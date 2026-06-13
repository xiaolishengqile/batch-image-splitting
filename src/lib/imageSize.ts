/**
 * 获取图片的宽高
 */
export async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.width, height: img.height })
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

/**
 * 根据目标尺寸字符串解析宽高
 */
export function parseSize(sizeStr: string): { width: number; height: number } {
  const [w, h] = sizeStr.split('x').map((n) => parseInt(n, 10))
  return { width: w, height: h }
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

/**
 * 找到最接近的尺寸选项
 */
export function closestSizeLabel(width: number, height: number): string {
  const ratio = width / height
  if (Math.abs(ratio - 1) < 0.1) return '1:1'
  if (ratio > 1) return '3:2'
  return '2:3'
}
