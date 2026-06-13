import { parseGenerationImage } from './imagesGenerations'

export interface EditsBody {
  model: string
  prompt: string
  size: string
  aspect_ratio: string
  /** 待编辑的图片 */
  images: File[]
}

function extractErrorMessage(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return
  const o = json as Record<string, unknown>
  for (const k of ['message', 'error', 'msg', 'detail']) {
    const v = o[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
}

export async function postImagesEdits(
  baseUrl: string,
  bearerToken: string,
  body: EditsBody,
  signal?: AbortSignal,
): Promise<{ imageDataUrl: string; rawJson: unknown }> {
  const base = baseUrl.replace(/\/$/, '')
  const url = `${base}/v1/images/edits`

  const form = new FormData()
  form.append('model', body.model)
  form.append('prompt', body.prompt)
  form.append('size', body.size)
  form.append('aspect_ratio', body.aspect_ratio)
  for (const file of body.images) {
    form.append('image[]', file, file.name)
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
    body: form,
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
