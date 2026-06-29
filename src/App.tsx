import { type InputHTMLAttributes, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  DEFAULT_VARIATION_SCENE,
  DEFAULT_VARIATION_STRENGTH,
  DEFAULT_RESOLUTION_MODE,
  DEFAULT_START_NUMBER,
  DEFAULT_TARGET_ASPECT,
  DEFAULT_TASK_RETRY_COUNT,
  MAX_VARIATION_COUNT,
  MIN_VARIATION_COUNT,
  DEFAULT_EXPANSION_SCALE,
  BATCH_WINDOW_SIZE,
  CANCEL_MESSAGE,
  DEFAULT_BATCH_CONCURRENCY,
  MAX_BATCH_CONCURRENCY,
  MIN_BATCH_CONCURRENCY,
  RESOLUTION_MODES,
  normalizeBatchConcurrency,
  normalizeStartNumber,
  normalizeVariationCount,
  PROMPT_OUTPAINT_CN,
  PROMPT_PATTERN_EXTRACT_CN,
  ASPECT_OPTIONS,
  STORAGE_KEY_CONCURRENCY,
  STORAGE_KEY_RESOLUTION_MODE,
  STORAGE_KEY_START_NUMBER,
  STORAGE_KEY_CUSTOM_TARGET_ASPECT,
  STORAGE_KEY_TARGET_ASPECT,
  STORAGE_KEY_VARIATION_SCENE,
  STORAGE_KEY_VARIATION_STRENGTH,
  SIZE_OPTIONS,
  STORAGE_KEY_BASE,
  STORAGE_KEY_MODEL,
  STORAGE_KEY_TOKEN,
  STORAGE_KEY_SIZE,
  STORAGE_KEY_PREFIX,
  STORAGE_KEY_EXPANSION_SCALE,
  STORAGE_KEY_VARIATION_COUNT,
  VARIATION_SCENES,
  VARIATION_STRENGTHS,
  buildVariationPrompt,
  pickVariationDirectionIndices,
  TASK_RETRY_DELAY_MS,
  type ResolutionMode,
  type VariationScene,
  type VariationStrength,
} from './lib/constants'
import {
  supportsSaveToFolder,
  pickSaveDirectoryHandle,
  writeBlobToDirectory,
  extensionFromBlob,
  getImageFilesFromDataTransfer,
  isImageFile,
} from './lib/files'
import { closestAspectLabel, is2kSizeLabel, isValidAspectRatioLabel, sizeForAspect } from './lib/imageAspect'
import { calculateExpandedSize, getImageDimensions, isValidSizeFormat } from './lib/imageSize'
import {
  clearResultImages,
  deleteResultImage,
  getResultBlob,
  putResultImage,
} from './lib/imageStore'
import { ResultImage } from './components/ResultImage'
import './App.css'

type JobStatus = 'queued' | 'running' | 'done' | 'error'
type JobType = 'outpaint' | 'variation' | 'extract' | 'text2img'

interface Job {
  id: string
  file?: File
  previewObjectUrl?: string
  status: JobStatus
  error?: string
  hasResult?: boolean
  addedSeq: number
  completedAt?: number
  jobType: JobType
  fileIndex?: number
  promptIndex?: number
  variationIndex?: number
  prompt?: string
  targetSize?: string
  outputName?: string
  saveError?: string
}

interface ExcelPrompt {
  id: string
  prompt: string
  status: JobStatus
  error?: string
  addedSeq: number
  completedAt?: number
  outputName?: string
}

interface ImagePreviewState {
  src: string
  title: string
  revokeOnClose: boolean
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

function disposeJobResources(job: Job) {
  revokeJobPreview(job)
  if (job.hasResult) {
    void deleteResultImage(job.id)
  }
}

function readInitialSizeState(): { size: string; customSize: string; useCustomSize: boolean } {
  const saved = localStorage.getItem(STORAGE_KEY_SIZE) ?? DEFAULT_SIZE
  if (SIZE_OPTIONS.includes(saved)) {
    return { size: saved, customSize: '', useCustomSize: false }
  }
  return { size: DEFAULT_SIZE, customSize: saved, useCustomSize: true }
}

function readInitialVariationScene(): VariationScene {
  const saved = localStorage.getItem(STORAGE_KEY_VARIATION_SCENE)
  return VARIATION_SCENES.some((option) => option.value === saved)
    ? (saved as VariationScene)
    : DEFAULT_VARIATION_SCENE
}

function readInitialVariationStrength(): VariationStrength {
  const saved = localStorage.getItem(STORAGE_KEY_VARIATION_STRENGTH)
  return VARIATION_STRENGTHS.some((option) => option.value === saved)
    ? (saved as VariationStrength)
    : DEFAULT_VARIATION_STRENGTH
}

function readInitialResolutionMode(): ResolutionMode {
  const saved = localStorage.getItem(STORAGE_KEY_RESOLUTION_MODE)
  return RESOLUTION_MODES.some((option) => option.value === saved)
    ? (saved as ResolutionMode)
    : DEFAULT_RESOLUTION_MODE
}

function readInitialTargetAspect(): string {
  const saved = localStorage.getItem(STORAGE_KEY_TARGET_ASPECT)
  return saved && isValidAspectRatioLabel(saved) ? saved : DEFAULT_TARGET_ASPECT
}

function readInitialCustomTargetAspect(targetAspect: string): string {
  const saved = localStorage.getItem(STORAGE_KEY_CUSTOM_TARGET_ASPECT)
  if (saved && isValidAspectRatioLabel(saved)) return saved
  return ASPECT_OPTIONS.includes(targetAspect as (typeof ASPECT_OPTIONS)[number]) ? '9:18' : targetAspect
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

const DIRECTORY_INPUT_PROPS: InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string } = {
  webkitdirectory: '',
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
  const [apiSettingsOpen, setApiSettingsOpen] = useState(() => !localStorage.getItem(STORAGE_KEY_TOKEN))
  const initialSizeState = useMemo(() => readInitialSizeState(), [])
  const initialTargetAspect = useMemo(() => readInitialTargetAspect(), [])
  const [model, setModel] = useState(() => localStorage.getItem(STORAGE_KEY_MODEL) ?? DEFAULT_MODEL)
  const [size, setSize] = useState(initialSizeState.size)
  const [customSize, setCustomSize] = useState(initialSizeState.customSize)
  const [useCustomSize, setUseCustomSize] = useState(initialSizeState.useCustomSize)
  const [prefix, setPrefix] = useState(() => localStorage.getItem(STORAGE_KEY_PREFIX) ?? 'A')
  const [startNumberInput, setStartNumberInput] = useState(() => {
    return String(normalizeStartNumber(localStorage.getItem(STORAGE_KEY_START_NUMBER) ?? String(DEFAULT_START_NUMBER)))
  })
  const [resolutionMode, setResolutionMode] = useState<ResolutionMode>(() => readInitialResolutionMode())
  const [targetAspect, setTargetAspect] = useState(initialTargetAspect)
  const [customTargetAspect, setCustomTargetAspect] = useState(() => readInitialCustomTargetAspect(initialTargetAspect))
  const [useCustomTargetAspect, setUseCustomTargetAspect] = useState(
    () => !ASPECT_OPTIONS.includes(initialTargetAspect as (typeof ASPECT_OPTIONS)[number]),
  )

  // 功能设置
  const [expansionScale, setExpansionScale] = useState(
    () => localStorage.getItem(STORAGE_KEY_EXPANSION_SCALE) ?? DEFAULT_EXPANSION_SCALE,
  )
  const [variationCount, setVariationCount] = useState(() => {
    return normalizeVariationCount(localStorage.getItem(STORAGE_KEY_VARIATION_COUNT) ?? String(DEFAULT_VARIATION_COUNT))
  })
  const [variationCountInput, setVariationCountInput] = useState(() => String(variationCount))
  const [variationScene, setVariationScene] = useState<VariationScene>(() => readInitialVariationScene())
  const [variationStrength, setVariationStrength] = useState<VariationStrength>(() => readInitialVariationStrength())

  // 功能开关
  const [enableOutpaint, setEnableOutpaint] = useState(true)
  const [enableVariation, setEnableVariation] = useState(false)
  const [enableExtract, setEnableExtract] = useState(false)
  const [enableText2Img, setEnableText2Img] = useState(false)
  const [isInputDragOver, setIsInputDragOver] = useState(false)

  // 数据状态
  const [inputFiles, setInputFiles] = useState<File[]>([])
  const [excelPrompts, setExcelPrompts] = useState<ExcelPrompt[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null)
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
    () => inputFiles.slice(0, 20).map((file) => URL.createObjectURL(file)),
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
    localStorage.setItem(STORAGE_KEY_RESOLUTION_MODE, resolutionMode)
  }, [resolutionMode])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TARGET_ASPECT, targetAspect)
  }, [targetAspect])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_CUSTOM_TARGET_ASPECT, customTargetAspect)
  }, [customTargetAspect])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_EXPANSION_SCALE, expansionScale)
  }, [expansionScale])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_VARIATION_COUNT, String(variationCount))
  }, [variationCount])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_VARIATION_SCENE, variationScene)
  }, [variationScene])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_VARIATION_STRENGTH, variationStrength)
  }, [variationStrength])
  const commitVariationCountInput = useCallback(() => {
    const normalized = normalizeVariationCount(variationCountInput, variationCount)
    setVariationCount(normalized)
    setVariationCountInput(String(normalized))
  }, [variationCount, variationCountInput])
  const commitStartNumberInput = useCallback(() => {
    const normalized = normalizeStartNumber(startNumberInput)
    const next = String(normalized)
    setStartNumberInput(next)
    localStorage.setItem(STORAGE_KEY_START_NUMBER, next)
  }, [startNumberInput])
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

  const closeImagePreview = useCallback(() => {
    setImagePreview((prev) => {
      if (prev?.revokeOnClose) {
        URL.revokeObjectURL(prev.src)
      }
      return null
    })
  }, [])

  useEffect(() => {
    return () => {
      if (imagePreview?.revokeOnClose) {
        URL.revokeObjectURL(imagePreview.src)
      }
    }
  }, [imagePreview])

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
    const arr = Array.from(files).filter(isImageFile)
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
  const saveJobToFolder = useCallback(async (job: Job, used: Set<string>): Promise<string | null> => {
    if (!autoSaveAfterGenerate || !job.hasResult || !job.outputName) return null
    const dir = saveFolderHandleRef.current
    if (!dir) return null
    try {
      const blob = await getResultBlob(job.id)
      if (!blob) return '自动保存失败：结果图片不存在'
      await writeBlobToDirectory(dir, blob, `${job.outputName}.${extensionFromBlob(blob)}`, used)
      return null
    } catch (e) {
      return `自动保存失败：${e instanceof Error ? e.message : String(e)}`
    }
  }, [autoSaveAfterGenerate])

  const openResultPreview = useCallback(async (job: Job) => {
    if (!job.hasResult) return
    const blob = await getResultBlob(job.id)
    if (!blob) return
    const src = URL.createObjectURL(blob)
    setImagePreview((prev) => {
      if (prev?.revokeOnClose) {
        URL.revokeObjectURL(prev.src)
      }
      return {
        src,
        title: `${job.outputName ?? '生成图'} - 生成图`,
        revokeOnClose: true,
      }
    })
  }, [])

  const openOriginalPreview = useCallback((job: Job) => {
    if (!job.previewObjectUrl) return
    const src = job.previewObjectUrl
    setImagePreview((prev) => {
      if (prev?.revokeOnClose) {
        URL.revokeObjectURL(prev.src)
      }
      return {
        src,
        title: `${job.file?.name ?? job.outputName ?? '原图'} - 原图`,
        revokeOnClose: false,
      }
    })
  }, [])

  // 运行批处理 - 分批处理版本（每批最多 10 个任务）
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

    const normalizedVariationCount = normalizeVariationCount(variationCountInput, variationCount)
    setVariationCount(normalizedVariationCount)
    setVariationCountInput(String(normalizedVariationCount))

    const normalizedStartNumber = normalizeStartNumber(startNumberInput)
    setStartNumberInput(String(normalizedStartNumber))
    localStorage.setItem(STORAGE_KEY_START_NUMBER, String(normalizedStartNumber))

    // 快照当前输入，避免运行中 state 变化导致重复或遗漏
    const filesSnapshot = inputFiles
    const promptsSnapshot = excelPrompts
    const baseSize = useCustomSize ? customSize.trim() : size
    if (!isValidSizeFormat(baseSize)) {
      alert('分辨率无效：请使用「宽x高」，两边为 16 的倍数，最长边不超过 3840，长短边不超过 3:1，像素数在 655360 到 8294400 之间。')
      return
    }
    if (resolutionMode === 'aspect' && !isValidAspectRatioLabel(targetAspect)) {
      alert('画幅比例无效：请使用「宽:高」格式，例如 9:16、1:2、1:2.2；长短边比例不能超过 3:1。')
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
      directionIndex?: number
      outputName: string
    }

    const taskQueue: TaskItem[] = []
    let outputSeq = normalizedStartNumber

    if (enableOutpaint && filesSnapshot.length > 0) {
      filesSnapshot.forEach((file, index) => {
        taskQueue.push({
          file,
          fileIndex: index,
          jobType: 'outpaint',
          outputName: generateOutputName(prefix, outputSeq++),
        })
      })
    }

    if (enableVariation && filesSnapshot.length > 0) {
      filesSnapshot.forEach((file, index) => {
        const directionIndices = pickVariationDirectionIndices(variationStrength, normalizedVariationCount)
        for (let i = 0; i < normalizedVariationCount; i++) {
          taskQueue.push({
            file,
            fileIndex: index,
            jobType: 'variation',
            variationIndex: i,
            directionIndex: directionIndices[i],
            outputName: generateOutputName(prefix, outputSeq++),
          })
        }
      })
    }

    if (enableExtract && filesSnapshot.length > 0) {
      filesSnapshot.forEach((file, index) => {
        taskQueue.push({
          file,
          fileIndex: index,
          jobType: 'extract',
          outputName: generateOutputName(prefix, outputSeq++),
        })
      })
    }

    if (enableText2Img && promptsSnapshot.length > 0) {
      promptsSnapshot.forEach((p, index) => {
        taskQueue.push({
          prompt: p.prompt,
          promptIndex: index,
          jobType: 'text2img',
          outputName: generateOutputName(prefix, outputSeq++),
        })
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

    const nextStartNumberAfterRun = outputSeq

    const totalTasks = taskQueue.length
    setTotalTaskCount(totalTasks)
    setProcessedTaskCount(0)

    runInProgressRef.current = true
    cancelRef.current = false
    setIsRunning(true)

    const resolveEditParams = async (
      file: File,
      jobType: 'outpaint' | 'variation' | 'extract',
      variationIndex?: number,
      directionIndex?: number,
    ): Promise<{ prompt: string; size: string }> => {
      const { width, height } = await getImageDimensions(file)
      let aspect: string
      let sizeForRequest: string

      if (resolutionMode === 'custom') {
        sizeForRequest = baseSize
      } else if (resolutionMode === 'aspect') {
        aspect = targetAspect
        sizeForRequest = sizeForAspect(aspect, baseSize, use2kOutput)
      } else {
        const expanded = calculateExpandedSize(width, height, parseFloat(expansionScale))
        aspect = closestAspectLabel(expanded.width, expanded.height)
        sizeForRequest = sizeForAspect(aspect, baseSize, use2kOutput)
      }

      return {
        prompt:
          jobType === 'outpaint'
            ? PROMPT_OUTPAINT_CN
            : jobType === 'extract'
              ? PROMPT_PATTERN_EXTRACT_CN
              : buildVariationPrompt(variationScene, variationStrength, variationIndex, directionIndex),
        size: sizeForRequest,
      }
    }

    const resolveTextToImageSize = (): string => {
      if (resolutionMode === 'aspect') {
        return sizeForAspect(targetAspect, baseSize, use2kOutput)
      }
      return baseSize
    }

    const runOneTask = async (
      task: TaskItem,
      batchCtx: { activeControllers: Set<AbortController> },
    ): Promise<{ imageDataUrl: string } | null> => {
      if (cancelRef.current) return null

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
              size: resolveTextToImageSize(),
            },
            ac.signal,
          )
          imageDataUrl = result.imageDataUrl
        } else {
          if (!task.file) {
            throw new Error('缺少输入图片')
          }
          const editParams = await resolveEditParams(
            task.file,
            task.jobType,
            task.variationIndex,
            task.directionIndex,
          )
          const result = await postImagesEdits(
            base,
            token,
            {
              model: model.trim() || DEFAULT_MODEL,
              prompt: editParams.prompt,
              size: editParams.size,
              images: [task.file],
            },
            ac.signal,
          )
          imageDataUrl = result.imageDataUrl
        }

        if (cancelRef.current) return null

        return { imageDataUrl }
      } catch (e) {
        if (cancelRef.current || (e instanceof DOMException && e.name === 'AbortError')) {
          return null
        }
        throw e
      } finally {
        batchCtx.activeControllers.delete(ac)
        activeAbortControllersRef.current.delete(ac)
      }
    }

    const runOneTaskWithRetry = async (
      task: TaskItem,
      batchCtx: { activeControllers: Set<AbortController> },
      jobId: string,
    ): Promise<{ imageDataUrl: string } | null> => {
      let lastError: unknown
      for (let attempt = 0; attempt <= DEFAULT_TASK_RETRY_COUNT; attempt++) {
        if (cancelRef.current) return null
        try {
          return await runOneTask(task, batchCtx)
        } catch (e) {
          lastError = e
          if (cancelRef.current || (e instanceof DOMException && e.name === 'AbortError')) {
            return null
          }
          if (attempt < DEFAULT_TASK_RETRY_COUNT) {
            updateJob(jobId, {
              error: `第 ${attempt + 1} 次失败，正在重试...`,
            })
            await delay(TASK_RETRY_DELAY_MS * (attempt + 1))
          }
        }
      }
      throw lastError
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
          fileIndex: task.fileIndex,
          promptIndex: task.promptIndex,
          variationIndex: task.variationIndex,
          prompt: task.prompt,
          outputName: task.outputName,
          addedSeq: addedSeqRef.current++,
        }))

        setJobs((prev) => {
          const keep = batchStart === 0 ? [] : prev.filter((j) => j.status === 'done' || j.status === 'error')
          const drop = batchStart === 0 ? prev : prev.filter((j) => j.status !== 'done' && j.status !== 'error')
          drop.forEach(disposeJobResources)
          if (batchStart === 0) prev.forEach(disposeJobResources)
          return [...keep, ...batchJobs]
        })

        const concurrency = Math.min(normalizeBatchConcurrency(normalizedConcurrency), currentBatchSize)
        let taskIdxInBatch = 0
        const batchCtx = {
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
          while (!cancelRef.current) {
            const myTask = taskIdxInBatch++
            if (myTask >= batchTasks.length) return

            const task = batchTasks[myTask]
            const jobId = batchJobs[myTask].id

            updateJob(jobId, { status: 'running' })

            try {
              const result = await runOneTaskWithRetry(task, batchCtx, jobId)
              if (result) {
                if (cancelRef.current) {
                  markJobFinished(jobId, { status: 'error', error: CANCEL_MESSAGE })
                  continue
                }
                try {
                  await putResultImage(jobId, result.imageDataUrl)
                } catch {
                  markJobFinished(jobId, { status: 'error', error: '结果保存失败' })
                  continue
                }
                const finishedJob: Job = {
                  ...batchJobs[myTask],
                  status: 'done',
                  hasResult: true,
                  completedAt: Date.now(),
                }
                markJobFinished(jobId, {
                  status: 'done',
                  hasResult: true,
                  completedAt: finishedJob.completedAt,
                  outputName: finishedJob.outputName,
                })
                const saveError = await saveJobToFolder(finishedJob, autoSaveUsedNamesRef.current)
                if (saveError) {
                  updateJob(jobId, { saveError })
                }
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

        await Promise.all(Array.from({ length: concurrency }, () => worker()))

        taskCursor = batchEnd

        if (!cancelRef.current && batchEnd < totalTasks) {
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
      }
    } finally {
      activeAbortControllersRef.current.clear()
      runInProgressRef.current = false
      setIsRunning(false)
      if (!cancelRef.current) {
        const next = String(nextStartNumberAfterRun)
        setStartNumberInput(next)
        localStorage.setItem(STORAGE_KEY_START_NUMBER, next)
      }
    }
  }, [
    apiBase,
    apiToken,
    enableOutpaint,
    enableVariation,
    enableExtract,
    enableText2Img,
    inputFiles,
    excelPrompts,
    expansionScale,
    variationCount,
    variationScene,
    variationStrength,
    model,
    size,
    customSize,
    useCustomSize,
    prefix,
    concurrencyInput,
    variationCountInput,
    startNumberInput,
    resolutionMode,
    targetAspect,
    updateJob,
    generateOutputName,
    saveJobToFolder,
    autoSaveAfterGenerate,
  ])

  const downloadOne = useCallback(async (job: Job) => {
    if (!job.hasResult) return
    const blob = await getResultBlob(job.id)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${job.outputName ?? 'image'}.${extensionFromBlob(blob)}`
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [])

  // 删除单个 job
  const removeJob = useCallback((jobId: string) => {
    if (isRunning) return
    setJobs((prev) => {
      const job = prev.find((j) => j.id === jobId)
      if (job) disposeJobResources(job)
      return prev.filter((j) => j.id !== jobId)
    })
  }, [isRunning])

  const clearAllJobs = useCallback(() => {
    if (isRunning) return
    setJobs((prev) => {
      prev.forEach(disposeJobResources)
      void clearResultImages()
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
    const done = jobs.filter((j) => j.status === 'done' && j.hasResult)
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
      const used = new Set<string>(autoSaveUsedNamesRef.current)
      let savedCount = 0
      for (const job of done) {
        if (!job.outputName) continue
        const blob = await getResultBlob(job.id)
        if (!blob) continue
        await writeBlobToDirectory(dir, blob, `${job.outputName}.${extensionFromBlob(blob)}`, used)
        savedCount += 1
      }
      autoSaveUsedNamesRef.current = used
      alert(`已保存 ${savedCount} 张图片到「${dir.name}」。`)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      alert(err instanceof Error ? err.message : String(err))
    }
  }, [jobs])

  const downloadZip = useCallback(async () => {
    const done = jobs.filter((j) => j.status === 'done' && j.hasResult)
    if (done.length === 0) {
      alert('还没有生成完成的图片。')
      return
    }
    const zip = new JSZip()
    const usedNames = new Set<string>()
    for (const job of done) {
      const blob = await getResultBlob(job.id)
      if (!blob) continue
      const ext = extensionFromBlob(blob)
      let candidate = `${job.outputName ?? 'image'}.${ext}`
      let n = 1
      while (usedNames.has(candidate.toLowerCase())) {
        candidate = `${job.outputName ?? 'image'}_${n}.${ext}`
        n += 1
      }
      usedNames.add(candidate.toLowerCase())
      zip.file(candidate, blob)
    }
    const out = await zip.generateAsync({ type: 'blob' })
    saveAs(out, `批量处理结果-${new Date().toISOString().slice(0, 10)}.zip`)
  }, [jobs])

  const displayJobs = useMemo(() => {
    const jobTypeRank: Record<JobType, number> = {
      outpaint: 0,
      variation: 1,
      extract: 2,
      text2img: 3,
    }
    const sourceRank = (job: Job) => {
      if (job.fileIndex != null) return job.fileIndex
      if (job.promptIndex != null) return 100_000 + job.promptIndex
      return 200_000 + job.addedSeq
    }
    return [...jobs].sort((a, b) => {
      const sourceDiff = sourceRank(a) - sourceRank(b)
      if (sourceDiff !== 0) return sourceDiff
      const typeDiff = jobTypeRank[a.jobType] - jobTypeRank[b.jobType]
      if (typeDiff !== 0) return typeDiff
      const variationDiff = (a.variationIndex ?? 0) - (b.variationIndex ?? 0)
      if (variationDiff !== 0) return variationDiff
      return a.addedSeq - b.addedSeq
    })
  }, [jobs])

  const canStart = Boolean(
    apiToken.trim() &&
      (((enableOutpaint || enableVariation || enableExtract) && inputFiles.length > 0) ||
        (enableText2Img && excelPrompts.length > 0)),
  )

  const enabledFeatureCount =
    Number(enableOutpaint && inputFiles.length > 0) +
    Number(enableVariation && inputFiles.length > 0) +
    Number(enableExtract && inputFiles.length > 0) +
    Number(enableText2Img && excelPrompts.length > 0)

  const totalBatchCount = totalTaskCount > 0 ? Math.ceil(totalTaskCount / BATCH_WINDOW_SIZE) : 0

  return (
    <div className="app">
      <header className="app-header">
        <h1>图片批量处理工具</h1>
        <p className="app-tagline">图片扩充 · 图片裂变 · 图案提取 · Excel 文生图</p>
      </header>

      {/* 主布局：左右两列 */}
      <div className="app-layout">
        {/* 左侧边栏 */}
        <aside className="app-sidebar">
          {/* API 设置 */}
          <div className="sidebar-card sidebar-card-collapsible">
            <button
              type="button"
              className="sidebar-card-toggle"
              aria-expanded={apiSettingsOpen}
              onClick={() => setApiSettingsOpen((open) => !open)}
            >
              <span>API 设置</span>
              <span className="sidebar-card-summary">
                {apiToken.trim() ? '已配置' : '未配置'} · {model.trim() || DEFAULT_MODEL}
              </span>
              <span className="sidebar-card-caret">{apiSettingsOpen ? '收起' : '展开'}</span>
            </button>
            {apiSettingsOpen ? (
              <div className="sidebar-card-body">
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
            ) : null}
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
                  checked={enableExtract}
                  onChange={(e) => setEnableExtract(e.target.checked)}
                />
                <span>图案提取/清晰化</span>
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
              <label htmlFor="size">分辨率</label>
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
              <label htmlFor="resolution-mode">分辨率模式</label>
              <select
                id="resolution-mode"
                value={resolutionMode}
                disabled={isRunning}
                onChange={(e) => {
                  const next = e.target.value as ResolutionMode
                  setResolutionMode(next)
                  if (next === 'custom') {
                    setUseCustomSize(true)
                    setCustomSize((prev) => prev || size)
                  }
                }}
              >
                {RESOLUTION_MODES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                裂变和扩图会按此模式决定输出画幅；文生图使用比例或自定义分辨率。
              </span>
            </div>
            {resolutionMode === 'aspect' && (
              <div className="field">
                <label htmlFor="target-aspect">画幅比例</label>
                <select
                  id="target-aspect"
                  value={useCustomTargetAspect ? 'custom' : targetAspect}
                  disabled={isRunning}
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      const next = customTargetAspect || '9:18'
                      setUseCustomTargetAspect(true)
                      setCustomTargetAspect(next)
                      setTargetAspect(next)
                    } else {
                      setUseCustomTargetAspect(false)
                      setTargetAspect(e.target.value)
                    }
                  }}
                >
                  {ASPECT_OPTIONS.map((aspect) => (
                    <option key={aspect} value={aspect}>
                      {aspect}
                    </option>
                  ))}
                  <option value="custom">自定义...</option>
                </select>
                {useCustomTargetAspect && (
                  <>
                    <input
                      type="text"
                      value={customTargetAspect}
                      disabled={isRunning}
                      onChange={(e) => {
                        const next = e.target.value
                        if (/^[\d:.xX\s]{0,16}$/.test(next)) {
                          setCustomTargetAspect(next)
                          setTargetAspect(next)
                        }
                      }}
                      placeholder="宽:高，如 9:18 或 1:2.2"
                      className="custom-size-input"
                    />
                    <span className="field-hint">自定义比例会自动换算为符合接口约束的分辨率。</span>
                  </>
                )}
              </div>
            )}
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
            <div className="field">
              <label htmlFor="start-number">起始编号</label>
              <input
                id="start-number"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                disabled={isRunning}
                value={startNumberInput}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '' || /^\d{1,6}$/.test(v)) {
                    setStartNumberInput(v)
                  }
                }}
                onBlur={commitStartNumberInput}
                placeholder={String(DEFAULT_START_NUMBER)}
              />
              <span className="field-hint">例如前缀 CS-、起始编号 31，会从 CS-31 开始。</span>
            </div>
          </div>

          {/* 功能特定设置 */}
          {(enableOutpaint || enableVariation || enableExtract) && (
            <div className="sidebar-card">
              <h3>功能参数</h3>
              <div className="feature-settings">
                {(enableOutpaint || enableExtract || resolutionMode === 'scale') && (
                  <div className="setting-row">
                    <label>原图倍数</label>
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
                  <>
                    <div className="setting-row">
                      <label>裂变类型</label>
                      <select
                        value={variationScene}
                        disabled={isRunning}
                        onChange={(e) => setVariationScene(e.target.value as VariationScene)}
                      >
                        {VARIATION_SCENES.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="setting-row">
                      <label>变化强度</label>
                      <select
                        value={variationStrength}
                        disabled={isRunning}
                        onChange={(e) => setVariationStrength(e.target.value as VariationStrength)}
                      >
                        {VARIATION_STRENGTHS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="setting-row setting-row-with-hint">
                      <label>裂变数量</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        disabled={isRunning}
                        value={variationCountInput}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === '' || /^\d{1,3}$/.test(v)) {
                            setVariationCountInput(v)
                          }
                        }}
                        onBlur={commitVariationCountInput}
                        placeholder={String(DEFAULT_VARIATION_COUNT)}
                      />
                      <span className="setting-hint">
                        每张原图生成 {MIN_VARIATION_COUNT}-{MAX_VARIATION_COUNT} 张裂变图
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* 右侧主内容区 */}
        <main className="app-main">
          {/* 功能一&二：图片输入 */}
          {(enableOutpaint || enableVariation || enableExtract) && (
            <div className="settings-card">
              <div className="settings-card-head">
                <h2>📁 输入图片</h2>
              </div>
              <div className="settings-card-body">
                <div
                  className={`input-dropzone${isInputDragOver ? ' is-dragover' : ''}`}
                  tabIndex={isRunning ? -1 : 0}
                  onPaste={(e) => {
                    if (isRunning) return
                    const files = getImageFilesFromDataTransfer(e.clipboardData)
                    if (files.length === 0) return
                    e.preventDefault()
                    handleFilesSelected(files)
                  }}
                  onMouseDown={(e) => {
                    if (isRunning) return
                    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.dropzone-sub')) {
                      e.currentTarget.focus()
                    }
                  }}
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
                    点击选中此区域后粘贴 (Ctrl/Cmd + V)，也可上传或拖拽图片 · 支持多选
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
                        {...DIRECTORY_INPUT_PROPS}
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
              每批最多 {BATCH_WINDOW_SIZE} 个任务；失败任务会自动重试 {DEFAULT_TASK_RETRY_COUNT} 次。
            </p>
            {enabledFeatureCount > 1 ? (
              <p className="task-order-hint">
                多任务同时开启时按顺序执行：扩充 → 裂变 → 图案提取 → Excel 文生图。
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
                        {job.jobType === 'outpaint'
                          ? '🖼️ 扩充'
                          : job.jobType === 'variation'
                            ? '✨ 裂变'
                            : job.jobType === 'extract'
                              ? '🎯 提取'
                              : '📝 文生图'}
                      </span>
                      {job.outputName && <span className="job-output">{job.outputName}</span>}
                    </div>
                    <div className={`job-images${job.previewObjectUrl ? '' : ' job-images-single'}`}>
                      {job.previewObjectUrl && (
                        <figure>
                          <img src={job.previewObjectUrl} alt="原图" />
                          <figcaption>原图</figcaption>
                        </figure>
                      )}
                      <figure
                        className={job.hasResult ? 'job-result-thumb' : undefined}
                        role={job.hasResult ? 'button' : undefined}
                        tabIndex={job.hasResult ? 0 : undefined}
                        onClick={job.hasResult ? () => void openResultPreview(job) : undefined}
                        onKeyDown={
                          job.hasResult
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  void openResultPreview(job)
                                }
                              }
                            : undefined
                        }
                        title={job.hasResult ? '点击查看生成图' : undefined}
                      >
                        {job.hasResult ? (
                          <ResultImage
                            imageId={job.id}
                            alt="生成图"
                            placeholder={job.status === 'running' ? '生成中…' : '加载中…'}
                          />
                        ) : (
                          <span className="result-placeholder">
                            {job.status === 'running' ? '生成中…' : job.status === 'error' ? '失败' : '等待'}
                          </span>
                        )}
                        <figcaption>生成图</figcaption>
                      </figure>
                    </div>
                    {job.error ? <div className="job-error">{job.error}</div> : null}
                    {job.saveError ? <div className="job-save-error">{job.saveError}</div> : null}
                    <div className="job-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!job.hasResult}
                        onClick={() => void openResultPreview(job)}
                      >
                        查看
                      </button>
                      {job.previewObjectUrl ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => openOriginalPreview(job)}
                        >
                          原图
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!job.hasResult}
                        onClick={() => void downloadOne(job)}
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
      {imagePreview ? (
        <div
          className="image-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label={imagePreview.title}
          onClick={closeImagePreview}
        >
          <div className="image-preview-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="image-preview-head">
              <span title={imagePreview.title}>{imagePreview.title}</span>
              <button
                type="button"
                className="btn btn-ghost image-preview-close"
                onClick={closeImagePreview}
                aria-label="关闭预览"
              >
                ×
              </button>
            </div>
            <div className="image-preview-body">
              <img src={imagePreview.src} alt={imagePreview.title} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
