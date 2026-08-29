package com.wotbtools.app

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

/** 待处理 replay：已复制到 app private cache，uri 为 app-owned FileProvider URI。 */
data class PendingReplay(val name: String, val file: File, val uri: Uri, val size: Long)

/**
 * Replay 入口意图 → 安全 ingress（规格 §6 原始计划）：
 * external content URI → ContentResolver → 最小验证(.wotbreplay) → stream copy 到 app private cache
 * → app-owned FileProvider URI → WebView file chooser。不 Base64、不取真实路径、不解析 replay、
 * 不复制 20 MiB/100/200 MiB 业务 contract（只保留一个 infra 单文件硬上限）。
 * 非 replay intent 安全忽略（返回 null，绝不把任意 binary 交给 Web upload pipeline）。
 */
object ReplayIntentHandler {
    private const val CACHE_DIR = "replay"
    private const val BUFFER = 8192
    // infra safety hard ceiling（单文件），高于业务 20 MiB；不是业务 validator。
    private const val MAX_BYTES = 25L * 1024 * 1024

    fun fromIntent(context: Context, intent: Intent?): PendingReplay? {
        if (intent == null) return null
        val uri: Uri = when (intent.action) {
            Intent.ACTION_SEND -> {
                @Suppress("DEPRECATION")
                if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
                }
            }
            Intent.ACTION_VIEW -> intent.data
            else -> null
        } ?: return null

        val resolver = context.contentResolver
        val displayName = queryDisplayName(resolver, uri) ?: fallbackName(uri)
        // 候选验证：非 .wotbreplay 一律忽略，绝不把任意 binary 传入 Web pipeline。
        if (!displayName.lowercase().endsWith(".wotbreplay")) return null

        val size = querySize(resolver, uri)
        val file = copyToCache(context, resolver, uri) ?: return null
        val fileUri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        return PendingReplay(displayName, file, fileUri, size)
    }

    private fun copyToCache(context: Context, resolver: ContentResolver, uri: Uri): File? {
        val dir = File(context.cacheDir, CACHE_DIR).apply { mkdirs() }
        val file = File(dir, "replay-${System.currentTimeMillis()}.wotbreplay")
        return try {
            resolver.openInputStream(uri)?.use { input ->
                FileOutputStream(file).use { out ->
                    val buf = ByteArray(BUFFER)
                    var total = 0L
                    while (true) {
                        val read = input.read(buf)
                        if (read == -1) break
                        total += read
                        if (total > MAX_BYTES) {
                            file.delete()
                            return null
                        }
                        out.write(buf, 0, read)
                    }
                }
            } ?: return null
            file
        } catch (_: Exception) {
            file.delete()
            null
        }
    }

    fun cleanupOrphans(context: Context) {
        val dir = File(context.cacheDir, CACHE_DIR)
        if (!dir.exists()) return
        dir.listFiles()?.forEach { it.delete() }
    }

    private fun queryDisplayName(resolver: ContentResolver, uri: Uri): String? {
        return try {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(c.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME)) else null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun querySize(resolver: ContentResolver, uri: Uri): Long {
        return try {
            resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(c.getColumnIndexOrThrow(OpenableColumns.SIZE))) {
                    c.getLong(c.getColumnIndexOrThrow(OpenableColumns.SIZE))
                } else 0L
            } ?: 0L
        } catch (_: Exception) {
            0L
        }
    }

    private fun fallbackName(uri: Uri): String {
        return uri.lastPathSegment?.substringAfterLast('/') ?: "replay.wotbreplay"
    }
}
