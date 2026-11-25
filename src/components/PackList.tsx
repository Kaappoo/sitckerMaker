import { useState } from 'react'
import type { StickerPack } from '../lib/types'
import { LIMITS } from '../lib/types'
import { PackForm } from './PackForm'
import { Thumb } from './Thumb'

interface Props {
  packs: StickerPack[]
  onOpen: (id: string) => void
  onCreate: (name: string, publisher: string) => void
}

export function PackList({ packs, onOpen, onCreate }: Props) {
  const [creating, setCreating] = useState(false)

  return (
    <div className="screen">
      <header className="topbar">
        <h1>Figurinhas</h1>
      </header>

      {packs.length === 0 ? (
        <div className="empty">
          <p className="big">🎨</p>
          <p>Nenhum pacote ainda.</p>
          <p className="muted">Crie um pacote e adicione de {LIMITS.minStickers} a {LIMITS.maxStickers} figurinhas para mandar pro WhatsApp.</p>
        </div>
      ) : (
        <ul className="pack-list">
          {packs.map((p) => (
            <li key={p.id}>
              <button onClick={() => onOpen(p.id)}>
                <div className="pack-thumb"><Thumb blob={p.stickers[0]?.image} /></div>
                <div className="pack-info">
                  <strong>{p.name}</strong>
                  <span className="muted">{p.publisher} · {p.stickers.length} figurinha{p.stickers.length === 1 ? '' : 's'}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button className="fab primary" onClick={() => setCreating(true)}>+ Novo pacote</button>

      {creating && (
        <PackForm
          title="Novo pacote"
          onCancel={() => setCreating(false)}
          onSubmit={(name, publisher) => {
            setCreating(false)
            onCreate(name, publisher)
          }}
        />
      )}
    </div>
  )
}
