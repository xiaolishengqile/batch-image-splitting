import { blobToDataURL } from '../lib/files'

export interface GenerationsBody {
  model: string
  prompt: string
  size: string
  /** 与 OpenAI Image API 对齐 */
  background?: 'transparent' | 'opaque' | 'auto'
  output_format?: 'png' | 'jpeg' | 'webp'
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

function extractErrorMessage(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return
  const o = json as Record<string, unknown>
  return pickString(o, ['message', 'error', 'msg', 'detail'])
}

/**
 * 从网关返回 JSON 中解析出可在 <img src> 使用的地址或 data URL。
 * 兼容 OpenAI 风格 data[]、单字段 image / b64_json 等。
 */
export async function parseGenerationImage(json: unknown): Promise<string> {
  if (!json || typeof json !== 'object') {
    throw new Error('响应体不是 JSON 对象')
  }
  const root = json as Record<string, unknown>

  if (Array.isArray(root.image) && root.image.length > 0 && typeof root.image[0] === 'string') {
    const s = root.image[0]
    if (s.startsWith('http://') || s.startsWith('https://')) return fetchRemoteAsDataURL(s)
    if (s.startsWith('data:')) return s
    return `data:image/png;base64,${s}`
  }

  const direct = pickString(root, ['b64_json', 'image_base64']) ?? (typeof root.image === 'string' ? root.image : undefined)
  if (direct) {
    if (direct.startsWith('http://') || direct.startsWith('https://')) {
      return fetchRemoteAsDataURL(direct)
    }
    if (direct.startsWith('data:')) return direct
    return `data:image/png;base64,${direct}`
  }

  const dataArr = root.data
  if (Array.isArray(dataArr) && dataArr.length > 0) {
    const first = dataArr[0]
    if (first && typeof first === 'object') {
      const item = first as Record<string, unknown>
      const url = item.url
      if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
        return fetchRemoteAsDataURL(url)
      }
      const b64 = item.b64_json
      if (typeof b64 === 'string') {
        return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`
      }
    }
  }

  const images = root.images
  if (Array.isArray(images) && typeof images[0] === 'string') {
    const s = images[0] as string
    if (s.startsWith('http')) return fetchRemoteAsDataURL(s)
    return s.startsWith('data:') ? s : `data:image/png;base64,${s}`
  }

  throw new Error(
    '无法解析图片字段：请展开「原始响应」查看结构。常见字段为 data[0].url 或 data[0].b64_json。',
  )
}

async function fetchRemoteAsDataURL(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`下载生成图失败 HTTP ${res.status}`)
  }
  const blob = await res.blob()
  return blobToDataURL(blob)
}

export async function postImagesGenerations(
  baseUrl: string,
  bearerToken: string,
  body: GenerationsBody,
  signal?: AbortSignal,
): Promise<{ imageDataUrl: string; rawJson: unknown }> {
  const base = baseUrl.replace(/\/$/, '')
  const url = `${base}/v1/images/generations`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`响应不是合法 JSON（HTTP ${res.status}）：${text.slice(0, 280)}`)
  }

  if (!res.ok) {
    const hint = extractErrorMessage(json) ?? text.slice(0, 400)
    throw new Error(`HTTP ${res.status}: ${hint}`)
  }

  const imageDataUrl = await parseGenerationImage(json)
  return { imageDataUrl, rawJson: json }
}
