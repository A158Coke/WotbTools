package com.wotbtools.app

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import android.provider.DocumentsContract
import android.util.Log
import android.webkit.MimeTypeMap
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.UUID
import java.security.MessageDigest

/** Disposable chooser files; independent of external replay pending and folder ownership. */
internal object FilePickerCache {
    internal const val TTL_MS = 60L * 60 * 1000
    // Infrastructure ceilings exceed Web replay/image validation limits, not business rules.
    internal const val MAX_BATCH_BYTES = 256L * 1024 * 1024
    internal const val MAX_FILES = 128
    private const val TAG = "WotbPicker"

    fun spoolSelection(resolver: ContentResolver, uris: List<Uri>, directory: File): List<File> {
        if (uris.size > MAX_FILES) throw IOException("Picker count limit exceeded")
        val files = mutableListOf<File>()
        var total = 0L
        try {
            uris.forEach { uri ->
                val file = spool(resolver, uri, directory, MAX_BATCH_BYTES - total)
                files.add(file)
                total += file.length()
            }
            return files
        } catch (error: Exception) {
            discard(files)
            throw error
        }
    }

    fun spool(resolver: ContentResolver, uri: Uri, directory: File,
        remainingBytes: Long = MAX_BATCH_BYTES): File {
        var name: String? = null
        var size: Long? = null
        try {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let {
                        name = cursor.getString(it)
                    }
                    cursor.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !cursor.isNull(it) }?.let {
                        size = cursor.getLong(it)
                    }
                }
            }
        } catch (_: Exception) { /* Metadata is optional; the stream is authoritative. */ }
        val modified = try {
            resolver.query(uri, arrayOf(DocumentsContract.Document.COLUMN_LAST_MODIFIED), null, null, null)?.use { cursor ->
                val index = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
                if (cursor.moveToFirst() && index >= 0 && !cursor.isNull(index)) cursor.getLong(index).takeIf { it > 0 } else null
            }
        } catch (_: Exception) { null }
        val extension = try {
            resolver.getType(uri)?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) }
        } catch (_: Exception) { null }
        val fallback = "picked-file" + (extension?.let { ".$it" } ?: "")
        Log.d(TAG, "picker-copy-start scheme=${uri.scheme} authority=${uri.authority} declared=$size")
        return copy(directory, name?.takeIf { it.isNotBlank() } ?: fallback, { resolver.openInputStream(uri) }, maxBytes = minOf(ReplayIntentHandler.MAX_BYTES, remainingBytes), modified = modified, log = { event ->
            // No provider paths, names, bytes or exception messages in logs.
            Log.d(TAG, event)
        }).also { Log.d(TAG, "picker-copy-success bytes=${it.length()}") }
    }

    /** Keep the original basename (and suffix) inside a unique private directory. */
    internal fun safeName(name: String): String {
        val clean = name.map { if (it == '/' || it == '\\' || it.isISOControl()) '_' else it }.joinToString("")
            .trim().takeUnless { it.isEmpty() || it == "." || it == ".." } ?: "picked-file"
        // Bound UTF-8 filename bytes while preserving a reasonable final extension.
        if (clean.toByteArray(Charsets.UTF_8).size <= 200) return clean
        val suffix = clean.substringAfterLast('.', "").takeIf { it.length in 1..20 }?.let { ".$it" } ?: ""
        var stem = clean.removeSuffix(suffix)
        while ((stem + suffix).toByteArray(Charsets.UTF_8).size > 200) stem = stem.dropLast(1)
        return stem + suffix
    }

    /** Own stream opening and partial outputs, including failures before a stream is available. */
    internal fun copy(directory: File, name: String, open: () -> InputStream?, log: (String) -> Unit = {},
        maxBytes: Long = ReplayIntentHandler.MAX_BYTES, modified: Long? = null): File {
        val selection = File(directory, UUID.randomUUID().toString())
        var phase = "write"
        try {
            if (!selection.mkdirs()) throw IOException("Cannot create picker cache")
            val file = File(selection, safeName(name))
            phase = "open"
            val input = open() ?: throw IOException("No picker stream")
            val digest = MessageDigest.getInstance("SHA-256")
            var copied = 0L
            input.use {
                phase = "write"
                file.outputStream().use { output ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        phase = "read"
                        val count = it.read(buffer)
                        if (count < 0) break
                        if (count.toLong() > maxBytes - copied) throw IOException("Picker byte limit exceeded")
                        phase = "write"
                        output.write(buffer, 0, count)
                        digest.update(buffer, 0, count)
                        copied += count
                    }
                    phase = "write"
                }
                phase = "read"
            }
            if (file.length() == 0L) {
                phase = "empty"
                throw IOException("Empty picker stream")
            }
            // Stable unknown-mtime fallback also distinguishes changed bytes with the same name/size.
            val fallbackTime = 946684800000L + digest.digest().take(6)
                .fold(0L) { value, byte -> (value shl 8) or (byte.toLong() and 255) } % (30L * 365 * 24 * 60 * 60 * 1000)
            if (!file.setLastModified(modified ?: fallbackTime)) throw IOException("Cannot preserve picker timestamp")
            return file
        } catch (error: Exception) {
            selection.deleteRecursively()
            log("picker-copy-${if (phase == "empty") "empty" else "$phase-failed"} exception=${error.javaClass.simpleName}")
            throw error
        }
    }

    internal fun discard(files: List<File>) {
        files.forEach { it.delete(); it.parentFile?.delete() }
    }

    /** Never evict a fresh confirmed DOM File merely because another chooser opens. */
    fun cleanup(directory: File, now: Long = System.currentTimeMillis()) {
        directory.listFiles()?.filter { now - it.lastModified() >= TTL_MS }?.forEach { it.deleteRecursively() }
    }
}
