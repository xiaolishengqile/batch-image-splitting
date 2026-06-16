import { ASPECT_OPTIONS } from './constants'

function parseAspectRatio(label: string): number {
  const [w, h] = label.split(':').map(Number)
  if (!w || !h) return 1
  return w / h
}

/** 从预设比例中选取与图片宽高比最接近的一项 */
export function closestAspectLabel(
  width: number,
  height: number,
  options: readonly string[] = ASPECT_OPTIONS,
): string {
  const r = width / height
  let best = options[0] ?? '1:1'
  let bestDiff = Infinity
  for (const opt of options) {
    const diff = Math.abs(parseAspectRatio(opt) - r)
    if (diff < bestDiff) {
      bestDiff = diff
      best = opt
    }
  }
  return best
}

/** 与画面比例对应的 API size（1K） */
export const ASPECT_TO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '2:3': '1024x1536',
  '3:2': '1536x1024',
  '3:4': '1024x1536',
  '4:3': '1536x1024',
  '4:5': '1024x1536',
  '5:4': '1536x1024',
  '9:16': '1024x1792',
  '16:9': '1792x1024',
}

/** 与画面比例对应的 API size（2K） */
export const ASPECT_TO_SIZE_2K: Record<string, string> = {
  '1:1': '2048x2048',
  '2:3': '2048x3072',
  '3:2': '3072x2048',
  '3:4': '2048x3072',
  '4:3': '3072x2048',
  '4:5': '2048x3072',
  '5:4': '3072x2048',
  '9:16': '2048x3584',
  '16:9': '3584x2048',
}

export function is2kSizeLabel(size: string): boolean {
  const w = parseInt(size.split('x')[0] ?? '0', 10)
  return w >= 2048
}

export function sizeForAspect(aspect: string, fallback = '1024x1024', use2k = false): string {
  const map = use2k ? ASPECT_TO_SIZE_2K : ASPECT_TO_SIZE
  return map[aspect] ?? fallback
}
