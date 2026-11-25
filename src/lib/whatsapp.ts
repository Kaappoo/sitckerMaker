import { Capacitor, registerPlugin } from '@capacitor/core'
import { blobToBase64, makeTrayIcon } from './render'
import { LIMITS, type StickerPack } from './types'

// Ponte com o código nativo Android (android/app/src/main/java/.../whatsapp).
// O plugin grava os arquivos do pacote no armazenamento interno do app, que
// são expostos ao WhatsApp por um ContentProvider, e dispara a intent oficial
// "com.whatsapp.intent.action.ENABLE_STICKER_PACK".

interface NativeSticker {
  /** WebP em base64 (sem o prefixo data:) */
  data: string
  emojis: string[]
}

interface WhatsAppStickersPlugin {
  isWhatsAppInstalled(): Promise<{ consumer: boolean; business: boolean }>
  addStickerPack(options: {
    identifier: string
    name: string
    publisher: string
    imageDataVersion: string
    trayImage: string
    trayImageType: 'png' | 'webp'
    animated: boolean
    stickers: NativeSticker[]
  }): Promise<{ added: boolean }>
}

const WhatsAppStickers = registerPlugin<WhatsAppStickersPlugin>('WhatsAppStickers')

export const isAndroidApp = Capacitor.getPlatform() === 'android'

/** Retorna a lista de problemas que impedem o envio ao WhatsApp. */
export function validatePack(pack: StickerPack): string[] {
  const problems: string[] = []
  const n = pack.stickers.length
  if (n < LIMITS.minStickers) {
    problems.push(`O WhatsApp exige pelo menos ${LIMITS.minStickers} figurinhas (faltam ${LIMITS.minStickers - n}).`)
  }
  if (n > LIMITS.maxStickers) problems.push(`Máximo de ${LIMITS.maxStickers} figurinhas por pacote.`)
  if (!pack.name.trim()) problems.push('Dê um nome ao pacote.')
  if (!pack.publisher.trim()) problems.push('Informe o autor do pacote.')
  if (pack.name.length > LIMITS.maxTextLength || pack.publisher.length > LIMITS.maxTextLength) {
    problems.push(`Nome e autor podem ter no máximo ${LIMITS.maxTextLength} caracteres.`)
  }
  const maxBytes = pack.animated ? LIMITS.animatedStickerMaxBytes : LIMITS.stickerMaxBytes
  if (pack.stickers.some((s) => s.image.size > maxBytes)) {
    problems.push(`Alguma figurinha passou de ${maxBytes / 1024} KB.`)
  }
  if (pack.stickers.some((s) => !!s.animated !== !!pack.animated)) {
    problems.push('O pacote mistura figurinhas estáticas e animadas.')
  }
  return problems
}

export async function whatsAppStatus() {
  if (!isAndroidApp) return { consumer: false, business: false }
  return WhatsAppStickers.isWhatsAppInstalled()
}

/**
 * Envia o pacote para o WhatsApp. Resolve `true` se o usuário confirmou,
 * `false` se cancelou. Lança erro com a mensagem de validação do WhatsApp.
 */
export async function addToWhatsApp(pack: StickerPack): Promise<boolean> {
  const problems = validatePack(pack)
  if (problems.length) throw new Error(problems.join('\n'))

  const tray = await makeTrayIcon(pack.stickers[0].image)
  const stickers = await Promise.all(
    pack.stickers.map(async (s) => ({
      data: await blobToBase64(s.image),
      emojis: s.emojis.length ? s.emojis : ['😀'],
    })),
  )
  const { added } = await WhatsAppStickers.addStickerPack({
    identifier: pack.id,
    name: pack.name.trim(),
    publisher: pack.publisher.trim(),
    imageDataVersion: String(pack.version),
    trayImage: await blobToBase64(tray),
    trayImageType: tray.type === 'image/png' ? 'png' : 'webp',
    animated: !!pack.animated,
    stickers,
  })
  return added
}
