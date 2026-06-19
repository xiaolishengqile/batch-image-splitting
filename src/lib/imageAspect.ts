import { ASPECT_OPTIONS } from './constants'

const MIN_IMAGE_PIXELS = 655_360
const MAX_IMAGE_PIXELS = 8_294_400
const MAX_IMAGE_EDGE = 3840
const MAX_ASPECT_RATIO = 3
const SIZE_MULTIPLE = 16

export function parseAspectRatio(label: string): number {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, '')
  const separator = normalized.includes(':') ? ':' : normalized.includes('x') ? 'x' : ''
  if (!separator) return Number.NaN
  const [w, h] = normalized.split(separator).map(Number)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return Number.NaN
  return w / h
}

export function isValidAspectRatioLabel(label: string): boolean {
  const ratio = parseAspectRatio(label)
  if (!Number.isFinite(ratio)) return false
  return ratio <= MAX_ASPECT_RATIO && ratio >= 1 / MAX_ASPECT_RATIO
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
  '1:2': '1024x1792',
  '2:1': '1792x1024',
  '2:3': '1024x1536',
  '3:2': '1536x1024',
  '3:4': '1024x1536',
  '4:3': '1536x1024',
  '9:16': '1024x1792',
  '16:9': '1792x1024',
}

/** 与画面比例对应的 API size（2K） */
export const ASPECT_TO_SIZE_2K: Record<string, string> = {
  '1:1': '2048x2048',
  '1:2': '2048x3584',
  '2:1': '3584x2048',
  '2:3': '2048x3072',
  '3:2': '3072x2048',
  '3:4': '2048x3072',
  '4:3': '3072x2048',
  '9:16': '2048x3584',
  '16:9': '3584x2048',
}

export function is2kSizeLabel(size: string): boolean {
  const parsed = parseSizeLabel(size)
  return parsed ? Math.max(parsed.width, parsed.height) >= 2048 : false
}

function parseSizeLabel(size: string): { width: number; height: number } | null {
  const m = /^(\d+)x(\d+)$/i.exec(size.trim())
  if (!m) return null
  const width = parseInt(m[1], 10)
  const height = parseInt(m[2], 10)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

function roundToMultiple(value: number): number {
  return Math.max(SIZE_MULTIPLE, Math.round(value / SIZE_MULTIPLE) * SIZE_MULTIPLE)
}

function clampArea(area: number): number {
  if (!Number.isFinite(area) || area <= 0) return 1024 * 1024
  return Math.max(MIN_IMAGE_PIXELS, Math.min(MAX_IMAGE_PIXELS, area))
}

function normalizeSizeForAspect(width: number, height: number): { width: number; height: number } {
  let w = roundToMultiple(width)
  let h = roundToMultiple(height)

  const shrinkForEdge = Math.min(1, MAX_IMAGE_EDGE / Math.max(w, h))
  if (shrinkForEdge < 1) {
    w = roundToMultiple(w * shrinkForEdge)
    h = roundToMultiple(h * shrinkForEdge)
  }

  while (w * h > MAX_IMAGE_PIXELS) {
    w = roundToMultiple(w * 0.96)
    h = roundToMultiple(h * 0.96)
  }

  while (w * h < MIN_IMAGE_PIXELS) {
    const nextW = roundToMultiple(w * 1.04)
    const nextH = roundToMultiple(h * 1.04)
    if (Math.max(nextW, nextH) > MAX_IMAGE_EDGE || nextW * nextH > MAX_IMAGE_PIXELS) break
    w = nextW
    h = nextH
  }

  return { width: w, height: h }
}

export function customSizeForAspect(aspect: string, fallback = '1024x1024'): string {
  const ratio = parseAspectRatio(aspect)
  if (!Number.isFinite(ratio)) return fallback
  const boundedRatio = Math.max(1 / MAX_ASPECT_RATIO, Math.min(MAX_ASPECT_RATIO, ratio))
  const fallbackSize = parseSizeLabel(fallback)
  const targetArea = clampArea(fallbackSize ? fallbackSize.width * fallbackSize.height : 1024 * 1024)
  const rawWidth = Math.sqrt(targetArea * boundedRatio)
  const rawHeight = rawWidth / boundedRatio
  const { width, height } = normalizeSizeForAspect(rawWidth, rawHeight)
  return `${width}x${height}`
}

export function sizeForAspect(aspect: string, fallback = '1024x1024', use2k = false): string {
  const map = use2k ? ASPECT_TO_SIZE_2K : ASPECT_TO_SIZE
  return map[aspect] ?? customSizeForAspect(aspect, fallback)
}
