package com.wotbtools.app

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

internal class LocalRuntimeServer(
    private val origin: String,
    private val route: (Request) -> ReplayIntentHandler.StreamResponse
) {
    private val port = java.net.URI(origin).let { uri ->
        require(uri.scheme == "http" && uri.host == HOST && uri.port in 1..65535 && uri.rawPath.isNullOrEmpty()) {
            "Local runtime origin must be http://$HOST:<port>"
        }
        uri.port
    }
    private val authority = "$HOST:$port"

    internal data class Request(val method: String, val path: String, val headers: Map<String, String>)

    private val workers: ExecutorService = Executors.newFixedThreadPool(WORKERS) { runnable ->
        Thread(runnable, "wotb-runtime-http").apply { isDaemon = true }
    }
    @Volatile private var socket: ServerSocket? = null

    @Throws(IOException::class)
    fun start() {
        val server = ServerSocket()
        try {
            server.reuseAddress = true
            server.bind(InetSocketAddress(InetAddress.getByName(HOST), port), BACKLOG)
        } catch (e: IOException) {
            server.close()
            throw e
        }
        socket = server
        Thread({ acceptLoop(server) }, "wotb-runtime-accept").apply { isDaemon = true }.start()
    }

    fun close() {
        try {
            socket?.close()
        } catch (_: IOException) {
        }
        socket = null
        workers.shutdownNow()
    }

    private fun acceptLoop(server: ServerSocket) {
        while (!server.isClosed) {
            val client = try {
                server.accept()
            } catch (_: SocketException) {
                return
            } catch (_: IOException) {
                continue
            }
            try {
                workers.execute { serve(client) }
            } catch (_: Exception) {
                client.close()
            }
        }
    }

    internal fun serve(client: Socket) {
        client.use {
            try {
                it.soTimeout = READ_TIMEOUT_MS
                val parsed = parse(BufferedInputStream(it.getInputStream(), HEAD_BUFFER))
                val response = when (parsed) {
                    is Parsed.Rejected -> parsed.response
                    is Parsed.Ok -> try {
                        route(parsed.request)
                    } catch (_: Exception) {
                        ReplayIntentHandler.StreamResponse(500, "Internal Server Error")
                    }
                }
                val headOnly = parsed is Parsed.Ok && parsed.request.method == "HEAD"
                sendResponse({ it.getOutputStream() }, response, headOnly)
            } catch (_: IOException) {
            }
        }
    }

    private sealed class Parsed {
        class Ok(val request: Request) : Parsed()
        class Rejected(val response: ReplayIntentHandler.StreamResponse) : Parsed()
    }

    private fun parse(input: InputStream): Parsed {
        val lines = readHead(input) ?: return reject(431, "Request Header Fields Too Large")
        val requestLine = lines.firstOrNull()?.split(' ') ?: return reject(400, "Bad Request")
        if (requestLine.size != 3 || !requestLine[2].startsWith("HTTP/1.")) return reject(400, "Bad Request")
        val (method, target) = requestLine
        val headers = HashMap<String, String>()
        for (line in lines.drop(1)) {
            val colon = line.indexOf(':')
            if (colon <= 0) return reject(400, "Bad Request")
            val name = line.substring(0, colon).trim().lowercase(Locale.ROOT)
            if (name in headers) return reject(400, "Bad Request")
            headers[name] = line.substring(colon + 1).trim()
        }
        if (method != "GET" && method != "HEAD") return reject(405, "Method Not Allowed")
        if (headers["host"] != authority) return reject(421, "Misdirected Request")
        val requestOrigin = headers["origin"]
        if (requestOrigin != null && requestOrigin != origin) return reject(403, "Forbidden")
        val path = decodePath(target) ?: return reject(400, "Bad Request")
        return Parsed.Ok(Request(method, path, headers))
    }

    private fun reject(status: Int, reason: String) =
        Parsed.Rejected(ReplayIntentHandler.StreamResponse(status, reason, headers = NO_STORE))

    private fun readHead(input: InputStream): List<String>? {
        val lines = ArrayList<String>()
        val line = StringBuilder()
        var total = 0
        while (true) {
            val b = input.read()
            if (b < 0) return if (lines.isEmpty()) null else lines
            if (++total > MAX_HEAD_BYTES) return null
            when {
                b == '\n'.code -> {
                    if (line.isNotEmpty() && line.last() == '\r') line.setLength(line.length - 1)
                    if (line.isEmpty()) return lines
                    lines.add(line.toString())
                    line.setLength(0)
                }
                b < 0x20 && b != '\r'.code && b != '\t'.code -> return null
                else -> line.append(b.toChar())
            }
        }
    }

    internal companion object {
        const val HOST = "127.0.0.1"

        private const val WORKERS = 16
        private const val BACKLOG = 64
        private const val READ_TIMEOUT_MS = 15_000
        private const val MAX_HEAD_BYTES = 16 * 1024
        private const val HEAD_BUFFER = 4 * 1024
        private const val BUFFER = 64 * 1024
        internal val NO_STORE = mapOf("Cache-Control" to "no-store")

        fun sendResponse(
            open: () -> OutputStream,
            response: ReplayIntentHandler.StreamResponse,
            headOnly: Boolean
        ) {
            try {
                write(BufferedOutputStream(open()), response, headOnly)
            } finally {
                closeQuietly(response.data)
            }
        }

        private fun write(output: OutputStream, response: ReplayIntentHandler.StreamResponse, headOnly: Boolean) {
            val head = StringBuilder()
                .append("HTTP/1.1 ").append(response.status).append(' ').append(response.reason).append("\r\n")
                .append("Content-Type: ").append(response.contentType).append("\r\n")
                .append("X-Content-Type-Options: nosniff\r\n")
                .append("Connection: close\r\n")
            response.headers.forEach { (name, value) -> head.append(name).append(": ").append(value).append("\r\n") }
            head.append("\r\n")
            output.write(head.toString().toByteArray(Charsets.US_ASCII))
            if (!headOnly) response.data?.copyTo(output, BUFFER)
            output.flush()
        }

        private fun closeQuietly(body: InputStream?) {
            try {
                body?.close()
            } catch (_: Exception) {
            }
        }

        fun decodePath(target: String): String? {
            if (!target.startsWith("/")) return null
            val raw = target.substringBefore('?').substringBefore('#')
            val decoded = StringBuilder()
            var i = 0
            while (i < raw.length) {
                val c = raw[i]
                if (c == '%') {
                    if (i + 2 >= raw.length) return null
                    val value = raw.substring(i + 1, i + 3).toIntOrNull(16) ?: return null
                    if (value < 0x20 || value == '/'.code || value == '\\'.code || value >= 0x7f) return null
                    decoded.append(value.toChar())
                    i += 3
                } else {
                    if (c < ' ' || c == '\\' || c.code >= 0x7f) return null
                    decoded.append(c)
                    i++
                }
            }
            val path = decoded.toString()
            val segments = path.substring(1).split('/')
            if (path != "/" && segments.any { it.isEmpty() || it == "." || it == ".." }) return null
            return path
        }

        fun contentTypeFor(path: String): String =
            when (path.substringAfterLast('/').substringAfterLast('.', "").lowercase(Locale.ROOT)) {
                "html" -> "text/html; charset=utf-8"
                "js", "mjs" -> "text/javascript; charset=utf-8"
                "css" -> "text/css; charset=utf-8"
                "json", "map" -> "application/json; charset=utf-8"
                "webmanifest" -> "application/manifest+json"
                "wasm" -> "application/wasm"
                "svg" -> "image/svg+xml"
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                "webp" -> "image/webp"
                "gif" -> "image/gif"
                "ico" -> "image/x-icon"
                "woff" -> "font/woff"
                "woff2" -> "font/woff2"
                "ttf" -> "font/ttf"
                "txt" -> "text/plain; charset=utf-8"
                "glb" -> "model/gltf-binary"
                "gltf" -> "model/gltf+json"
                else -> "application/octet-stream"
            }
    }
}
