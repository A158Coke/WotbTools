package com.wotbtools.app

import android.content.Context
import android.util.Log
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

object AgentAssetProxy {
    private const val TAG = "AgentAssetProxy"

    private const val REMOTE_ASSET_BASE = "https://assets.wotbtools.com"

    const val LOCAL_PATH_PREFIX = "/agent-assets/"

    private const val CACHE_SUBDIR = "agent-assets"
    private const val MAX_CACHE_BYTES = 192L * 1024 * 1024
    private const val CONNECT_TIMEOUT_MS = 8_000
    private const val READ_TIMEOUT_MS = 30_000
    private const val DEFAULT_CONTENT_TYPE = "application/octet-stream"
    private val NO_STORE = mapOf("Cache-Control" to "no-store")
    private val datasetStampPath = Regex("${LOCAL_PATH_PREFIX}v/[^/]+/version\\.json")

    internal fun intercept(context: Context, path: String, upstream: URL = URL(upstreamUrl(path))): ReplayIntentHandler.StreamResponse {
        return try {
            fetchAndServe(context, path, upstream, conditional = true)
        } catch (_: IOException) {
            val cached = entry(context, path)
            if (cached != null) {
                Log.w(TAG, "upstream failed; serving stale cache for $path")
                cached.response()
            } else {
                Log.w(TAG, "upstream failed and no cache for $path")
                ReplayIntentHandler.StreamResponse(502, "Bad Gateway", headers = NO_STORE)
            }
        }
    }

    private fun fetchAndServe(context: Context, path: String, upstream: URL, conditional: Boolean): ReplayIntentHandler.StreamResponse {
        val dir = cacheDir(context)
        dir.mkdirs()
        val entry = entry(context, path)
        val conn = open(upstream, entry?.etag.takeIf { conditional && it != null })
        try {
            when (val status = conn.responseCode) {
                HttpURLConnection.HTTP_NOT_MODIFIED -> {
                    val cached = entry?.takeIf { it.body.isFile }
                    if (cached != null) {
                        try {
                            return cached.response()
                        } catch (_: IOException) {
                        }
                    }
                    return fetchAndServe(context, path, upstream, conditional = false)
                }
                HttpURLConnection.HTTP_OK -> {
                    val stored = store(context, path, conn)
                    trimCache(dir)
                    return stored.response()
                }
                HttpURLConnection.HTTP_NOT_FOUND, HttpURLConnection.HTTP_GONE -> {
                    if (!datasetStampPath.matches(path)) throw IOException("asset upstream HTTP $status")
                    if (entry != null) {
                        metaFile(context, path).delete()
                        entry.body.delete()
                    }
                    val reason = if (status == HttpURLConnection.HTTP_NOT_FOUND) "Not Found" else "Gone"
                    return ReplayIntentHandler.StreamResponse(status, reason, headers = NO_STORE)
                }
                else -> throw IOException("asset upstream HTTP $status")
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun open(upstream: URL, etag: String?): HttpURLConnection =
        (upstream.openConnection() as HttpURLConnection).apply {
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            instanceFollowRedirects = true
            etag?.takeIf { it.isNotEmpty() }?.let { setRequestProperty("If-None-Match", it) }
        }

    internal fun upstreamUrl(path: String): String = REMOTE_ASSET_BASE + upstreamPath(path)

    private fun store(context: Context, path: String, conn: HttpURLConnection): Entry {
        val dir = cacheDir(context)
        val body = bodyFile(context, path)
        val tmp = File(dir, "${body.name}.${System.nanoTime()}.tmp")
        try {
            conn.inputStream.use { input ->
                tmp.outputStream().use { output -> input.copyTo(output) }
            }
            val etag = conn.getHeaderField("ETag") ?: ""
            val type = normalizeContentType(conn.contentType)
            if (!tmp.renameTo(body)) {
                body.delete()
                if (!tmp.renameTo(body)) throw IOException("asset cache rename failed")
            }
            val meta = metaFile(context, path)
            val metaTmp = File(dir, "${body.name}.${System.nanoTime()}.meta.tmp")
            metaTmp.writeText("$etag\n$type")
            meta.delete()
            metaTmp.renameTo(meta)
            return Entry(etag, type, body)
        } finally {
            tmp.delete()
        }
    }

    private fun entry(context: Context, path: String): Entry? {
        val body = bodyFile(context, path)
        val meta = metaFile(context, path)
        if (!body.isFile || !meta.isFile) return null
        val lines = try {
            meta.readLines()
        } catch (_: IOException) {
            return null
        }
        val type = normalizeContentType(lines.getOrNull(1))
        return Entry(lines.getOrNull(0) ?: "", type, body)
    }

    private fun trimCache(dir: File) {
        val bodies = dir.listFiles { f -> f.isFile && f.name.endsWith(".body") } ?: return
        val selection = trimSelection(
            bodies.map { Triple(it.name, it.length(), it.lastModified()) },
            MAX_CACHE_BYTES
        )
        for (name in selection) {
            File(dir, name).delete()
            File(dir, name.removeSuffix(".body") + ".meta").delete()
        }
    }

    private fun cacheDir(context: Context): File = File(context.cacheDir, CACHE_SUBDIR)

    private fun bodyFile(context: Context, path: String): File =
        File(cacheDir(context), cacheKey(path) + ".body")

    private fun metaFile(context: Context, path: String): File =
        File(cacheDir(context), cacheKey(path) + ".meta")

    private class Entry(val etag: String, val contentType: String, val body: File) {
        fun response() = ReplayIntentHandler.StreamResponse(200, "OK", body.inputStream(), contentType, NO_STORE)
    }

    fun cacheKey(path: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(path.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    fun upstreamPath(path: String): String {
        val stripped = path.removePrefix(LOCAL_PATH_PREFIX)
        return if (stripped.startsWith("/")) stripped else "/$stripped"
    }

    fun normalizeContentType(raw: String?): String =
        raw?.substringBefore(';')?.trim()?.lowercase()
            ?.takeIf { it.isNotEmpty() } ?: DEFAULT_CONTENT_TYPE

    fun trimSelection(entries: List<Triple<String, Long, Long>>, maxBytes: Long): List<String> {
        var total = entries.sumOf { it.second }
        if (total <= maxBytes) return emptyList()
        val drop = mutableListOf<String>()
        for ((name, size, _) in entries.sortedBy { it.third }) {
            if (total <= maxBytes) break
            drop.add(name)
            total -= size
        }
        return drop
    }
}
