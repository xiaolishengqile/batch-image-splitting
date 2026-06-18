import { useEffect, useState } from 'react'
import { getResultBlob } from '../lib/imageStore'

interface ResultImageProps {
  imageId: string
  alt: string
  placeholder?: string
}

export function ResultImage({ imageId, alt, placeholder = '加载中…' }: ResultImageProps) {
  const [state, setState] = useState<{ imageId: string; src: string | null; failed: boolean }>({
    imageId,
    src: null,
    failed: false,
  })

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    void getResultBlob(imageId)
      .then((blob) => {
        if (cancelled) return
        if (!blob) {
          setState({ imageId, src: null, failed: true })
          return
        }
        objectUrl = URL.createObjectURL(blob)
        setState({ imageId, src: objectUrl, failed: false })
      })
      .catch(() => {
        if (!cancelled) setState({ imageId, src: null, failed: true })
      })

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [imageId])

  const current = state.imageId === imageId ? state : { src: null, failed: false }

  if (current.src) {
    return <img src={current.src} alt={alt} />
  }

  return <span className="result-placeholder">{current.failed ? '无法加载' : placeholder}</span>
}
