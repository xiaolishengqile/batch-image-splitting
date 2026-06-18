export const DEFAULT_API_BASE = 'https://ai.t8star.org'

/** 每批次显示和处理的图片数量 */
export const BATCH_WINDOW_SIZE = 10

/** 并发数下限 / 上限 / 默认值 */
export const MIN_BATCH_CONCURRENCY = 1
export const MAX_BATCH_CONCURRENCY = BATCH_WINDOW_SIZE
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

export const CANCEL_MESSAGE = '已取消'

/** 单任务失败后的自动重试次数 */
export const DEFAULT_TASK_RETRY_COUNT = 2
export const TASK_RETRY_DELAY_MS = 1500

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

/** 产品图案提取提示词（中文） */
export const PROMPT_PATTERN_EXTRACT_CN = `【图案提取 / 清晰化】
请从输入的商品图、样机图或实拍图中，提取商品表面的印花图案，并输出为一张独立的高清平面设计图。

核心要求：
1. 只保留商品上的图案内容，去掉衣服、手机壳、挂画边框、手、背景、阴影、褶皱、透视变形和拍摄环境。
2. 将图案尽量还原为正面、平整、完整的二维印刷素材，适合再次用于 POD 商品或后续裂变生成。
3. 提高清晰度、边缘质量和细节完整度，但不要改变图案主题、主要元素、配色和风格。
4. 不要输出产品样机、衣服、手机壳、实拍场景、对比图、水印、文字说明或边框截图。
5. 如果原图中有明显遮挡或折皱，可合理补全缺失区域，让结果看起来像原始高清印花源文件。`

export const VARIATION_SCENES = [
  { value: 'default', label: '默认' },
  { value: 'apparel', label: '服装/家纺' },
  { value: 'phone_case', label: '手机壳' },
  { value: 'line_art', label: '铁艺图形' },
  { value: 'clock', label: '挂钟' },
  { value: 'wall_art', label: '装饰画' },
  { value: 'metal_sign', label: '铁皮画' },
] as const

export type VariationScene = (typeof VARIATION_SCENES)[number]['value']

export const VARIATION_STRENGTHS = [
  { value: 'balanced', label: '中等变化' },
  { value: 'subtle', label: '轻微变化' },
  { value: 'bold', label: '大胆变化' },
] as const

export type VariationStrength = (typeof VARIATION_STRENGTHS)[number]['value']

export const DEFAULT_VARIATION_SCENE: VariationScene = 'default'
export const DEFAULT_VARIATION_STRENGTH: VariationStrength = 'balanced'

/** 图片裂变提示词 */
export const PROMPT_VARIATION = `MERCHANDISE PRINT VARIATION:
Use the input image as visual inspiration, not as a layout to copy.
Create a new commercial print design with a clearly different composition.
Preserve the recognizable subject, style direction, color mood, and theme, but redesign the artwork with fresh details.
Avoid simple redraws, near-duplicates, watermarks, mockup frames, and product photos unless explicitly requested.`

const VARIATION_SCENE_PROMPTS: Record<VariationScene, string> = {
  default: `通用印花图案：适合用于多种 POD 商品的商业插画或图案设计。主体明确，构图完整，画面比原图有明显变化，背景干净但不空洞，适合直接印刷。`,
  apparel: `服装/家纺印花：适合 T 恤、卫衣、抱枕、毯子、布料印花。主体要醒目，装饰元素更丰富，边缘自然，适合织物印刷，避免复杂小字和过细线条。`,
  phone_case: `手机壳印花：竖版构图，主体居中或略偏上，保留安全边距，适合窄长手机壳画幅。画面要有装饰性背景，避免主体贴边或被裁切。`,
  line_art: `铁艺图形：转化为适合金属切割、线稿、雕刻或镂空工艺的图形。使用清晰轮廓、较少颜色、强对比、连贯线条，避免照片质感和复杂渐变。`,
  clock: `挂钟印花：适合圆形钟面。围绕圆形构图，主体和装饰元素平衡分布，可包含装饰边框、刻度感或数字区域，但不要让元素遮挡钟面可读性。`,
  wall_art: `装饰画印花：适合挂画、画框、墙面装饰。画面完整，有更强艺术感和场景感，构图饱满，适合大幅展示，避免像商品实拍。`,
  metal_sign: `铁皮画印花：适合复古金属牌、酒吧牌、车库牌、怀旧海报。使用复古海报感、高对比、醒目主体、装饰边框、轻微旧化质感，避免真实产品 mockup。`,
}

const VARIATION_STRENGTH_PROMPTS: Record<VariationStrength, string> = {
  subtle: `变化强度：轻微。保留原图主体和大致风格，但改变装饰细节、背景、姿态或局部元素，不能输出与原图几乎一致的结果。`,
  balanced: `变化强度：中等。保留原图的主题灵感和视觉风格，但重新设计构图、背景、装饰元素和细节，结果应明显不同于原图。`,
  bold: `变化强度：大胆。只保留原图的核心主体或风格灵感，进行全新商业图案创作，构图和细节要大幅变化。`,
}

/** 图片裂变提示词（中文） */
export function buildVariationPrompt(scene: VariationScene, strength: VariationStrength): string {
  return `【图片裂变 / 印花再设计】
请把输入图片作为灵感参考，而不是复制对象。生成一张新的商业印花图案。

核心要求：
1. 保留原图可识别的主体、主题气质、色彩情绪和大致风格方向。
2. 必须重新设计构图、背景、装饰元素和画面细节，避免简单重绘、换色或输出近似原图。
3. 输出应像一张可直接用于 POD 商品的高清图案，不要生成产品样机、边框截图、水印、文字说明或对比图。
4. 画面主体清晰，商业感强，适合印刷，细节丰富但不要杂乱。

${VARIATION_SCENE_PROMPTS[scene]}
${VARIATION_STRENGTH_PROMPTS[strength]}`
}

export const STORAGE_KEY_TOKEN = 'batch_image_api_token'
export const STORAGE_KEY_MODEL = 'batch_image_model'
export const STORAGE_KEY_BASE = 'batch_image_api_base'
export const STORAGE_KEY_SIZE = 'batch_image_size'
export const STORAGE_KEY_PREFIX = 'batch_image_prefix'
export const STORAGE_KEY_START_NUMBER = 'batch_image_start_number'
export const STORAGE_KEY_EXPANSION_SCALE = 'batch_image_expansion_scale'
export const STORAGE_KEY_VARIATION_COUNT = 'batch_image_variation_count'
export const STORAGE_KEY_VARIATION_SCENE = 'batch_image_variation_scene'
export const STORAGE_KEY_VARIATION_STRENGTH = 'batch_image_variation_strength'
export const STORAGE_KEY_RESOLUTION_MODE = 'batch_image_resolution_mode'
export const STORAGE_KEY_TARGET_ASPECT = 'batch_image_target_aspect'

/** 默认尺寸 */
export const DEFAULT_SIZE = '1024x1024'

/** API 支持的宽高比标签 */
export const ASPECT_OPTIONS = ['1:1', '1:2', '2:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'] as const

export const DEFAULT_TARGET_ASPECT = '1:1'

export const RESOLUTION_MODES = [
  { value: 'scale', label: '按原图倍数' },
  { value: 'aspect', label: '按比例' },
  { value: 'custom', label: '自定义' },
] as const

export type ResolutionMode = (typeof RESOLUTION_MODES)[number]['value']

export const DEFAULT_RESOLUTION_MODE: ResolutionMode = 'aspect'

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
export const MIN_VARIATION_COUNT = 1
export const MAX_VARIATION_COUNT = 10
export const DEFAULT_VARIATION_COUNT = 4

/** 输出起始编号 */
export const MIN_START_NUMBER = 1
export const MAX_START_NUMBER = 999999
export const DEFAULT_START_NUMBER = 1

/** 将裂变数量输入规范为合法整数 */
export function normalizeVariationCount(
  raw: string | number,
  fallback: number = DEFAULT_VARIATION_COUNT,
): number {
  const n = typeof raw === 'number' ? raw : parseInt(raw.trim(), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(MIN_VARIATION_COUNT, Math.min(MAX_VARIATION_COUNT, n))
}

/** 将起始编号输入规范为合法整数 */
export function normalizeStartNumber(
  raw: string | number,
  fallback: number = DEFAULT_START_NUMBER,
): number {
  const n = typeof raw === 'number' ? raw : parseInt(raw.trim(), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(MIN_START_NUMBER, Math.min(MAX_START_NUMBER, n))
}

/** 默认扩充比例 */
export const DEFAULT_EXPANSION_SCALE = '1.5'
