package com.wotbtools.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import android.view.View
import com.wotbtools.app.MainActivity.Companion.LOCAL_APP_ORIGIN
import com.wotbtools.app.MainActivity.Companion.TAG
import java.io.IOException
import java.io.InputStream
import org.mozilla.geckoview.GeckoView

internal fun MainActivity.ensureLocalServer(): Boolean {
    if (localServer != null) return true
    val server = LocalRuntimeServer(LOCAL_APP_ORIGIN, ::serveLocalRequest)
    return try {
        server.start()
        localServer = server
        true
    } catch (e: IOException) {
        Log.w(TAG, "local runtime bind failed category=${e.javaClass.simpleName}")
        server.close()
        false
    }
}

internal fun MainActivity.serveLocalRequest(request: LocalRuntimeServer.Request): ReplayIntentHandler.StreamResponse {
    val url = LOCAL_APP_ORIGIN + request.path
    if (url == ReplayFolderPicker.STREAM_URL) {
        return replayFolderPicker.interceptFolderResource(
            url,
            request.headers[ReplayFolderPicker.SELECTION_IDENTITY_HEADER.lowercase()],
            request.headers[ReplayFolderPicker.FILE_IDENTITY_HEADER.lowercase()],
            request.method
        ) { treeUri, documentId ->
            contentResolver.openInputStream(
                DocumentsContract.buildDocumentUriUsingTree(Uri.parse(treeUri), documentId)
            )
        }?.copy(headers = LocalRuntimeServer.NO_STORE) ?: error("Synthetic folder resource must be Native-owned")
    }
    if (url == ReplayIntentHandler.STREAM_URL) {
        Log.d(TAG, "replay-pending stream requested")
        val pending = pendingReplay?.takeIf { pendingReplayEligible }
        val response = ReplayIntentHandler.interceptPendingResource(
            url, pending?.file, pending?.pendingId,
            request.headers[ReplayIntentHandler.IDENTITY_HEADER.lowercase()], request.method
        ) ?: error("Synthetic replay resource must be Native-owned")
        val event = when (response.status) {
            200 -> "served"
            404 -> "missing"
            else -> "failed"
        }
        Log.d(TAG, "replay-pending stream $event status=${response.status} ref=${pendingLogRef(pending?.pendingId)}")
        return response.copy(headers = LocalRuntimeServer.NO_STORE)
    }
    if (request.path.startsWith(AgentAssetProxy.LOCAL_PATH_PREFIX)) {
        return if (request.method == "GET") AgentAssetProxy.intercept(applicationContext, request.path)
        else ReplayIntentHandler.StreamResponse(405, "Method Not Allowed", headers = LocalRuntimeServer.NO_STORE)
    }
    val asset = if (request.path == "/") "index.html" else request.path.substring(1)
    openBundledAsset(asset)?.let { return bundledResponse(asset, it) }
    if ('.' !in asset.substringAfterLast('/')) {
        openBundledAsset("index.html")?.let { return bundledResponse("index.html", it) }
    }
    return ReplayIntentHandler.StreamResponse(404, "Not Found", headers = LocalRuntimeServer.NO_STORE)
}

internal fun MainActivity.openBundledAsset(path: String): InputStream? = try {
    assets.open("web/$path")
} catch (_: IOException) {
    null
}

internal fun MainActivity.bundledResponse(path: String, data: InputStream) = ReplayIntentHandler.StreamResponse(
    200, "OK", data, LocalRuntimeServer.contentTypeFor(path),
    mapOf("Cache-Control" to if (path.startsWith("assets/")) "public, max-age=31536000, immutable" else "no-cache")
)

internal fun MainActivity.openExternal(uri: String) {
    try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)))
    } catch (_: Exception) {
    }
}

internal fun MainActivity.enterFullscreen() {
    if (fullscreen) return
    fullscreen = true
    fullscreenPreviousSystemUiVisibility = window.decorView.systemUiVisibility
    fullscreenOrientation.enter(requestedOrientation, isPhone())?.let { requestedOrientation = it }
    window.decorView.systemUiVisibility = (
        View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        )
}

internal fun MainActivity.exitFullscreen() {
    if (!fullscreen) return
    fullscreen = false
    fullscreenOrientation.exit()?.let { requestedOrientation = it }
    window.decorView.systemUiVisibility = fullscreenPreviousSystemUiVisibility
}
