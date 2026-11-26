package com.wotbtools.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import com.wotbtools.app.MainActivity.Companion.PICKER_REQUEST_MAX
import com.wotbtools.app.MainActivity.Companion.PICKER_REQUEST_MIN
import com.wotbtools.app.MainActivity.Companion.REPLAY_FOLDER_SCAN_TIMEOUT_MS
import com.wotbtools.app.MainActivity.Companion.TAG
import com.wotbtools.app.MainActivity.Companion.extendedDownloadName
import com.wotbtools.app.MainActivity.Companion.nextPickerRequestCode
import com.wotbtools.app.MainActivity.Companion.spoolDownload
import java.io.File
import java.io.IOException
import org.mozilla.geckoview.GeckoSession.PromptDelegate
import org.mozilla.geckoview.WebResponse

internal fun MainActivity.saveExternalResponse(response: WebResponse) {
    val body = response.body ?: run { toast(getString(R.string.download_failed)); return }
    if (destroyedRuntime || downloadInFlight || filePrompt != null || folderPickRequest != null || downloadSave != null) {
        try { body.close() } catch (_: IOException) { }
        if (!destroyedRuntime) toast(getString(R.string.download_busy))
        return
    }
    downloadInFlight = true
    try {
        executor.execute {
            var file: File? = null
            try {
                val ready = spoolDownload(body, cacheDir)
                file = ready
                val contentType = response.headers.entries.firstOrNull {
                    it.key.equals("content-type", ignoreCase = true)
                }?.value?.substringBefore(';')?.trim()?.takeIf { '/' in it }
                val disposition = response.headers.entries.firstOrNull {
                    it.key.equals("content-disposition", ignoreCase = true)
                }?.value
                val name = (extendedDownloadName(disposition) ?: URLUtil.guessFileName(response.uri, disposition, contentType))
                    .replace(Regex("""[\\/\p{Cntrl}]"""), "_").trim().take(180)
                    .takeUnless { it.isBlank() || it == "." || it == ".." } ?: "download"
                val mime = contentType ?: MimeTypeMap.getSingleton()
                    .getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
                runOnUiThread {
                    if (destroyedRuntime || filePrompt != null || folderPickRequest != null) {
                        ready.delete()
                        downloadInFlight = false
                        if (!destroyedRuntime) toast(getString(R.string.download_busy))
                        return@runOnUiThread
                    }
                    val code = nextPickerRequestCode.getAndIncrement()
                    try {
                        check(code <= PICKER_REQUEST_MAX)
                        downloadSave = code to ready
                        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT)
                            .addCategory(Intent.CATEGORY_OPENABLE).setType(mime)
                            .putExtra(Intent.EXTRA_TITLE, name), code)
                    } catch (_: Exception) {
                        downloadSave = null
                        ready.delete()
                        downloadInFlight = false
                        toast(getString(R.string.download_failed))
                    }
                }
            } catch (_: Exception) {
                file?.delete()
                runOnUiThread {
                    downloadInFlight = false
                    if (!destroyedRuntime) toast(getString(R.string.download_failed))
                }
            }
        }
    } catch (_: Exception) {
        try { body.close() } catch (_: IOException) { }
        downloadInFlight = false
        if (!destroyedRuntime) toast(getString(R.string.download_failed))
    }
}

internal fun MainActivity.dispatchActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == downloadSave?.first) {
        val file = downloadSave!!.second
        downloadSave = null
        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) {
            file.delete()
            downloadInFlight = false
        } else {
            executor.execute {
                try {
                    contentResolver.openOutputStream(uri, "wt")?.use { output ->
                        file.inputStream().use { it.copyTo(output) }
                    } ?: throw IOException("No document output stream")
                    runOnUiThread { if (!destroyedRuntime) toast(getString(R.string.download_saved)) }
                } catch (_: Exception) {
                    runOnUiThread { if (!destroyedRuntime) toast(getString(R.string.download_failed)) }
                } finally {
                    file.delete()
                    runOnUiThread { downloadInFlight = false }
                }
            }
        }
        return
    }
    if (requestCode == filePrompt?.first) {
        val request = filePrompt ?: return
        if (filePromptCopying) return
        val (_, prompt, result) = request
        val uris = when {
            resultCode == Activity.RESULT_OK && data?.clipData != null ->
                (0 until data.clipData!!.itemCount).map { data.clipData!!.getItemAt(it).uri }
            resultCode == Activity.RESULT_OK && data?.data != null -> listOf(data.data!!)
            else -> emptyList()
        }.let { if (prompt.type == PromptDelegate.FilePrompt.Type.MULTIPLE) it else it.take(1) }
        if (uris.isEmpty()) {
            filePrompt = null
            prompt.setDelegate(null)
            result.complete(prompt.dismiss())
            return
        }
        filePromptCopying = true
        Log.d(TAG, "picker-selected count=${uris.size}")
        try {
            executor.execute {
                val files = mutableListOf<File>()
                val success = try {
                    val directory = File(cacheDir, "file-picker")
                    FilePickerCache.cleanup(directory)
                    files.addAll(FilePickerCache.spoolSelection(contentResolver, uris, directory))
                    true
                } catch (_: Exception) {
                    FilePickerCache.discard(files)
                    files.clear()
                    false
                }
                runOnUiThread {
                    if (filePrompt !== request || destroyedRuntime) {
                        FilePickerCache.discard(files)
                        return@runOnUiThread
                    }
                    filePrompt = null
                    prompt.setDelegate(null)
                    try {
                        val response = when {
                            !success -> prompt.dismiss()
                            prompt.type == PromptDelegate.FilePrompt.Type.MULTIPLE ->
                                prompt.confirm(this, files.map { Uri.fromFile(it) }.toTypedArray())
                            else -> prompt.confirm(this, Uri.fromFile(files.first()))
                        }
                        result.complete(response)
                        Log.d(TAG, "picker-confirm count=${files.size}")
                    } catch (_: Exception) {
                        FilePickerCache.discard(files)
                        result.complete(prompt.dismiss())
                    }
                }
            }
        } catch (_: Exception) {
            filePrompt = null
            prompt.setDelegate(null)
            result.complete(prompt.dismiss())
        }
        return
    }
    if (requestCode in PICKER_REQUEST_MIN..PICKER_REQUEST_MAX) {
        val request = folderPickRequest ?: return
        if (request.requestCode != requestCode || !request.pickerOpen) return
        request.pickerOpen = false
        if (resultCode != Activity.RESULT_OK) {
            finishFolderPick(request, "cancelled")
            return
        }
        val treeUri = data?.data
        if (treeUri == null) {
            finishFolderPick(request, "failed")
            return
        }
        request.scanTimeout = Runnable { expireFolderPick(request) }.also {
            folderTimeoutHandler.postDelayed(it, REPLAY_FOLDER_SCAN_TIMEOUT_MS)
        }
        try {
            request.scanTask = executor.submit {
                val selection = try {
                    scanReplayFolder(treeUri, request)
                } catch (_: Exception) {
                    null
                }
                runOnUiThread {
                    finishFolderPick(request, if (selection == null) "failed" else "selected", selection)
                }
            }
        } catch (_: Exception) {
            finishFolderPick(request, "failed")
        }
        return
    }
    handleAuthorizationIntent(data)
}
