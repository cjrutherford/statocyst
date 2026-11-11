package net.christopherrutherford.statocyst.downloads

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.effect.Presentation
import androidx.media3.transformer.AudioEncoderSettings
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Download-time compression through Media3 Transformer (S060).
 *
 * Only the fixed presets in [DownloadProfile] are accepted. The transform runs on
 * its own looper thread, never on playback or the UI thread, and writes to a temp
 * file that is only committed after the caller verifies it. Cancellation stops the
 * transformer and leaves no final file.
 *
 * IMPLEMENTED_UNVERIFIED: this compiles into the APK but the size/quality and
 * cancellation gates still need a device run with a real video podcast fixture.
 */
@androidx.media3.common.util.UnstableApi
object TransformerCompressor {
    fun compress(
        context: Context,
        input: File,
        output: File,
        profile: DownloadProfile,
        events: DownloadEvents,
    ) {
        require(profile.compressed) { "Only audio-only/480p/720p presets can be compressed" }
        require(input.isFile && input.length() > 0) { "The downloaded source is missing" }
        output.delete()

        val thread = HandlerThread("statocyst-transcode").apply { start() }
        val handler = Handler(thread.looper)
        val finished = CountDownLatch(1)
        val failure = AtomicReference<Throwable?>()
        val transformerRef = AtomicReference<Transformer?>()

        handler.post {
            try {
                val transformer = buildTransformer(context, profile)
                transformerRef.set(transformer)
                transformer.addListener(object : Transformer.Listener {
                    override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                        finished.countDown()
                    }

                    override fun onError(
                        composition: Composition,
                        exportResult: ExportResult,
                        exportException: ExportException,
                    ) {
                        failure.compareAndSet(null, exportException)
                        finished.countDown()
                    }
                })
                transformer.start(editedItem(input, profile), output.absolutePath)

                val holder = ProgressHolder()
                val poll = object : Runnable {
                    override fun run() {
                        if (finished.count == 0L) return
                        val state = transformer.getProgress(holder)
                        if (state == Transformer.PROGRESS_STATE_AVAILABLE) {
                            events.compressing(holder.progress.coerceIn(0, 100))
                        }
                        handler.postDelayed(this, PROGRESS_INTERVAL_MS)
                    }
                }
                handler.postDelayed(poll, PROGRESS_INTERVAL_MS)
            } catch (error: Throwable) {
                failure.compareAndSet(null, error)
                finished.countDown()
            }
        }

        try {
            while (!finished.await(POLL_SLICE_MS, TimeUnit.MILLISECONDS)) {
                if (events.cancelled()) {
                    handler.post { transformerRef.get()?.cancel() }
                    // Give the transformer a moment to release the output file.
                    finished.await(CANCEL_GRACE_MS, TimeUnit.MILLISECONDS)
                    throw DownloadCancelled()
                }
            }
            failure.get()?.let { error ->
                throw if (error is Exception) error else IllegalStateException(error.message, error)
            }
            if (!output.isFile || output.length() <= 0) {
                throw IllegalStateException("Compression produced no output file")
            }
        } catch (error: Throwable) {
            output.delete()
            throw error
        } finally {
            handler.removeCallbacksAndMessages(null)
            thread.quitSafely()
        }
    }

    private fun buildTransformer(context: Context, profile: DownloadProfile): Transformer {
        val encoder = DefaultEncoderFactory.Builder(context)
            .setRequestedAudioEncoderSettings(
                AudioEncoderSettings.Builder()
                    .setBitrate(profile.targetAudioBitRate)
                    .build(),
            )
        profile.targetHeight?.let { _ ->
            encoder.setRequestedVideoEncoderSettings(
                VideoEncoderSettings.Builder()
                    .setBitrate(profile.bitRate ?: 800_000)
                    .build(),
            )
        }
        val builder = Transformer.Builder(context)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .setEncoderFactory(encoder.build())
        if (profile.targetHeight != null) builder.setVideoMimeType(MimeTypes.VIDEO_H264)
        return builder.build()
    }

    private fun editedItem(input: File, profile: DownloadProfile): EditedMediaItem {
        val item = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(input)))
        if (profile == DownloadProfile.AUDIO_ONLY) {
            item.setRemoveVideo(true)
        } else {
            val target = profile.targetHeight
            val sourceHeight = videoHeight(input)
            if (target != null && sourceHeight != null && sourceHeight > target) {
                item.setEffects(
                    Effects(
                        emptyList<androidx.media3.common.audio.AudioProcessor>(),
                        listOf<androidx.media3.common.Effect>(Presentation.createForHeight(target)),
                    ),
                )
            }
        }
        return item.build()
    }

    /** Never upscale: a smaller source keeps its size and only the bitrate is capped. */
    private fun videoHeight(input: File): Int? {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(input.absolutePath)
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
        } catch (_: Exception) {
            null
        } finally {
            runCatching { retriever.release() }
        }
    }

    private const val PROGRESS_INTERVAL_MS = 400L
    private const val POLL_SLICE_MS = 250L
    private const val CANCEL_GRACE_MS = 10_000L
}
