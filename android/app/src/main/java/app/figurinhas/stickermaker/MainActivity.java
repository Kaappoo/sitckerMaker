package app.figurinhas.stickermaker;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import app.figurinhas.stickermaker.whatsapp.WhatsAppStickersPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins locais precisam ser registrados antes do super.onCreate
        registerPlugin(WhatsAppStickersPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
