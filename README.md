# Figurinhas

App para criar figurinhas de WhatsApp e adicioná-las como pacote, direto do celular.

- **Editor:** foto da galeria ou câmera, remoção de fundo com IA (roda no aparelho), mover/zoom/girar com os dedos, textos e contorno branco estilo figurinha.
- **Pacotes:** de 3 a 30 figurinhas, guardados no próprio aparelho (IndexedDB).
- **WhatsApp:** botão "Adicionar ao WhatsApp" que usa a integração oficial de pacotes (Android).

Feito com React + TypeScript + Vite, empacotado como app Android com Capacitor.

## Como funciona a integração com o WhatsApp

O WhatsApp só aceita pacotes vindos de um app instalado. O fluxo é:

1. O JavaScript gera cada figurinha como **WebP 512×512 até 100 KB** e o ícone do pacote (PNG 96×96).
2. O plugin nativo `WhatsAppStickers` (`android/app/src/main/java/.../whatsapp/`) grava os arquivos em `files/sticker_packs/<id>/` no armazenamento interno.
3. O plugin dispara a intent `com.whatsapp.intent.action.ENABLE_STICKER_PACK`.
4. O WhatsApp lê o pacote pelo `StickerContentProvider` (protegido pela permissão `com.whatsapp.sticker.READ`) e mostra a tela de confirmação.

Ao mudar um pacote, o campo `version` aumenta e é enviado como `image_data_version`, o que faz o WhatsApp atualizar o pacote já adicionado.

## Rodando

Requisitos: Node 20+, JDK 21 e Android SDK (o Android Studio instala o SDK).

```bash
npm install
npm run dev            # editor no navegador (sem o botão do WhatsApp)
npm run android:apk    # gera android/app/build/outputs/apk/debug/app-debug.apk
npm run android:open   # abre no Android Studio para rodar no celular/emulador
```

Depois de mudar o código web, rode `npm run android:sync` antes de compilar o app.

Para instalar nos celulares dos amigos sem Play Store, mande o `app-debug.apk` e libere "instalar apps desconhecidos".

## Observações

- A remoção de fundo usa `@imgly/background-removal` (licença **AGPL-3.0**). O modelo (~40 MB) é baixado da CDN da IMG.LY no primeiro uso e depois fica em cache, então essa função precisa de internet na primeira vez.
- O APK de debug serve para uso entre amigos. Para a Play Store, gere um build de release assinado.
