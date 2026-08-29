package com.wotbtools.app

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns

/** 从 ACTION_SEND / ACTION_VIEW 提取的待处理 replay（不解析内容，只交接 URI）。 */
data class PendingReplay(val name: String?, val uri: Uri, val size: Long)

/**
 * 解析 replay 入口意图。V1 只支持单个 ACTION_SEND / ACTION_VIEW（规格 §41）。
 * 具体 action/mime 以用户真机 evidence 为准（规格 §35）；这里先用保守探测。
 */
object ReplayIntentHandler {
    fun fromIntent(intent: Intent?, resolver: ContentResolver): PendingReplay? {
        if (intent == null) return null
        val uri: Uri? = when (intent.action) {
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

        val name = queryDisplayName(resolver, uri) ?: fallbackName(uri)
        val size = querySize(resolver, uri)
        return PendingReplay(name, uri, size)
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
