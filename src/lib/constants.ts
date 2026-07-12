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
Analyze the input image's theme, subject matter, visual medium, art style, color palette, texture, lighting, and motif language.
Create a new artwork with the same theme family and the same visual medium/style, but redesign the composition and element arrangement.
Keep the result suitable as a standalone commercial print pattern.
Do not copy the original layout, crop, camera angle, or exact object positions.
Avoid watermarks, mockup frames, product photos, before/after comparisons, and text labels.`

const VARIATION_SCENE_PROMPTS: Record<VariationScene, string> = {
  default: `通用印花图案：适合用于多种 POD 商品。保持原图的艺术媒介和审美风格，例如油画继续油画、水彩继续水彩、摄影质感继续摄影质感、矢量扁平继续矢量扁平；不要自动改成插画风。`,
  apparel: `服装/家纺印花：适合 T 恤、卫衣、抱枕、毯子、布料印花。主体要醒目，装饰元素更丰富，边缘自然，适合织物印刷，避免复杂小字和过细线条；同时保持原图艺术媒介。`,
  phone_case: `手机壳印花：竖版构图，主体居中或略偏上，保留安全边距，适合窄长手机壳画幅。画面要有装饰性背景，避免主体贴边或被裁切。`,
  line_art: `铁艺图形：转化为适合金属切割、线稿、雕刻或镂空工艺的图形。使用清晰轮廓、较少颜色、强对比、连贯线条，避免照片质感和复杂渐变。`,
  clock: `挂钟印花：适合圆形钟面。围绕圆形构图，主体和装饰元素平衡分布，可包含装饰边框、刻度感或数字区域，但不要让元素遮挡钟面可读性。`,
  wall_art: `装饰画印花：适合挂画、画框、墙面装饰。画面完整，有更强艺术感和场景感，构图饱满，适合大幅展示，避免像商品实拍。`,
  metal_sign: `铁皮画印花：适合复古金属牌、酒吧牌、车库牌、怀旧海报。使用复古海报感、高对比、醒目主体、装饰边框、轻微旧化质感，避免真实产品 mockup。`,
}

const VARIATION_STRENGTH_PROMPTS: Record<VariationStrength, string> = {
  subtle: `变化强度：轻微。必须保持主题相似和风格相似，但构图要大胆重构：改变视角或图案排布，替换部分元素组合，调整元素大小层级、密度、背景节奏和视觉焦点。结果应像同一系列的新设计，而不是原图的临摹、裁切、扩写或轻微改色。`,
  balanced: `变化强度：中等。必须保持原图的图片种类和媒介类别：实景变实景、插画变插画、动漫变动漫、油画变油画、水彩变水彩。不要改变种类，但只需要保留大类主体或大类场景，不需要还原原图的具体主题元素。猫咪只要还是猫咪，可以跳跃、睡觉、躺着、吃东西；沙滩只要能看出来是沙滩，可以换成任意沙滩场景。`,
  bold: `变化强度：大胆。第 1 张保持原图图片种类和视觉风格，但大幅改变构图、动作、场景或元素组合；从第 2 张开始按裂变序号分配不同风格方向，可以改变艺术媒介、视觉风格、色彩体系、构图语言和整体设计气质，只保留核心题材类别和商业用途。`,
}

const VARIATION_DIRECTION_PROMPTS: Record<VariationStrength, string[]> = {
  subtle: [
    `本张变化方向：使用全新的俯视/平铺式构图，关键元素重新分布成图案化画面；不要沿用原图的主体位置、裁切和视角。`,
    `本张变化方向：使用近景细节构图，放大局部材质、纹理和关键元素，背景节奏重新设计；仍保持原图真实/绘画媒介质感。`,
    `本张变化方向：做更密集的满版构图，增加同主题元素数量和大小层级变化，让画面像同系列新设计而非原图改色。`,
    `本张变化方向：做更清爽的留白构图，减少部分元素、拉开空间关系、改变视觉焦点；主题和风格不变。`,
    `本张变化方向：采用对角线、弧形或流动式构图，让画面运动方向完全不同，关键元素重新组合。`,
    `本张变化方向：替换约一半的次要元素为同主题家族的新元素，保留核心题材和媒介风格，但画面结构必须明显不同。`,
    `本张变化方向：改变主体尺度关系，把原来的大元素变小或把小元素变成视觉焦点，重建前景、中景、背景。`,
    `本张变化方向：改变取景距离和空间层次，加入新的同主题背景结构，避免复制原图的元素位置和整体轮廓。`,
  ],
  balanced: [
    `同种类变化方向：保持图片种类不变，改变主体动作或状态；例如猫咪可变成跳跃、睡觉、躺着、吃东西，场景也可完全更换。`,
    `同种类变化方向：保持图片种类不变，换成另一个同大类场景；例如沙滩可换成海岸线、浅滩、棕榈海滩、日落沙滩或贝壳沙地。`,
    `同种类变化方向：保持图片种类不变，改变取景距离和视角；可以从远景变近景、从正面变俯视、从局部变全景。`,
    `同种类变化方向：保持图片种类不变，改变主角姿态、数量或互动关系；不需要沿用原图里的具体物体。`,
    `同种类变化方向：保持图片种类不变，改变环境和背景；只要大类主体或大类场景清楚即可。`,
    `同种类变化方向：保持图片种类不变，改变时间、天气、光影或氛围；例如晴天、日落、清晨、柔光、强光。`,
    `同种类变化方向：保持图片种类不变，重新设计构图和视觉焦点；不要保留原图轮廓、裁切和对象位置。`,
    `同种类变化方向：保持图片种类不变，使用新的颜色比例、背景结构和元素疏密，生成同大类的新素材。`,
    `同种类变化方向：保持图片种类不变，换成另一种同类用途的商业图案或素材构图。`,
    `同种类变化方向：保持图片种类不变，替换大部分具体元素，只保留可识别的大类主题。`,
    `同种类变化方向：保持图片种类不变，改变画面叙事；例如从静态展示变成动作瞬间、生活场景或装饰场景。`,
    `同种类变化方向：保持图片种类不变，改变主体尺度关系和空间层次，重新建立前景、中景、背景。`,
    `同种类变化方向：保持图片种类不变，生成另一个同大类素材库图片，避免像原图的变体。`,
    `同种类变化方向：保持图片种类不变，改变细节密度和留白位置，不必保留原图元素组合。`,
    `同种类变化方向：保持图片种类不变，加入新的同大类元素或删除原图多数元素，只要类别清楚。`,
    `同种类变化方向：保持图片种类不变，重建整体场景方案，允许主题细节大幅不同。`,
  ],
  bold: [
    `参考原图风格方向：保持原图图片种类和视觉风格，但大幅改变构图、动作、场景、元素组合、取景和视觉焦点。`,
    `高级商业插画/装饰图案风格：使用新的线条、色块、纹理和设计语言。`,
    `复古海报或复古印花风格：重建色彩体系、构图节奏和装饰元素。`,
    `现代极简图形风格：减少真实细节，强调大色块、清晰轮廓和设计感。`,
    `水彩/手绘艺术风格：使用新的笔触、留白、层次和柔和色彩。`,
    `高饱和潮流插画风格：加入更强对比、更大胆配色和全新画面节奏。`,
    `奢华装饰艺术风格：使用对称、边框、金属感或精致纹样重构画面。`,
    `儿童友好/可爱卡通风格：重建角色化元素、圆润造型和轻快色彩。`,
    `拼贴/版画风格：使用全新的材质层次、剪纸感轮廓和组合构图。`,
    `矢量徽章/贴纸风格：用清晰轮廓、醒目主体、扁平色块和装饰边框重新设计。`,
    `民族风/波西米亚装饰风格：加入重复纹样、手工感线条、暖色装饰和图腾式排布。`,
    `赛博霓虹/未来感风格：使用霓虹色、暗色背景、发光边缘和科技感构图。`,
    `日系清新插画风格：使用柔和配色、简洁线条、轻盈留白和温柔画面节奏。`,
    `复古雕刻/铜版画风格：使用细密线条、单色或双色印刷质感和复古排版。`,
    `涂鸦街头艺术风格：使用夸张轮廓、喷绘质感、高对比色和动感构图。`,
    `高级壁纸图案风格：使用重复纹样、精致装饰、均衡密度和可平铺的商业图案感。`,
    `梦幻奇幻插画风格：使用发光细节、幻想色彩、戏剧化层次和全新视觉气质。`,
  ],
}

/** 从 [0, poolSize) 中随机抽取 count 个不重复的下标 */
export function pickRandomDirectionIndices(count: number, poolSize: number): number[] {
  if (count <= 0 || poolSize <= 0) return []
  const n = Math.min(count, poolSize)
  const indices = Array.from({ length: poolSize }, (_, i) => i)
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (poolSize - i))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }
  return indices.slice(0, n)
}

/** 为一次裂变批次随机分配方向下标；大胆变化第 1 张固定为参考原图风格 */
export function pickVariationDirectionIndices(strength: VariationStrength, count: number): number[] {
  const poolSize = VARIATION_DIRECTION_PROMPTS[strength].length
  if (count <= 0) return []
  if (strength === 'bold') {
    if (count === 1) return [0]
    const rest = pickRandomDirectionIndices(count - 1, poolSize - 1)
    return [0, ...rest.map((i) => i + 1)]
  }
  return pickRandomDirectionIndices(count, poolSize)
}

function buildVariationDirectionPrompt(
  strength: VariationStrength,
  variationIndex?: number,
  directionIndex?: number,
): string {
  if (variationIndex == null) return ''
  const prompts = VARIATION_DIRECTION_PROMPTS[strength]
  const index = directionIndex ?? variationIndex % prompts.length
  const prompt = prompts[index]
  if (strength === 'bold') {
    return `本张大胆变化是第 ${variationIndex + 1} 张裂变图，必须使用指定风格方向：${prompt}`
  }
  return prompt
}

/** 图片裂变提示词（中文） */
export function buildVariationPrompt(
  scene: VariationScene,
  strength: VariationStrength,
  variationIndex?: number,
  directionIndex?: number,
  targetAspect?: string,
): string {
  const directionPrompt = buildVariationDirectionPrompt(strength, variationIndex, directionIndex)
  const looseSubject = strength === 'balanced' || strength === 'bold'
  const isFirstBoldVariation = strength === 'bold' && variationIndex === 0
  const styleRule =
    strength === 'bold'
      ? isFirstBoldVariation
        ? `2. 大胆变化第 1 张必须参考原图图片种类和视觉风格，不改变原图媒介类别。`
        : `2. 大胆变化第 2 张及之后必须使用分配到的全新风格方向，可以改变艺术媒介和视觉风格。`
      : `2. 必须保持原图的艺术媒介和风格质感：油画不能变插画，水彩不能变矢量，照片不能变卡通，手绘线稿不能变厚涂。`
  const sceneRule =
    looseSubject
      ? isFirstBoldVariation
        ? `5. 大胆变化第 1 张不改变原图风格，但不需要还原原图具体主题元素；只要大类主体或大类场景可识别即可。`
        : `5. 中等/大胆变化不需要还原原图具体主题元素；只要大类主体或大类场景可识别即可。`
      : `5. 如果原图是真实摄影或真实质感场景，输出也必须是真实摄影/真实质感场景；变化只发生在构图、元素组合和取景方式上。`
  const boldInstruction =
    strength === 'bold'
      ? `
大胆变化特别规则：
1. 第 1 张大胆裂变必须参考原图风格，但仍要明显改变构图、场景、动作或元素组合。
2. 第 2 张及之后必须按照裂变序号使用不同风格方向，避免同风格重复。
3. 只需要保留大类主体或大类场景，不需要保留原图的具体主题元素；猫咪可以换动作，沙滩可以换成任何能看出是沙滩的场景。
4. 不要保留原图的具体构图、具体对象位置、具体物体数量、边缘轮廓、裁切方式或视觉焦点。`
      : ''
  const aspectPrompt = targetAspect
    ? `\n输出画幅必须严格使用 ${targetAspect} 的宽高比。整个构图需要按照这个比例来组织，确保视觉元素在画布上均衡分布。`
    : ''
  return `【图片裂变 / 印花再设计】
请把输入图片作为主题和风格参考，而不是复制对象。生成一张新的商业印花图案。

核心要求：
1. 先识别原图的主题词、主要元素、艺术媒介、笔触/材质、色彩气质、光影和装饰语言。
${styleRule}
3. 主题要相似：轻微变化保留同一题材家族和关键元素类型；中等/大胆变化只需保留大类主体或大类场景，不要复刻原图的构图、裁切、视角、元素位置或主体比例。
4. 根据变化强度重新设计构图、背景、元素密度、装饰节奏和细节组合，让结果像同系列新图。
${sceneRule}
6. 输出应像一张可直接用于 POD 商品的高清图案，不要生成产品样机、边框截图、水印、文字说明或对比图。

${VARIATION_SCENE_PROMPTS[scene]}
${VARIATION_STRENGTH_PROMPTS[strength]}
${boldInstruction}
${directionPrompt}${aspectPrompt}`
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
export const STORAGE_KEY_CUSTOM_TARGET_ASPECT = 'batch_image_custom_target_aspect'

/** 默认尺寸 */
export const DEFAULT_SIZE = '1024x1024'

/** API 支持的宽高比标签 */
export const ASPECT_OPTIONS = ['5:8', '1:1', '1:2', '2:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'] as const

export const DEFAULT_TARGET_ASPECT = '5:8'

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
