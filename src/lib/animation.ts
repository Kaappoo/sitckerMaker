import { LIMITS } from './types'

// Figurinhas animadas do WhatsApp são WebP animados: 512x512, até 500 KB,
// até 10 s, cada quadro com pelo menos 8 ms.
//
// Fluxo: vídeo/GIF -> quadros (ImageBitmap) -> cada quadro renderizado com
// textos/contorno -> cada um codificado como WebP estático pelo canvas ->
// os quadros são "costurados" num único WebP animado (contêiner RIFF).
// Tudo roda no aparelho, sem servidor e sem ffmpeg.

export interface AnimFrames {
  frames: ImageBitmap[]
  /** duração de cada quadro em ms */
  durations: number[]
}

export const ANIM = {
  fps: 10,
  maxSeconds: 8,
  defaultSeconds: 3,
  maxFrames: 100,
} as const

export function totalMs(a: AnimFrames): number {
  return a.durations.reduce((s, d) => s + d, 0)
}

export function disposeFrames(a: AnimFrames | null) {
  a?.frames.forEach((f) => f.close())
}

async function scaledBitmap(source: CanvasImageSource, w: number, h: number, maxSide: number) {
  const ratio = Math.min(1, maxSide / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * ratio))
  const ch = Math.max(1, Math.round(h * ratio))
  const c = document.createElement('canvas')
  c.width = cw
  c.height = ch
  c.getContext('2d')!.drawImage(source, 0, 0, cw, ch)
  return createImageBitmap(c)
}

// ---------------------------------------------------------------- vídeo

export interface VideoInfo {
  video: HTMLVideoElement
  url: string
  duration: number
}

export async function openVideo(file: Blob): Promise<VideoInfo> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('Formato de vídeo não suportado'))
    })
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
  if (!video.videoWidth || !Number.isFinite(video.duration)) {
    URL.revokeObjectURL(url)
    throw new Error('Não consegui ler esse vídeo')
  }
  return { video, url, duration: video.duration }
}

export function closeVideo(info: VideoInfo | null) {
  if (!info) return
  info.video.removeAttribute('src')
  info.video.load()
  URL.revokeObjectURL(info.url)
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      video.removeEventListener('seeked', done)
      resolve()
    }
    // "seeked" não dispara se já estiver nessa posição: usa um timeout de segurança
    const timer = setTimeout(done, 2000)
    video.addEventListener('seeked', done)
    video.currentTime = t
  })
}

/** Extrai quadros de um trecho do vídeo, a ANIM.fps. */
export async function extractVideoFrames(
  info: VideoInfo,
  start: number,
  seconds: number,
  onProgress?: (fraction: number) => void,
  maxSide = 512,
): Promise<AnimFrames> {
  const { video } = info
  const step = 1 / ANIM.fps
  const end = Math.min(info.duration, start + Math.min(seconds, ANIM.maxSeconds))
  const count = Math.max(1, Math.min(ANIM.maxFrames, Math.floor((end - start) / step + 1e-6)))
  const frames: ImageBitmap[] = []
  for (let i = 0; i < count; i++) {
    // pequeno deslocamento evita cair exatamente na borda entre quadros
    await seek(video, Math.min(info.duration - 0.001, start + i * step + 0.001))
    frames.push(await scaledBitmap(video, video.videoWidth, video.videoHeight, maxSide))
    onProgress?.((i + 1) / count)
  }
  return { frames, durations: frames.map(() => Math.round(1000 / ANIM.fps)) }
}

// ---------------------------------------------------------------- GIF / WebP animado

export function canDecodeAnimatedImages(): boolean {
  return typeof ImageDecoder !== 'undefined'
}

/** Decodifica GIF (ou WebP/PNG animado) com a API ImageDecoder do Chromium. */
export async function decodeAnimatedImage(file: Blob, maxSide = 512): Promise<AnimFrames> {
  if (!canDecodeAnimatedImages()) throw new Error('Este aparelho não decodifica GIF. Use um vídeo.')
  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type || 'image/gif' })
  try {
    await decoder.tracks.ready
    const track = decoder.tracks.selectedTrack
    const count = track?.frameCount ?? 1
    const frames: ImageBitmap[] = []
    const durations: number[] = []
    let elapsed = 0
    // Pula quadros se o GIF tiver muitos, preservando o tempo total
    const stride = Math.max(1, Math.ceil(count / ANIM.maxFrames))
    for (let i = 0; i < count && elapsed < ANIM.maxSeconds * 1000; i += stride) {
      let ms = 0
      for (let j = i; j < Math.min(count, i + stride); j++) {
        const { image } = await decoder.decode({ frameIndex: j })
        if (j === i) frames.push(await scaledBitmap(image, image.displayWidth, image.displayHeight, maxSide))
        // navegadores tratam GIF com atraso <= 10 ms como 100 ms
        const d = (image.duration ?? 0) / 1000
        ms += d <= 10 ? 100 : d
        image.close()
      }
      durations.push(Math.round(ms))
      elapsed += ms
    }
    return { frames, durations }
  } finally {
    decoder.close()
  }
}

// ---------------------------------------------------------------- WebP animado

interface Chunk {
  fourcc: string
  data: Uint8Array
}

function readChunks(webp: Uint8Array): Chunk[] {
  const dv = new DataView(webp.buffer, webp.byteOffset, webp.byteLength)
  const tag = (o: number) => String.fromCharCode(webp[o], webp[o + 1], webp[o + 2], webp[o + 3])
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP') throw new Error('WebP inválido')
  const chunks: Chunk[] = []
  let o = 12
  while (o + 8 <= webp.length) {
    const size = dv.getUint32(o + 4, true)
    chunks.push({ fourcc: tag(o), data: webp.subarray(o + 8, o + 8 + size) })
    o += 8 + size + (size & 1)
  }
  return chunks
}

class ByteWriter {
  private parts: Uint8Array[] = []
  length = 0
  bytes(b: Uint8Array) {
    this.parts.push(b)
    this.length += b.length
  }
  ascii(s: string) {
    this.bytes(new TextEncoder().encode(s))
  }
  u8(v: number) {
    this.bytes(new Uint8Array([v & 0xff]))
  }
  u16(v: number) {
    this.bytes(new Uint8Array([v & 0xff, (v >> 8) & 0xff]))
  }
  u24(v: number) {
    this.bytes(new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff]))
  }
  u32(v: number) {
    this.bytes(new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]))
  }
  chunk(fourcc: string, payload: Uint8Array) {
    this.ascii(fourcc)
    this.u32(payload.length)
    this.bytes(payload)
    if (payload.length & 1) this.u8(0)
  }
  concat(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.length)
    let o = 0
    for (const p of this.parts) {
      out.set(p, o)
      o += p.length
    }
    return out
  }
}

/**
 * Junta WebPs estáticos (mesmo tamanho) num WebP animado com loop infinito.
 * Cada quadro cobre a tela inteira e substitui o anterior (sem mesclagem),
 * então a transparência funciona corretamente.
 */
export function muxAnimatedWebp(frames: Uint8Array[], durations: number[], width: number, height: number): Blob {
  const body = new ByteWriter()

  const vp8x = new ByteWriter()
  vp8x.u8(0x10 | 0x02) // alfa + animação
  vp8x.u24(0)
  vp8x.u24(width - 1)
  vp8x.u24(height - 1)
  body.chunk('VP8X', vp8x.concat())

  const anim = new ByteWriter()
  anim.u32(0) // cor de fundo transparente
  anim.u16(0) // loop infinito
  body.chunk('ANIM', anim.concat())

  frames.forEach((webp, i) => {
    const frame = new ByteWriter()
    frame.u24(0) // x / 2
    frame.u24(0) // y / 2
    frame.u24(width - 1)
    frame.u24(height - 1)
    frame.u24(Math.max(8, Math.round(durations[i])))
    frame.u8(0x02) // sem mesclagem, sem descarte
    for (const c of readChunks(webp)) {
      if (c.fourcc === 'ALPH' || c.fourcc === 'VP8 ' || c.fourcc === 'VP8L') frame.chunk(c.fourcc, c.data)
    }
    body.chunk('ANMF', frame.concat())
  })

  const out = new ByteWriter()
  out.ascii('RIFF')
  out.u32(4 + body.length)
  out.ascii('WEBP')
  out.bytes(body.concat())
  return new Blob([out.concat()], { type: 'image/webp' })
}

async function encodeFrame(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Falha ao gerar quadro'))), 'image/webp', quality),
  )
  if (blob.type !== 'image/webp') throw new Error('Este navegador não gera WebP. Use o app Android ou o Chrome.')
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Gera a figurinha animada dentro dos limites do WhatsApp. Se passar de
 * 500 KB, reduz a qualidade e depois a quantidade de quadros (mantendo o
 * tempo total).
 */
export async function exportAnimatedWebp(
  frameCount: number,
  durations: number[],
  renderFrame: (index: number) => HTMLCanvasElement,
  onProgress?: (label: string) => void,
): Promise<Blob> {
  const size = LIMITS.stickerSize
  const budget = LIMITS.animatedStickerMaxBytes - 1024 // margem para os cabeçalhos
  const qualities = [0.8, 0.65, 0.5, 0.38, 0.28]
  const total = durations.reduce((s, d) => s + d, 0)
  if (total > LIMITS.animatedMaxMs) throw new Error('A animação pode ter no máximo 10 segundos')

  for (const stride of [1, 2, 3, 4]) {
    const indices: number[] = []
    const merged: number[] = []
    for (let i = 0; i < frameCount; i += stride) {
      indices.push(i)
      merged.push(durations.slice(i, i + stride).reduce((s, d) => s + d, 0))
    }
    if (indices.length < 2 && frameCount >= 2) break

    for (const q of qualities) {
      onProgress?.(`Gerando animação… (${indices.length} quadros, qualidade ${Math.round(q * 100)}%)`)
      const encoded: Uint8Array[] = []
      let bytes = 0
      for (const i of indices) {
        const frame = await encodeFrame(renderFrame(i), q)
        bytes += frame.length + 24
        if (bytes > budget) break
        encoded.push(frame)
      }
      if (encoded.length === indices.length) {
        const blob = muxAnimatedWebp(encoded, merged, size, size)
        if (blob.size <= LIMITS.animatedStickerMaxBytes) return blob
      }
    }
  }
  throw new Error('Não coube em 500 KB. Escolha um trecho mais curto.')
}
