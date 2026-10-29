package net.christopherrutherford.statocyst;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.LifecycleEventObserver;
import androidx.lifecycle.LifecycleOwner;

import com.getcapacitor.BridgeActivity;

import net.christopherrutherford.statocyst.media.LocalMediaServer;
import net.christopherrutherford.statocyst.plugin.StatocystPlugin;

public class MainActivity extends BridgeActivity {
    private static PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StatocystPlugin.class);
        // Start before the WebView loads so the first playback can resolve a URL.
        LocalMediaServer.start(getApplicationContext());
        super.onCreate(savedInstanceState);

        // Android 13+: without this the media notification and lock-screen
        // controls are silently suppressed.
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] {Manifest.permission.POST_NOTIFICATIONS}, 1001);
        }

        // Keep the CPU awake so background buffering and playback are not
        // suspended by Doze while the app is off-screen.
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "statocyst:playback");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            }
        }

        // Keep the WebView (and its media playback) alive when backgrounded,
        // instead of letting BridgeActivity pause it (which stops playback).
        getLifecycle().addObserver(new LifecycleEventObserver() {
            @Override
            public void onStateChanged(LifecycleOwner source, Lifecycle.Event event) {
                if (bridge == null || bridge.getWebView() == null) return;
                WebView wv = bridge.getWebView();
                if (event == Lifecycle.Event.ON_PAUSE) {
                    wv.resumeTimers();
                    wv.onResume();
                } else if (event == Lifecycle.Event.ON_RESUME) {
                    wv.resumeTimers();
                }
            }
        });

        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().getSettings().setMixedContentMode(
                WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
    }

    @Override
    protected void load() {
        super.load();
        if (bridge == null) return;
        // Local media is served by the loopback HTTP server above. Chromium
        // treats 127.0.0.1 as potentially trustworthy, but allow it explicitly
        // for devices whose WebView is stricter about mixed content.
        bridge.getWebView().getSettings().setMixedContentMode(
            WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
    }
}
