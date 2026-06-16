/**
 * 获取图片的宽高
 */
export async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('无法读取图片尺寸'))
      el.src = url
    })
    return { width: img.naturalWidth, height: img.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 根据目标尺寸字符串解析宽高
 */
export function parseSize(sizeStr: string): { width: number; height: number } {
  const [w, h] = sizeStr.split('x').map((n) => parseInt(n, 10))
  return { width: w, height: h }
}

/** 校验 API 尺寸字符串，格式为 宽x高 */
export function isValidSizeFormat(sizeStr: string): boolean {
  const m = /^(\d+)x(\d+)$/i.exec(sizeStr.trim())
  if (!m) return false
  const w = parseInt(m[1], 10)
  const h = parseInt(m[2], 10)
  return Number.isFinite(w) && Number.isFinite(h) && w >= 64 && h <= 8192 && h >= 64 && w <= 8192
}

/**
 * 计算扩充后的目标尺寸
 * @param originalWidth 原始宽度
 * @param originalHeight 原始高度
 * @param scale 扩充比例（如 1.5 表示扩大到 1.5 倍）
 */
export function calculateExpandedSize(
  originalWidth: number,
  originalHeight: number,
  scale: number,
): { width: number; height: number } {
  const targetWidth = Math.round(originalWidth * scale)
  const targetHeight = Math.round(originalHeight * scale)
  // 确保是 16 的倍数
  return {
    width: Math.floor(targetWidth / 16) * 16,
    height: Math.floor(targetHeight / 16) * 16,
  }
}

