import { LIMITS } from './types'

/** Todas as coordenadas do editor estão no espaço 512x512 da figurinha. */
export const CANVAS = LIMITS.stickerSize

export interface ImageLayer {
  bitmap: ImageBitmap
  x: number
  y: number
  scale: number
  /** radianos */
  rotation: number
}

export interface TextLayer {
  id: string
  text: string
  x: number
  y: number
  size: number
  color: string
  stroke: string
}

export interface Outline {
  enabled: boolean
  width: number
  color: string
}

export interface StickerDesign {
  image: ImageLayer | null
  texts: TextLayer[]
  outline: Outline
}

export const FONT_FAMILY = '"Arial Black", "Roboto", "Helvetica Neue", Arial, sans-serif'

export function textFont(size: number): string {
  return `900 ${size}px ${FONT_FAMILY}`
}

export function textLines(t: TextLayer): string[] {
  return t.text.split('\n')
}

/** Caixa (sem rotação) que contém o texto, para seleção e arraste. */
export function textBounds(ctx: CanvasRenderingContext2D, t: TextLayer) {
  ctx.save()
  ctx.font = textFont(t.size)
  const lines = textLines(t)
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width), t.size * 0.5)
  ctx.restore()
  const lineHeight = t.size * 1.1
  const height = lineHeight * lines.length
  const pad = t.size * 0.15
  return {
    x: t.x - width / 2 - pad,
    y: t.y - height / 2 - pad,
    w: width + pad * 2,
    h: height + pad * 2,
  }
}

function drawText(ctx: CanvasRenderingContext2D, t: TextLayer) {
  const lines = textLines(t)
  const lineHeight = t.size * 1.1
  ctx.save()
  ctx.font = textFont(t.size)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  ctx.lineWidth = Math.max(2, t.size * 0.2)
  ctx.strokeStyle = t.stroke
  ctx.fillStyle = t.color
  const top = t.y - (lineHeight * (lines.length - 1)) / 2
  lines.forEach((line, i) => {
    const y = top + i * lineHeight
    ctx.strokeText(line, t.x, y)
    ctx.fillText(line, t.x, y)
  })
  ctx.restore()
}

function drawImageLayer(ctx: CanvasRenderingContext2D, img: ImageLayer) {
  ctx.save()
  ctx.translate(img.x, img.y)
  ctx.rotate(img.rotation)
  ctx.scale(img.scale, img.scale)
  ctx.drawImage(img.bitmap, -img.bitmap.width / 2, -img.bitmap.height / 2)
  ctx.restore()
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponível')
  return [c, ctx]
}

/**
 * Contorno estilo "figurinha recortada": carimba a silhueta (canal alfa)
 * deslocada em vários ângulos, pinta tudo com a cor do contorno e desenha o
 * conteúdo original por cima.
 */
function withOutline(src: HTMLCanvasElement, width: number, color: string): HTMLCanvasElement {
  const [out, ctx] = makeCanvas(src.width)
  const steps = Math.max(16, Math.ceil(width * 4))
  for (const r of [width, width * 0.5]) {
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      ctx.drawImage(src, Math.cos(a) * r, Math.sin(a) * r)
    }
  }
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(src, 0, 0)
  return out
}

/** Renderiza a figurinha final (sem guias de seleção) em 512x512. */
export function renderDesign(design: StickerDesign): HTMLCanvasElement {
  const [content, ctx] = makeCanvas(CANVAS)
  if (design.image) drawImageLayer(ctx, design.image)
  design.texts.forEach((t) => drawText(ctx, t))
  if (design.outline.enabled && design.outline.width > 0) {
    return withOutline(content, design.outline.width, design.outline.color)
  }
  return content
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar imagem'))), type, quality),
  )
}

function isBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d')!
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false
  return true
}

/**
 * Gera o WebP exigido pelo WhatsApp: 512x512 e até 100 KB.
 * Reduz a qualidade aos poucos até caber no limite.
 */
export async function exportStickerWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  if (canvas.width !== CANVAS || canvas.height !== CANVAS) {
    throw new Error('A figurinha precisa ter 512x512')
  }
  if (isBlank(canvas)) throw new Error('A figurinha está vazia')
  for (let q = 0.95; q >= 0.2; q -= 0.075) {
    const blob = await toBlob(canvas, 'image/webp', q)
    if (blob.type !== 'image/webp') {
      throw new Error('Este navegador não consegue gerar WebP. Use o app Android ou o Chrome.')
    }
    if (blob.size <= LIMITS.stickerMaxBytes) return blob
  }
  throw new Error('Não foi possível deixar a figurinha abaixo de 100 KB')
}

/** Ícone do pacote: PNG 96x96, até 50 KB, gerado a partir de uma figurinha. */
export async function makeTrayIcon(sticker: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(sticker)
  const [c, ctx] = makeCanvas(LIMITS.traySize)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, LIMITS.traySize, LIMITS.traySize)
  bmp.close()
  const png = await toBlob(c, 'image/png')
  if (png.size <= LIMITS.trayMaxBytes) return png
  return toBlob(c, 'image/webp', 0.8)
}

/** Reduz fotos grandes da câmera para acelerar edição e recorte. */
export async function loadImage(file: Blob, maxSide = 1024): Promise<ImageBitmap> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const ratio = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  if (ratio === 1) return bmp
  const resized = await createImageBitmap(bmp, {
    resizeWidth: Math.round(bmp.width * ratio),
    resizeHeight: Math.round(bmp.height * ratio),
    resizeQuality: 'high',
  })
  bmp.close()
  return resized
}

export function fitImage(bitmap: ImageBitmap, margin = 24): ImageLayer {
  const box = CANVAS - margin * 2
  return {
    bitmap,
    x: CANVAS / 2,
    y: CANVAS / 2,
    scale: Math.min(box / bitmap.width, box / bitmap.height),
    rotation: 0,
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** Separa emojis digitados (1 a 3). */
export function parseEmojis(input: string): string[] {
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return Array.from(seg.segment(input), (s) => s.segment)
    .filter((g) => g.trim() !== '' && g !== ',')
    .slice(0, LIMITS.maxEmojis)
}
