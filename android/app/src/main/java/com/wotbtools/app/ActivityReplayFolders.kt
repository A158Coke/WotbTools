package com.wotbtools.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import com.wotbtools.app.MainActivity.Companion.PICKER_REQUEST_MAX
import com.wotbtools.app.MainActivity.Companion.PICKER_REQUEST_MIN
import com.wotbtools.app.MainActivity.Companion.REPLAY_FOLDER_LIFETIME_MS
import com.wotbtools.app.MainActivity.Companion.nextPickerRequestCode
import com.wotbtools.app.MainActivity.FolderPickRequest
import java.io.IOException
import org.json.JSONArray
import org.json.JSONObject

internal fun MainActivity.pickReplayFolder(requestId: String?, reply: (JSONObject) -> Unit) {
    runOnUiThread {
        val clientRequestId = requestId?.takeIf { ReplayFolderPicker.validClientRequestId(it) }
        if (clientRequestId == null || destroyedRuntime || isDestroyed || filePrompt != null || downloadInFlight || downloadSave != null) {
            reply(folderPickJson("failed"))
            return@runOnUiThread
        }
        val generation = replayFolderPicker.begin()
        if (generation == null) {
            reply(folderPickJson("failed"))
            return@runOnUiThread
        }
        val requestCode = nextPickerRequestCode.getAndIncrement()
        if (requestCode !in PICKER_REQUEST_MIN..PICKER_REQUEST_MAX) {
            replayFolderPicker.complete(generation, null)
            reply(folderPickJson("failed"))
            return@runOnUiThread
        }
        val request = FolderPickRequest(generation, clientRequestId, requestCode, reply)
        folderPickRequest = request
        request.lifetimeTimeout = Runnable { expireFolderPick(request) }.also {
            folderTimeoutHandler.postDelayed(it, REPLAY_FOLDER_LIFETIME_MS)
        }
        request.pickerOpen = true
        try {
            startActivityForResult(
                Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                request.requestCode
            )
        } catch (_: Exception) {
            finishFolderPick(request, "failed")
        }
    }
}

internal fun MainActivity.cancelReplayFolderPicker(requestId: String?, reply: (Boolean) -> Unit) {
    runOnUiThread {
        val request = folderPickRequest
        if (request == null || destroyedRuntime || isDestroyed ||
            !ReplayFolderPicker.ownsClientRequest(request.clientRequestId, requestId)
        ) {
            reply(false)
            return@runOnUiThread
        }
        reply(abortFolderPick(request, "cancelled"))
    }
}

internal fun MainActivity.releaseReplayFolderSelection(selectionId: String?): Boolean =
    replayFolderPicker.release(selectionId)

internal fun MainActivity.scanReplayFolder(treeUri: Uri, request: FolderPickRequest): ReplayFolderPicker.Selection {
    if (treeUri.scheme != "content" || !DocumentsContract.isTreeUri(treeUri)) {
        throw IOException("Invalid directory selection")
    }
    val columns = arrayOf(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED
    )
    return ReplayFolderPicker.enumerate(
        treeUri.toString(), DocumentsContract.getTreeDocumentId(treeUri),
        visitChildren = { documentId, emit ->
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId)
            val cursor = contentResolver.query(
                childrenUri, columns, null, null, null, request.cancellation
            ) ?: throw IOException("Directory query unavailable")
            cursor.use {
                val idColumn = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
                val nameColumn = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                val mimeColumn = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
                val sizeColumn = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_SIZE)
                val modifiedColumn = it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
                while (it.moveToNext()) {
                    request.cancellation.throwIfCanceled()
                    val mime = it.getString(mimeColumn)
                        ?: throw IOException("Document type unavailable")
                    emit(ReplayFolderPicker.Document(
                        it.getString(idColumn) ?: throw IOException("Document identity unavailable"),
                        it.getString(nameColumn) ?: throw IOException("Document name unavailable"),
                        mime == DocumentsContract.Document.MIME_TYPE_DIR,
                        if (it.isNull(sizeColumn)) null else it.getLong(sizeColumn),
                        if (it.isNull(modifiedColumn)) 0L else it.getLong(modifiedColumn)
                    ))
                }
            }
        },
        cancelled = { request.cancellation.isCanceled || !replayFolderPicker.isActive(request.generation) }
    )
}

internal fun MainActivity.finishFolderPick(
    request: FolderPickRequest,
    status: String,
    selection: ReplayFolderPicker.Selection? = null
): Boolean {
    if (folderPickRequest !== request || destroyedRuntime || isDestroyed) return false
    if (!replayFolderPicker.complete(request.generation, selection)) return false
    folderPickRequest = null
    cancelFolderPickWork(request)
    request.reply(folderPickJson(status, selection))
    return true
}

internal fun MainActivity.expireFolderPick(request: FolderPickRequest) {
    abortFolderPick(request, "failed")
}

internal fun MainActivity.abortFolderPick(request: FolderPickRequest, status: String): Boolean {
    val closePicker = request.pickerOpen
    if (!finishFolderPick(request, status)) return false
    if (closePicker) {
        try {
            finishActivity(request.requestCode)
        } catch (_: Exception) {
        }
    }
    return true
}

internal fun MainActivity.cancelFolderPickWork(request: FolderPickRequest) {
    request.lifetimeTimeout?.let { folderTimeoutHandler.removeCallbacks(it) }
    request.scanTimeout?.let { folderTimeoutHandler.removeCallbacks(it) }
    request.lifetimeTimeout = null
    request.scanTimeout = null
    request.scanTask?.cancel(true)
    request.scanTask = null
    request.cancellation.cancel()
}

internal fun MainActivity.folderPickJson(status: String, selection: ReplayFolderPicker.Selection? = null): JSONObject {
    val files = JSONArray()
    selection?.files?.forEach { file ->
        files.put(JSONObject()
            .put("fileId", file.fileId)
            .put("name", file.name)
            .put("relativePath", file.relativePath)
            .put("size", file.size ?: JSONObject.NULL)
            .put("lastModified", file.lastModified))
    }
    return JSONObject()
        .put("status", status)
        .put("selectionId", selection?.selectionId ?: JSONObject.NULL)
        .put("files", files)
}
