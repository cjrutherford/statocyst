package net.christopherrutherford.statocyst.automotive

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import net.christopherrutherford.statocyst.BuildConfig

/**
 * The Android Automotive OS surface. It uses the same Room catalog, Media3
 * session and car recommendation snapshot as the phone, but draws the real
 * Statocyst theme instead of the system media template.
 */
class AutomotiveActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AutomotiveDebug.forceDriving =
            BuildConfig.DEBUG && intent?.getBooleanExtra("force_driving", false) == true
        window.setBackgroundDrawable(ColorDrawable(COLOR_ABYSS))
        setContent {
            AutomotiveApp()
        }
    }

    private companion object {
        const val COLOR_ABYSS = 0xFF050A18.toInt()
    }
}
