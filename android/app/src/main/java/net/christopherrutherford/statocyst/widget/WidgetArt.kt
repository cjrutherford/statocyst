package net.christopherrutherford.statocyst.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.util.LruCache

/** Square, rounded artwork bitmaps sized for RemoteViews; decoding happens on the render worker. */
internal object WidgetArt {
    private val cache = LruCache<String, Bitmap>(24)

    /** The art behind [uri] (a token-free content URI), or a lettered tile when there is none. */
    fun tile(context: Context, uri: String?, label: String?, px: Int): Bitmap {
        val key = "$px|$uri|${if (uri == null) label else ""}"
        cache.get(key)?.let { return it }
        val bitmap = (uri?.let { decode(context, it, px) } ?: placeholder(label, px))
        cache.put(key, bitmap)
        return bitmap
    }

    private fun decode(context: Context, uri: String, px: Int): Bitmap? = try {
        val parsed = Uri.parse(uri)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(parsed)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= px && bounds.outHeight / (sample * 2) >= px) sample *= 2
        val raw = context.contentResolver.openInputStream(parsed)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        }
        raw?.let { rounded(it, px) }
    } catch (e: Exception) {
        android.util.Log.w("WidgetArt", "artwork unavailable", e)
        null
    }

    /** Centre-cropped to a square of [px] with rounded corners. */
    private fun rounded(src: Bitmap, px: Int): Bitmap {
        val out = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888)
        val side = minOf(src.width, src.height)
        val from = android.graphics.Rect((src.width - side) / 2, (src.height - side) / 2, (src.width + side) / 2, (src.height + side) / 2)
        val canvas = Canvas(out)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        canvas.drawRoundRect(RectF(0f, 0f, px.toFloat(), px.toFloat()), px * RADIUS, px * RADIUS, paint)
        paint.xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC_IN)
        canvas.drawBitmap(src, from, RectF(0f, 0f, px.toFloat(), px.toFloat()), paint)
        return out
    }

    private fun placeholder(label: String?, px: Int): Bitmap {
        val out = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = BACKGROUNDS[(label?.hashCode() ?: 0).mod(BACKGROUNDS.size)] }
        canvas.drawRoundRect(RectF(0f, 0f, px.toFloat(), px.toFloat()), px * RADIUS, px * RADIUS, paint)
        val letter = label?.trim()?.firstOrNull { it.isLetterOrDigit() }?.uppercaseChar()?.toString() ?: "♪"
        paint.color = 0xCCFFFFFF.toInt()
        paint.textSize = px * 0.42f
        paint.textAlign = Paint.Align.CENTER
        paint.isFakeBoldText = true
        canvas.drawText(letter, px / 2f, px / 2f - (paint.descent() + paint.ascent()) / 2f, paint)
        return out
    }

    private const val RADIUS = 0.1f
    private val BACKGROUNDS = intArrayOf(0xFF2A3A63.toInt(), 0xFF3B2A63.toInt(), 0xFF1F5A5A.toInt(), 0xFF5A2F3F.toInt(), 0xFF4A4A2A.toInt())
}
