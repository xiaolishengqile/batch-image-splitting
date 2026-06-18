const DB_NAME = 'batch_image_splitting'
const STORE_NAME = 'results'
const DB_VERSION = 1

interface StoredImageRecord {
  id: string
  blob: Blob
  mime: string
  createdAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('无法打开 IndexedDB'))
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })

  return dbPromise
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl)
  return response.blob()
}

export async function putResultImage(id: string, source: string | Blob): Promise<Blob> {
  const blob = typeof source === 'string' ? await dataUrlToBlob(source) : source
  const record: StoredImageRecord = {
    id,
    blob,
    mime: blob.type || 'image/png',
    createdAt: Date.now(),
  }

  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 写入失败'))
    tx.oncomplete = () => resolve()
    tx.objectStore(STORE_NAME).put(record)
  })

  return blob
}

export async function getResultBlob(id: string): Promise<Blob | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 读取失败'))
    const request = tx.objectStore(STORE_NAME).get(id)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 读取失败'))
    request.onsuccess = () => {
      const record = request.result as StoredImageRecord | undefined
      resolve(record?.blob ?? null)
    }
  })
}

export async function deleteResultImage(id: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 删除失败'))
    tx.oncomplete = () => resolve()
    tx.objectStore(STORE_NAME).delete(id)
  })
}

export async function deleteResultImages(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 批量删除失败'))
    tx.oncomplete = () => resolve()
    const store = tx.objectStore(STORE_NAME)
    for (const id of ids) {
      store.delete(id)
    }
  })
}

export async function clearResultImages(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 清空失败'))
    tx.oncomplete = () => resolve()
    tx.objectStore(STORE_NAME).clear()
  })
}
