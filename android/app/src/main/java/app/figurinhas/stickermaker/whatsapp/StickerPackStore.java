package app.figurinhas.stickermaker.whatsapp;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Guarda no armazenamento interno do app os pacotes enviados ao WhatsApp:
 *
 * <pre>
 * files/sticker_packs/&lt;identificador&gt;/pack.json
 * files/sticker_packs/&lt;identificador&gt;/tray.png
 * files/sticker_packs/&lt;identificador&gt;/1.webp ...
 * </pre>
 *
 * O {@link StickerContentProvider} lê daqui quando o WhatsApp consulta o app.
 */
public final class StickerPackStore {

    private static final String ROOT = "sticker_packs";
    private static final String META = "pack.json";
    private static final Pattern IDENTIFIER = Pattern.compile("^[a-zA-Z0-9_.\\- ]{1,128}$");
    private static final Pattern FILE_NAME = Pattern.compile("^[a-zA-Z0-9_\\-]+\\.(webp|png)$");

    public static final class Sticker {
        public final String fileName;
        public final List<String> emojis;

        Sticker(String fileName, List<String> emojis) {
            this.fileName = fileName;
            this.emojis = emojis;
        }
    }

    public static final class Pack {
        public final String identifier;
        public final String name;
        public final String publisher;
        public final String trayImageFile;
        public final String imageDataVersion;
        public final List<Sticker> stickers;

        Pack(String identifier, String name, String publisher, String trayImageFile,
             String imageDataVersion, List<Sticker> stickers) {
            this.identifier = identifier;
            this.name = name;
            this.publisher = publisher;
            this.trayImageFile = trayImageFile;
            this.imageDataVersion = imageDataVersion;
            this.stickers = stickers;
        }
    }

    /** Dados recebidos do JavaScript, ainda não gravados. */
    public static final class NewSticker {
        final byte[] webp;
        final List<String> emojis;

        public NewSticker(byte[] webp, List<String> emojis) {
            this.webp = webp;
            this.emojis = emojis;
        }
    }

    private StickerPackStore() {}

    public static boolean isValidIdentifier(String id) {
        return id != null && IDENTIFIER.matcher(id).matches();
    }

    private static File root(Context ctx) {
        return new File(ctx.getFilesDir(), ROOT);
    }

    private static File packDir(Context ctx, String identifier) {
        if (!isValidIdentifier(identifier)) throw new IllegalArgumentException("Identificador inválido");
        return new File(root(ctx), identifier);
    }

    /** Substitui por completo os arquivos do pacote. */
    public static synchronized void save(@NonNull Context ctx, @NonNull String identifier,
                                         @NonNull String name, @NonNull String publisher,
                                         @NonNull String imageDataVersion,
                                         @NonNull byte[] tray, @NonNull String trayExtension,
                                         @NonNull List<NewSticker> stickers)
            throws IOException, JSONException {
        File dir = packDir(ctx, identifier);
        deleteRecursive(dir);
        if (!dir.mkdirs()) throw new IOException("Não foi possível criar " + dir);

        String trayFile = "tray." + ("webp".equals(trayExtension) ? "webp" : "png");
        write(new File(dir, trayFile), tray);

        JSONArray stickerArr = new JSONArray();
        for (int i = 0; i < stickers.size(); i++) {
            NewSticker s = stickers.get(i);
            String file = (i + 1) + ".webp";
            write(new File(dir, file), s.webp);
            JSONArray emojis = new JSONArray();
            for (String e : s.emojis) emojis.put(e);
            stickerArr.put(new JSONObject().put("file", file).put("emojis", emojis));
        }

        JSONObject meta = new JSONObject()
                .put("identifier", identifier)
                .put("name", name)
                .put("publisher", publisher)
                .put("tray", trayFile)
                .put("imageDataVersion", imageDataVersion)
                .put("stickers", stickerArr);
        write(new File(dir, META), meta.toString().getBytes(StandardCharsets.UTF_8));
    }

    public static synchronized List<Pack> all(@NonNull Context ctx) {
        List<Pack> packs = new ArrayList<>();
        File[] dirs = root(ctx).listFiles(File::isDirectory);
        if (dirs == null) return packs;
        for (File dir : dirs) {
            Pack p = load(ctx, dir.getName());
            if (p != null) packs.add(p);
        }
        return packs;
    }

    @Nullable
    public static synchronized Pack load(@NonNull Context ctx, String identifier) {
        if (!isValidIdentifier(identifier)) return null;
        File meta = new File(packDir(ctx, identifier), META);
        if (!meta.isFile()) return null;
        try {
            JSONObject json = new JSONObject(new String(read(meta), StandardCharsets.UTF_8));
            JSONArray arr = json.getJSONArray("stickers");
            List<Sticker> stickers = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject s = arr.getJSONObject(i);
                JSONArray e = s.getJSONArray("emojis");
                List<String> emojis = new ArrayList<>();
                for (int j = 0; j < e.length(); j++) emojis.add(e.getString(j));
                stickers.add(new Sticker(s.getString("file"), emojis));
            }
            return new Pack(
                    json.getString("identifier"),
                    json.getString("name"),
                    json.getString("publisher"),
                    json.getString("tray"),
                    json.getString("imageDataVersion"),
                    stickers);
        } catch (IOException | JSONException e) {
            return null;
        }
    }

    /** Arquivo de um pacote, apenas se ele pertencer ao pacote (evita path traversal). */
    @Nullable
    public static File assetFile(@NonNull Context ctx, String identifier, String fileName) {
        if (fileName == null || !FILE_NAME.matcher(fileName).matches()) return null;
        Pack pack = load(ctx, identifier);
        if (pack == null) return null;
        boolean known = fileName.equals(pack.trayImageFile);
        for (Sticker s : pack.stickers) known |= fileName.equals(s.fileName);
        if (!known) return null;
        File f = new File(packDir(ctx, identifier), fileName);
        return f.isFile() ? f : null;
    }

    private static void write(File f, byte[] data) throws IOException {
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(data);
        }
    }

    private static byte[] read(File f) throws IOException {
        byte[] buf = new byte[(int) f.length()];
        try (FileInputStream in = new FileInputStream(f)) {
            int off = 0;
            while (off < buf.length) {
                int n = in.read(buf, off, buf.length - off);
                if (n < 0) break;
                off += n;
            }
        }
        return buf;
    }

    private static void deleteRecursive(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteRecursive(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
