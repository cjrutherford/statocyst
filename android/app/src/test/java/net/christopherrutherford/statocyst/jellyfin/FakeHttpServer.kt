package net.christopherrutherford.statocyst.jellyfin

import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections

/** Minimal in-process HTTP/1.1 server for JVM tests (no Android, no real Jellyfin). */
class FakeHttpServer(private val handler: (Request) -> Response) : AutoCloseable {
    data class Request(val method: String, val target: String, val headers: Map<String, String>, val body: String = "") {
        val path: String get() = target.substringBefore('?')
        val query: String? get() = target.substringAfter('?', "").ifEmpty { null }
    }

    data class Response(val status: Int = 200, val contentType: String = "application/octet-stream", val body: ByteArray = ByteArray(0), val headers: Map<String, String> = emptyMap())

    private val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
    val requests: MutableList<Request> = Collections.synchronizedList(mutableListOf())
    val url: String get() = "http://127.0.0.1:${socket.localPort}"

    init {
        Thread({
            while (!socket.isClosed) {
                try {
                    val client = socket.accept()
                    Thread { serve(client) }.apply { isDaemon = true }.start()
                } catch (_: Exception) {
                    break
                }
            }
        }, "fake-http").apply { isDaemon = true }.start()
    }

    private fun serve(client: Socket) {
        client.use {
            val reader = it.getInputStream().bufferedReader(Charsets.ISO_8859_1)
            val line = reader.readLine() ?: return
            val parts = line.split(" ")
            if (parts.size < 2) return
            val headers = HashMap<String, String>()
            while (true) {
                val h = reader.readLine() ?: break
                if (h.isEmpty()) break
                val i = h.indexOf(':')
                if (i > 0) headers[h.substring(0, i).trim().lowercase()] = h.substring(i + 1).trim()
            }
            val length = headers["content-length"]?.toIntOrNull() ?: 0
            val body = if (length > 0) CharArray(length).also { buf -> reader.read(buf, 0, length) }.concatToString() else ""
            val req = Request(parts[0], parts[1], headers, body)
            requests.add(req)
            val res = handler(req)
            val head = "HTTP/1.1 ${res.status} X\r\nContent-Type: ${res.contentType}\r\nContent-Length: ${res.body.size}\r\nConnection: close\r\n${res.headers.entries.joinToString("") { (k, v) -> "$k: $v\r\n" }}\r\n"
            it.getOutputStream().apply {
                write(head.toByteArray(Charsets.ISO_8859_1))
                if (req.method != "HEAD") write(res.body)
                flush()
            }
        }
    }

    override fun close() = socket.close()
}
