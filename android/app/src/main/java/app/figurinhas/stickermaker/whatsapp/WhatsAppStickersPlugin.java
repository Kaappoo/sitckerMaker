package app.figurinhas.stickermaker.whatsapp;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.util.Base64;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Ponte JS -> Android. Exposto ao JavaScript como "WhatsAppStickers"
 * (ver src/lib/whatsapp.ts).
 */
@CapacitorPlugin(name = "WhatsAppStickers")
public class WhatsAppStickersPlugin extends Plugin {

    private static final String TAG = "WhatsAppStickers";
    private static final String WHATSAPP = "com.whatsapp";
    private static final String WHATSAPP_BUSINESS = "com.whatsapp.w4b";
    private static final String ACTION_ENABLE_STICKER_PACK = "com.whatsapp.intent.action.ENABLE_STICKER_PACK";

    private static final int MAX_STICKER_BYTES = 100 * 1024;
    private static final int MAX_ANIMATED_STICKER_BYTES = 500 * 1024;
    private static final int MAX_TRAY_BYTES = 50 * 1024;

    @PluginMethod
    public void isWhatsAppInstalled(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("consumer", isInstalled(WHATSAPP));
        ret.put("business", isInstalled(WHATSAPP_BUSINESS));
        call.resolve(ret);
    }

    @PluginMethod
    public void addStickerPack(PluginCall call) {
        String identifier = call.getString("identifier");
        String name = call.getString("name");
        String publisher = call.getString("publisher");
        String version = call.getString("imageDataVersion", "1");
        String trayB64 = call.getString("trayImage");
        String trayType = call.getString("trayImageType", "png");
        boolean animated = Boolean.TRUE.equals(call.getBoolean("animated", false));
        int maxStickerBytes = animated ? MAX_ANIMATED_STICKER_BYTES : MAX_STICKER_BYTES;
        JSArray stickersArr = call.getArray("stickers");

        if (!StickerPackStore.isValidIdentifier(identifier)) {
            call.reject("Identificador do pacote inválido");
            return;
        }
        if (name == null || name.trim().isEmpty() || publisher == null || publisher.trim().isEmpty()) {
            call.reject("Nome e autor são obrigatórios");
            return;
        }
        if (trayB64 == null || stickersArr == null) {
            call.reject("Pacote incompleto");
            return;
        }

        boolean consumer = isInstalled(WHATSAPP);
        boolean business = isInstalled(WHATSAPP_BUSINESS);
        if (!consumer && !business) {
            call.reject("WhatsApp não está instalado neste aparelho");
            return;
        }

        try {
            byte[] tray = Base64.decode(trayB64, Base64.DEFAULT);
            if (tray.length > MAX_TRAY_BYTES) {
                call.reject("O ícone do pacote passou de 50 KB");
                return;
            }

            List<StickerPackStore.NewSticker> stickers = new ArrayList<>();
            for (int i = 0; i < stickersArr.length(); i++) {
                JSONObject s = stickersArr.getJSONObject(i);
                byte[] webp = Base64.decode(s.getString("data"), Base64.DEFAULT);
                if (webp.length > maxStickerBytes) {
                    call.reject("A figurinha " + (i + 1) + " passou de " + (maxStickerBytes / 1024) + " KB");
                    return;
                }
                List<String> emojis = new ArrayList<>();
                JSONArray e = s.optJSONArray("emojis");
                if (e != null) for (int j = 0; j < e.length() && j < 3; j++) emojis.add(e.getString(j));
                stickers.add(new StickerPackStore.NewSticker(webp, emojis));
            }
            if (stickers.size() < 3 || stickers.size() > 30) {
                call.reject("O pacote precisa ter de 3 a 30 figurinhas");
                return;
            }

            StickerPackStore.save(getContext(), identifier, name.trim(), publisher.trim(), version,
                    animated, tray, trayType, stickers);
            // avisa o WhatsApp que os dados mudaram
            getContext().getContentResolver().notifyChange(
                    android.net.Uri.parse("content://" + StickerContentProvider.authority(getContext()) + "/metadata"),
                    null);
        } catch (Exception e) {
            Log.e(TAG, "Falha ao gravar pacote", e);
            call.reject("Falha ao preparar o pacote: " + e.getMessage(), e);
            return;
        }

        Intent intent = new Intent(ACTION_ENABLE_STICKER_PACK);
        intent.putExtra("sticker_pack_id", identifier);
        intent.putExtra("sticker_pack_authority", StickerContentProvider.authority(getContext()));
        intent.putExtra("sticker_pack_name", name.trim());
        // Com os dois WhatsApps instalados o Android pergunta qual usar.
        if (consumer != business) intent.setPackage(consumer ? WHATSAPP : WHATSAPP_BUSINESS);

        try {
            startActivityForResult(call, intent, "onAddStickerPackResult");
        } catch (ActivityNotFoundException e) {
            call.reject("Esta versão do WhatsApp não aceita pacotes de figurinhas. Atualize o WhatsApp.");
        }
    }

    @ActivityCallback
    private void onAddStickerPackResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_OK) {
            JSObject ret = new JSObject();
            ret.put("added", true);
            call.resolve(ret);
            return;
        }
        Intent data = result.getData();
        String error = data != null ? data.getStringExtra("validation_error") : null;
        if (error != null) {
            Log.e(TAG, "WhatsApp recusou o pacote: " + error);
            call.reject("O WhatsApp recusou o pacote: " + error);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("added", false);
        call.resolve(ret);
    }

    private boolean isInstalled(String pkg) {
        try {
            Context ctx = getContext();
            ctx.getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}
