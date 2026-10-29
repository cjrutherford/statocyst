package net.christopherrutherford.statocyst.media

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Generates small playable audio files so tests need no checked-in media. */
object TestAudio {
    /** 8 kHz mono 8-bit PCM silence: small, and decodable on every device without a codec. */
    fun writeSilence(file: File, seconds: Int): File {
        val data = ByteArray(8_000 * seconds) { 128.toByte() }
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + data.size); put("WAVE".toByteArray())
            put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(1)
            putInt(8_000); putInt(8_000); putShort(1); putShort(8)
            put("data".toByteArray()); putInt(data.size)
        }
        file.parentFile?.mkdirs()
        file.outputStream().use { it.write(header.array()); it.write(data) }
        return file
    }
}
