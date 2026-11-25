import type { StickerPack } from './types'

// Os pacotes ficam no IndexedDB do próprio aparelho (WebView no Android,
// navegador na web). Blobs são guardados diretamente, sem base64.

const DB_NAME = 'figurinhas'
const STORE = 'packs'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

async function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = run(t.objectStore(STORE))
    t.oncomplete = () => resolve(req.result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export async function listPacks(): Promise<StickerPack[]> {
  const packs = await tx('readonly', (s) => s.getAll() as IDBRequest<StickerPack[]>)
  return packs.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getPack(id: string): Promise<StickerPack | undefined> {
  return tx('readonly', (s) => s.get(id) as IDBRequest<StickerPack | undefined>)
}

export async function savePack(pack: StickerPack): Promise<void> {
  await tx('readwrite', (s) => s.put(pack))
}

export async function deletePack(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
}
