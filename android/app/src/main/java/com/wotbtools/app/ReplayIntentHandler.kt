package com.wotbtools.app

import android.annotation.SuppressLint
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.util.UUID

data class PendingReplay(
    val pendingId: String,
    val name: String,
    val file: File,
    val uri: Uri,
    val size: Long,
    val createdAt: Long
)

private const val LOG_REF_LENGTH = 8

internal fun pendingLogRef(pendingId: String?): String = pendingId?.take(LOG_REF_LENGTH) ?: "none"

internal val PendingReplay.logRef: String get() = pendingLogRef(pendingId)

internal data class ReplayPendingMetadata(
    val pendingId: String,
    val cacheFilename: String,
    val originalName: String,
    val size: Long,
    val createdAt: Long
)

object ReplayIntentHandler {
    internal const val STREAM_URL = MainActivity.LOCAL_APP_ORIGIN + "/__native/replay-pending"
    internal const val IDENTITY_HEADER = "X-Wotb-Pending-Id"

    internal data class StreamResponse(
        val status: Int,
        val reason: String,
        val data: InputStream? = null,
        val contentType: String = "application/octet-stream",
        val headers: Map<String, String> = emptyMap()
    )

    internal fun interceptPendingResource(
        url: String, file: File?, currentId: String?, expectedId: String?, method: String = "GET"
    ): StreamResponse? {
        if (url != STREAM_URL) return null
        if (method != "GET") return StreamResponse(405, "Method Not Allowed")
        return try {
            if (file == null || !file.isFile) {
                StreamResponse(404, "Not Found")
            } else if (expectedId.isNullOrBlank() || expectedId != currentId) {
                StreamResponse(409, "Conflict")
            } else {
                StreamResponse(200, "OK", file.inputStream())
            }
        } catch (_: Exception) {
            StreamResponse(500, "Internal Server Error")
        }
    }

    private const val CACHE_DIR = "replay"
    private const val BUFFER = 8192
    internal const val MAX_BYTES = 25L * 1024 * 1024

    private const val PREFS_NAME = "replay_pending"
    private const val KEY_METADATA = "metadata"

    internal const val PENDING_ID_MIN_LENGTH = 8
    internal const val PENDING_ID_MAX_LENGTH = 64

    internal const val PENDING_TTL_MS = 60L * 60 * 1000

    private const val METADATA_VERSION = "1"

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
        if (!displayName.lowercase().endsWith(".wotbreplay")) return null

        val size = querySize(resolver, uri)
        val pendingId = newPendingId()
        val createdAt = System.currentTimeMillis()
        val file = copyToCache(context, resolver, uri, pendingId) ?: return null
        val fileUri = FileProvider.getUriForFile(context, fileProviderAuthority(context), file)
        return PendingReplay(pendingId, displayName, file, fileUri, size, createdAt)
    }


    @SuppressLint("ApplySharedPref")
    fun savePendingMetadata(context: Context, pending: PendingReplay) {
        val metadata = ReplayPendingMetadata(
            pendingId = pending.pendingId,
            cacheFilename = pending.file.name,
            originalName = pending.name,
            size = pending.size,
            createdAt = pending.createdAt
        )
        metadataPrefs(context).edit().putString(KEY_METADATA, encodeMetadata(metadata)).commit()
    }

    @SuppressLint("ApplySharedPref")
    fun clearPendingMetadata(context: Context) {
        metadataPrefs(context).edit().remove(KEY_METADATA).commit()
    }

    fun restorePending(context: Context): PendingReplay? {
        val raw = metadataPrefs(context).getString(KEY_METADATA, null) ?: return null
        val metadata = decodeMetadata(raw)
        val file = resolveRestorableBackingFile(metadata, cacheDir(context), System.currentTimeMillis())
        if (metadata == null || file == null) {
            clearPendingMetadata(context)
            return null
        }
        val uri = FileProvider.getUriForFile(context, fileProviderAuthority(context), file)
        return PendingReplay(
            metadata.pendingId,
            metadata.originalName,
            file,
            uri,
            metadata.size,
            metadata.createdAt
        )
    }

    internal fun encodeMetadata(metadata: ReplayPendingMetadata): String = listOf(
        "version=$METADATA_VERSION",
        "pendingId=${metadata.pendingId}",
        "cacheFilename=${metadata.cacheFilename}",
        "originalName=${sanitizeName(metadata.originalName)}",
        "size=${metadata.size}",
        "createdAt=${metadata.createdAt}"
    ).joinToString("\n")

    internal fun decodeMetadata(raw: String?): ReplayPendingMetadata? {
        if (raw.isNullOrEmpty()) return null
        val fields = LinkedHashMap<String, String>()
        for (line in raw.split('\n')) {
            val separator = line.indexOf('=')
            if (separator <= 0) return null
            val key = line.substring(0, separator)
            if (fields.put(key, line.substring(separator + 1)) != null) return null
        }
        if (fields["version"] != METADATA_VERSION) return null
        val pendingId = fields["pendingId"] ?: return null
        val cacheFilename = fields["cacheFilename"] ?: return null
        val originalName = fields["originalName"] ?: return null
        val size = fields["size"]?.toLongOrNull() ?: return null
        val createdAt = fields["createdAt"]?.toLongOrNull() ?: return null
        if (pendingId.isBlank()) return null
        if (pendingId.length !in PENDING_ID_MIN_LENGTH..PENDING_ID_MAX_LENGTH) return null
        if (!isSafeCacheFilename(cacheFilename)) return null
        if (size < 0L) return null
        if (createdAt <= 0L) return null
        return ReplayPendingMetadata(pendingId, cacheFilename, originalName, size, createdAt)
    }

    internal fun isExpired(createdAt: Long, now: Long): Boolean = now - createdAt >= PENDING_TTL_MS

    internal fun resolveRestorableBackingFile(
        metadata: ReplayPendingMetadata?,
        dir: File,
        now: Long
    ): File? {
        if (metadata == null) return null
        if (isExpired(metadata.createdAt, now)) return null
        val file = File(dir, metadata.cacheFilename)
        if (!file.isFile) return null
        return file
    }


    fun cleanupOrphans(context: Context, activeFile: File?) {
        cleanupOrphansInDir(cacheDir(context), activeFile)
    }

    internal fun cleanupOrphansInDir(dir: File, activeFile: File?) {
        if (!dir.isDirectory) return
        val keep = activeFile?.absolutePath
        dir.listFiles()?.forEach { candidate ->
            if (keep != null && candidate.absolutePath == keep) return@forEach
            candidate.delete()
        }
    }


    private fun copyToCache(
        context: Context,
        resolver: ContentResolver,
        uri: Uri,
        pendingId: String
    ): File? {
        val dir = cacheDir(context).apply { mkdirs() }
        val file = File(dir, "replay-$pendingId.wotbreplay")
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

    private fun sanitizeName(name: String): String = name.replace('\r', ' ').replace('\n', ' ')

    private fun isSafeCacheFilename(name: String): Boolean {
        if (name.isBlank() || name.length > 128) return false
        if (name.contains('/') || name.contains('\\')) return false
        if (name.contains("..")) return false
        return true
    }

    private fun metadataPrefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun cacheDir(context: Context): File = File(context.cacheDir, CACHE_DIR)

    private fun fileProviderAuthority(context: Context): String = "${context.packageName}.fileprovider"

    internal fun newPendingId(): String = UUID.randomUUID().toString()
}
