package com.wotbtools.app

import java.io.IOException
import java.io.InputStream
import java.util.Collections
import java.util.UUID

/**
 * Temporary SAF directory selection, isolated from the durable external pending replay.
 * Platform query/open boundaries are lambdas so traversal and ownership are real JVM-testable logic.
 */
internal class ReplayFolderPicker {
    internal data class Document(
        val documentId: String,
        val name: String,
        val directory: Boolean,
        val size: Long?,
        val lastModified: Long
    )

    internal data class FolderFile(
        val fileId: String,
        val name: String,
        val relativePath: String,
        val size: Long?,
        val lastModified: Long,
        val documentId: String
    )

    internal class Selection(
        val selectionId: String,
        val treeUri: String,
        files: List<FolderFile>
    ) {
        val files: List<FolderFile> = Collections.unmodifiableList(ArrayList(files))
        internal val filesById: Map<String, FolderFile> =
            Collections.unmodifiableMap(this.files.associateBy { it.fileId })
    }

    private var nextRequestId = 0L
    private var activeRequestId: Long? = null
    private var currentSelection: Selection? = null
    private var destroyed = false

    /** One picker/scan at a time; a cancelled picker preserves the prior readable selection. */
    @Synchronized fun begin(): Long? {
        if (destroyed || activeRequestId != null) return null
        return (++nextRequestId).also { activeRequestId = it }
    }

    @Synchronized fun isActive(requestId: Long): Boolean =
        !destroyed && activeRequestId == requestId

    /** Reject late scans before they can replace a more recent selection. */
    @Synchronized fun complete(requestId: Long, selection: Selection?): Boolean {
        if (!isActive(requestId)) return false
        activeRequestId = null
        if (selection != null) currentSelection = selection
        return true
    }

    /** Only the exact selection identity may release this transient read window. */
    @Synchronized fun release(selectionId: String?): Boolean {
        if (selectionId.isNullOrBlank() || currentSelection?.selectionId != selectionId) return false
        currentSelection = null
        return true
    }

    @Synchronized fun destroy() {
        destroyed = true
        activeRequestId = null
        currentSelection = null
    }

    @Synchronized private fun owns(selection: Selection): Boolean =
        !destroyed && currentSelection === selection

    /** Exact resource requests always return a Native decision, including all failure cases. */
    internal fun interceptFolderResource(
        url: String,
        expectedSelectionId: String?,
        expectedFileId: String?,
        method: String = "GET",
        open: (treeUri: String, documentId: String) -> InputStream?
    ): ReplayIntentHandler.StreamResponse? {
        if (url != STREAM_URL) return null
        if (method != "GET") return ReplayIntentHandler.StreamResponse(405, "Method Not Allowed")
        val selection = synchronized(this) { currentSelection }
            ?: return ReplayIntentHandler.StreamResponse(404, "Not Found")
        if (expectedSelectionId.isNullOrBlank() || expectedSelectionId != selection.selectionId ||
            expectedFileId.isNullOrBlank()
        ) return ReplayIntentHandler.StreamResponse(409, "Conflict")
        val file = selection.filesById[expectedFileId]
            ?: return ReplayIntentHandler.StreamResponse(404, "Not Found")
        if (file.size != null && file.size > ReplayIntentHandler.MAX_BYTES) {
            return ReplayIntentHandler.StreamResponse(413, "Payload Too Large")
        }
        return try {
            val input = open(selection.treeUri, file.documentId)
                ?: return ReplayIntentHandler.StreamResponse(500, "Internal Server Error")
            if (!owns(selection)) {
                input.close()
                ReplayIntentHandler.StreamResponse(409, "Conflict")
            } else {
                ReplayIntentHandler.StreamResponse(
                    200, "OK", boundedStream(input, ReplayIntentHandler.MAX_BYTES) { owns(selection) }
                )
            }
        } catch (_: Exception) {
            ReplayIntentHandler.StreamResponse(500, "Internal Server Error")
        }
    }

    companion object {
        internal const val STREAM_URL = MainActivity.REPLAY_FOLDER_STREAM_URL
        internal const val SELECTION_IDENTITY_HEADER = MainActivity.REPLAY_FOLDER_SELECTION_IDENTITY_HEADER
        internal const val FILE_IDENTITY_HEADER = MainActivity.REPLAY_FOLDER_FILE_IDENTITY_HEADER
        // Provider safety bounds, independent of the shared Web replay count/size rules.
        internal const val MAX_SCAN_ENTRIES = 10_000
        internal const val MAX_RETAINED_METADATA_CHARS = 1_000_000
        internal const val MAX_CLIENT_REQUEST_ID_LENGTH = 128
        private const val MAX_METADATA_LENGTH = 8192

        internal fun validClientRequestId(requestId: String?): Boolean =
            !requestId.isNullOrBlank() && requestId.length <= MAX_CLIENT_REQUEST_ID_LENGTH

        /** Client cancellation owns only the exact in-flight request, never a prefix or completed selection. */
        internal fun ownsClientRequest(currentRequestId: String?, expectedRequestId: String?): Boolean =
            validClientRequestId(currentRequestId) && validClientRequestId(expectedRequestId) &&
                currentRequestId == expectedRequestId

        /**
         * Iterative traversal avoids stack exhaustion. Each cursor row is counted before retention,
         * including duplicates/cycles; the provider adapter emits rows directly, never a child list.
         * Any provider failure/cancellation/bound aborts the whole selection without publishing it.
         */
        internal fun enumerate(
            treeUri: String,
            rootDocumentId: String,
            visitChildren: (documentId: String, emit: (Document) -> Unit) -> Unit,
            cancelled: () -> Boolean = { false }
        ): Selection {
            if (treeUri.isBlank() || treeUri.length > MAX_METADATA_LENGTH ||
                rootDocumentId.isBlank() || rootDocumentId.length > MAX_METADATA_LENGTH
            ) throw IOException("Invalid directory metadata")
            val selectionId = UUID.randomUUID().toString()
            var retainedChars = treeUri.length + rootDocumentId.length + selectionId.length
            val visited = HashSet<String>().apply { add(rootDocumentId) }
            val directories = ArrayDeque<Pair<String, String>>().apply { add(rootDocumentId to "") }
            val files = ArrayList<FolderFile>()
            var scanned = 0
            fun checkCancelled() {
                if (cancelled() || Thread.currentThread().isInterrupted) {
                    throw IOException("Directory scan cancelled")
                }
            }
            while (directories.isNotEmpty()) {
                checkCancelled()
                val (documentId, parentPath) = directories.removeLast()
                visitChildren(documentId) { document ->
                    checkCancelled()
                    if (++scanned > MAX_SCAN_ENTRIES) throw IOException("Directory scan limit exceeded")
                    if (document.documentId.isBlank() || document.documentId.length > MAX_METADATA_LENGTH ||
                        document.name.isBlank() || document.name.length > MAX_METADATA_LENGTH
                    ) throw IOException("Invalid document metadata")
                    if (document.documentId in visited) return@visitChildren
                    val pathLength = document.name.length + if (parentPath.isEmpty()) 0 else parentPath.length + 1
                    if (pathLength > MAX_METADATA_LENGTH) throw IOException("Directory path limit exceeded")
                    val fileId = if (document.directory) "" else UUID.randomUUID().toString()
                    // Conservatively count every retained identity/name/path field, even shared strings.
                    // Check before retaining the id or constructing an accumulated relative path.
                    val rowChars = document.documentId.length + document.name.length + pathLength + fileId.length
                    if (rowChars > MAX_RETAINED_METADATA_CHARS - retainedChars) {
                        throw IOException("Directory metadata budget exceeded")
                    }
                    retainedChars += rowChars
                    visited.add(document.documentId)
                    val path = if (parentPath.isEmpty()) document.name else "$parentPath/${document.name}"
                    if (document.directory) {
                        directories.add(document.documentId to path)
                    } else {
                        files.add(FolderFile(
                            fileId, document.name, path,
                            document.size?.takeIf { it >= 0L }, document.lastModified.coerceAtLeast(0L),
                            document.documentId
                        ))
                    }
                }
            }
            checkCancelled()
            return Selection(selectionId, treeUri, files)
        }

        /** Count actual bytes even when a provider omits or lies about SIZE; never truncate silently. */
        internal fun boundedStream(
            input: InputStream,
            maxBytes: Long,
            stillOwned: () -> Boolean = { true }
        ): InputStream {
            require(maxBytes >= 0L)
            return object : InputStream() {
                private var total = 0L
                private var closed = false

                private fun ensureReadable() {
                    if (closed) throw IOException("Directory stream closed")
                    if (!stillOwned()) {
                        close()
                        throw IOException("Directory selection released")
                    }
                }

                override fun read(): Int {
                    ensureReadable()
                    return try {
                        val byte = input.read()
                        if (byte != -1 && total++ >= maxBytes) {
                            throw IOException("Directory stream limit exceeded")
                        }
                        byte
                    } catch (failure: Exception) {
                        closeAfterFailure()
                        throw failure
                    }
                }

                override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                    if (offset < 0 || length < 0 || offset > buffer.size - length) {
                        throw IndexOutOfBoundsException()
                    }
                    if (length == 0) return 0
                    ensureReadable()
                    return try {
                        val remaining = maxBytes - total
                        // The extra byte detects an oversize source, including a false/unknown SIZE.
                        val requested = minOf(length.toLong(), remaining + 1L).toInt()
                        val read = input.read(buffer, offset, requested)
                        if (read > remaining) throw IOException("Directory stream limit exceeded")
                        if (read > 0) total += read
                        read
                    } catch (failure: Exception) {
                        closeAfterFailure()
                        throw failure
                    }
                }

                private fun closeAfterFailure() {
                    try { close() } catch (_: Exception) { /* Preserve the read failure. */ }
                }

                override fun close() {
                    if (closed) return
                    closed = true
                    input.close()
                }
            }
        }
    }
}
