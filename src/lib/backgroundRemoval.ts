// Remoção de fundo 100% no aparelho, com um modelo de IA (ONNX/WASM).
// O modelo (~40 MB) é baixado da CDN da IMG.LY na primeira vez e fica em
// cache. A biblioteca é carregada sob demanda para não pesar a abertura do app.
//
// Licença: @imgly/background-removal é AGPL-3.0. Para um projeto entre
// amigos tudo bem; se um dia virar produto fechado, troque por outra solução.

export type Progress = (label: string, fraction: number | null) => void

export async function removeBackground(image: ImageBitmap, onProgress?: Progress): Promise<ImageBitmap> {
  onProgress?.('Carregando recortador…', null)
  const { removeBackground: run } = await import('@imgly/background-removal')

  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  canvas.getContext('2d')!.drawImage(image, 0, 0)
  const input = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Falha ao preparar imagem'))), 'image/png'),
  )

  const result = await run(input, {
    model: 'isnet_quint8',
    output: { format: 'image/png' },
    progress: (key, current, total) => {
      const downloading = key.startsWith('fetch')
      onProgress?.(
        downloading ? 'Baixando modelo de recorte (só na 1ª vez)…' : 'Recortando…',
        total > 0 ? current / total : null,
      )
    },
  })
  return cleanAlpha(await createImageBitmap(result))
}

/**
 * O modelo deixa "poeira" semitransparente no fundo, que o contorno branco
 * transforma em manchas. Zera o alfa baixo e reforça as bordas do recorte.
 */
async function cleanAlpha(bmp: ImageBitmap, low = 48, high = 200): Promise<ImageBitmap> {
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i]
    d[i] = a <= low ? 0 : a >= high ? 255 : Math.round(((a - low) / (high - low)) * 255)
  }
  ctx.putImageData(img, 0, 0)
  return createImageBitmap(c)
}
