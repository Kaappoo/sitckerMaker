import { useState } from 'react'
import { LIMITS } from '../lib/types'

interface Props {
  title: string
  initialName?: string
  initialPublisher?: string
  onCancel: () => void
  onSubmit: (name: string, publisher: string) => void
}

const PUBLISHER_KEY = 'figurinhas.publisher'

function lastPublisher(): string {
  try {
    return localStorage.getItem(PUBLISHER_KEY) ?? ''
  } catch {
    return ''
  }
}

export function PackForm({ title, initialName = '', initialPublisher, onCancel, onSubmit }: Props) {
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
          onSubmit(name.trim(), publisher.trim())
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
        <div className="row">
          <button type="button" className="ghost" onClick={onCancel}>Cancelar</button>
          <button type="submit" className="primary" disabled={!valid}>Salvar</button>
        </div>
      </form>
    </div>
  )
}
