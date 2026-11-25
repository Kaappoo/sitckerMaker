export interface Sticker {
  id: string
  /** WebP 512x512, até 100 KB */
  image: Blob
  /** 1 a 3 emojis usados pelo WhatsApp para busca */
  emojis: string[]
}

export interface StickerPack {
  /** Também é o identificador do pacote no WhatsApp (só letras e números) */
  id: string
  name: string
  publisher: string
  stickers: Sticker[]
  /**
   * Incrementado a cada mudança nas figurinhas. O WhatsApp guarda cache do
   * pacote e só atualiza quando esse número muda (image_data_version).
   */
  version: number
  createdAt: number
  updatedAt: number
}

/** Regras do WhatsApp para pacotes de figurinhas estáticas */
export const LIMITS = {
  stickerSize: 512,
  stickerMaxBytes: 100 * 1024,
  traySize: 96,
  trayMaxBytes: 50 * 1024,
  minStickers: 3,
  maxStickers: 30,
  maxTextLength: 128,
  maxEmojis: 3,
} as const

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}
