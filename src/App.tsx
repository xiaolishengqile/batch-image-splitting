import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import { read, utils } from 'xlsx'
import { postImagesGenerations } from './api/imagesGenerations'
import { postImagesEdits } from './api/imagesEdits'
import {
  DEFAULT_API_BASE,
  DEFAULT_MODEL,
  DEFAULT_SIZE,
  DEFAULT_VARIATION_COUNT,
  DEFAULT_EXPANSION_SCALE,
  BATCH_WINDOW_SIZE,
  BATCH_TIMEOUT_MS,
  BATCH_TIMEOUT_MESSAGE,
  CANCEL_MESSAGE,
  DEFAULT_BATCH_CONCURRENCY,
  MAX_BATCH_CONCURRENCY,
  MIN_BATCH_CONCURRENCY,
  normalizeBatchConcurrency,
  PROMPT_OUTPAINT_CN,
  STORAGE_KEY_CONCURRENCY,
  PROMPT_VARIATION_CN,
  SIZE_OPTIONS,
  STORAGE_KEY_BASE,
  STORAGE_KEY_MODEL,
  STORAGE_KEY_TOKEN,
  STORAGE_KEY_SIZE,
  STORAGE_KEY_PREFIX,
  STORAGE_KEY_EXPANSION_SCALE,
  STORAGE_KEY_VARIATION_COUNT,
} from './lib/constants'
import {
  supportsSaveToFolder,
  pickSaveDirectoryHandle,
  writeImageToDirectory,
  getImageFilesFromDataTransfer,
} from './lib/files'
import { closestAspectLabel, is2kSizeLabel, sizeForAspect } from './lib/imageAspect'
import { calculateExpandedSize, getImageDimensions, isValidSizeFormat } from './lib/imageSize'
import './App.css'

type JobStatus = 'queued' | 'running' | 'done' | 'error'
type JobType = 'outpaint' | 'variation' | 'text2img'

interface Job {
  id: string
  file?: File
  previewObjectUrl?: string
  status: JobStatus
  error?: string
  resultDataUrl?: string
  addedSeq: number
  completedAt?: number
  jobType: JobType
  prompt?: string
  targetSize?: string
  outputName?: string
}

interface ExcelPrompt {
  id: string
  prompt: string
  status: JobStatus
  error?: string
  resultDataUrl?: string
  addedSeq: number
  completedAt?: number
  outputName?: string
}

function extensionFromMime(dataUrl: string): string {
  if (dataUrl.includes('image/jpeg') || dataUrl.includes('image/jpg')) return 'jpg'
  if (dataUrl.includes('image/webp')) return 'webp'
  return 'png'
}

function truncateLabel(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return `${text.slice(0, maxLen)}…`
}

function cellToPrompt(cell: unknown): string | null {
  if (cell == null || cell === '') return null
  if (typeof cell === 'string') {
    const trimmed = cell.trim()
    return trimmed || null
  }
  if (typeof cell === 'number' || typeof cell === 'boolean') {
    const trimmed = String(cell).trim()
    return trimmed || null
  }
  return null
}

function revokeJobPreview(job: Job) {
  if (job.previewObjectUrl) {
    try {
      URL.revokeObjectURL(job.previewObjectUrl)
    } catch {
      /* ignore */
    }
  }
}

function readInitialSizeState(): { size: string; customSize: string; useCustomSize: boolean } {
  const saved = localStorage.getItem(STORAGE_KEY_SIZE) ?? DEFAULT_SIZE
  if (SIZE_OPTIONS.includes(saved)) {
    return { size: saved, customSize: '', useCustomSize: false }
  }
  return { size: DEFAULT_SIZE, customSize: saved, useCustomSize: true }
}

export default function App() {
  // API 设置 - 如果 localStorage 中是 .cn 域名，自动修正为 .org
  const [apiBase, setApiBase] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_BASE)
    if (saved && saved.includes('ai.t8star.cn')) {
      // 自动修正为 .org
      const corrected = saved.replace('ai.t8star.cn', 'ai.t8star.org')
      localStorage.setItem(STORAGE_KEY_BASE, corrected)
      return corrected
    }
    return saved ?? DEFAULT_API_BASE
  })
  const [apiToken, setApiToken] = useState(() => localStorage.getItem(STORAGE_KEY_TOKEN) ?? '')
  const initialSizeState = useMemo(() => readInitialSizeState(), [])
  const [model, setModel] = useState(() => localStorage.getItem(STORAGE_KEY_MODEL) ?? DEFAULT_MODEL)
  const [size, setSize] = useState(initialSizeState.size)
  const [customSize, setCustomSize] = useState(initialSizeState.customSize)
  const [useCustomSize, setUseCustomSize] = useState(initialSizeState.useCustomSize)
  const [prefix, setPrefix] = useState(() => localStorage.getItem(STORAGE_KEY_PREFIX) ?? 'A')

  // 功能设置
  const [expansionScale, setExpansionScale] = useState(
    () => localStorage.getItem(STORAGE_KEY_EXPANSION_SCALE) ?? DEFAULT_EXPANSION_SCALE,
  )
  const [variationCount, setVariationCount] = useState(() => {
    const n = parseInt(localStorage.getItem(STORAGE_KEY_VARIATION_COUNT) ?? String(DEFAULT_VARIATION_COUNT), 10)
    return Number.isFinite(n) ? Math.max(1, Math.min(10, n)) : DEFAULT_VARIATION_COUNT
  })

  // 功能开关
  const [enableOutpaint, setEnableOutpaint] = useState(true)
  const [enableVariation, setEnableVariation] = useState(false)
  const [enableText2Img, setEnableText2Img] = useState(false)
  const [isInputDragOver, setIsInputDragOver] = useState(false)

  // 数据状态
  const [inputFiles, setInputFiles] = useState<File[]>([])
  const [excelPrompts, setExcelPrompts] = useState<ExcelPrompt[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [isRunning, setIsRunning] = useState(false)
  // 批次处理状态
  const [totalTaskCount, setTotalTaskCount] = useState<number>(0)
  const [processedTaskCount, setProcessedTaskCount] = useState<number>(0)
  // 并发数：输入框用字符串，允许清空后重输；失焦或开始处理时再规范化
  const [concurrencyInput, setConcurrencyInput] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_CONCURRENCY)
    if (!saved) return String(DEFAULT_BATCH_CONCURRENCY)
    return String(normalizeBatchConcurrency(saved))
  })

  // Excel 相关
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [excelPreview, setExcelPreview] = useState<string[][]>([])

  // 保存文件夹相关
  const [saveFolderName, setSaveFolderName] = useState<string | null>(null)
  const saveFolderHandleRef = useRef<FileSystemDirectoryHandle | null>(null)
  const [autoSaveAfterGenerate, setAutoSaveAfterGenerate] = useState(false)
  const autoSaveUsedNamesRef = useRef<Set<string>>(new Set())

  const addedSeqRef = useRef(0)
  const cancelRef = useRef(false)
  const activeAbortControllersRef = useRef<Set<AbortController>>(new Set())
  const runInProgressRef = useRef(false)

  const inputPreviewUrls = useMemo(
    () => inputFiles.map((file) => URL.createObjectURL(file)),
    [inputFiles],
  )

  // 持久化设置
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_BASE, apiBase)
  }, [apiBase])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TOKEN, apiToken)
  }, [apiToken])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_MODEL, model)
  }, [model])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SIZE, useCustomSize ? customSize : size)
  }, [size, customSize, useCustomSize])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_PREFIX, prefix)
  }, [prefix])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_EXPANSION_SCALE, expansionScale)
  }, [expansionScale])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_VARIATION_COUNT, String(variationCount))
  }, [variationCount])
  const commitConcurrencyInput = useCallback(() => {
    const normalized = String(normalizeBatchConcurrency(concurrencyInput))
    setConcurrencyInput(normalized)
    localStorage.setItem(STORAGE_KEY_CONCURRENCY, normalized)
  }, [concurrencyInput])

  useEffect(() => {
    return () => {
      inputPreviewUrls.forEach((url) => {
        try {
          URL.revokeObjectURL(url)
        } catch {
          /* ignore */
        }
      })
    }
  }, [inputPreviewUrls])

  const jobStats = useMemo(() => {
    let done = 0
    let running = 0
    let error = 0
    for (const j of jobs) {
      if (j.status === 'done') done++
      else if (j.status === 'running') running++
      else if (j.status === 'error') error++
    }
    return { done, running, error, total: jobs.length, processed: processedTaskCount, grandTotal: totalTaskCount }
  }, [jobs, processedTaskCount, totalTaskCount])

  const updateJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))
  }, [])

  // 处理输入文件
  const handleFilesSelected = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => /^image\//.test(f.type))
    if (arr.length === 0) return
    setInputFiles((prev) => [...prev, ...arr])
  }, [])

  useEffect(() => {
    if (!enableOutpaint && !enableVariation) return
    const onPaste = (e: ClipboardEvent) => {
      if (isRunning) return
      const dt = e.clipboardData
      if (!dt) return
      const files = getImageFilesFromDataTransfer(dt)
      if (files.length === 0) return
      e.preventDefault()
      handleFilesSelected(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [isRunning, enableOutpaint, enableVariation, handleFilesSelected])

  // 移除输入文件
  const removeInputFile = useCallback((index: number) => {
    setInputFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clearInputFiles = useCallback(() => {
    setInputFiles([])
  }, [])

  // 处理 Excel 文件
  const handleExcelFile = useCallback(async (file: File) => {
    setExcelFile(file)
    const arrayBuffer = await file.arrayBuffer()
    const workbook = read(arrayBuffer)
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const data: string[][] = utils.sheet_to_json(worksheet, { header: 1 })
    setExcelPreview(data)

    // 提取提示词
    const prompts: ExcelPrompt[] = []
    data.forEach((row) => {
      row.forEach((cell) => {
        const prompt = cellToPrompt(cell)
        if (prompt) {
          prompts.push({
            id: crypto.randomUUID(),
            prompt,
            status: 'queued',
            addedSeq: addedSeqRef.current++,
          })
        }
      })
    })
    setExcelPrompts(prompts)
  }, [])

  // 移除 Excel 提示词
  const removeExcelPrompt = useCallback((id: string) => {
    setExcelPrompts((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const clearExcelPrompts = useCallback(() => {
    setExcelPrompts([])
    setExcelFile(null)
    setExcelPreview([])
  }, [])

  // 停止运行
  const stopRun = useCallback(() => {
    cancelRef.current = true
    for (const ac of activeAbortControllersRef.current) {
      ac.abort()
    }
    activeAbortControllersRef.current.clear()
  }, [])

  // 生成输出名称
  const generateOutputName = useCallback(
    (prefix: string, seq: number): string => {
      return `${prefix}${seq}`
    },
    [],
  )

  // 生成完成后自动保存到文件夹
  const saveJobToFolder = useCallback(async (job: Job, used: Set<string>) => {
    if (!autoSaveAfterGenerate || !job.resultDataUrl || !job.outputName) return
    const dir = saveFolderHandleRef.current
    if (!dir) return
    try {
      await writeImageToDirectory(dir, job.resultDataUrl, `${job.outputName}.${extensionFromMime(job.resultDataUrl)}`, used)
    } catch (e) {
      console.error('自动保存失败:', e)
    }
  }, [autoSaveAfterGenerate])

  // 运行批处理 - 分批处理版本（每批最多 10 张，单批最长 3 分钟）
  const runBatch = useCallback(async () => {
    if (runInProgressRef.current) return

    const token = apiToken.trim()
    if (!token) {
      alert('请先填写 API 密钥。')
      return
    }
    const base = apiBase.trim()
    if (!base) {
      alert('请填写接口地址。')
      return
    }

    const normalizedConcurrency = String(normalizeBatchConcurrency(concurrencyInput))
    setConcurrencyInput(normalizedConcurrency)
    localStorage.setItem(STORAGE_KEY_CONCURRENCY, normalizedConcurrency)

    // 快照当前输入，避免运行中 state 变化导致重复或遗漏
    const filesSnapshot = inputFiles
    const promptsSnapshot = excelPrompts
    const baseSize = useCustomSize ? customSize.trim() : size
    if (!isValidSizeFormat(baseSize)) {
      alert('输出尺寸格式无效，请使用「宽x高」格式，例如 1024x1024。')
      return
    }
    const use2kOutput = is2kSizeLabel(baseSize)

    // 构建任务队列
    type TaskItem = {
      file?: File
      fileIndex?: number
      prompt?: string
      promptIndex?: number
      jobType: JobType
      variationIndex?: number
    }

    const taskQueue: TaskItem[] = []

    if (enableOutpaint && filesSnapshot.length > 0) {
      filesSnapshot.forEach((file, index) => {
        taskQueue.push({ file, fileIndex: index, jobType: 'outpaint' })
      })
    }

    if (enableVariation && filesSnapshot.length > 0) {
      filesSnapshot.forEach((file, index) => {
        for (let i = 0; i < variationCount; i++) {
          taskQueue.push({ file, fileIndex: index, jobType: 'variation', variationIndex: i })
        }
      })
    }

    if (enableText2Img && promptsSnapshot.length > 0) {
      promptsSnapshot.forEach((p, index) => {
        taskQueue.push({ prompt: p.prompt, promptIndex: index, jobType: 'text2img' })
      })
    }

    if (taskQueue.length === 0) {
      alert('请至少选择一个功能并添加输入内容。')
      return
    }

    if (autoSaveAfterGenerate && !saveFolderHandleRef.current) {
      alert('已开启「生成后自动保存」，请先在「开始处理」区域选择保存文件夹。')
      return
    }

    const totalTasks = taskQueue.length
    setTotalTaskCount(totalTasks)
    setProcessedTaskCount(0)

    runInProgressRef.current = true
    cancelRef.current = false
    setIsRunning(true)

    let outputSeq = 1

    const resolveEditParams = async (
      file: File,
      jobType: 'outpaint' | 'variation',
    ): Promise<{ prompt: string; size: string; aspect_ratio: string }> => {
      const { width, height } = await getImageDimensions(file)
      if (jobType === 'outpaint') {
        const expanded = calculateExpandedSize(width, height, parseFloat(expansionScale))
        const aspect = closestAspectLabel(expanded.width, expanded.height)
        return {
          prompt: PROMPT_OUTPAINT_CN,
          size: sizeForAspect(aspect, baseSize, use2kOutput),
          aspect_ratio: aspect,
        }
      }
      const aspect = closestAspectLabel(width, height)
      return {
        prompt: PROMPT_VARIATION_CN,
        size: sizeForAspect(aspect, baseSize, use2kOutput),
        aspect_ratio: aspect,
      }
    }

    const runOneTask = async (
      task: TaskItem,
      batchCtx: { timedOut: { current: boolean }; activeControllers: Set<AbortController> },
    ): Promise<{ outputName: string; resultDataUrl: string } | null> => {
      if (cancelRef.current || batchCtx.timedOut.current) return null

      const ac = new AbortController()
      batchCtx.activeControllers.add(ac)
      activeAbortControllersRef.current.add(ac)

      try {
        let imageDataUrl: string

        if (task.jobType === 'text2img') {
          const result = await postImagesGenerations(
            base,
            token,
            {
              model: model.trim() || DEFAULT_MODEL,
              prompt: task.prompt ?? '',
              size: baseSize,
            },
            ac.signal,
          )
          imageDataUrl = result.imageDataUrl
        } else {
          if (!task.file) {
            throw new Error('缺少输入图片')
          }
          const editParams = await resolveEditParams(task.file, task.jobType)
          const result = await postImagesEdits(
            base,
            token,
            {
              model: model.trim() || DEFAULT_MODEL,
              prompt: editParams.prompt,
              size: editParams.size,
              aspect_ratio: editParams.aspect_ratio,
              images: [task.file],
            },
            ac.signal,
          )
          imageDataUrl = result.imageDataUrl
        }

        if (batchCtx.timedOut.current) return null

        const outputName = generateOutputName(prefix, outputSeq++)
        return { outputName, resultDataUrl: imageDataUrl }
      } catch (e) {
        if (cancelRef.current || batchCtx.timedOut.current || (e instanceof DOMException && e.name === 'AbortError')) {
          return null
        }
        throw e
      } finally {
        batchCtx.activeControllers.delete(ac)
        activeAbortControllersRef.current.delete(ac)
      }
    }

    let taskCursor = 0

    try {
      while (taskCursor < totalTasks && !cancelRef.current) {
        const batchStart = taskCursor
        const batchEnd = Math.min(batchStart + BATCH_WINDOW_SIZE, totalTasks)
        const batchTasks = taskQueue.slice(batchStart, batchEnd)
        const currentBatchSize = batchTasks.length

        const batchJobs: Job[] = batchTasks.map((task) => ({
          id: crypto.randomUUID(),
          file: task.file,
          previewObjectUrl: task.file ? URL.createObjectURL(task.file) : undefined,
          status: 'queued' as JobStatus,
          jobType: task.jobType,
          prompt: task.prompt,
          addedSeq: addedSeqRef.current++,
        }))

        setJobs((prev) => {
          const keep = batchStart === 0 ? [] : prev.filter((j) => j.status === 'done' || j.status === 'error')
          const drop = batchStart === 0 ? prev : prev.filter((j) => j.status !== 'done' && j.status !== 'error')
          drop.forEach(revokeJobPreview)
          if (batchStart === 0) prev.forEach(revokeJobPreview)
          return [...keep, ...batchJobs]
        })

        const concurrency = Math.min(normalizeBatchConcurrency(normalizedConcurrency), currentBatchSize)
        let taskIdxInBatch = 0
        const batchCtx = {
          timedOut: { current: false },
          activeControllers: new Set<AbortController>(),
        }
        const jobSettled = new Set<string>()

        const markJobFinished = (jobId: string, patch: Partial<Job>) => {
          updateJob(jobId, patch)
          if (!jobSettled.has(jobId)) {
            jobSettled.add(jobId)
            setProcessedTaskCount((prev) => prev + 1)
          }
        }

        const worker = async () => {
          while (!cancelRef.current && !batchCtx.timedOut.current) {
            const myTask = taskIdxInBatch++
            if (myTask >= batchTasks.length) return

            const task = batchTasks[myTask]
            const jobId = batchJobs[myTask].id

            updateJob(jobId, { status: 'running' })

            try {
              const result = await runOneTask(task, batchCtx)
              if (result) {
                markJobFinished(jobId, {
                  status: 'done',
                  resultDataUrl: result.resultDataUrl,
                  completedAt: Date.now(),
                  outputName: result.outputName,
                })
                void saveJobToFolder(
                  {
                    ...batchJobs[myTask],
                    resultDataUrl: result.resultDataUrl,
                    outputName: result.outputName,
                  },
                  autoSaveUsedNamesRef.current,
                )
              } else if (batchCtx.timedOut.current) {
                markJobFinished(jobId, { status: 'error', error: BATCH_TIMEOUT_MESSAGE })
              } else if (cancelRef.current) {
                markJobFinished(jobId, { status: 'error', error: CANCEL_MESSAGE })
              } else {
                markJobFinished(jobId, { status: 'error', error: '任务已中断' })
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              markJobFinished(jobId, { status: 'error', error: msg })
            }
          }
        }

        const workersPromise = Promise.all(Array.from({ length: concurrency }, () => worker()))

        const batchTimer = setTimeout(() => {
          batchCtx.timedOut.current = true
          for (const ac of batchCtx.activeControllers) {
            ac.abort()
          }
        }, BATCH_TIMEOUT_MS)

        await workersPromise
        clearTimeout(batchTimer)

        if (batchCtx.timedOut.current) {
          for (const job of batchJobs) {
            if (!jobSettled.has(job.id)) {
              markJobFinished(job.id, { status: 'error', error: BATCH_TIMEOUT_MESSAGE })
            }
          }
        }

        taskCursor = batchEnd

        if (!cancelRef.current && batchEnd < totalTasks) {
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
      }
    } finally {
      activeAbortControllersRef.current.clear()
      runInProgressRef.current = false
      setIsRunning(false)
    }
  }, [
    apiBase,
    apiToken,
    enableOutpaint,
    enableVariation,
    enableText2Img,
    inputFiles,
    excelPrompts,
    expansionScale,
    variationCount,
    model,
    size,
    customSize,
    useCustomSize,
    prefix,
    concurrencyInput,
    CANCEL_MESSAGE,
    updateJob,
    generateOutputName,
    saveJobToFolder,
    autoSaveAfterGenerate,
  ])

  const downloadOne = useCallback((job: Job) => {
    if (!job.resultDataUrl) return
    const a = document.createElement('a')
    a.href = job.resultDataUrl
    const ext = extensionFromMime(job.resultDataUrl)
    a.download = `${job.outputName ?? 'image'}.${ext}`
    a.click()
  }, [])

  // 删除单个 job
  const removeJob = useCallback((jobId: string) => {
    if (isRunning) return
    setJobs((prev) => {
      const job = prev.find((j) => j.id === jobId)
      if (job) revokeJobPreview(job)
      return prev.filter((j) => j.id !== jobId)
    })
  }, [isRunning])

  const clearAllJobs = useCallback(() => {
    if (isRunning) return
    setJobs((prev) => {
      prev.forEach(revokeJobPreview)
      return []
    })
  }, [isRunning])

  const onPickSaveFolder = useCallback(async () => {
    try {
      const dir = await pickSaveDirectoryHandle()
      saveFolderHandleRef.current = dir
      setSaveFolderName(dir.name)
      autoSaveUsedNamesRef.current = new Set()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      alert(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const onClearSaveFolder = useCallback(() => {
    saveFolderHandleRef.current = null
    setSaveFolderName(null)
    autoSaveUsedNamesRef.current = new Set()
  }, [])

  const onSaveDoneToFolder = useCallback(async () => {
    const done = jobs.filter((j) => j.status === 'done' && j.resultDataUrl)
    if (done.length === 0) {
      alert('还没有生成完成的图片。')
      return
    }
    const dir = saveFolderHandleRef.current
    if (!dir) {
      alert('请先在「开始处理」区域选择保存文件夹。')
      return
    }
    try {
      const used = new Set<string>()
      for (const job of done) {
        if (job.resultDataUrl && job.outputName) {
          await writeImageToDirectory(dir, job.resultDataUrl, `${job.outputName}.${extensionFromMime(job.resultDataUrl)}`, used)
        }
      }
      alert(`已保存 ${done.length} 张图片到「${dir.name}」。`)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      alert(err instanceof Error ? err.message : String(err))
    }
  }, [jobs])

  const downloadZip = useCallback(async () => {
    const done = jobs.filter((j) => j.status === 'done' && j.resultDataUrl)
    if (done.length === 0) {
      alert('还没有生成完成的图片。')
      return
    }
    const zip = new JSZip()
    for (const job of done) {
      const res = await fetch(job.resultDataUrl!)
      const blob = await res.blob()
      const ext = extensionFromMime(job.resultDataUrl!)
      zip.file(`${job.outputName ?? 'image'}.${ext}`, blob)
    }
    const out = await zip.generateAsync({ type: 'blob' })
    saveAs(out, `批量处理结果-${new Date().toISOString().slice(0, 10)}.zip`)
  }, [jobs])

  const displayJobs = useMemo(() => {
    const rank = (s: JobStatus) => (s === 'done' ? 0 : s === 'running' ? 1 : s === 'queued' ? 2 : 3)
    return [...jobs].sort((a, b) => {
      const ra = rank(a.status)
      const rb = rank(b.status)
      if (ra !== rb) return ra - rb
      if (a.status === 'done' && b.status === 'done') {
        return (a.completedAt ?? 0) - (b.completedAt ?? 0)
      }
      return a.addedSeq - b.addedSeq
    })
  }, [jobs])

  const canStart = Boolean(
    apiToken.trim() &&
      (((enableOutpaint || enableVariation) && inputFiles.length > 0) ||
        (enableText2Img && excelPrompts.length > 0)),
  )

  const enabledFeatureCount =
    Number(enableOutpaint && inputFiles.length > 0) +
    Number(enableVariation && inputFiles.length > 0) +
    Number(enableText2Img && excelPrompts.length > 0)

  const totalBatchCount = totalTaskCount > 0 ? Math.ceil(totalTaskCount / BATCH_WINDOW_SIZE) : 0

  return (
    <div className="app">
      <header className="app-header">
        <h1>图片批量处理工具</h1>
        <p className="app-tagline">图片扩充 · 图片裂变 · Excel 文生图</p>
      </header>

      {/* 主布局：左右两列 */}
      <div className="app-layout">
        {/* 左侧边栏 */}
        <aside className="app-sidebar">
          {/* API 设置 */}
          <div className="sidebar-card">
            <h3>API 设置</h3>
            <div className="field">
              <label htmlFor="token">API 密钥</label>
              <input
                id="token"
                className="toolbar-input"
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
              />
              <span className="token-privacy-hint">密钥仅保存在本机浏览器，请勿在公共电脑使用。</span>
            </div>
            <div className="field">
              <label htmlFor="base">接口地址</label>
              <input
                id="base"
                type="url"
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
                placeholder="https://ai.t8star.org"
              />
            </div>
            <div className="field">
              <label htmlFor="model">模型</label>
              <input
                id="model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-image-2"
              />
            </div>
            <div className="field">
              <label htmlFor="concurrency">并发数</label>
              <input
                id="concurrency"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={concurrencyInput}
                disabled={isRunning}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '' || /^\d{1,2}$/.test(v)) {
                    setConcurrencyInput(v)
                  }
                }}
                onBlur={commitConcurrencyInput}
                placeholder={String(DEFAULT_BATCH_CONCURRENCY)}
              />
              <span className="field-hint">
                同时处理的请求数（{MIN_BATCH_CONCURRENCY}-{MAX_BATCH_CONCURRENCY}）
              </span>
            </div>
          </div>

          {/* 功能开关 */}
          <div className="sidebar-card">
            <h3>功能选择</h3>
            <div className="feature-toggles">
              <label className="feature-toggle">
                <input
                  type="checkbox"
                  checked={enableOutpaint}
                  onChange={(e) => setEnableOutpaint(e.target.checked)}
                />
                <span>图片扩充</span>
              </label>
              <label className="feature-toggle">
                <input
                  type="checkbox"
                  checked={enableVariation}
                  onChange={(e) => setEnableVariation(e.target.checked)}
                />
                <span>图片裂变</span>
              </label>
              <label className="feature-toggle">
                <input
                  type="checkbox"
                  checked={enableText2Img}
                  onChange={(e) => setEnableText2Img(e.target.checked)}
                />
                <span>Excel 文生图</span>
              </label>
            </div>
          </div>

          {/* 输出设置 */}
          <div className="sidebar-card">
            <h3>输出设置</h3>
            <div className="field">
              <label htmlFor="size">输出尺寸</label>
              <select
                id="size"
                value={useCustomSize ? 'custom' : size}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setUseCustomSize(true)
                    setCustomSize(size)
                  } else {
                    setUseCustomSize(false)
                    setSize(e.target.value)
                  }
                }}
              >
                {SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                <option value="custom">自定义...</option>
              </select>
              {useCustomSize && (
                <input
                  type="text"
                  value={customSize}
                  onChange={(e) => setCustomSize(e.target.value)}
                  placeholder="宽 x 高，如 1024x1024"
                  className="custom-size-input"
                />
              )}
            </div>
            <div className="field">
              <label htmlFor="prefix">图片名前缀</label>
              <input
                id="prefix"
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="A"
              />
              <span className="field-hint">示例：A1, A2, A3...</span>
            </div>
          </div>

          {/* 功能特定设置 */}
          {(enableOutpaint || enableVariation) && (
            <div className="sidebar-card">
              <h3>功能参数</h3>
              <div className="feature-settings">
                {enableOutpaint && (
                  <div className="setting-row">
                    <label>扩充比例</label>
                    <select
                      value={expansionScale}
                      onChange={(e) => setExpansionScale(e.target.value)}
                    >
                      <option value="1.25">1.25 倍</option>
                      <option value="1.5">1.5 倍</option>
                      <option value="1.75">1.75 倍</option>
                      <option value="2">2 倍</option>
                    </select>
                  </div>
                )}
                {enableVariation && (
                  <div className="setting-row">
                    <label>裂变数量</label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={variationCount}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10)
                        if (!Number.isFinite(v)) return
                        setVariationCount(Math.max(1, Math.min(10, v)))
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* 右侧主内容区 */}
        <main className="app-main">
          {/* 功能一&二：图片输入 */}
          {(enableOutpaint || enableVariation) && (
            <div className="settings-card">
              <div className="settings-card-head">
                <h2>📁 输入图片</h2>
              </div>
              <div className="settings-card-body">
                <div
                  className={`input-dropzone${isInputDragOver ? ' is-dragover' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (!isRunning) setIsInputDragOver(true)
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault()
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return
                    setIsInputDragOver(false)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsInputDragOver(false)
                    if (isRunning) return
                    const files = getImageFilesFromDataTransfer(e.dataTransfer)
                    if (files.length) handleFilesSelected(files)
                  }}
                >
                <p className="dropzone-sub" style={{ margin: 0 }}>
                  上传图片、拖拽到此处，或粘贴 (Ctrl/Cmd + V) · 支持多选
                </p>

                <div className="excel-upload-row">
                  <label className="btn btn-secondary">
                    选择图片
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={isRunning}
                      onChange={(e) => {
                        if (e.target.files?.length) {
                          handleFilesSelected(e.target.files)
                        }
                        e.target.value = ''
                      }}
                    />
                  </label>
                  <label className="btn btn-secondary">
                    从文件夹导入
                    <input
                      type="file"
                      // @ts-ignore - webkitdirectory 是非标准属性
                      webkitdirectory=""
                      disabled={isRunning}
                      onChange={(e) => {
                        if (e.target.files?.length) {
                          handleFilesSelected(e.target.files)
                        }
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>

                {inputFiles.length > 0 && (
                  <div className="input-files-list">
                    <div className="input-files-header">
                      <span>
                        已添加 {inputFiles.length} 张图片（预览前 20 张
                        {inputFiles.length > 20 ? `，另有 ${inputFiles.length - 20} 张未展示` : ''}）
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={isRunning}
                        onClick={clearInputFiles}
                      >
                        清空
                      </button>
                    </div>
                    <div className="input-files-grid">
                      {inputFiles.slice(0, 20).map((file, index) => (
                        <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="input-file-item">
                          <img
                            src={inputPreviewUrls[index]}
                            alt={file.name}
                            title={file.name}
                          />
                          <button
                            type="button"
                            className="remove-btn"
                            disabled={isRunning}
                            onClick={() => removeInputFile(index)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                </div>
              </div>
            </div>
          )}

          {/* 功能三：Excel 文生图 */}
          {enableText2Img && (
            <div className="settings-card">
              <div className="settings-card-head">
                <h2>📊 Excel 提示词</h2>
              </div>
              <div className="settings-card-body">
                <p className="dropzone-sub" style={{ margin: 0 }}>
                  上传 Excel 文件，每个单元格是一个提示词
                </p>

                <div className="excel-upload-row">
                  <label className="btn btn-secondary">
                    选择 Excel 文件 (.xlsx)
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      disabled={isRunning}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleExcelFile(file)
                        e.target.value = ''
                      }}
                    />
                  </label>
                  {excelFile && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={isRunning}
                      onClick={clearExcelPrompts}
                    >
                      重新选择
                    </button>
                  )}
                </div>

                {excelFile && (
                  <div className="excel-preview">
                    <div className="excel-preview-header">
                      <span>文件：{excelFile.name} · 共 {excelPrompts.length} 个提示词</span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={isRunning}
                        onClick={clearExcelPrompts}
                      >
                        清空
                      </button>
                    </div>

                    {/* Excel 表格预览 - 显示前 5 行 */}
                    {excelPreview.length > 0 && (
                      <details className="excel-details">
                        <summary className="excel-details-summary">
                          <span>表格预览（前 5 行）</span>
                        </summary>
                        <div className="excel-table-wrapper">
                          <table className="excel-table">
                            <tbody>
                              {excelPreview.slice(0, 5).map((row, i) => (
                                <tr key={i}>
                                  {row.map((cell, j) => (
                                    <td key={j} title={cell != null ? String(cell) : ''}>
                                      {cell != null ? String(cell) : ''}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {excelPreview.length > 5 && (
                            <p className="excel-more">... 还有 {excelPreview.length - 5} 行</p>
                          )}
                        </div>
                      </details>
                    )}

                    {/* 提示词列表 */}
                    {excelPrompts.length > 0 && (
                      <div className="prompts-list">
                        <div className="prompts-scroll">
                          {excelPrompts.map((p, index) => (
                            <div key={p.id} className="prompt-item">
                              <span className="prompt-index">{index + 1}.</span>
                              <span className="prompt-text" title={p.prompt}>{p.prompt}</span>
                              <button
                                type="button"
                                className="btn btn-ghost prompt-remove"
                                disabled={isRunning}
                                onClick={() => removeExcelPrompt(p.id)}
                                title="删除此提示词"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 执行按钮 */}
          <div className="action-card">
            <h3>🚀 开始处理</h3>

            <p className="batch-hint">
              每批最多 {BATCH_WINDOW_SIZE} 张，单批最长 3 分钟；超时未完成的会自动跳过并进入下一批。
            </p>
            {enabledFeatureCount > 1 ? (
              <p className="task-order-hint">
                多任务同时开启时按顺序执行：扩充 → 裂变 → Excel 文生图。
              </p>
            ) : null}

            {supportsSaveToFolder() ? (
              <div className="action-save-folder">
                <div className="action-save-folder-head">
                  <span className="action-save-folder-label">保存位置</span>
                  <span className={`action-save-folder-value${saveFolderName ? ' is-set' : ''}`}>
                    {saveFolderName ? saveFolderName : '未选择'}
                  </span>
                </div>
                <div className="action-save-folder-row">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={isRunning}
                    onClick={() => void onPickSaveFolder()}
                  >
                    {saveFolderName ? '更换保存文件夹' : '选择保存文件夹'}
                  </button>
                  {saveFolderName ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={isRunning}
                      onClick={onClearSaveFolder}
                    >
                      清除
                    </button>
                  ) : null}
                  <label className="feature-toggle action-save-folder-auto">
                    <input
                      type="checkbox"
                      checked={autoSaveAfterGenerate}
                      disabled={isRunning}
                      onChange={(e) => setAutoSaveAfterGenerate(e.target.checked)}
                    />
                    <span>生成后自动保存</span>
                  </label>
                </div>
                {!saveFolderName && canStart && !isRunning ? (
                  <p className="action-hint action-save-folder-hint">
                    建议生成前先选择保存文件夹；未选择时结果仅显示在页面中，需手动打包 ZIP 下载。
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="action-hint action-save-folder-hint">
                当前浏览器不支持直接保存到本地文件夹，请使用「打包下载 ZIP」。
              </p>
            )}

            <div className="action-row">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                disabled={isRunning || !canStart}
                onClick={() => void runBatch()}
              >
                {isRunning ? '正在处理…' : '开始生成'}
              </button>
              {isRunning ? (
                <button type="button" className="btn btn-ghost" onClick={stopRun}>
                  停止
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isRunning || jobStats.done === 0}
                onClick={() => void downloadZip()}
              >
                打包下载 ZIP ({jobStats.done})
              </button>
              {supportsSaveToFolder() ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isRunning || jobStats.done === 0 || !saveFolderName}
                  onClick={() => void onSaveDoneToFolder()}
                  title={saveFolderName ? undefined : '请先在下方「开始处理」区域选择保存文件夹'}
                >
                  保存已完成到文件夹 ({jobStats.done})
                </button>
              ) : null}
            </div>

            {!canStart && !isRunning ? (
              <p className="action-hint">
                {!apiToken.trim()
                  ? '请先填写 API 密钥'
                  : '请先添加输入内容'}
              </p>
            ) : null}

            {isRunning && totalTaskCount > 0 ? (
              <p className="progress-line">
                进度：已处理 {processedTaskCount} / {totalTaskCount}
                {jobStats.done > 0 ? ` · 成功 ${jobStats.done}` : ''}
                {jobStats.error > 0 ? ` · 失败 ${jobStats.error}` : ''}
                {jobStats.running > 0 ? ` · 进行中 ${jobStats.running}` : ''}
                {totalBatchCount > 1 ? ` · 共 ${totalBatchCount} 批` : ''}
              </p>
            ) : null}
            {!isRunning && jobs.length > 0 ? (
              <p className="results-summary">
                结果汇总：共 {jobs.length} 项 · 成功 {jobStats.done} · 失败 {jobStats.error}
              </p>
            ) : null}
          </div>

          {/* 生成结果 */}
          {jobs.length > 0 && (
            <div className="results-section">
              <div className="results-header">
                <h2 className="results-heading">生成结果</h2>
                <span className="results-summary">
                  成功 {jobStats.done} · 失败 {jobStats.error}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={isRunning}
                  onClick={clearAllJobs}
                  title="清空所有生成的图片"
                >
                  全部清空
                </button>
              </div>
              <div className="job-grid">
                {displayJobs.map((job) => {
                  const jobTitle = job.file?.name ?? job.prompt ?? '文生图'
                  return (
                  <article key={job.id} className="job-card">
                    <div className="job-card-head">
                      <span className="job-name" title={jobTitle}>
                        {truncateLabel(jobTitle, 24)}
                      </span>
                      <span className={`status status-${job.status}`}>
                        {job.status === 'queued' ? '等待' : job.status === 'running' ? '生成中' : job.status === 'done' ? '完成' : '失败'}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost job-remove"
                        disabled={isRunning}
                        onClick={() => removeJob(job.id)}
                        title="删除此项目"
                      >
                        ×
                      </button>
                    </div>
                    <div className="job-meta">
                      <span className="job-type">
                        {job.jobType === 'outpaint' ? '🖼️ 扩充' : job.jobType === 'variation' ? '✨ 裂变' : '📝 文生图'}
                      </span>
                      {job.outputName && <span className="job-output">{job.outputName}</span>}
                    </div>
                    <div className="job-images">
                      {job.previewObjectUrl && (
                        <figure>
                          <img src={job.previewObjectUrl} alt="原图" />
                          <figcaption>原图</figcaption>
                        </figure>
                      )}
                      <figure>
                        {job.resultDataUrl ? (
                          <img src={job.resultDataUrl} alt="生成图" />
                        ) : (
                          <span className="result-placeholder">
                            {job.status === 'running' ? '生成中…' : job.status === 'error' ? '失败' : '等待'}
                          </span>
                        )}
                        <figcaption>生成图</figcaption>
                      </figure>
                    </div>
                    {job.error ? <div className="job-error">{job.error}</div> : null}
                    <div className="job-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!job.resultDataUrl}
                        onClick={() => downloadOne(job)}
                      >
                        下载
                      </button>
                    </div>
                  </article>
                  )
                })}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
