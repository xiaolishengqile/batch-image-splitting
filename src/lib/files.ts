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
