import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Editor } from './components/Editor'
import { PackList } from './components/PackList'
import { PackView } from './components/PackView'
import { deletePack, listPacks, savePack } from './lib/storage'
import { newId, type StickerPack } from './lib/types'
import './App.css'

type View = { name: 'list' } | { name: 'pack'; id: string } | { name: 'editor'; packId: string }

export default function App() {
  const [packs, setPacks] = useState<StickerPack[]>([])
  const [view, setView] = useState<View>({ name: 'list' })
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    setPacks(await listPacks())
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Botão "voltar" do Android
  const viewRef = useRef(view)
  useLayoutEffect(() => {
    viewRef.current = view
  })
  useEffect(() => {
    const sub = CapApp.addListener('backButton', () => {
      const v = viewRef.current
      if (v.name === 'editor') setView({ name: 'pack', id: v.packId })
      else if (v.name === 'pack') setView({ name: 'list' })
      else void CapApp.exitApp()
    })
    return () => {
      void sub.then((s) => s.remove())
    }
  }, [])

  async function persist(pack: StickerPack, contentChanged: boolean) {
    const next = {
      ...pack,
      updatedAt: Date.now(),
      version: contentChanged ? pack.version + 1 : pack.version,
    }
    await savePack(next)
    await refresh()
  }

  async function createPack(name: string, publisher: string) {
    const pack: StickerPack = {
      id: newId(),
      name,
      publisher,
      stickers: [],
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await savePack(pack)
    await refresh()
    setView({ name: 'pack', id: pack.id })
  }

  if (!loaded) return null

  if (view.name === 'editor') {
    const pack = packs.find((p) => p.id === view.packId)
    if (!pack) return null
    return (
      <Editor
        onCancel={() => setView({ name: 'pack', id: pack.id })}
        onSave={async (image, emojis) => {
          await persist({ ...pack, stickers: [...pack.stickers, { id: newId(), image, emojis }] }, true)
          setView({ name: 'pack', id: pack.id })
        }}
      />
    )
  }

  if (view.name === 'pack') {
    const pack = packs.find((p) => p.id === view.id)
    if (pack) {
      return (
        <PackView
          pack={pack}
          onBack={() => setView({ name: 'list' })}
          onAddSticker={() => setView({ name: 'editor', packId: pack.id })}
          onChange={persist}
          onDelete={async () => {
            await deletePack(pack.id)
            await refresh()
            setView({ name: 'list' })
          }}
        />
      )
    }
  }

  return <PackList packs={packs} onOpen={(id) => setView({ name: 'pack', id })} onCreate={createPack} />
}
