package net.christopherrutherford.statocyst;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import net.christopherrutherford.statocyst.automotive.AutomotiveActivity;
import net.christopherrutherford.statocyst.media.LocalMediaServer;
import net.christopherrutherford.statocyst.media.VideoPresentation;
import net.christopherrutherford.statocyst.plugin.StatocystPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StatocystPlugin.class);
        // Start before the WebView loads so the first playback can resolve a URL.
        LocalMediaServer.start(getApplicationContext());
        super.onCreate(savedInstanceState);

        // Android 13+: without this the media notification and lock-screen
        // controls are silently suppressed. Embedded automotive owns its own
        // surface and does not need the phone permission prompt.
        if (!isAutomotive()
                && Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] {Manifest.permission.POST_NOTIFICATIONS}, 1001);
        }
    }

    private boolean isAutomotive() {
        return getPackageManager().hasSystemFeature(PackageManager.FEATURE_AUTOMOTIVE);
    }

    @Override
    protected void load() {
        // Embedded Android Automotive gets the native Compose surface; the
        // projected Android Auto / CarPlay clients still use the media browse
        // tree and never launch this activity.
        if (isAutomotive()) {
            startActivity(new Intent(this, AutomotiveActivity.class));
            finish();
            return;
        }
        super.load();
        if (bridge == null || bridge.getWebView() == null) return;
        WebView wv = bridge.getWebView();
        // Local media is served by the loopback HTTP server above. Chromium
        // treats 127.0.0.1 as potentially trustworthy, but allow it explicitly
        // for devices whose WebView is stricter about mixed content.
        wv.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // A static app shell does not need the overscroll glow, and painting the
        // WebView background avoids a white flash between frames.
        wv.setOverScrollMode(View.OVER_SCROLL_NEVER);
        wv.setBackgroundColor(0xFF050A18);
    }

    /**
     * Leaving the app during video playback shrinks into native PiP on the same
     * Media3 player. Audio-only/music never enters PiP.
     */
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (VideoPresentation.shouldEnterPip(this)) {
            VideoPresentation.enterPip(this);
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        VideoPresentation.onPipModeChanged(this, isInPictureInPictureMode);
    }

    @Override
    public void onDestroy() {
        VideoPresentation.onHostDestroyed(this);
        super.onDestroy();
    }
}
