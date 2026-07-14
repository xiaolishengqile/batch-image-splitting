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
 * 判断文件是否是常见图片。部分文件夹导入场景下浏览器可能不给 MIME。
 */
export function isImageFile(file: File): boolean {
  if (/^image\//.test(file.type)) return true
  return /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif|tiff?)$/i.test(file.name)
}

/**
 * 从 DataTransfer 对象中提取图片文件
 */
export function getImageFilesFromDataTransfer(dt: DataTransfer): File[] {
  const files = dt.files
  if (!files || files.length === 0) return []
  return Array.from(files).filter(isImageFile)
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
 * 从 Blob MIME 推断文件扩展名
 */
export function extensionFromBlob(blob: Blob): string {
  const type = blob.type
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg'
  if (type.includes('webp')) return 'webp'
  return 'png'
}

/**
 * 从 Data URL 推断文件扩展名
 */
export function extensionFromDataUrl(dataUrl: string): string {
  if (dataUrl.includes('image/jpeg') || dataUrl.includes('image/jpg')) return 'jpg'
  if (dataUrl.includes('image/webp')) return 'webp'
  return 'png'
}

function sanitizeFilename(filename: string): string {
  let name = filename.trim() || 'result.png'
  name = name.replace(/[/\\]/g, '_').replace(/\.\./g, '_')
  if (!/\.(png|jpe?g|webp)$/i.test(name)) {
    name = `${name.replace(/\.+$/, '')}.png`
  }
  return name
}

function dedupeFilename(filename: string, usedNames: Set<string>): string {
  let candidate = sanitizeFilename(filename)
  let n = 1
  while (usedNames.has(candidate.toLowerCase())) {
    const match = candidate.match(/^(.*?)(\.(png|jpe?g|webp))$/i)
    const stem = match?.[1] ?? candidate
    const ext = match?.[2] ?? '.png'
    candidate = `${stem}_${n}${ext}`
    n += 1
  }
  usedNames.add(candidate.toLowerCase())
  return candidate
}

/**
 * 将 Blob 写入指定目录
 */
export async function writeBlobToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  blob: Blob,
  filename: string,
  usedNames: Set<string>,
): Promise<void> {
  const candidate = dedupeFilename(filename, usedNames)
  const fileHandle = await dirHandle.getFileHandle(candidate, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(blob)
  await writable.close()
}

/**
 * 获取或创建子目录
 */
export async function getOrCreateSubdirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true })
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
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  await writeBlobToDirectory(dirHandle, blob, filename, usedNames)
}
