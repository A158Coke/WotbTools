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

/** 本机 origin 按需绑定；绑定失败（端口被占用）返回 false，由调用方显示错误页，「重新加载」会再试一次。 */
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

/**
 * 本机 origin 的全部路由（取代 2.x 的 WebView shouldInterceptRequest），在 server worker 线程运行。
 * 合成 replay resource 的 exact URL 优先，其次 3D 资产代理，其余是 APK bundle；
 * 缺失的本地资源返回本地 404，绝不落到网络。
 */
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
    // 3D 资产（/agent-assets/*）由 Native 直连对象存储并做 ETag 磁盘缓存，
    // 不经生产网关反代（AgentAssetProxy 类注释有完整背景与约束）。
    if (request.path.startsWith(AgentAssetProxy.LOCAL_PATH_PREFIX)) {
        return if (request.method == "GET") AgentAssetProxy.intercept(applicationContext, request.path)
        else ReplayIntentHandler.StreamResponse(405, "Method Not Allowed", headers = LocalRuntimeServer.NO_STORE)
    }
    // Vite base=/：URL path 映射到 APK assets/web/<path>。
    val asset = if (request.path == "/") "index.html" else request.path.substring(1)
    openBundledAsset(asset)?.let { return bundledResponse(asset, it) }
    // History navigation is owned by Vue Router：无扩展名的未知路径回落同一个 index。
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

/** Vite 的 `assets/` 产物带内容哈希，可长期缓存；入口与其它文件每次重新校验。 */
internal fun MainActivity.bundledResponse(path: String, data: InputStream) = ReplayIntentHandler.StreamResponse(
    200, "OK", data, LocalRuntimeServer.contentTypeFor(path),
    mapOf("Cache-Control" to if (path.startsWith("assets/")) "public, max-age=31536000, immutable" else "no-cache")
)

/** 无可用浏览器时同样阻断：宁可停在这一页，也不在引擎内加载非本机 origin。 */
internal fun MainActivity.openExternal(uri: String) {
    try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)))
    } catch (_: Exception) {
        // 没有可处理的 Activity：保持当前页面。
    }
}

/**
 * HTML Fullscreen API：Gecko 在 GeckoView 内渲染 fullscreen element，经 onFullScreen 通知宿主；
 * 这里只切换系统 UI 与方向（方向只在手机上锁横屏）。BattlePlayback 继续使用标准 requestFullscreen()，
 * 不需要 Android 专用前端分支，也不会 reset playback state。
 */
internal fun MainActivity.enterFullscreen() {
    if (fullscreen) return
    fullscreen = true
    fullscreenPreviousSystemUiVisibility = window.decorView.systemUiVisibility
    // 只在手机上锁横屏（design-language §9「强制横屏」）；平板保持系统方向。页面方向锁（如回放查看器的竖屏锁）由状态机保存并在退出时还原
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
