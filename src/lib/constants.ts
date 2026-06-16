export const DEFAULT_API_BASE = 'https://ai.t8star.org'

/** 并发数下限 / 上限 / 默认值 */
export const MIN_BATCH_CONCURRENCY = 1
export const MAX_BATCH_CONCURRENCY = 20
export const DEFAULT_BATCH_CONCURRENCY = 10

export const STORAGE_KEY_CONCURRENCY = 'batch_image_concurrency'

/** 将输入框字符串规范为合法并发数（空或非法时用 fallback） */
export function normalizeBatchConcurrency(
  raw: string,
  fallback: number = DEFAULT_BATCH_CONCURRENCY,
): number {
  const n = parseInt(raw.trim(), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(MIN_BATCH_CONCURRENCY, Math.min(MAX_BATCH_CONCURRENCY, n))
}

/** 每批次显示和处理的图片数量 */
export const BATCH_WINDOW_SIZE = 10

/** 单批次最长等待时间（毫秒），超时后未完成的图片跳过并进入下一批 */
export const BATCH_TIMEOUT_MS = 3 * 60 * 1000

export const BATCH_TIMEOUT_MESSAGE = '批次超时（3 分钟），已跳过继续下一批'

export const CANCEL_MESSAGE = '已取消'

export const DEFAULT_MODEL = 'gpt-image-2'

/** 图片扩充提示词 */
export const PROMPT_OUTPAINT = `OUTPAINTING — expand the image canvas:
Intelligently extend the image beyond its current borders.
Fill in the newly exposed areas with coherent, contextually appropriate content.
Match the style, lighting, colors, and composition of the original image.
The expansion should look seamless and natural, as if the original photo was simply cropped.`

/** 图片扩充提示词（中文） */
export const PROMPT_OUTPAINT_CN = `【图片扩充】智能扩展图片画布，在图片四周智能填充原本没有的内容。
填充的新内容必须与原图的风格、光线、颜色、构图保持一致。
扩充后的效果应该看起来自然无缝，就像原始照片只是被裁剪了一样。
不要改变原图主体的大小和位置，只扩展周围背景和边缘内容。`

/** 图片裂变提示词 */
export const PROMPT_VARIATION = `IMAGE VARIATION — create stylistic variants:
Generate a new image that maintains the same artistic style, composition, and subject matter as the original.
The variation should feel like an alternate version — same theme, same aesthetic, but with different details.
Keep colors vibrant and the overall mood consistent.
Think of it as the same artist painting a similar piece on a different day.`

/** 图片裂变提示词（中文） */
export const PROMPT_VARIATION_CN = `【图片裂变】生成风格相同的变体图片。
新生成的图片必须保持与原始图片相同的艺术风格、构图和主题。
变体应该感觉像是同一作品的另一个版本——相同的主题、相同的美学，但细节有所不同。
保持颜色鲜艳，整体情绪一致。
就像是同一位艺术家在不同一天画出的相似作品。`

export const STORAGE_KEY_TOKEN = 'batch_image_api_token'
export const STORAGE_KEY_MODEL = 'batch_image_model'
export const STORAGE_KEY_BASE = 'batch_image_api_base'
export const STORAGE_KEY_SIZE = 'batch_image_size'
export const STORAGE_KEY_PREFIX = 'batch_image_prefix'
export const STORAGE_KEY_EXPANSION_SCALE = 'batch_image_expansion_scale'
export const STORAGE_KEY_VARIATION_COUNT = 'batch_image_variation_count'

/** 默认尺寸 */
export const DEFAULT_SIZE = '1024x1024'

/** API 支持的宽高比标签 */
export const ASPECT_OPTIONS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'] as const

/** 尺寸选项 */
export const SIZE_OPTIONS = [
  '1024x1024',
  '1024x1536',
  '1536x1024',
  '1792x1024',
  '1024x1792',
  '2048x2048',
  '2048x3072',
  '3072x2048',
]

/** 默认裂变数量 */
export const DEFAULT_VARIATION_COUNT = 4

/** 默认扩充比例 */
export const DEFAULT_EXPANSION_SCALE = '1.5'
