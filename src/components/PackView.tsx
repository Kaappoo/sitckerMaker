import { useState } from 'react'
import { parseEmojis } from '../lib/render'
import { LIMITS, type Sticker, type StickerPack } from '../lib/types'
import { addToWhatsApp, isAndroidApp, validatePack } from '../lib/whatsapp'
import { PackForm } from './PackForm'
import { Thumb } from './Thumb'

interface Props {
  pack: StickerPack
  onBack: () => void
  onAddSticker: () => void
  onChange: (pack: StickerPack, contentChanged: boolean) => Promise<void>
  onDelete: () => Promise<void>
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function PackView({ pack, onBack, onAddSticker, onChange, onDelete }: Props) {
  const [active, setActive] = useState<Sticker | null>(null)
  const [emojiDraft, setEmojiDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const problems = validatePack(pack)
  const full = pack.stickers.length >= LIMITS.maxStickers

  async function send() {
    setMessage(null)
    setSending(true)
    try {
      const added = await addToWhatsApp(pack)
      setMessage(added ? { kind: 'ok', text: 'Pacote enviado ao WhatsApp! 🎉' } : { kind: 'error', text: 'Envio cancelado.' })
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(false)
    }
  }

  function openSticker(s: Sticker) {
    setActive(s)
    setEmojiDraft(s.emojis.join(''))
  }

  async function saveEmojis() {
    if (!active) return
    const emojis = parseEmojis(emojiDraft)
    await onChange({ ...pack, stickers: pack.stickers.map((s) => (s.id === active.id ? { ...s, emojis } : s)) }, true)
    setActive(null)
  }

  async function removeSticker() {
    if (!active) return
    await onChange({ ...pack, stickers: pack.stickers.filter((s) => s.id !== active.id) }, true)
    setActive(null)
  }

  async function makeFirst() {
    if (!active) return
    await onChange({ ...pack, stickers: [active, ...pack.stickers.filter((s) => s.id !== active.id)] }, true)
    setActive(null)
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="ghost" onClick={onBack} aria-label="Voltar">←</button>
        <h1>{pack.name}</h1>
        <button className="ghost" onClick={() => setEditing(true)} aria-label="Editar pacote">✏️</button>
      </header>

      <p className="muted center">
        {pack.animated ? 'Pacote animado · ' : ''}{pack.publisher} · {pack.stickers.length}/{LIMITS.maxStickers} figurinhas
      </p>

      <ul className="sticker-grid">
        {pack.stickers.map((s, i) => (
          <li key={s.id}>
            <button onClick={() => openSticker(s)} aria-label={`Figurinha ${i + 1}`}>
              <Thumb blob={s.image} />
              {i === 0 && <span className="badge">ícone</span>}
            </button>
          </li>
        ))}
        {!full && (
          <li>
            <button className="add-tile" onClick={onAddSticker} aria-label="Adicionar figurinha">+</button>
          </li>
        )}
      </ul>

      <div className="send-area">
        {problems.length > 0 && <p className="muted center">{problems[0]}</p>}
        {message && <p className={`${message.kind === 'ok' ? 'success' : 'error'} center`}>{message.text}</p>}
        {isAndroidApp ? (
          <button className="primary wa" disabled={problems.length > 0 || sending} onClick={send}>
            {sending ? 'Enviando…' : 'Adicionar ao WhatsApp'}
          </button>
        ) : (
          <>
            <p className="muted center">Para adicionar o pacote no WhatsApp, abra no app Android. Aqui você pode baixar as figurinhas.</p>
            <button
              className="primary"
              disabled={pack.stickers.length === 0}
              onClick={() => pack.stickers.forEach((s, i) => download(s.image, `${pack.name}-${i + 1}.webp`))}
            >
              Baixar figurinhas
            </button>
          </>
        )}
      </div>

      {active && (
        <div className="sheet-backdrop" onClick={() => setActive(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-preview"><Thumb blob={active.image} /></div>
            <p className="muted center">{Math.round(active.image.size / 1024)} KB · 512×512 WebP{active.animated ? ' animado' : ''}</p>
            <label>
              Emojis (até 3)
              <input value={emojiDraft} onChange={(e) => setEmojiDraft(e.target.value)} />
            </label>
            <div className="row wrap">
              <button className="primary" onClick={saveEmojis}>Salvar emojis</button>
              {pack.stickers[0]?.id !== active.id && <button className="ghost" onClick={makeFirst}>Usar como ícone</button>}
              {!isAndroidApp && <button className="ghost" onClick={() => download(active.image, 'figurinha.webp')}>Baixar</button>}
              <button className="ghost danger" onClick={removeSticker}>Excluir</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <PackForm
          title="Editar pacote"
          initialName={pack.name}
          initialPublisher={pack.publisher}
          onCancel={() => setEditing(false)}
          onSubmit={async (name, publisher) => {
            setEditing(false)
            await onChange({ ...pack, name, publisher }, true)
          }}
        />
      )}

      <button
        className="link danger delete-pack"
        onClick={async () => {
          if (confirm(`Excluir o pacote "${pack.name}"? Isso não remove do WhatsApp o que já foi adicionado.`)) await onDelete()
        }}
      >
        Excluir pacote
      </button>
    </div>
  )
}
