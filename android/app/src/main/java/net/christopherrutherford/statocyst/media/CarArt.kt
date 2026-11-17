package net.christopherrutherford.statocyst.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import java.io.File
import java.io.FileOutputStream
import kotlin.math.abs

/**
 * Generates the square, sonar-ringed car tiles that carry the Statocyst palette
 * into Android Auto's system-rendered grid. Artwork is cached in the app cache,
 * so a browse refresh does not redraw the same tile.
 */
object CarArt {
    private const val SIZE = 320

    private val palettes = arrayOf(
        intArrayOf(0xFFBFF6FF.toInt(), 0xFF0A4C74.toInt(), 0xFF050A18.toInt()),
        intArrayOf(0xFFD8C9FF.toInt(), 0xFF3A2A78.toInt(), 0xFF081326.toInt()),
        intArrayOf(0xFF7FE9FF.toInt(), 0xFF041D2B.toInt(), 0xFF03070F.toInt()),
        intArrayOf(0xFFFFD9EF.toInt(), 0xFF293061.toInt(), 0xFF081326.toInt()),
    )

    fun tile(context: Context, key: String, title: String): String? {
        return try {
            val dir = File(context.cacheDir, "car-art").apply { mkdirs() }
            val file = File(dir, "${safe(key)}-${safe(title)}.png")
            if (file.isFile && file.length() > 0) return file.absolutePath

            val palette = palettes[abs(key.hashCode()) % palettes.size]
            val bitmap = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)

            paint.shader = LinearGradient(
                0f, 0f, SIZE.toFloat(), SIZE.toFloat(),
                palette, null, Shader.TileMode.CLAMP,
            )
            canvas.drawRect(0f, 0f, SIZE.toFloat(), SIZE.toFloat(), paint)
            paint.shader = null

            val cx = SIZE * 0.28f
            val cy = SIZE * 0.25f
            paint.style = Paint.Style.FILL
            paint.color = 0x5538E1FF
            canvas.drawCircle(cx, cy, SIZE * 0.09f, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 2.2f
            paint.color = 0x4438E1FF
            for (ring in 1..5) {
                canvas.drawCircle(cx, cy, SIZE * 0.09f + ring * SIZE * 0.10f, paint)
            }

            // A soft bottom shade; the host draws the title beneath the tile.
            paint.style = Paint.Style.FILL
            paint.shader = LinearGradient(
                0f, SIZE * 0.55f, 0f, SIZE.toFloat(),
                0x0003070F, 0xCC03070F.toInt(), Shader.TileMode.CLAMP,
            )
            canvas.drawRect(0f, SIZE * 0.55f, SIZE.toFloat(), SIZE.toFloat(), paint)

            FileOutputStream(file).use { out ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            }
            bitmap.recycle()
            file.absolutePath
        } catch (_: Exception) {
            null
        }
    }

    private fun safe(value: String): String =
        value.replace(Regex("[^A-Za-z0-9_-]+"), "_").take(48).ifBlank { "tile" }
}
