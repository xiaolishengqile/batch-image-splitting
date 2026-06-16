/**
 * 将 Blob 转换为 Data URL
 */
export async function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * 将文件读取为 Data URL
 */
export async function readFileAsDataURL(file: File): Promise<string> {
  return blobToDataURL(file)
}

/**
 * 从 DataTransfer 对象中提取图片文件
 */
export function getImageFilesFromDataTransfer(dt: DataTransfer): File[] {
  const files = dt.files
  if (!files || files.length === 0) return []
  return Array.from(files).filter((f) => /^image\//.test(f.type))
}

/**
 * 检查浏览器是否支持 File System Access API（保存到文件夹）
 */
export function supportsSaveToFolder(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/**
 * 请求用户选择保存目录
 */
export async function pickSaveDirectoryHandle(): Promise<FileSystemDirectoryHandle> {
  if (!supportsSaveToFolder()) {
    throw new Error('当前浏览器不支持「保存到文件夹」，请使用 Chrome / Edge（HTTPS 或 localhost）。')
  }
  return window.showDirectoryPicker({ mode: 'readwrite' })
}

/**
 * 将 Data URL 写入指定目录
 */
export async function writeImageToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  dataUrl: string,
  filename: string,
  usedNames: Set<string>,
): Promise<void> {
  // 文件名去重
  let name = filename.trim() || 'result.png'
  name = name.replace(/[/\\]/g, '_').replace(/\.\./g, '_')
  if (!/\.(png|jpe?g|webp)$/i.test(name)) name = `${name.replace(/\.+$/, '')}.png`
  let candidate = name
  let n = 1
  while (usedNames.has(candidate.toLowerCase())) {
    const stem = candidate.replace(/\.(png|jpe?g|webp)$/i, '')
    candidate = `${stem}_${n}.png`
    n += 1
  }
  usedNames.add(candidate.toLowerCase())

  // 获取或创建文件
  const fileHandle = await dirHandle.getFileHandle(candidate, { create: true })
  const writable = await fileHandle.createWritable()

  // Data URL 转 Blob
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  await writable.write(blob)
  await writable.close()
}
