package app.figurinhas.stickermaker.whatsapp;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.UriMatcher;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.Collections;
import java.util.List;

/**
 * Interface que o WhatsApp usa para ler os pacotes deste app, seguindo o
 * contrato oficial (github.com/WhatsApp/stickers, pasta Android).
 *
 * <ul>
 *   <li>content://AUTH/metadata — todos os pacotes</li>
 *   <li>content://AUTH/metadata/ID — um pacote</li>
 *   <li>content://AUTH/stickers/ID — figurinhas do pacote</li>
 *   <li>content://AUTH/stickers_asset/ID/ARQUIVO — arquivo (webp/png)</li>
 * </ul>
 *
 * Só o WhatsApp consegue ler: o manifest exige a permissão com.whatsapp.sticker.READ.
 */
public class StickerContentProvider extends ContentProvider {

    public static final String AUTHORITY_SUFFIX = ".stickercontentprovider";

    // Colunas de metadados
    static final String STICKER_PACK_IDENTIFIER = "sticker_pack_identifier";
    static final String STICKER_PACK_NAME = "sticker_pack_name";
    static final String STICKER_PACK_PUBLISHER = "sticker_pack_publisher";
    static final String STICKER_PACK_ICON = "sticker_pack_icon";
    static final String ANDROID_APP_DOWNLOAD_LINK = "android_play_store_link";
    static final String IOS_APP_DOWNLOAD_LINK = "ios_app_download_link";
    static final String PUBLISHER_EMAIL = "sticker_pack_publisher_email";
    static final String PUBLISHER_WEBSITE = "sticker_pack_publisher_website";
    static final String PRIVACY_POLICY_WEBSITE = "sticker_pack_privacy_policy_website";
    static final String LICENSE_AGREEMENT_WEBSITE = "sticker_pack_license_agreement_website";
    static final String IMAGE_DATA_VERSION = "image_data_version";
    static final String AVOID_CACHE = "whatsapp_will_not_cache_stickers";
    static final String ANIMATED_STICKER_PACK = "animated_sticker_pack";

    // Colunas de figurinhas
    static final String STICKER_FILE_NAME = "sticker_file_name";
    static final String STICKER_FILE_EMOJI = "sticker_emoji";
    static final String STICKER_ACCESSIBILITY_TEXT = "sticker_accessibility_text";

    private static final String METADATA = "metadata";
    private static final String STICKERS = "stickers";
    private static final String STICKERS_ASSET = "stickers_asset";

    private static final int METADATA_ALL = 1;
    private static final int METADATA_SINGLE = 2;
    private static final int STICKERS_LIST = 3;
    private static final int STICKER_ASSET = 4;

    private final UriMatcher matcher = new UriMatcher(UriMatcher.NO_MATCH);
    private String authority;

    public static String authority(Context ctx) {
        return ctx.getPackageName() + AUTHORITY_SUFFIX;
    }

    @Override
    public boolean onCreate() {
        authority = authority(requireContext());
        matcher.addURI(authority, METADATA, METADATA_ALL);
        matcher.addURI(authority, METADATA + "/*", METADATA_SINGLE);
        matcher.addURI(authority, STICKERS + "/*", STICKERS_LIST);
        matcher.addURI(authority, STICKERS_ASSET + "/*/*", STICKER_ASSET);
        return true;
    }

    @Nullable
    @Override
    public Cursor query(@NonNull Uri uri, @Nullable String[] projection, @Nullable String selection,
                        @Nullable String[] selectionArgs, @Nullable String sortOrder) {
        Context ctx = requireContext();
        switch (matcher.match(uri)) {
            case METADATA_ALL:
                return packCursor(uri, StickerPackStore.all(ctx));
            case METADATA_SINGLE: {
                StickerPackStore.Pack p = StickerPackStore.load(ctx, uri.getLastPathSegment());
                return packCursor(uri, p == null ? Collections.emptyList() : Collections.singletonList(p));
            }
            case STICKERS_LIST:
                return stickerCursor(uri, StickerPackStore.load(ctx, uri.getLastPathSegment()));
            default:
                throw new IllegalArgumentException("URI desconhecida: " + uri);
        }
    }

    private Cursor packCursor(Uri uri, List<StickerPackStore.Pack> packs) {
        MatrixCursor c = new MatrixCursor(new String[]{
                STICKER_PACK_IDENTIFIER, STICKER_PACK_NAME, STICKER_PACK_PUBLISHER, STICKER_PACK_ICON,
                ANDROID_APP_DOWNLOAD_LINK, IOS_APP_DOWNLOAD_LINK, PUBLISHER_EMAIL, PUBLISHER_WEBSITE,
                PRIVACY_POLICY_WEBSITE, LICENSE_AGREEMENT_WEBSITE, IMAGE_DATA_VERSION, AVOID_CACHE,
                ANIMATED_STICKER_PACK,
        });
        for (StickerPackStore.Pack p : packs) {
            c.newRow()
                    .add(p.identifier)
                    .add(p.name)
                    .add(p.publisher)
                    .add(p.trayImageFile)
                    .add("")
                    .add("")
                    .add("")
                    .add("")
                    .add("")
                    .add("")
                    .add(p.imageDataVersion)
                    .add(0)
                    .add(p.animated ? 1 : 0);
        }
        c.setNotificationUri(requireContext().getContentResolver(), uri);
        return c;
    }

    private Cursor stickerCursor(Uri uri, @Nullable StickerPackStore.Pack pack) {
        MatrixCursor c = new MatrixCursor(new String[]{
                STICKER_FILE_NAME, STICKER_FILE_EMOJI, STICKER_ACCESSIBILITY_TEXT,
        });
        if (pack != null) {
            for (StickerPackStore.Sticker s : pack.stickers) {
                c.addRow(new Object[]{s.fileName, String.join(",", s.emojis), ""});
            }
        }
        c.setNotificationUri(requireContext().getContentResolver(), uri);
        return c;
    }

    @Nullable
    @Override
    public AssetFileDescriptor openAssetFile(@NonNull Uri uri, @NonNull String mode) throws FileNotFoundException {
        if (matcher.match(uri) != STICKER_ASSET) throw new FileNotFoundException("URI inválida: " + uri);
        List<String> seg = uri.getPathSegments();
        if (seg.size() != 3) throw new FileNotFoundException("URI inválida: " + uri);
        File f = StickerPackStore.assetFile(requireContext(), seg.get(1), seg.get(2));
        if (f == null) throw new FileNotFoundException("Arquivo não encontrado: " + uri);
        ParcelFileDescriptor pfd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
        return new AssetFileDescriptor(pfd, 0, AssetFileDescriptor.UNKNOWN_LENGTH);
    }

    @Nullable
    @Override
    public String getType(@NonNull Uri uri) {
        switch (matcher.match(uri)) {
            case METADATA_ALL:
                return "vnd.android.cursor.dir/vnd." + authority + "." + METADATA;
            case METADATA_SINGLE:
                return "vnd.android.cursor.item/vnd." + authority + "." + METADATA;
            case STICKERS_LIST:
                return "vnd.android.cursor.dir/vnd." + authority + "." + STICKERS;
            case STICKER_ASSET: {
                String name = uri.getLastPathSegment();
                if (name != null && name.endsWith(".png")) return "image/png";
                return "image/webp";
            }
            default:
                throw new IllegalArgumentException("URI desconhecida: " + uri);
        }
    }

    @Nullable
    @Override
    public Uri insert(@NonNull Uri uri, @Nullable ContentValues values) {
        throw new UnsupportedOperationException("Somente leitura");
    }

    @Override
    public int delete(@NonNull Uri uri, @Nullable String selection, @Nullable String[] selectionArgs) {
        throw new UnsupportedOperationException("Somente leitura");
    }

    @Override
    public int update(@NonNull Uri uri, @Nullable ContentValues values, @Nullable String selection,
                      @Nullable String[] selectionArgs) {
        throw new UnsupportedOperationException("Somente leitura");
    }
}
