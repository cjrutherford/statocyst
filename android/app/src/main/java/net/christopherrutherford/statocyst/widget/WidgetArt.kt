package net.christopherrutherford.statocyst.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
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

    /** Centre-cropped to a square of [px] with rounded corners and the app's hairline border. */
    private fun rounded(src: Bitmap, px: Int): Bitmap {
        val out = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888)
        val side = minOf(src.width, src.height)
        val from = android.graphics.Rect((src.width - side) / 2, (src.height - side) / 2, (src.width + side) / 2, (src.height + side) / 2)
        val canvas = Canvas(out)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        val box = RectF(0f, 0f, px.toFloat(), px.toFloat())
        canvas.drawRoundRect(box, px * RADIUS, px * RADIUS, paint)
        paint.xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC_IN)
        canvas.drawBitmap(src, from, box, paint)
        border(canvas, px)
        return out
    }

    /** Mirrors the app's artwork placeholder: abyss gradient with a cyan and a violet bloom. */
    private fun placeholder(label: String?, px: Int): Bitmap {
        val out = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val size = px.toFloat()
        val box = RectF(0f, 0f, size, size)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        val path = android.graphics.Path().apply { addRoundRect(box, size * RADIUS, size * RADIUS, android.graphics.Path.Direction.CW) }
        canvas.save()
        canvas.clipPath(path)
        paint.shader = LinearGradient(0f, 0f, size, size, 0xFF0A1830.toInt(), 0xFF060D1D.toInt(), Shader.TileMode.CLAMP)
        canvas.drawRect(box, paint)
        // Which corner carries which bloom varies per song so a row of placeholders is not identical.
        val flip = (label?.hashCode() ?: 0).mod(2) == 1
        val cyanAt = if (flip) 0.74f else 0.3f
        val violetAt = if (flip) 0.3f else 0.74f
        paint.shader = RadialGradient(size * cyanAt, size * 0.2f, size * 0.7f, 0x4038E1FF, 0x0038E1FF, Shader.TileMode.CLAMP)
        canvas.drawRect(box, paint)
        paint.shader = RadialGradient(size * violetAt, size * 0.85f, size * 0.75f, 0x55A78BFA, 0x00A78BFA, Shader.TileMode.CLAMP)
        canvas.drawRect(box, paint)
        paint.shader = null
        val letter = label?.trim()?.firstOrNull { it.isLetterOrDigit() }?.uppercaseChar()?.toString() ?: "\u266A"
        paint.color = 0xE67FE9FF.toInt()
        paint.textSize = size * 0.4f
        paint.textAlign = Paint.Align.CENTER
        paint.typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        canvas.drawText(letter, size / 2f, size / 2f - (paint.descent() + paint.ascent()) / 2f, paint)
        canvas.restore()
        border(canvas, px)
        return out
    }

    private fun border(canvas: Canvas, px: Int) {
        val width = maxOf(1f, px * 0.012f)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = width
            color = 0x4094C5FF
        }
        val inset = width / 2f
        canvas.drawRoundRect(RectF(inset, inset, px - inset, px - inset), px * RADIUS, px * RADIUS, paint)
    }

    private const val RADIUS = 0.16f
}
