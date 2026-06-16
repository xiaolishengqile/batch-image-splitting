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
  DEFAULT_BATCH_CONCURRENCY,
  MAX_BATCH_CONCURRENCY,
  MIN_BATCH_CONCURRENCY,
  normalizeBatchConcurrency,
  PROMPT_OUTPAINT_CN,
  STORAGE_KEY_CONCURRENCY,
  PROMPT_VARIATION,
  SIZE_OPTIONS,
  STORAGE_KEY_BASE,
  STORAGE_KEY_TOKEN,
  STORAGE_KEY_SIZE,
  STORAGE_KEY_PREFIX,
  STORAGE_KEY_EXPANSION_SCALE,
  STORAGE_KEY_VARIATION_COUNT,
} from './lib/constants'
import { supportsSaveToFolder, pickSaveDirectoryHandle, writeImageToDirectory } from './lib/files'
import { closestAspectLabel, is2kSizeLabel, sizeForAspect } from './lib/imageAspect'
import { calculateExpandedSize, getImageDimensions } from './lib/imageSize'
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
  // 分批处理相关
  batchIndex?: number  // 当前任务在批次中的索引 (0-9)
  totalBatches?: number  // 总批次数
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
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [size, setSize] = useState(() => localStorage.getItem(STORAGE_KEY_SIZE) ?? DEFAULT_SIZE)
  const [customSize, setCustomSize] = useState('')
  const [useCustomSize, setUseCustomSize] = useState(false)
  const [prefix, setPrefix] = useState(() => localStorage.getItem(STORAGE_KEY_PREFIX) ?? 'A')

  // 功能设置
  const [expansionScale, setExpansionScale] = useState(
    () => localStorage.getItem(STORAGE_KEY_EXPANSION_SCALE) ?? DEFAULT_EXPANSION_SCALE,
  )
  const [variationCount, setVariationCount] = useState(
    () => parseInt(localStorage.getItem(STORAGE_KEY_VARIATION_COUNT) ?? String(DEFAULT_VARIATION_COUNT), 10),
  )

  // 功能开关
  const [enableOutpaint, setEnableOutpaint] = useState(true)
  const [enableVariation, setEnableVariation] = useState(false)
  const [enableText2Img, setEnableText2Img] = useState(false)

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
  // 已处理的文件索引（用于从 inputFiles 中移除已处理完的文件）
  const processedFileIndexRef = useRef<number>(0)

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
  const abortRef = useRef<AbortController | null>(null)
  const runInProgressRef = useRef(false)

  // 持久化设置
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_BASE, apiBase)
  }, [apiBase])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TOKEN, apiToken)
  }, [apiToken])
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

  // 清理 URL 对象
  useEffect(() => {
    return () => {
      inputFiles.forEach((f) => {
        try { URL.revokeObjectURL(URL.createObjectURL(f)) } catch {}
      })
      jobs.forEach((j) => {
        if (j.previewObjectUrl) {
          try { URL.revokeObjectURL(j.previewObjectUrl) } catch {}
        }
      })
    }
  }, [inputFiles, jobs])

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
        if (cell && typeof cell === 'string' && cell.trim()) {
          prompts.push({
            id: crypto.randomUUID(),
            prompt: cell.trim(),
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
    abortRef.current?.abort()
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

  // 运行批处理 - 分批处理版本（每批 10 个，处理完后从输入列表中移除）
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
    const baseSize = useCustomSize ? customSize : size
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
      alert('已开启「生成后自动保存」，请先在左侧选择保存文件夹。')
      return
    }

    const totalTasks = taskQueue.length
    setTotalTaskCount(totalTasks)
    setProcessedTaskCount(0)
    processedFileIndexRef.current = 0

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
        prompt: PROMPT_VARIATION,
        size: sizeForAspect(aspect, baseSize, use2kOutput),
        aspect_ratio: aspect,
      }
    }

    const runOneTask = async (task: TaskItem): Promise<{ outputName: string; resultDataUrl: string } | null> => {
      if (cancelRef.current) return null

      const ac = new AbortController()
      abortRef.current = ac

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

        const outputName = generateOutputName(prefix, outputSeq++)
        return { outputName, resultDataUrl: imageDataUrl }
      } catch (e) {
        if (cancelRef.current || (e instanceof DOMException && e.name === 'AbortError')) {
          return null
        }
        throw e
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
          if (batchStart === 0) return batchJobs
          const finished = prev.filter((j) => j.status === 'done' || j.status === 'error')
          return [...finished, ...batchJobs]
        })

        const concurrency = Math.min(normalizeBatchConcurrency(normalizedConcurrency), currentBatchSize)
        let taskIdxInBatch = 0

        const worker = async () => {
          while (!cancelRef.current) {
            const myTask = taskIdxInBatch++
            if (myTask >= batchTasks.length) return

            const task = batchTasks[myTask]
            const jobId = batchJobs[myTask].id

            updateJob(jobId, { status: 'running' })

            try {
              const result = await runOneTask(task)
              if (result) {
                updateJob(jobId, {
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
              } else {
                updateJob(jobId, { status: 'queued' })
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              updateJob(jobId, { status: 'error', error: msg })
            }

            setProcessedTaskCount((prev) => prev + 1)
          }
        }

        await Promise.all(Array.from({ length: concurrency }, () => worker()))

        taskCursor = batchEnd

        if (!cancelRef.current && batchEnd < totalTasks) {
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
      }
    } finally {
      abortRef.current = null
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
      const job = prev.find(j => j.id === jobId)
      if (job?.previewObjectUrl) {
        try { URL.revokeObjectURL(job.previewObjectUrl) } catch {}
      }
      return prev.filter(j => j.id !== jobId)
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
      alert('请先在左侧「保存位置」中选择文件夹。')
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
      ((enableOutpaint || enableVariation) && inputFiles.length > 0) ||
      (enableText2Img && excelPrompts.length > 0),
  )

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

          {supportsSaveToFolder() ? (
            <div className="sidebar-card">
              <h3>保存位置</h3>
              <p className="save-folder-status">
                {saveFolderName ? (
                  <>当前文件夹：<strong>{saveFolderName}</strong></>
                ) : (
                  '尚未选择，生成前可先指定保存目录'
                )}
              </p>
              <div className="save-folder-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isRunning}
                  onClick={() => void onPickSaveFolder()}
                >
                  {saveFolderName ? '更换文件夹' : '选择保存文件夹'}
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
              </div>
              <label className="feature-toggle save-folder-auto">
                <input
                  type="checkbox"
                  checked={autoSaveAfterGenerate}
                  disabled={isRunning}
                  onChange={(e) => setAutoSaveAfterGenerate(e.target.checked)}
                />
                <span>生成后自动保存到上述文件夹</span>
              </label>
            </div>
          ) : null}

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
                      onChange={(e) => setVariationCount(parseInt(e.target.value, 10))}
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
                <p className="dropzone-sub" style={{ margin: 0 }}>
                  上传图片或选择文件夹，支持多选 · 粘贴 (Ctrl/Cmd + V)
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
                    选择文件夹
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
                      <span>已添加 {inputFiles.length} 张图片（显示前 20 张）</span>
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
                        <div key={`${file.name}-${index}`} className="input-file-item">
                          <img
                            src={URL.createObjectURL(file)}
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
                                    <td key={j} title={cell || ''}>{cell}</td>
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
                  title={saveFolderName ? undefined : '请先在左侧选择保存文件夹'}
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
              <>
                <p className="progress-line">
                  进度：已完成 {jobStats.done} / {totalTaskCount}
                  {jobStats.running > 0 ? ` · 进行中 ${jobStats.running}` : ''}
                  {jobStats.error > 0 ? ` · 失败 ${jobStats.error}` : ''}
                </p>
                {totalTaskCount > BATCH_WINDOW_SIZE ? (
                  <p className="progress-line">
                    已处理 {processedTaskCount} / {totalTaskCount}（共 {Math.ceil(totalTaskCount / BATCH_WINDOW_SIZE)} 批）
                  </p>
                ) : null}
              </>
            ) : null}
          </div>

          {/* 生成结果 */}
          {jobs.length > 0 && (
            <div className="results-section">
              <div className="results-header">
                <h2 className="results-heading">生成结果</h2>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={isRunning}
                  onClick={() => setJobs([])}
                  title="清空所有生成的图片"
                >
                  全部清空
                </button>
              </div>
              <div className="job-grid">
                {displayJobs.map((job) => (
                  <article key={job.id} className="job-card">
                    <div className="job-card-head">
                      <span className="job-name" title={job.file?.name ?? job.prompt ?? '文生图'}>
                        {job.file?.name ?? job.prompt?.slice(0, 15) ?? '文生图'}
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
                        {job.jobType === 'outpaint' ? ' 扩充' : job.jobType === 'variation' ? '✨ 裂变' : ' 文生图'}
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
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
