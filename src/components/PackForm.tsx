import { useState } from 'react'
import { LIMITS } from '../lib/types'

interface Props {
  title: string
  initialName?: string
  initialPublisher?: string
  /** Mostra a escolha entre pacote estático e animado (só na criação) */
  askType?: boolean
  onCancel: () => void
  onSubmit: (name: string, publisher: string, animated: boolean) => void
}

const PUBLISHER_KEY = 'figurinhas.publisher'

function lastPublisher(): string {
  try {
    return localStorage.getItem(PUBLISHER_KEY) ?? ''
  } catch {
    return ''
  }
}

export function PackForm({ title, initialName = '', initialPublisher, askType, onCancel, onSubmit }: Props) {
  const [animated, setAnimated] = useState(false)
  const [name, setName] = useState(initialName)
  const [publisher, setPublisher] = useState(initialPublisher ?? lastPublisher())
  const valid = name.trim() !== '' && publisher.trim() !== ''

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <form
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          try {
            localStorage.setItem(PUBLISHER_KEY, publisher.trim())
          } catch {
            /* sem armazenamento: tudo bem */
          }
          onSubmit(name.trim(), publisher.trim(), animated)
        }}
      >
        <h2>{title}</h2>
        <label>
          Nome do pacote
          <input autoFocus value={name} maxLength={LIMITS.maxTextLength} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Resenha da turma" />
        </label>
        <label>
          Autor
          <input value={publisher} maxLength={LIMITS.maxTextLength} onChange={(e) => setPublisher(e.target.value)} placeholder="Seu nome" />
        </label>
        {askType && (
          <div className="segmented" role="radiogroup" aria-label="Tipo de pacote">
            <button type="button" role="radio" aria-checked={!animated} className={!animated ? 'on' : ''} onClick={() => setAnimated(false)}>
              🖼️ Estático
              <small>fotos</small>
            </button>
            <button type="button" role="radio" aria-checked={animated} className={animated ? 'on' : ''} onClick={() => setAnimated(true)}>
              🎬 Animado
              <small>vídeos e GIFs</small>
            </button>
          </div>
        )}
        {askType && <p className="muted small-text">O WhatsApp não deixa misturar figurinhas estáticas e animadas no mesmo pacote.</p>}
        <div className="row">
          <button type="button" className="ghost" onClick={onCancel}>Cancelar</button>
          <button type="submit" className="primary" disabled={!valid}>Salvar</button>
        </div>
      </form>
    </div>
  )
}
