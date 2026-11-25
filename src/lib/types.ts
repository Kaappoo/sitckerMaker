export interface Sticker {
  id: string
  /** WebP 512x512: até 100 KB (estática) ou 500 KB (animada) */
  image: Blob
  animated?: boolean
  /** 1 a 3 emojis usados pelo WhatsApp para busca */
  emojis: string[]
}

export interface StickerPack {
  /** Também é o identificador do pacote no WhatsApp (só letras e números) */
  id: string
  name: string
  publisher: string
  stickers: Sticker[]
  /** O WhatsApp não aceita misturar estáticas e animadas no mesmo pacote */
  animated?: boolean
  /**
   * Incrementado a cada mudança nas figurinhas. O WhatsApp guarda cache do
   * pacote e só atualiza quando esse número muda (image_data_version).
   */
  version: number
  createdAt: number
  updatedAt: number
}

/** Regras do WhatsApp para pacotes de figurinhas */
export const LIMITS = {
  stickerSize: 512,
  stickerMaxBytes: 100 * 1024,
  animatedStickerMaxBytes: 500 * 1024,
  animatedMaxMs: 10_000,
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
