package com.wotbtools.app

import android.content.Context
import android.util.Log
import android.webkit.WebResourceResponse
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * 3D 资产原生代理：WebView 页面 origin（appassets.androidplatform.net）不在对象存储桶的
 * CORS 白名单里，页面内 `fetch` 直连会被 CORS 拦截；改由 Native 在 shouldInterceptRequest
 * 里以 HttpURLConnection 匿名 GET 对象存储（CORS 是浏览器机制，原生代码不受约束），字节
 * COS → 设备直连、不经过生产网关——TX1 出口带宽不再被资产包流量占用。
 *
 * 资产基址因此保持本机路径（frontend/src/platform/runtime.js 的 ANDROID_ASSET_BASE =
 * '/agent-assets'），请求 same-origin，无需桶 CORS，也无需额外 CSP 白名单。
 *
 * ETag 磁盘缓存：条目 = <sha256(path)>.body + <sha256(path)>.meta（首行 ETag，次行
 * Content-Type）。命中时带 If-None-Match 条件请求，304 回放缓存；200 先全量落盘再回放
 * （先落盘换取实现简单：资产不可变，重取即得同一字节）。网络/上游失败回退陈旧缓存——
 * 资产不可变，陈旧即正确。缓存总量超限按 lastModified LRU 修剪。
 *
 * 对象存储侧无需任何配置（桶匿名可读；条件请求只依赖 ETag）。换 origin 时同步
 * docs/operations/agent-asset-origin.md 与 runtime.js 的注释。
 */
object AgentAssetProxy {
    private const val TAG = "AgentAssetProxy"

    /** 与 Web 构建默认（ASSET_BASE_URL Repository Variable）同一对象存储 origin。 */
    private const val COS_BASE = "https://wotbtools-assets-1478073677.cos.ap-shanghai.myqcloud.com"

    /** 本机资产路径前缀；runtime.js 的 ANDROID_ASSET_BASE 与这里保持一致。 */
    const val LOCAL_PATH_PREFIX = "/agent-assets/"

    private const val CACHE_SUBDIR = "agent-assets"
    private const val MAX_CACHE_BYTES = 192L * 1024 * 1024
    private const val CONNECT_TIMEOUT_MS = 8_000
    private const val READ_TIMEOUT_MS = 30_000
    private const val DEFAULT_CONTENT_TYPE = "application/octet-stream"

    fun intercept(context: Context, path: String): WebResourceResponse {
        return try {
            fetchAndServe(context, path, conditional = true)
        } catch (_: IOException) {
            val cached = entry(context, path)
            if (cached != null) {
                Log.w(TAG, "upstream failed; serving stale cache for $path")
                cached.response()
            } else {
                Log.w(TAG, "upstream failed and no cache for $path")
                WebResourceResponse(
                    "text/plain", "UTF-8", 502, "asset upstream unavailable",
                    mapOf("Cache-Control" to "no-store"), null
                )
            }
        }
    }

    private fun fetchAndServe(context: Context, path: String, conditional: Boolean): WebResourceResponse {
        val dir = cacheDir(context)
        dir.mkdirs()
        val entry = entry(context, path)
        val conn = open(path, entry?.etag.takeIf { conditional && it != null })
        try {
            when (conn.responseCode) {
                HttpURLConnection.HTTP_NOT_MODIFIED -> {
                    if (entry != null) return entry.response()
                    // 304 但本地缺失（缓存被系统清理等）：无条件重取一次。
                    return fetchAndServe(context, path, conditional = false)
                }
                HttpURLConnection.HTTP_OK -> {
                    val stored = store(context, path, conn)
                    trimCache(dir)
                    return stored.response()
                }
                else -> throw IOException("asset upstream HTTP ${conn.responseCode}")
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun open(path: String, etag: String?): HttpURLConnection =
        (URL(COS_BASE + path).openConnection() as HttpURLConnection).apply {
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            instanceFollowRedirects = true
            etag?.takeIf { it.isNotEmpty() }?.let { setRequestProperty("If-None-Match", it) }
        }

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
        fun response(): WebResourceResponse = WebResourceResponse(contentType, null, body.inputStream())
    }

    companion object {
        /** 纯函数（纯 JVM 单测覆盖）：路径 → 定长缓存键。 */
        fun cacheKey(path: String): String =
            MessageDigest.getInstance("SHA-256")
                .digest(path.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }

        /** 纯函数：COS Content-Type（可能带 charset 参数/大小写随意）归一化为 MIME。 */
        fun normalizeContentType(raw: String?): String =
            raw?.substringBefore(';')?.trim()?.lowercase()
                ?.takeIf { it.isNotEmpty() } ?: DEFAULT_CONTENT_TYPE

        /**
         * 纯函数：entries = (body 文件名, 字节数, lastModified)；按 lastModified 升序淘汰
         * 直到总量 ≤ maxBytes，返回应删除的 body 文件名列表。
         */
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
}
