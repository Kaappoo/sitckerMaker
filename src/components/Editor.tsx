import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ANIM,
  closeVideo,
  decodeAnimatedImage,
  disposeFrames,
  exportAnimatedWebp,
  extractVideoFrames,
  openVideo,
  totalMs,
  type AnimFrames,
  type VideoInfo,
} from '../lib/animation'
import { removeBackground } from '../lib/backgroundRemoval'
import {
  CANVAS,
  exportStickerWebp,
  fitImage,
  loadImage,
  parseEmojis,
  renderDesign,
  textBounds,
  type ImageLayer,
  type Outline,
  type TextLayer,
} from '../lib/render'
import { newId } from '../lib/types'

interface Props {
  /** Pacote animado: aceita vídeo/GIF e gera WebP animado */
  animated: boolean
  onCancel: () => void
  onSave: (image: Blob, emojis: string[]) => Promise<void>
}

type Selection = 'image' | string | null

interface Gesture {
  target: Selection
  /** posição inicial dos dedos (espaço 512) */
  points: { x: number; y: number }[]
  image: ImageLayer | null
  text: TextLayer | null
}

const COLORS = ['#ffffff', '#000000', '#ffd60a', '#ff3b30', '#34c759', '#0a84ff', '#bf5af2', '#ff9f0a']

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
function angle(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.atan2(b.y - a.y, b.x - a.x)
}

export function Editor({ animated, onCancel, onSave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [original, setOriginal] = useState<ImageBitmap | null>(null)
  const [cutout, setCutout] = useState<ImageBitmap | null>(null)
  const [useCutout, setUseCutout] = useState(false)
  const [image, setImage] = useState<ImageLayer | null>(null)
  const [texts, setTexts] = useState<TextLayer[]>([])
  const [outline, setOutline] = useState<Outline>({ enabled: false, width: 10, color: '#ffffff' })
  const [selected, setSelected] = useState<Selection>(null)
  const [emojis, setEmojis] = useState('😀')
  const [busy, setBusy] = useState<{ label: string; fraction: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Animação (vídeo ou GIF)
  const [anim, setAnim] = useState<AnimFrames | null>(null)
  const [frameIndex, setFrameIndex] = useState(0)
  const [video, setVideo] = useState<VideoInfo | null>(null)
  const [trim, setTrim] = useState({ start: 0, seconds: ANIM.defaultSeconds as number })
  const [trimmed, setTrimmed] = useState({ start: 0, seconds: ANIM.defaultSeconds as number })

  // libera vídeo e quadros ao sair do editor
  const media = useRef<{ video: VideoInfo | null; anim: AnimFrames | null }>({ video: null, anim: null })
  useLayoutEffect(() => {
    media.current = { video, anim }
  })
  useEffect(
    () => () => {
      closeVideo(media.current.video)
      disposeFrames(media.current.anim)
    },
    [],
  )

  // toca a prévia da animação
  useEffect(() => {
    if (!anim || anim.frames.length < 2) return
    let i = 0
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      i = (i + 1) % anim.frames.length
      setFrameIndex(i)
      timer = setTimeout(tick, anim.durations[i])
    }
    timer = setTimeout(tick, anim.durations[0])
    return () => clearTimeout(timer)
  }, [anim])

  /** Camada de imagem com o quadro atual da animação */
  const shown: ImageLayer | null = useMemo(
    () => (image && anim ? { ...image, bitmap: anim.frames[Math.min(frameIndex, anim.frames.length - 1)] } : image),
    [image, anim, frameIndex],
  )

  // Estado atual acessível dentro dos handlers de gesto
  const live = useRef({ image, texts })
  useLayoutEffect(() => {
    live.current = { image, texts }
  })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)

  const selectedText = texts.find((t) => t.id === selected) ?? null

  // ---------- Desenho da prévia ----------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, CANVAS, CANVAS)
    ctx.drawImage(renderDesign({ image: shown, texts, outline }), 0, 0)

    // guia da seleção
    ctx.save()
    ctx.setLineDash([8, 6])
    ctx.lineWidth = 2
    ctx.strokeStyle = '#25d366'
    if (selectedText) {
      const b = textBounds(ctx, selectedText)
      ctx.strokeRect(b.x, b.y, b.w, b.h)
    } else if (selected === 'image' && image) {
      ctx.translate(image.x, image.y)
      ctx.rotate(image.rotation)
      const w = image.bitmap.width * image.scale
      const h = image.bitmap.height * image.scale
      ctx.strokeRect(-w / 2, -h / 2, w, h)
    }
    ctx.restore()
  }, [image, shown, texts, outline, selected, selectedText])

  // ---------- Carregar vídeo / GIF ----------
  function applyFrames(next: AnimFrames) {
    disposeFrames(anim)
    setAnim(next)
    setFrameIndex(0)
    // o 1º quadro define o tamanho; os outros têm as mesmas dimensões
    setImage((img) => (img && img.bitmap.width === next.frames[0].width && img.bitmap.height === next.frames[0].height
      ? { ...img, bitmap: next.frames[0] }
      : fitImage(next.frames[0])))
    setSelected('image')
  }

  async function loadVideoSegment(info: VideoInfo, start: number, seconds: number) {
    setBusy({ label: 'Lendo quadros do vídeo…', fraction: 0 })
    try {
      const frames = await extractVideoFrames(info, start, seconds, (f) =>
        setBusy({ label: 'Lendo quadros do vídeo…', fraction: f }),
      )
      applyFrames(frames)
      setTrimmed({ start, seconds })
    } finally {
      setBusy(null)
    }
  }

  async function handleAnimatedFile(file: File) {
    if (file.type.startsWith('video/')) {
      const info = await openVideo(file)
      closeVideo(video)
      setVideo(info)
      const t = { start: 0, seconds: Math.min(ANIM.defaultSeconds, info.duration) }
      setTrim(t)
      await loadVideoSegment(info, t.start, t.seconds)
    } else {
      setBusy({ label: 'Lendo animação…', fraction: null })
      try {
        const frames = await decodeAnimatedImage(file)
        closeVideo(video)
        setVideo(null)
        applyFrames(frames)
      } finally {
        setBusy(null)
      }
    }
  }

  // ---------- Carregar foto ----------
  async function handleFile(file: File | undefined) {
    if (!file) return
    setError(null)
    if (animated) {
      try {
        await handleAnimatedFile(file)
      } catch (e) {
        console.error(e)
        setError(e instanceof Error ? e.message : 'Não consegui abrir esse arquivo.')
      }
      return
    }
    try {
      const bmp = await loadImage(file)
      original?.close()
      cutout?.close()
      setOriginal(bmp)
      setCutout(null)
      setUseCutout(false)
      setImage(fitImage(bmp))
      setSelected('image')
    } catch {
      setError('Não consegui abrir essa imagem.')
    }
  }

  function swapBitmap(next: ImageBitmap) {
    setImage((img) => {
      if (!img) return fitImage(next)
      // mantém o tamanho visual se as dimensões forem iguais
      return { ...img, bitmap: next }
    })
  }

  async function handleRemoveBackground() {
    if (!original) return
    if (cutout) {
      const next = !useCutout
      setUseCutout(next)
      swapBitmap(next ? cutout : original)
      return
    }
    setError(null)
    setBusy({ label: 'Preparando…', fraction: null })
    try {
      const result = await removeBackground(original, (label, fraction) => setBusy({ label, fraction }))
      setCutout(result)
      setUseCutout(true)
      swapBitmap(result)
    } catch (e) {
      console.error(e)
      setError('Falha ao remover o fundo. Verifique a internet (o modelo é baixado na 1ª vez) e tente de novo.')
    } finally {
      setBusy(null)
    }
  }

  // ---------- Texto ----------
  function addText() {
    const t: TextLayer = {
      id: newId(),
      text: 'Texto',
      x: CANVAS / 2,
      y: CANVAS - 70,
      size: 64,
      color: '#ffffff',
      stroke: '#000000',
    }
    setTexts((ts) => [...ts, t])
    setSelected(t.id)
  }

  function updateText(id: string, patch: Partial<TextLayer>) {
    setTexts((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  function removeText(id: string) {
    setTexts((ts) => ts.filter((t) => t.id !== id))
    setSelected(image ? 'image' : null)
  }

  // ---------- Gestos (arrastar, pinça para zoom/girar) ----------
  function toCanvas(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) * CANVAS) / rect.width,
      y: ((e.clientY - rect.top) * CANVAS) / rect.height,
    }
  }

  function startGesture(target: Selection) {
    const { image: img, texts: ts } = live.current
    gesture.current = {
      target,
      points: [...pointers.current.values()],
      image: img,
      text: ts.find((t) => t.id === target) ?? null,
    }
  }

  function hitTest(p: { x: number; y: number }): Selection {
    const ctx = canvasRef.current!.getContext('2d')!
    const ts = live.current.texts
    for (let i = ts.length - 1; i >= 0; i--) {
      const b = textBounds(ctx, ts[i])
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return ts[i].id
    }
    return live.current.image ? 'image' : null
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toCanvas(e)
    pointers.current.set(e.pointerId, p)
    let target = gesture.current?.target ?? null
    if (pointers.current.size === 1) {
      target = hitTest(p)
      setSelected(target)
    }
    startGesture(target)
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, toCanvas(e))
    const g = gesture.current
    if (!g || !g.target) return
    const now = [...pointers.current.values()]

    if (now.length === 1 && g.points.length === 1) {
      const dx = now[0].x - g.points[0].x
      const dy = now[0].y - g.points[0].y
      if (g.target === 'image' && g.image) {
        setImage({ ...g.image, x: g.image.x + dx, y: g.image.y + dy })
      } else if (g.text) {
        updateText(g.text.id, { x: g.text.x + dx, y: g.text.y + dy })
      }
    } else if (now.length >= 2 && g.points.length >= 2) {
      const factor = distance(now[0], now[1]) / Math.max(1, distance(g.points[0], g.points[1]))
      const rot = angle(now[0], now[1]) - angle(g.points[0], g.points[1])
      if (g.target === 'image' && g.image) {
        setImage({ ...g.image, scale: g.image.scale * factor, rotation: g.image.rotation + rot })
      } else if (g.text) {
        updateText(g.text.id, { size: Math.min(220, Math.max(16, g.text.size * factor)) })
      }
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId)
    const target = gesture.current?.target ?? null
    if (pointers.current.size > 0) startGesture(target)
    else gesture.current = null
  }

  function onWheel(e: React.WheelEvent) {
    const factor = e.deltaY < 0 ? 1.06 : 1 / 1.06
    if (selected === 'image' && image) setImage({ ...image, scale: image.scale * factor })
    else if (selectedText) updateText(selectedText.id, { size: Math.min(220, Math.max(16, selectedText.size * factor)) })
  }

  // ---------- Salvar ----------
  async function handleSave() {
    setError(null)
    setBusy({ label: 'Gerando figurinha…', fraction: null })
    try {
      const blob =
        anim && image
          ? await exportAnimatedWebp(
              anim.frames.length,
              anim.durations,
              (i) => renderDesign({ image: { ...image, bitmap: anim.frames[i] }, texts, outline }),
              (label) => setBusy({ label, fraction: null }),
            )
          : await exportStickerWebp(renderDesign({ image, texts, outline }))
      await onSave(blob, parseEmojis(emojis))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar')
      setBusy(null)
    }
  }

  const isEmpty = animated ? !anim : !image && texts.length === 0
  const hasMedia = animated ? !!anim : !!original
  const pickLabel = animated ? (hasMedia ? 'Trocar vídeo' : 'Vídeo ou GIF') : original ? 'Trocar foto' : 'Foto'

  return (
    <div className="screen editor">
      <header className="topbar">
        <button className="ghost" onClick={onCancel}>Cancelar</button>
        <h1>{animated ? 'Figurinha animada' : 'Nova figurinha'}</h1>
        <button className="primary small" onClick={handleSave} disabled={isEmpty || !!busy}>Salvar</button>
      </header>

      <div className="stage">
        <canvas
          ref={canvasRef}
          width={CANVAS}
          height={CANVAS}
          className="sticker-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        />
        {!hasMedia && !busy && (
          <button className="pick-photo" onClick={() => fileRef.current?.click()}>
            <span className="big">{animated ? '🎬' : '🖼️'}</span>
            {animated ? 'Escolher vídeo ou GIF' : 'Escolher foto'}
          </button>
        )}
        {busy && (
          <div className="busy">
            <div className="spinner" />
            <p>{busy.label}</p>
            {busy.fraction !== null && (
              <progress value={busy.fraction} max={1} />
            )}
          </div>
        )}
      </div>
      <p className="hint">Arraste para mover · use dois dedos para zoom e girar</p>
      {error && <p className="error">{error}</p>}

      <input
        ref={fileRef}
        type="file"
        accept={animated ? 'video/*,image/gif,image/webp' : 'image/*'}
        hidden
        onChange={(e) => {
          void handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <div className="tools">
        <button onClick={() => fileRef.current?.click()} disabled={!!busy}>{animated ? '🎬' : '🖼️'} {pickLabel}</button>
        {!animated && (
          <button onClick={handleRemoveBackground} disabled={!original || !!busy} className={useCutout ? 'active' : ''}>
            ✂️ {cutout ? (useCutout ? 'Fundo removido' : 'Remover fundo') : 'Remover fundo'}
          </button>
        )}
        <button onClick={addText} disabled={!!busy}>🔤 Texto</button>
        <button
          onClick={() => setOutline((o) => ({ ...o, enabled: !o.enabled }))}
          className={outline.enabled ? 'active' : ''}
          disabled={!!busy}
        >
          ⭕ Contorno
        </button>
      </div>

      {video && (
        <section className="panel">
          <label>
            Início do trecho: {trim.start.toFixed(1)} s
            <input
              type="range"
              min={0}
              max={Math.max(0, video.duration - 0.5)}
              step={0.1}
              value={trim.start}
              onChange={(e) => setTrim({ ...trim, start: Number(e.target.value) })}
            />
          </label>
          <label>
            Duração: {Math.min(trim.seconds, video.duration - trim.start).toFixed(1)} s (máx. {ANIM.maxSeconds} s)
            <input
              type="range"
              min={0.5}
              max={Math.min(ANIM.maxSeconds, video.duration)}
              step={0.1}
              value={trim.seconds}
              onChange={(e) => setTrim({ ...trim, seconds: Number(e.target.value) })}
            />
          </label>
          <button
            className="ghost"
            disabled={!!busy || (trim.start === trimmed.start && trim.seconds === trimmed.seconds)}
            onClick={() => void loadVideoSegment(video, trim.start, trim.seconds).catch((e) => setError(String(e)))}
          >
            Atualizar trecho
          </button>
        </section>
      )}

      {anim && (
        <p className="hint">
          {anim.frames.length} quadros · {(totalMs(anim) / 1000).toFixed(1)} s
        </p>
      )}

      {selected === 'image' && image && (
        <section className="panel">
          <label>
            Zoom
            <input
              type="range"
              min={0.05}
              max={4}
              step={0.01}
              value={image.scale}
              onChange={(e) => setImage({ ...image, scale: Number(e.target.value) })}
            />
          </label>
          <label>
            Girar
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={Math.round((image.rotation * 180) / Math.PI)}
              onChange={(e) => setImage({ ...image, rotation: (Number(e.target.value) * Math.PI) / 180 })}
            />
          </label>
          <button className="ghost" onClick={() => setImage(fitImage(image.bitmap))}>Centralizar</button>
        </section>
      )}

      {selectedText && (
        <section className="panel">
          <textarea
            value={selectedText.text}
            rows={2}
            maxLength={60}
            onChange={(e) => updateText(selectedText.id, { text: e.target.value })}
          />
          <div className="swatches" aria-label="Cor do texto">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${selectedText.color === c ? 'on' : ''}`}
                style={{ background: c }}
                aria-label={`Cor ${c}`}
                onClick={() => updateText(selectedText.id, { color: c, stroke: c === '#000000' ? '#ffffff' : '#000000' })}
              />
            ))}
          </div>
          <label>
            Tamanho
            <input
              type="range"
              min={16}
              max={220}
              value={selectedText.size}
              onChange={(e) => updateText(selectedText.id, { size: Number(e.target.value) })}
            />
          </label>
          <button className="ghost danger" onClick={() => removeText(selectedText.id)}>Remover texto</button>
        </section>
      )}

      {outline.enabled && (
        <section className="panel">
          <label>
            Espessura do contorno
            <input
              type="range"
              min={2}
              max={20}
              value={outline.width}
              onChange={(e) => setOutline({ ...outline, width: Number(e.target.value) })}
            />
          </label>
          <div className="swatches" aria-label="Cor do contorno">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${outline.color === c ? 'on' : ''}`}
                style={{ background: c }}
                aria-label={`Contorno ${c}`}
                onClick={() => setOutline({ ...outline, color: c })}
              />
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <label>
          Emojis da figurinha (até 3, usados na busca do WhatsApp)
          <input value={emojis} onChange={(e) => setEmojis(e.target.value)} placeholder="😀😂" />
        </label>
      </section>
    </div>
  )
}
