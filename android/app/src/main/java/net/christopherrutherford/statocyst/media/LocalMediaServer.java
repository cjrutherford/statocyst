package net.christopherrutherford.statocyst.media;

import android.content.Context;
import android.net.Uri;
import android.util.Log;
import android.webkit.MimeTypeMap;

import net.christopherrutherford.statocyst.artwork.ExternalArt;
import net.christopherrutherford.statocyst.jellyfin.JellyfinArtwork;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Serves app-private audio files to the WebView over a loopback HTTP server.
 *
 * A real socket (rather than WebView's shouldInterceptRequest) is used because
 * Chromium's FFmpeg audio pipeline cannot seek in intercepted response streams:
 * seek requests are retried indefinitely and end in a demuxer failure. A local
 * HTTP server gives the player genuine 206 Partial Content responses, so
 * seeking works exactly as it does for a remote Jellyfin stream.
 *
 * Requests look like:
 *
 *   http://127.0.0.1:&lt;port&gt;/__media/file?path=&lt;url-encoded absolute path&gt;
 *
 * The path must live under one of the app's media roots (downloads, cache or
 * imported library), so a page can never read arbitrary files. The server only
 * binds to loopback and is reachable only from this app.
 */
public final class LocalMediaServer {

    public static final String PREFIX = "/__media/";
    private static final String HOST = "127.0.0.1";
    private static final String TAG = "LocalMediaServer";

    private static ServerSocket serverSocket;
    private static int port;
    private static Context appContext;
    private static ExecutorService workers;

    private LocalMediaServer() {}

    /** Starts the loopback server once; safe to call from any thread. */
    public static synchronized void start(Context context) {
        if (serverSocket != null && !serverSocket.isClosed()) return;
        appContext = context.getApplicationContext();
        try {
            ServerSocket socket = new ServerSocket(0, 16, InetAddress.getByName(HOST));
            serverSocket = socket;
            port = socket.getLocalPort();
            workers = Executors.newFixedThreadPool(4, runnable -> {
                Thread thread = new Thread(runnable, "statocyst-media");
                thread.setDaemon(true);
                return thread;
            });
            Thread accept = new Thread(() -> {
                while (!socket.isClosed()) {
                    try {
                        Socket client = socket.accept();
                        workers.execute(() -> handle(client));
                    } catch (IOException error) {
                        if (!socket.isClosed()) {
                            Log.w(TAG, "accept failed", error);
                        }
                    }
                }
            }, "statocyst-media-accept");
            accept.setDaemon(true);
            accept.start();
            Log.i(TAG, "loopback media server listening on " + HOST + ":" + port);
        } catch (IOException error) {
            Log.e(TAG, "could not start loopback media server", error);
            serverSocket = null;
            port = 0;
        }
    }

    /** Absolute local path for a track file as a playable URL, or null. */
    public static String localUri(Context context, File file) {
        start(context);
        if (port <= 0) return null;
        return "http://" + HOST + ":" + port + PREFIX + "file?path="
            + Uri.encode(file.getAbsolutePath());
    }

    /** Loopback URL for a Jellyfin primary image; the server adds the session header, the URL carries no token. */
    public static String artUri(Context context, String itemId, String tag) {
        start(context);
        if (port <= 0 || !JellyfinArtwork.INSTANCE.isValidId(itemId)) return null;
        String safeTag = JellyfinArtwork.INSTANCE.isValidTag(tag) ? tag : "";
        return "http://" + HOST + ":" + port + PREFIX + "art?id=" + itemId
            + (safeTag.isEmpty() ? "" : "&tag=" + safeTag);
    }

    /** Loopback URL for an opt-in MusicBrainz cover (artist + album) or artist photo (album null); null when off. */
    public static String extArtUri(Context context, String artist, String album) {
        String path = album == null
            ? ExternalArt.INSTANCE.artistUri(context, artist)
            : ExternalArt.INSTANCE.coverUri(context, artist, album);
        if (path == null) return null;
        start(context);
        if (port <= 0) return null;
        Uri.Builder b = new Uri.Builder().scheme("http").encodedAuthority(HOST + ":" + port)
            .appendEncodedPath(PREFIX.substring(1) + "ext");
        if (album == null) b.appendQueryParameter("name", artist);
        else b.appendQueryParameter("artist", artist).appendQueryParameter("album", album);
        return b.build().toString();
    }

    private static void serveExternalArt(Socket socket, Uri url, boolean head) throws IOException {
        String name = url.getQueryParameter("name");
        String artist = url.getQueryParameter("artist");
        String album = url.getQueryParameter("album");
        File image;
        if (name != null) image = ExternalArt.INSTANCE.artist(appContext, name);
        else if (artist != null && album != null) image = ExternalArt.INSTANCE.cover(appContext, artist, album);
        else {
            writeText(socket, 400, "Bad Request", "Bad artwork request");
            return;
        }
        if (image == null) {
            writeText(socket, 404, "Not Found", "No artwork");
            return;
        }
        sendImage(socket, image, head);
    }

    private static void serveArtwork(Socket socket, Uri url, boolean head) throws IOException {
        String id = url.getQueryParameter("id");
        String tag = url.getQueryParameter("tag");
        if (tag == null) tag = "";
        if (!JellyfinArtwork.INSTANCE.isValidId(id) || !JellyfinArtwork.INSTANCE.isValidTag(tag)) {
            writeText(socket, 400, "Bad Request", "Bad artwork request");
            return;
        }
        File image = JellyfinArtwork.INSTANCE.fetch(appContext, id, tag, 300);
        if (image == null) {
            writeText(socket, 404, "Not Found", "No artwork");
            return;
        }
        sendImage(socket, image, head);
    }

    private static void sendImage(Socket socket, File image, boolean head) throws IOException {
        byte[] head16 = new byte[16];
        try (java.io.FileInputStream in = new java.io.FileInputStream(image)) {
            in.read(head16);
        }
        String mime = JellyfinArtwork.INSTANCE.sniffMime(head16);
        if (mime == null) mime = "application/octet-stream";
        long length = image.length();
        String header = "HTTP/1.1 200 OK\r\n"
            + "Content-Type: " + mime + "\r\n"
            + "Content-Length: " + length + "\r\n"
            + "Cache-Control: private, max-age=86400\r\n"
            + "Access-Control-Allow-Origin: *\r\n"
            + "Connection: close\r\n\r\n";
        OutputStream output = socket.getOutputStream();
        output.write(header.getBytes(StandardCharsets.ISO_8859_1));
        if (!head) {
            try (java.io.FileInputStream in = new java.io.FileInputStream(image)) {
                byte[] buffer = new byte[32 * 1024];
                int read;
                while ((read = in.read(buffer)) >= 0) output.write(buffer, 0, read);
            }
        }
        output.flush();
    }

    private static void handle(Socket client) {
        try (Socket socket = client) {
            socket.setSoTimeout(20_000);
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(socket.getInputStream(), StandardCharsets.ISO_8859_1));
            String requestLine = reader.readLine();
            if (requestLine == null) return;
            String[] request = requestLine.split(" ");
            if (request.length < 2) return;
            String method = request[0].toUpperCase(Locale.US);
            String target = request[1];

            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) {
                    headers.put(
                        line.substring(0, colon).trim().toLowerCase(Locale.US),
                        line.substring(colon + 1).trim());
                }
            }

            if (!"GET".equals(method) && !"HEAD".equals(method)) {
                writeText(socket, 405, "Method Not Allowed", "Method not allowed");
                return;
            }

            Uri url = Uri.parse(target);
            String path = url.getPath();
            if (path != null && path.equals(PREFIX + "ext")) {
                serveExternalArt(socket, url, "HEAD".equals(method));
                return;
            }
            if (path != null && path.equals(PREFIX + "art")) {
                serveArtwork(socket, url, "HEAD".equals(method));
                return;
            }
            if (path == null || !path.startsWith(PREFIX) || !path.endsWith("/file")) {
                writeText(socket, 404, "Not Found", "Not found");
                return;
            }
            String rawPath = url.getQueryParameter("path");
            if (rawPath == null || rawPath.isEmpty()) {
                writeText(socket, 400, "Bad Request", "Missing path");
                return;
            }

            File file;
            try {
                file = new File(rawPath).getCanonicalFile();
            } catch (IOException error) {
                writeText(socket, 400, "Bad Request", "Bad path");
                return;
            }
            if (!insideMediaRoots(file)) {
                writeText(socket, 403, "Forbidden", "Forbidden");
                return;
            }
            if (!file.isFile()) {
                writeText(socket, 404, "Not Found", "Not found");
                return;
            }

            serve(socket, file, headers, "HEAD".equals(method));
        } catch (java.net.SocketException closed) {
            // The player abandons a request whenever it seeks or buffers ahead;
            // that is normal, so it must not look like a failure in the log.
            Log.d(TAG, "player closed a media connection: " + closed.getMessage());
        } catch (IOException error) {
            Log.w(TAG, "media request failed", error);
        }
    }

    private static void serve(
        Socket socket,
        File file,
        Map<String, String> headers,
        boolean head
    ) throws IOException {
        long length = file.length();
        long start = 0L;
        long end = length - 1;
        boolean partial = false;

        String range = headers.get("range");
        if (range != null && range.startsWith("bytes=") && length > 0) {
            String spec = range.substring("bytes=".length()).trim();
            int dash = spec.indexOf('-');
            try {
                if (dash == 0) {
                    long suffix = Long.parseLong(spec.substring(1));
                    start = Math.max(0L, length - suffix);
                    partial = true;
                } else if (dash > 0) {
                    start = Long.parseLong(spec.substring(0, dash));
                    String tail = spec.substring(dash + 1);
                    if (!tail.isEmpty()) end = Math.min(Long.parseLong(tail), length - 1);
                    partial = true;
                }
            } catch (NumberFormatException error) {
                start = 0L;
                end = length - 1;
                partial = false;
            }
            if (partial && (start < 0L || start >= length || end < start)) {
                writeText(socket, 416, "Range Not Satisfiable", "Range not satisfiable",
                    "Content-Range: bytes */" + length + "\r\n");
                return;
            }
        }

        long contentLength = Math.max(0L, end - start + 1);
        String mime = mimeType(file.getName());
        StringBuilder headBuffer = new StringBuilder();
        headBuffer.append("HTTP/1.1 ").append(partial ? 206 : 200).append(' ')
            .append(partial ? "Partial Content" : "OK").append("\r\n");
        headBuffer.append("Content-Type: ").append(mime).append("\r\n");
        headBuffer.append("Content-Length: ").append(contentLength).append("\r\n");
        headBuffer.append("Accept-Ranges: bytes\r\n");
        headBuffer.append("Cache-Control: no-store\r\n");
        headBuffer.append("Access-Control-Allow-Origin: *\r\n");
        headBuffer.append("Access-Control-Allow-Private-Network: true\r\n");
        headBuffer.append("Connection: close\r\n");
        if (partial) {
            headBuffer.append("Content-Range: bytes ")
                .append(start).append('-').append(end).append('/').append(length)
                .append("\r\n");
        }
        headBuffer.append("\r\n");

        OutputStream output = socket.getOutputStream();
        output.write(headBuffer.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (head) {
            output.flush();
            return;
        }

        try (RandomAccessFile source = new RandomAccessFile(file, "r")) {
            source.seek(start);
            byte[] buffer = new byte[64 * 1024];
            long remaining = contentLength;
            while (remaining > 0) {
                int read = source.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                if (read < 0) break;
                output.write(buffer, 0, read);
                remaining -= read;
            }
            output.flush();
        }
    }

    private static void writeText(Socket socket, int status, String reason, String body)
        throws IOException {
        writeText(socket, status, reason, body, "");
    }

    private static void writeText(
        Socket socket,
        int status,
        String reason,
        String body,
        String extraHeaders
    ) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + status + " " + reason + "\r\n"
            + "Content-Type: text/plain; charset=utf-8\r\n"
            + "Content-Length: " + bytes.length + "\r\n"
            + "Connection: close\r\n"
            + extraHeaders
            + "\r\n";
        OutputStream output = socket.getOutputStream();
        output.write(head.getBytes(StandardCharsets.ISO_8859_1));
        output.write(bytes);
        output.flush();
    }

    private static boolean insideMediaRoots(File file) {
        if (appContext == null) return false;
        String[] roots = { "downloads", "cache", "library" };
        String base = appContext.getFilesDir().getAbsolutePath();
        for (String name : roots) {
            File root = new File(base, name);
            try {
                String rootPath = root.getCanonicalPath();
                if (file.getAbsolutePath().startsWith(rootPath + File.separator)) return true;
            } catch (IOException ignored) {
                // Unresolvable root: keep checking the others.
            }
        }
        return false;
    }

    private static String mimeType(String name) {
        String ext = MimeTypeMap.getFileExtensionFromUrl(name);
        if (ext == null || ext.isEmpty()) {
            int dot = name.lastIndexOf('.');
            ext = dot >= 0 ? name.substring(dot + 1) : "";
        }
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase(Locale.US));
        if (mime != null && mime.startsWith("audio/")) return mime;
        switch (ext.toLowerCase(Locale.US)) {
            case "flac": return "audio/flac";
            case "opus": return "audio/opus";
            case "m4a":
            case "alac": return "audio/mp4";
            case "ogg": return "audio/ogg";
            case "wav": return "audio/wav";
            case "mp3": return "audio/mpeg";
            default: return "application/octet-stream";
        }
    }
}
