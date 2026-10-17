package com.wotbtools.app

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import android.webkit.MimeTypeMap
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.UUID

/** Disposable chooser files; independent of external replay pending and folder ownership. */
internal object FilePickerCache {
    internal const val TTL_MS = 24L * 60 * 60 * 1000
    private const val TAG = "WotbPicker"

    fun spool(resolver: ContentResolver, uri: Uri, directory: File): File {
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
        val extension = try {
            resolver.getType(uri)?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) }
        } catch (_: Exception) { null }
        val fallback = "picked-file" + (extension?.let { ".$it" } ?: "")
        Log.d(TAG, "picker-copy-start scheme=${uri.scheme} authority=${uri.authority} declared=$size")
        return copy(directory, name?.takeIf { it.isNotBlank() } ?: fallback, { resolver.openInputStream(uri) }) { event ->
            // No provider paths, names, bytes or exception messages in logs.
            Log.d(TAG, event)
        }.also { Log.d(TAG, "picker-copy-success bytes=${it.length()}") }
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
    internal fun copy(directory: File, name: String, open: () -> InputStream?, log: (String) -> Unit = {}): File {
        val selection = File(directory, UUID.randomUUID().toString())
        var phase = "write"
        try {
            if (!selection.mkdirs()) throw IOException("Cannot create picker cache")
            val file = File(selection, safeName(name))
            phase = "open"
            val input = open() ?: throw IOException("No picker stream")
            input.use {
                phase = "write"
                file.outputStream().use { output ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        phase = "read"
                        val count = it.read(buffer)
                        if (count < 0) break
                        phase = "write"
                        output.write(buffer, 0, count)
                    }
                    phase = "write"
                }
                phase = "read"
            }
            if (file.length() == 0L) {
                phase = "empty"
                throw IOException("Empty picker stream")
            }
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
