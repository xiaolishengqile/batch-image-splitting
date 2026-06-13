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
  MAX_BATCH_CONCURRENCY,
  PROMPT_OUTPAINT,
  PROMPT_VARIATION,
  SIZE_OPTIONS,
  STORAGE_KEY_BASE,
  STORAGE_KEY_TOKEN,
  STORAGE_KEY_SIZE,
  STORAGE_KEY_PREFIX,
  STORAGE_KEY_EXPANSION_SCALE,
  STORAGE_KEY_VARIATION_COUNT,
} from './lib/constants'
import { getImageFilesFromDataTransfer } from './lib/files'
import { getImageDimensions, calculateExpandedSize } from './lib/imageSize'
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

export default function App() {
  // API 设置
  const [apiBase, setApiBase] = useState(() => localStorage.getItem(STORAGE_KEY_BASE) ?? DEFAULT_API_BASE)
  const [apiToken, setApiToken] = useState(() => localStorage.getItem(STORAGE_KEY_TOKEN) ?? '')
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [size, setSize] = useState(() => localStorage.getItem(STORAGE_KEY_SIZE) ?? DEFAULT_SIZE)
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
  const [dragOver, setDragOver] = useState(false)

  // Excel 相关
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [excelPreview, setExcelPreview] = useState<string[][]>([])

  const addedSeqRef = useRef(0)
  const cancelRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  // 持久化设置
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_BASE, apiBase)
  }, [apiBase])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TOKEN, apiToken)
  }, [apiToken])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SIZE, size)
  }, [size])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_PREFIX, prefix)
  }, [prefix])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_EXPANSION_SCALE, expansionScale)
  }, [expansionScale])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_VARIATION_COUNT, String(variationCount))
  }, [variationCount])

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
    return { done, running, error, total: jobs.length }
  }, [jobs])

  const updateJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))
  }, [])

  // 处理输入文件
  const handleFilesSelected = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => /^image\//.test(f.type))
    if (arr.length === 0) return
    setInputFiles((prev) => [...prev, ...arr])
  }, [])

  // 拖拽处理
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (e.dataTransfer.files?.length) {
        handleFilesSelected(e.dataTransfer.files)
      }
    },
    [handleFilesSelected],
  )

  // 粘贴处理
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = getImageFilesFromDataTransfer(e.clipboardData)
    if (files.length > 0) {
      handleFilesSelected(files)
    }
  }, [handleFilesSelected])

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

  // 运行批处理
  const runBatch = useCallback(async () => {
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

    const allJobs: Job[] = []

    // 功能一：图片扩充
    if (enableOutpaint && inputFiles.length > 0) {
      inputFiles.forEach((file) => {
        allJobs.push({
          id: crypto.randomUUID(),
          file,
          previewObjectUrl: URL.createObjectURL(file),
          status: 'queued',
          jobType: 'outpaint',
          addedSeq: addedSeqRef.current++,
        })
      })
    }

    // 功能二：图片裂变
    if (enableVariation && inputFiles.length > 0) {
      inputFiles.forEach((file) => {
        for (let i = 0; i < variationCount; i++) {
          allJobs.push({
            id: crypto.randomUUID(),
            file,
            previewObjectUrl: URL.createObjectURL(file),
            status: 'queued',
            jobType: 'variation',
            addedSeq: addedSeqRef.current++,
          })
        }
      })
    }

    // 功能三：文生图
    if (enableText2Img && excelPrompts.length > 0) {
      excelPrompts.forEach((p) => {
        allJobs.push({
          id: crypto.randomUUID(),
          status: 'queued',
          jobType: 'text2img',
          prompt: p.prompt,
          addedSeq: addedSeqRef.current++,
        })
      })
    }

    if (allJobs.length === 0) {
      alert('请至少选择一个功能并添加输入内容。')
      return
    }

    setJobs(allJobs)
    cancelRef.current = false
    setIsRunning(true)

    let outputSeq = 1

    const runOne = async (job: Job) => {
      if (cancelRef.current) return
      updateJob(job.id, {
        status: 'running',
        error: undefined,
        resultDataUrl: undefined,
        completedAt: undefined,
      })
      const ac = new AbortController()
      abortRef.current = ac

      try {
        let prompt = ''
        let targetSize = size

        if (job.jobType === 'outpaint') {
          prompt = PROMPT_OUTPAINT
          // 计算扩充后的尺寸
          if (job.file) {
            const { width, height } = await getImageDimensions(job.file)
            const expanded = calculateExpandedSize(width, height, parseFloat(expansionScale))
            targetSize = `${expanded.width}x${expanded.height}`
          }
        } else if (job.jobType === 'variation') {
          prompt = PROMPT_VARIATION
        } else if (job.jobType === 'text2img') {
          prompt = job.prompt ?? ''
        }

        let imageDataUrl: string
        if (job.jobType === 'text2img') {
          // 文生图使用 generations API
          const result = await postImagesGenerations(
            base,
            token,
            {
              model: model.trim() || DEFAULT_MODEL,
              prompt,
              size: targetSize,
            },
            ac.signal,
          )
          imageDataUrl = result.imageDataUrl
        } else {
          // 图片扩充和裂变使用 edits API
          if (!job.file) {
            throw new Error('缺少输入图片')
          }
          const result = await postImagesEdits(
            base,
            token,
            {
              model: model.trim() || DEFAULT_MODEL,
              prompt,
              size: targetSize,
              aspect_ratio: 'auto',
              images: [job.file],
            },
            ac.signal,
          )
          imageDataUrl = result.imageDataUrl
        }

        // 生成输出名称
        const outputName = generateOutputName(prefix, outputSeq++)
        updateJob(job.id, {
          status: 'done',
          resultDataUrl: imageDataUrl,
          completedAt: Date.now(),
          outputName,
          targetSize,
        })
      } catch (e) {
        if (cancelRef.current || (e instanceof DOMException && e.name === 'AbortError')) {
          updateJob(job.id, { status: 'queued' })
          return
        }
        const msg = e instanceof Error ? e.message : String(e)
        updateJob(job.id, { status: 'error', error: msg })
      }
    }

    const n = Math.min(MAX_BATCH_CONCURRENCY, Math.max(1, allJobs.length))
    let cursor = 0

    const worker = async () => {
      for (;;) {
        if (cancelRef.current) return
        const my = cursor++
        if (my >= allJobs.length) return
        await runOne(allJobs[my])
      }
    }

    await Promise.all(Array.from({ length: n }, () => worker()))

    abortRef.current = null
    setIsRunning(false)
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
    prefix,
    updateJob,
    generateOutputName,
  ])

  const downloadOne = useCallback((job: Job) => {
    if (!job.resultDataUrl) return
    const a = document.createElement('a')
    a.href = job.resultDataUrl
    const ext = extensionFromMime(job.resultDataUrl)
    a.download = `${job.outputName ?? 'image'}.${ext}`
    a.click()
  }, [])

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
                placeholder="https://ai.t8star.cn"
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
                value={size}
                onChange={(e) => setSize(e.target.value)}
              >
                {SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
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

                <div
                  className={`dropzone${dragOver ? ' drag' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOver(true)
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onPaste={handlePaste}
                >
                  <p className="dropzone-title">拖入图片，或点击选择</p>
                  <p className="dropzone-sub">支持多选 · 文件夹导入</p>
                  <label className="btn btn-secondary dropzone-btn">
                    选择图片/文件夹
                    <input
                      type="file"
                      accept="image/*"
                      multiple
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
                      <span>已添加 {inputFiles.length} 张图片</span>
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
                      {inputFiles.map((file, index) => (
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
                    <div className="prompts-header">
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
                    {excelPreview.length > 0 && (
                      <div className="excel-table-wrapper">
                        <table className="excel-table">
                          <tbody>
                            {excelPreview.slice(0, 10).map((row, i) => (
                              <tr key={i}>
                                {row.map((cell, j) => (
                                  <td key={j}>{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {excelPreview.length > 10 && (
                          <p className="excel-more">... 还有 {excelPreview.length - 10} 行</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {excelPrompts.length > 0 && (
                  <div className="prompts-list">
                    <div className="prompts-scroll">
                      {excelPrompts.map((p) => (
                        <div key={p.id} className="prompt-item">
                          <span className="prompt-text">{p.prompt}</span>
                          <button
                            type="button"
                            className="btn btn-ghost prompt-remove"
                            disabled={isRunning}
                            onClick={() => removeExcelPrompt(p.id)}
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
            </div>

            {!canStart && !isRunning ? (
              <p className="action-hint">
                {!apiToken.trim()
                  ? '请先填写 API 密钥'
                  : '请先添加输入内容'}
              </p>
            ) : null}

            {isRunning && jobs.length > 0 ? (
              <p className="progress-line">
                进度：已完成 {jobStats.done} / {jobStats.total}
                {jobStats.running > 0 ? ` · 进行中 ${jobStats.running}` : ''}
                {jobStats.error > 0 ? ` · 失败 ${jobStats.error}` : ''}
              </p>
            ) : null}
          </div>

          {/* 生成结果 */}
          {jobs.length > 0 && (
            <div className="results-section">
              <h2 className="results-heading">生成结果</h2>
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
