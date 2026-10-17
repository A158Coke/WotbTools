package com.wotbtools.app

import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.provider.Settings
import android.util.Log
import android.view.View
import android.webkit.URLUtil
import android.webkit.MimeTypeMap
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.wotbtools.app.auth.AuthFailureReason
import com.wotbtools.app.auth.AuthManager
import com.wotbtools.app.auth.AuthResult
import org.json.JSONArray
import org.json.JSONObject
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession.PromptDelegate
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebResponse
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicInteger

/**
 * Bundled Vue local-first shell. Native owns OIDC and replay ingress; Vue Router owns views.
 * Pending metadata survives process death and only an identity-matched ACK clears it.
 * Version discovery is bounded best-effort and never delays loading the local document.
 */
class MainActivity : Activity() {

    companion object {
        /**
         * 本机 origin（LocalRuntimeServer）：固定端口让 origin 跨启动稳定（localStorage / CORS 依赖它）。
         * 端口的唯一事实源；contracts/android-native-bridge.json 与前端声明由 android_contract.py 校验一致。
         */
        internal const val LOCAL_APP_ORIGIN = "http://127.0.0.1:21653"
        internal const val LOCAL_APP_ENTRY = LOCAL_APP_ORIGIN + "/index.html"
        internal const val REPLAY_FOLDER_STREAM_URL = MainActivity.LOCAL_APP_ORIGIN + "/__native/replay-folder"
        internal const val REPLAY_FOLDER_SELECTION_IDENTITY_HEADER = "X-Wotb-Folder-Selection-Id"
        internal const val REPLAY_FOLDER_FILE_IDENTITY_HEADER = "X-Wotb-Folder-File-Id"
        // replay canonical view 的 marker 由 ReplayDispatchPolicy 拥有：分发决策所判断的 URL 与这里导航到的
        // URL 共用同一常量，避免两处字面量漂移。
        private const val REPLAY_URL = LOCAL_APP_ENTRY + "?" + ReplayDispatchPolicy.REPLAY_VIEW_MARKER
        private const val PICKER_REQUEST_MIN = 0x2000
        private const val PICKER_REQUEST_MAX = 0xffff
        // All native pickers share this allocator; never reuse a code, including Activity recreation.
        private val nextPickerRequestCode = AtomicInteger(PICKER_REQUEST_MIN)
        private const val REPLAY_FOLDER_LIFETIME_MS = 9L * 60 * 1000
        private const val REPLAY_FOLDER_SCAN_TIMEOUT_MS = 60L * 1000

        /** 日志 tag（导航 / replay / auth 诊断共用）。 */
        private const val TAG = "WotbAuth"

        /** 原生认证变更后推给页面的全局（与 contracts/android-native-bridge.json 的 events 一致）。 */
        private const val AUTH_CHANGED_GLOBAL = "wotbtoolsOnAuthChanged"

        /** 连通性变化后推给页面的全局（与 contracts/android-native-bridge.json 的 events 一致）。 */
        private const val CONNECTIVITY_CHANGED_GLOBAL = "wotbtoolsOnConnectivityChanged"

        /** 已在 replay workspace 时通知页面消费 pending（与 contracts/android-native-bridge.json 的 events 一致）。 */
        private const val REPLAY_GLOBAL = "wotbtoolsOnReplay"

        /** 使用浏览器版（错误页兜底入口）。 */
        private const val WEB_APP_URL = "https://wotbtools.com/"

        /** [LOCAL_APP_ORIGIN] 的 authority；导航与 Bridge sender 校验共用同一份提取（不重复派生）。 */
        internal val LOCAL_APP_AUTHORITY = java.net.URI(LOCAL_APP_ORIGIN).rawAuthority

        /** Only the exact local origin can be the main document or call the Native Bridge. */
        internal fun isLocalAppUrl(url: String): Boolean = try {
            val uri = java.net.URI(url)
            uri.scheme == "http" && uri.rawAuthority == LOCAL_APP_AUTHORITY
        } catch (_: Exception) {
            false
        }

        /** Own the input even when creating or writing the private temp file fails. */
        internal fun spoolDownload(body: InputStream, directory: File): File {
            var file: File? = null
            try {
                return body.use { input ->
                    File.createTempFile("web-download-", ".tmp", directory).also {
                        file = it
                        it.outputStream().use { output -> input.copyTo(output) }
                    }
                }
            } catch (error: Exception) {
                file?.delete()
                throw error
            }
        }

        /** RFC 5987 filename* takes precedence over the legacy filename parameter. */
        internal fun extendedDownloadName(disposition: String?): String? {
            val match = disposition?.let {
                Regex("""(?i)filename\*\s*=\s*(?:"([^"\r\n]*)"|([^;\r\n]*))""").find(it)
            } ?: return null
            val parts = (match.groups[1]?.value ?: match.groups[2]?.value)?.trim()
                ?.split("'", limit = 3)?.takeIf { it.size == 3 } ?: return null
            return try {
                java.net.URLDecoder.decode(parts[2].replace("+", "%2B"), parts[0])
                    .takeIf { it.isNotBlank() }
            } catch (_: Exception) { null }
        }

    }

    private lateinit var runtimeView: GeckoView
    private lateinit var runtime: GeckoWebRuntime
    private var localServer: LocalRuntimeServer? = null
    private lateinit var versionGateView: LinearLayout
    private lateinit var runtimeErrorView: LinearLayout
    private lateinit var versionTitle: TextView
    private lateinit var versionMessage: TextView
    private lateinit var versionCurrent: TextView
    private lateinit var versionLatest: TextView
    private lateinit var runtimeErrorRetryButton: Button
    private lateinit var runtimeErrorBrowserButton: Button
    private lateinit var runtimeErrorDiagnostics: TextView
    private lateinit var versionPrimaryButton: Button
    private lateinit var versionLaterButton: Button
    private lateinit var runtimeErrorTitle: TextView

    private lateinit var apkUpdater: ApkUpdater
    private lateinit var nativeBridge: NativeBridge
    private lateinit var authManager: AuthManager
    private lateinit var connectivityMonitor: ConnectivityMonitor
    private val executor: ExecutorService = Executors.newFixedThreadPool(2)

    @Volatile private var pendingReplay: PendingReplay? = null
    @Volatile private var pendingReplayEligible = true
    @Volatile private var latestManifest: VersionManifest? = null
    private var versionCheckInFlight = false
    @Volatile private var downloadedApk: File? = null
    /** 进行中的普通 `<input type=file>` 选择（Gecko PromptDelegate）；同一时刻只有一个。 */
    private var filePrompt: Triple<Int, PromptDelegate.FilePrompt, GeckoResult<PromptDelegate.PromptResponse>>? = null
    private var filePromptCopying = false
    private var downloadInFlight = false
    private var downloadSave: Pair<Int, File>? = null
    private val replayFolderPicker = ReplayFolderPicker()
    private var folderPickRequest: FolderPickRequest? = null
    private val folderTimeoutHandler = Handler(Looper.getMainLooper())

    private class FolderPickRequest(
        val generation: Long,
        val clientRequestId: String,
        val requestCode: Int,
        val reply: (JSONObject) -> Unit
    ) {
        val cancellation = CancellationSignal()
        var pickerOpen = false
        var lifetimeTimeout: Runnable? = null
        var scanTimeout: Runnable? = null
        var scanTask: Future<*>? = null
    }
    @Volatile private var awaitingUnknownSourcesPermission = false

    /** 引擎是否已销毁：晚到的 bridge 回复 / 页面通知都必须先看这一位。 */
    @Volatile private var destroyedRuntime = false

    /** HTML Fullscreen API：Gecko 经 ContentDelegate.onFullScreen 通知，宿主只管系统 UI 与方向。 */
    private var fullscreen = false
    private var fullscreenPreviousOrientation: Int = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    private var fullscreenPreviousSystemUiVisibility: Int = View.SYSTEM_UI_FLAG_VISIBLE

    /** 认证变更监听：`AuthManager` 的 listener 需要能注销，所以留一个稳定引用。 */
    private val authChangedListener = AuthManager.Listener { notifyAuthChanged() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        executor.execute { FilePickerCache.cleanup(File(cacheDir, "file-picker")) }
        setContentView(R.layout.activity_main)

        runtimeView = findViewById(R.id.runtimeView)
        versionGateView = findViewById(R.id.versionGateView)
        runtimeErrorView = findViewById(R.id.runtimeErrorView)
        versionTitle = findViewById(R.id.versionTitle)
        versionMessage = findViewById(R.id.versionMessage)
        versionCurrent = findViewById(R.id.versionCurrent)
        versionLatest = findViewById(R.id.versionLatest)
        runtimeErrorRetryButton = findViewById(R.id.runtimeErrorRetryButton)
        runtimeErrorBrowserButton = findViewById(R.id.runtimeErrorBrowserButton)
        runtimeErrorDiagnostics = findViewById(R.id.runtimeErrorDiagnostics)
        runtimeErrorTitle = findViewById(R.id.runtimeErrorTitle)
        versionPrimaryButton = findViewById(R.id.versionPrimaryButton)
        versionLaterButton = findViewById(R.id.versionLaterButton)

        apkUpdater = ApkUpdater(this)
        nativeBridge = NativeBridge(this)
        authManager = AuthManager.getInstance(applicationContext, MainActivity::class.java)
        authManager.addListener(authChangedListener)
        // discovery 只预热一次（进程内缓存），让 authLogin 能真正同步启动 external user-agent。
        // 连通性由系统 ConnectivityManager 权威判定；页面经 bridge 读取（绝不看 navigator.onLine）。
        connectivityMonitor = ConnectivityMonitor(this) { notifyConnectivityChanged() }
        connectivityMonitor.start()
        if (connectivityMonitor.state == "online") authManager.warmUp()

        runtimeErrorRetryButton.setOnClickListener { hideAllGates(); loadWeb() }
        runtimeErrorBrowserButton.setOnClickListener { openExternal(WEB_APP_URL) }
        versionPrimaryButton.setOnClickListener { onUpdatePrimary() }
        versionLaterButton.setOnClickListener {
            hideAllGates()
            runtimeView.visibility = View.VISIBLE
            dispatchPendingReplayIfAllowed()
        }

        runtime = GeckoWebRuntime(this, runtimeView, runtimeHost)
        // 冷启动顺序：先恢复 active pending（跨进程重建存活），再清理不再被它引用的 orphan replay cache
        // —— active backing file 绝不能删除。
        val restoredReplay = ReplayIntentHandler.restorePending(this)
        if (restoredReplay != null) {
            pendingReplay = restoredReplay
            pendingReplayEligible = true
            Log.d(TAG, "replay-pending restored ref=${restoredReplay.logRef}")
        }
        ReplayIntentHandler.cleanupOrphans(this, restoredReplay?.file)
        // 冷启动 intent 先看是不是授权回程（external user-agent 回来，进程可能已被重建），
        // 其余一律走 replay ingress。
        if (!handleAuthorizationIntent(intent)) handleIncomingIntent(intent)
        startStartupFlow()
    }

    /** 本机 origin 按需绑定；绑定失败（端口被占用）返回 false，由调用方显示错误页，「重新加载」会再试一次。 */
    private fun ensureLocalServer(): Boolean {
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
    private fun serveLocalRequest(request: LocalRuntimeServer.Request): ReplayIntentHandler.StreamResponse {
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

    private fun openBundledAsset(path: String): InputStream? = try {
        assets.open("web/$path")
    } catch (_: IOException) {
        null
    }

    /** Vite 的 `assets/` 产物带内容哈希，可长期缓存；入口与其它文件每次重新校验。 */
    private fun bundledResponse(path: String, data: InputStream) = ReplayIntentHandler.StreamResponse(
        200, "OK", data, LocalRuntimeServer.contentTypeFor(path),
        mapOf("Cache-Control" to if (path.startsWith("assets/")) "public, max-age=31536000, immutable" else "no-cache")
    )

    private val runtimeHost = object : GeckoWebRuntime.Host {
        override fun onBridgeMessage(json: String, reply: (String) -> Unit) =
            nativeBridge.handleMessage(json, reply)

        /** Main frame stays local; HTTPS/mailto external links use the system browser. */
        override fun onExternalNavigation(uri: String) = openExternal(uri)

        override fun onExternalResponse(response: WebResponse) = saveExternalResponse(response)

        override fun onFullScreen(fullScreen: Boolean) {
            if (fullScreen) enterFullscreen() else exitFullscreen()
        }

        /**
         * 普通 Web file chooser：始终交给 Android 系统 picker（既有 UX 不变）。
         * Android external replay 绝不在这里注入：唯一 ingress 是 Intent → pending cache →
         * Native Bridge → local synthetic fetch → shared local parser.
         */
        override fun onFilePrompt(
            prompt: PromptDelegate.FilePrompt
        ): GeckoResult<PromptDelegate.PromptResponse> {
            if (filePrompt != null || folderPickRequest != null || downloadInFlight || downloadSave != null || destroyedRuntime) {
                return GeckoResult.fromValue(prompt.dismiss())
            }
            val intent = Intent(Intent.ACTION_GET_CONTENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*")
            prompt.mimeTypes?.filter { '/' in it }?.takeIf { it.isNotEmpty() }?.let {
                intent.putExtra(Intent.EXTRA_MIME_TYPES, it.toTypedArray())
            }
            if (prompt.type == PromptDelegate.FilePrompt.Type.MULTIPLE) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
            val result = GeckoResult<PromptDelegate.PromptResponse>()
            val requestCode = nextPickerRequestCode.getAndIncrement()
            if (requestCode > PICKER_REQUEST_MAX) return GeckoResult.fromValue(prompt.dismiss())
            val request = Triple(requestCode, prompt, result)
            filePrompt = request
            filePromptCopying = false
            prompt.setDelegate(object : PromptDelegate.PromptInstanceDelegate {
                override fun onPromptDismiss(dismissed: PromptDelegate.BasePrompt) {
                    if (filePrompt !== request) return
                    filePrompt = null
                    prompt.setDelegate(null)
                    result.complete(dismissed.dismiss())
                    finishActivity(requestCode)
                }
            })
            try {
                startActivityForResult(intent, requestCode)
            } catch (_: Exception) {
                filePrompt = null
                prompt.setDelegate(null)
                result.complete(prompt.dismiss())
            }
            return result
        }

        override fun onRuntimeFailure(crashLoop: Boolean) {
            if (fullscreen) exitFullscreen()
            showRuntimeError(if (crashLoop) R.string.runtime_error_crash_title else R.string.runtime_error_title)
        }
    }

    /** 无可用浏览器时同样阻断：宁可停在这一页，也不在引擎内加载非本机 origin。 */
    private fun openExternal(uri: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)))
        } catch (_: Exception) {
            // 没有可处理的 Activity：保持当前页面。
        }
    }

    /**
     * HTML Fullscreen API：Gecko 在 GeckoView 内渲染 fullscreen element，经 onFullScreen 通知宿主；
     * 这里只切换系统 UI 与方向。BattlePlayback 继续使用标准 requestFullscreen()，
     * 不需要 Android 专用前端分支，也不会 reset playback state。
     */
    private fun enterFullscreen() {
        if (fullscreen) return
        fullscreen = true
        fullscreenPreviousOrientation = requestedOrientation
        fullscreenPreviousSystemUiVisibility = window.decorView.systemUiVisibility
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
    }

    private fun exitFullscreen() {
        if (!fullscreen) return
        fullscreen = false
        requestedOrientation = fullscreenPreviousOrientation
        window.decorView.systemUiVisibility = fullscreenPreviousSystemUiVisibility
    }

    // ── Local startup + bounded best-effort update discovery ──

    private fun startStartupFlow() {
        loadWeb()
        checkForUpdateAsync()
    }

    private fun checkForUpdateAsync() {
        if (connectivityMonitor.state != "online" || versionCheckInFlight) return
        versionCheckInFlight = true
        executor.execute {
            val result = StartupGate.checkVersion()
            runOnUiThread {
                versionCheckInFlight = false
                if (isDestroyed || destroyedRuntime) return@runOnUiThread
                if (result is StartupGate.Result.Ok) onVersionReady(result.manifest)
            }
        }
    }

    private fun onVersionReady(manifest: VersionManifest) {
        latestManifest = manifest
        val installed = installedVersionCode()
        when {
            installed < manifest.minSupportedVersionCode -> showMandatoryUpdate(manifest, installed)
            installed < manifest.latestVersionCode -> showOptionalUpdate(manifest, installed)
            else -> Unit
        }
    }

    /** Entry URL：有 pending replay 就进 replay canonical view，否则首页。认证回程不经这里。 */
    private fun entryUrl(): String = if (pendingReplay != null) REPLAY_URL else LOCAL_APP_ENTRY

    private fun loadWeb() {
        val manifest = latestManifest
        if (manifest != null && installedVersionCode() < manifest.minSupportedVersionCode) {
            showMandatoryUpdate(manifest, installedVersionCode())
            return
        }
        hideAllGates()
        if (!ensureLocalServer()) {
            showRuntimeError(R.string.runtime_error_port_title)
            return
        }
        runtimeView.visibility = View.VISIBLE
        if (runtime.currentUrl.isNullOrEmpty()) {
            runtime.load(entryUrl())
        } else {
            runtime.reload()
        }
    }

    /** 本地运行时错误页：标题说明原因，诊断行可长按复制（引擎 / 设备 / crash 计数，不含账号或回放信息）。 */
    private fun showRuntimeError(titleRes: Int) {
        hideAllGates()
        runtimeErrorTitle.text = getString(titleRes)
        runtimeErrorDiagnostics.text = runtime.diagnostics()
        runtimeErrorView.visibility = View.VISIBLE
        Log.w(TAG, "runtime error ${runtimeErrorDiagnostics.text}")
    }

    private fun showMandatoryUpdate(manifest: VersionManifest, installed: Int) {
        // Best-effort discovery can finish after a local replay entered HTML fullscreen.
        if (fullscreen) runtime.exitFullScreen()
        hideAllGates()
        versionGateView.visibility = View.VISIBLE
        versionTitle.text = getString(R.string.update_mandatory_title)
        versionMessage.text = getString(R.string.update_mandatory_message)
        versionCurrent.text = getString(R.string.update_current_version, installed.toString())
        versionLatest.text = getString(R.string.update_latest_version, manifest.latestVersionName)
        versionPrimaryButton.text = getString(R.string.update_now)
        versionLaterButton.visibility = View.GONE
    }

    private fun showOptionalUpdate(manifest: VersionManifest, installed: Int) {
        hideAllGates()
        versionGateView.visibility = View.VISIBLE
        versionTitle.text = getString(R.string.update_optional_title)
        versionMessage.text = getString(R.string.update_optional_message)
        versionCurrent.text = getString(R.string.update_current_version, installed.toString())
        versionLatest.text = getString(R.string.update_latest_version, manifest.latestVersionName)
        versionPrimaryButton.text = getString(R.string.update_now)
        versionLaterButton.visibility = View.VISIBLE
        versionLaterButton.text = getString(R.string.update_later)
    }

    // ── 更新（fail-closed：SHA-256 必校验；未授权可恢复）──

    private fun onUpdatePrimary() {
        if (!packageManager.canRequestPackageInstalls()) {
            openInstallPermissionSettings()
            return
        }
        startDownload()
    }

    private fun startDownload() {
        val manifest = latestManifest ?: return
        versionPrimaryButton.isEnabled = false
        versionPrimaryButton.text = getString(R.string.update_downloading)
        executor.execute {
            val result = apkUpdater.downloadAndInstall(manifest.apkUrl, manifest.sha256)
            runOnUiThread {
                versionPrimaryButton.isEnabled = true
                versionPrimaryButton.text = getString(R.string.update_now)
                when (result) {
                    is ApkUpdater.Result.Ok -> {
                        downloadedApk = result.apk
                        if (!installDownloadedApk()) openInstallPermissionSettings()
                    }
                    is ApkUpdater.Result.Fail -> toast(result.message)
                }
            }
        }
    }

    private fun installDownloadedApk(): Boolean {
        val apk = downloadedApk ?: return false
        if (!packageManager.canRequestPackageInstalls()) return false
        return apkUpdater.requestInstall(apk)
    }

    private fun openInstallPermissionSettings() {
        awaitingUnknownSourcesPermission = true
        try {
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:$packageName")
                )
            )
        } catch (_: Exception) {
            toast(getString(R.string.update_unknown_source_hint))
        }
    }

    override fun onResume() {
        super.onResume()
        // 后台期间 content 进程被系统回收：回到前台静默重载（不算故障）。
        runtime.onResume()
        // 返回后保持可操作；缺权限时明确提示并可再次点击去授权。
        if (versionGateView.visibility == View.VISIBLE) {
            versionPrimaryButton.isEnabled = true
            versionPrimaryButton.text = getString(R.string.update_now)
            if (awaitingUnknownSourcesPermission) {
                // 仅从「未知来源」授权页返回才自动继续 installer；普通 Package Installer 返回不自动重开。
                awaitingUnknownSourcesPermission = false
                if (downloadedApk != null && packageManager.canRequestPackageInstalls()) {
                    installDownloadedApk()
                } else if (downloadedApk != null) {
                    versionMessage.text = getString(R.string.update_unknown_source_hint)
                }
            }
        }
    }

    // ── Replay 意图生命周期（冷启动 / 热启动 / 后台恢复）──

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // 授权回程（external user-agent 回来）归 auth 所有，绝不进入 replay ingress / 分发。
        if (handleAuthorizationIntent(intent)) return
        handleIncomingIntent(intent)
        dispatchPendingReplayIfAllowed()
    }

    /**
     * pending replay 的唯一分发点。
     *
     * 「是否分发 / 怎么分发」完全由纯策略 [ReplayDispatchPolicy] 决定（JVM 单测覆盖），这里只执行动作：
     * 无 pending / 页面不可见（门禁 / 错误 / 更新页接管中）→ 不分发；已在 replay workspace → 通知 Web；
     * 否则切到 replay canonical view。认证不再参与这个决策：登录在 external user-agent 里进行，不会占用
     * 页面导航，因此 replay 无需为 auth 让路。登录完成后 Web 应用就地同步认证状态，并经 Native Bridge
     * 自行消费 pending。
     */
    private fun dispatchPendingReplayIfAllowed() {
        val action = ReplayDispatchPolicy.decide(
            hasPendingReplay = pendingReplay != null,
            webViewVisible = runtimeView.visibility == View.VISIBLE,
            currentUrl = runtime.currentUrl
        )
        if (action == ReplayDispatchAction.NONE) return
        Log.d(TAG, "replay-pending dispatched")
        val notifyWeb = action == ReplayDispatchAction.NOTIFY_WEB
        runtimeView.post {
            if (notifyWeb) {
                // 已在 replay workspace：直接通知导入（exactly-once 由 pending 被 consume 清空保证）。
                runtime.postEvent(REPLAY_GLOBAL)
            } else {
                // 切到 replay canonical view；ReplayPage 就绪后消费。
                runtime.load(REPLAY_URL)
            }
        }
    }

    /**
     * replay ingress：存入新 pending（single pending slot，最新 replay 取代旧 pending）并落盘 metadata。
     *
     * 非 replay intent 不清空既有 pending：pending 只由 Web consume、TTL/损坏判断或更新的一份取代 —— 否则
     * 后台被系统杀掉后恢复出来的 replay 会被一个无关 intent（如 launcher ACTION_MAIN）立刻丢掉。
     *
     * @return true 表示本次 intent 确实存入了新的 pending replay。
     */
    private fun handleIncomingIntent(intent: Intent?): Boolean {
        val pending = ReplayIntentHandler.fromIntent(this, intent) ?: return false
        // 旧 backing file 不立即删除（页面可能仍在读取），交给下一次 startup orphan cleanup。
        pendingReplay = pending
        pendingReplayEligible = true
        ReplayIntentHandler.savePendingMetadata(this, pending)
        Log.d(TAG, "replay-pending stored ref=${pending.logRef}")
        return true
    }

    /**
     * 清 pending slot + 持久 metadata（exactly-once）。
     *
     * 唯一调用方是 [bridgeConsumePendingReplay] 的 `SUCCESS` 分支 —— 即 ACK 的 identity 与当前 pending
     * 逐字符相等之后。这里刻意保持无参：identity 判断归 [PendingReplayAckPolicy]，清理点不复制第二份规则。
     */
    private fun clearPendingReplay() {
        // 重要：Web synthetic fetch 返回后本机 server 仍可能在流式读取该文件，不能立即删除 backing file。
        // 只清 pending slot + 持久 metadata（exactly-once），文件保留到下一次 app startup cleanupOrphans() 清理。
        pendingReplay = null
        pendingReplayEligible = false
        ReplayIntentHandler.clearPendingMetadata(this)
    }

    // ── Native 认证（owner 是 auth/AuthManager；这里只做接线与投影）──

    /**
     * 授权回程 intent 判定：AppAuth 的回程 intent 一定带 [net.openid.appauth.AuthorizationResponse]
     * 或 [net.openid.appauth.AuthorizationException] extra。两者都没有就不是 auth 回程，交给 replay ingress。
     *
     * 注意：回程经 PendingIntent 投递，因此冷启动落在 `onCreate`、热启动落在 `onNewIntent`；
     * `onActivityResult` 只是防御性兜底（同一份处理逻辑，不重复实现）。
     */
    private fun handleAuthorizationIntent(intent: Intent?): Boolean {
        // 判定归 AuthManager（单一实现）：三类生命周期入口共用同一条「是不是 auth 回程」规则。
        if (!AuthManager.isAuthorizationIntent(intent)) return false
        handleAuthorizationResult(intent)
        return true
    }

    /**
     * 处理一次授权响应：结果归 [AuthManager]，这里只做 UI 反馈。
     *
     * 会话真正建立是异步的（token endpoint 往返），所以这里只处理**失败**的即时反馈：弹出「登录失败，
     * 请重试」；成功路径由 `wotbtoolsOnAuthChanged` 通知页面，绝不在这里抢先 loadUrl。
     * 取消与失败都必须回到「可复用的未认证」——不 reload、不导航、不停留在空白页。
     */
    private fun handleAuthorizationResult(intent: Intent?) {
        val result = try {
            authManager.handleAuthorizationResult(intent)
        } catch (e: Exception) {
            Log.d(TAG, "auth-result crashed category=${e.javaClass.simpleName}")
            null
        }
        if (result !is AuthResult.Failure) return
        // 三种失败不需要用户干预：
        //  - cancelled：用户主动放弃，页面保持未认证即可；
        //  - already-processed：系统把同一个回程 intent 又交付了一次，不是一次新的登录失败；
        //  - no-pending-transaction：回程没有对应的进行中交易（伪造的，或这笔交易已被消费），
        //    用户并没有发起一次新的登录。
        if (result.detail == AuthManager.ALREADY_PROCESSED_DETAIL) return
        if (result.detail == AuthManager.NO_PENDING_TRANSACTION_DETAIL) return
        if (result.reason == AuthFailureReason.CANCELLED) return
        toast(getString(R.string.auth_login_failed_retry))
    }

    /**
     * Native 认证变更 → 通知页面（全局 `wotbtoolsOnAuthChanged`），并顺带同步一次页面可见的会话状态。
     * 只在页面真的加载过时发送；没有页面就没有可通知的消费者。
     */
    private fun notifyAuthChanged() {
        // 这个 listener 可能由后台线程触发（bridge 的认证线程 / 库回调）：引擎只能在主线程使用，
        // 所以连「有没有页面」这个判断也放进主线程，绝不在调用线程碰引擎。
        runOnUiThread {
            if (destroyedRuntime || runtime.currentUrl.isNullOrEmpty()) return@runOnUiThread
            // 全局名来自 wire 契约（events.authChanged.global），页面据此重新拉 authGetState / authGetAccessToken。
            runtime.postEvent(AUTH_CHANGED_GLOBAL)
        }
    }

    /**
     * 连通性变化 → 通知页面（全局 `wotbtoolsOnConnectivityChanged`）。
     *
     * 推送**不携带 payload**：页面收到通知后回读 `connectivityGetState`，因此不存在
     * 「事件说在线、读回来是离线」的双事实源（与 authChanged 同一约定）。回调可能在主线程之外
     * （binder 线程经 mainHandler 转发，这里仍保守地按 post 处理）。
     */
    private fun notifyConnectivityChanged() {
        if (!destroyedRuntime) checkForUpdateAsync()
        runOnUiThread {
            if (destroyedRuntime || runtime.currentUrl.isNullOrEmpty()) return@runOnUiThread
            runtime.postEvent(CONNECTIVITY_CHANGED_GLOBAL)
        }
    }

    // ── Native Bridge 白名单能力（供 Vue 端；origin-scoped）──

    fun bridgeVersion(): Int = BuildConfig.NATIVE_BRIDGE_VERSION

    fun bridgeCapabilities(): List<String> =
        listOf("native-auth", "replay-share", "replay-open", "app-update", "connectivity", "replay-folder-picker")

    /**
     * 连通性状态 token（`connectivityGetState` 的 result）：Android 系统 `ConnectivityManager` 的
     * 权威判定（INTERNET + VALIDATED），页面**不得**用 `navigator.onLine` 代替它。
     */
    fun bridgeConnectivityState(): String = connectivityMonitor.state

    /**
     * pending replay 的 wire contract（`getPendingReplay` 的 result）：`pendingId` 是这份 pending 的
     * authoritative identity，Web 必须在本机分析完成后原样回传给 `consumePendingReplay`；其余字段与
     * 既有语义一致（`name` 仅显示名、`size` 仅提示、`uri` 为固定的同源 LocalRuntimeServer resource `http://127.0.0.1:21653/__native/replay-pending`）。
     */
    fun bridgePendingReplayJson(): Any {
        val pending = pendingReplay?.takeIf { pendingReplayEligible } ?: return org.json.JSONObject.NULL
        return org.json.JSONObject()
            .put("pendingId", pending.pendingId)
            .put("name", pending.name)
            .put("size", pending.size)
            .put("uri", ReplayIntentHandler.STREAM_URL)
    }

    /**
     * Web ACK：compare-and-clear。
     *
     * 只有 Web 明确 ACK 的那份 pending（identity = 完整 pendingId）**仍是**当前 pending 时才清理；
     * identity 缺失或已被更新的 replay 取代一律**不清理**（见 [PendingReplayAckPolicy]）—— 否则
     * 「A 本机分析完成后才发出的 ACK」会误清处理 A 期间新到的 B。刻意不存在无 identity 的 ACK 重载。
     *
     * @return true 仅表示本次 ACK 真的清掉了它命名的那份 pending。
     */
    fun bridgeConsumePendingReplay(expectedPendingId: String?): Boolean {
        val current = pendingReplay?.takeIf { pendingReplayEligible }
        return when (PendingReplayAckPolicy.decide(current?.pendingId, expectedPendingId)) {
            PendingReplayAckResult.MISSING_IDENTITY -> {
                // 无 identity 的 ACK 一律拒绝：绝不退化成「清掉当前 pending」。
                Log.d(TAG, "replay-pending ack rejected reason=missing-identity")
                false
            }
            PendingReplayAckResult.STALE -> {
                // 当前 pending 不是这份 ACK 命名的那一份（已被更新的 replay 取代 / 已无 pending）：保留。
                Log.d(
                    TAG,
                    "replay-pending ack mismatch expected=${pendingLogRef(expectedPendingId)} " +
                        "current=${pendingLogRef(current?.pendingId)}"
                )
                false
            }
            PendingReplayAckResult.SUCCESS -> {
                clearPendingReplay()
                Log.d(TAG, "replay-pending ack success ref=${pendingLogRef(expectedPendingId)}")
                true
            }
        }
    }

    /** Dedicated SAF directory picker; never pass a tree URI through the engine's file prompt. */
    fun bridgePickReplayFolder(requestId: String?, reply: (JSONObject) -> Unit) {
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

    /** Cancelling a page-owned request immediately frees the Native picker without touching completed files. */
    fun bridgeCancelReplayFolderPicker(requestId: String?, reply: (Boolean) -> Unit) {
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

    fun bridgeReleaseReplayFolderSelection(selectionId: String?): Boolean =
        replayFolderPicker.release(selectionId)

    /** Android cursor adapter emits rows directly; traversal applies its bound before retaining each. */
    private fun scanReplayFolder(treeUri: Uri, request: FolderPickRequest): ReplayFolderPicker.Selection {
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

    /** UI-thread compare-and-complete makes destroy/late worker responses harmless. */
    private fun finishFolderPick(
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

    /** A hung provider cannot keep later bridge calls busy after the bounded RPC lifetime. */
    private fun expireFolderPick(request: FolderPickRequest) {
        abortFolderPick(request, "failed")
    }

    /** Client cancellation and deadline expiry share exact native-generation/child-Activity cleanup. */
    private fun abortFolderPick(request: FolderPickRequest, status: String): Boolean {
        val closePicker = request.pickerOpen
        if (!finishFolderPick(request, status)) return false
        if (closePicker) {
            try {
                // Close only the child Activity started for this exact folder request.
                finishActivity(request.requestCode)
            } catch (_: Exception) {
                // Its result may already be queued; request-code ownership will reject that result.
            }
        }
        return true
    }

    private fun cancelFolderPickWork(request: FolderPickRequest) {
        request.lifetimeTimeout?.let { folderTimeoutHandler.removeCallbacks(it) }
        request.scanTimeout?.let { folderTimeoutHandler.removeCallbacks(it) }
        request.lifetimeTimeout = null
        request.scanTimeout = null
        request.scanTask?.cancel(true)
        request.scanTask = null
        request.cancellation.cancel()
    }

    private fun folderPickJson(status: String, selection: ReplayFolderPicker.Selection? = null): JSONObject {
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

    fun bridgeCheckForUpdate(): Boolean {
        val manifest = latestManifest ?: return false
        return installedVersionCode() < manifest.latestVersionCode
    }

    /** bridge 调用可能来自后台线程（认证分发）；UI 动作必须分发到主线程。 */
    fun bridgeStartUpdate() {
        runOnUiThread { onUpdatePrimary() }
    }

    // ── 认证 bridge 投影（在后台线程调用，结果经 reply 回调）──

    /** `authGetState`：会话快照，绝不触发网络。 */
    fun bridgeAuthGetState(): org.json.JSONObject {
        val session = authManager.currentSession()
        return org.json.JSONObject()
            .put("authenticated", session.authenticated)
            .put("expiresAt", session.expiresAtSeconds ?: org.json.JSONObject.NULL)
    }

    /**
     * `authLogin`：先补齐 discovery，再启动 external user-agent（Custom Tabs），
     * 并持久化含 PKCE verifier 的交易状态。返回 true 只在真的把它交给了浏览器时。
     */
    fun bridgeAuthLogin(): Boolean = authManager.login()

    /** `authLogout`：先清本地会话（内存 + 加密存储），再 best-effort 结束 Keycloak SSO 会话。 */
    fun bridgeAuthLogout(): Boolean = authManager.logout()

    /**
     * `authGetAccessToken`：满足 minValiditySeconds 直接返回；否则单飞 refresh。
     *
     * `claims` 是 access token 解码后的 JWT payload（roles / preferred_username），供前端与
     * keycloak-js `tokenParsed` 对齐；refresh token / 授权码 / verifier 永不出现。
     */
    fun bridgeAuthGetAccessToken(minValiditySeconds: Long): org.json.JSONObject {
        if (connectivityMonitor.state != "online") {
            val cached = authManager.currentSession()
            return if (cached.isValidFor(minValiditySeconds, System.currentTimeMillis())) sessionJson(cached)
            else tokenFailureJson(if (cached.authenticated) "refresh-failed" else "unauthenticated")
        }
        return when (val result = authManager.accessTokenOrRefresh(minValiditySeconds)) {
            is AuthResult.Success -> sessionJson(result.session)
            is AuthResult.Failure -> tokenFailureJson(result.wireError)
            else -> tokenFailureJson("unauthenticated")
        }
    }

    /** Cached claims on transient failure are a local UI projection, never API authorization. */
    private fun tokenFailureJson(error: String): org.json.JSONObject {
        val cached = if (error == "refresh-failed") authManager.currentSession().takeIf { it.authenticated } else null
        return org.json.JSONObject()
            .put("token", org.json.JSONObject.NULL)
            .put("expiresAt", cached?.expiresAtSeconds ?: org.json.JSONObject.NULL)
            .put("claims", claimsJson(cached?.claims))
            .put("error", error)
    }

    private fun sessionJson(session: com.wotbtools.app.auth.AuthSession): org.json.JSONObject =
        org.json.JSONObject()
            .put("token", session.accessToken ?: org.json.JSONObject.NULL)
            .put("expiresAt", session.expiresAtSeconds ?: org.json.JSONObject.NULL)
            .put("claims", claimsJson(session.claims))
            .put("error", org.json.JSONObject.NULL)

    /** claims 只做 JSON 投影；Map 里的 null 值保留为 JSON null，不改写、不过滤。 */
    private fun claimsJson(claims: Map<String, Any?>?): Any {
        if (claims == null) return org.json.JSONObject.NULL
        val json = org.json.JSONObject()
        claims.forEach { (key, value) -> json.put(key, value ?: org.json.JSONObject.NULL) }
        return json
    }

    // ── 通用 ──

    /**
     * 隐藏页面并收起版本/错误页。
     *
     * 门禁视图（version/runtimeError）与 [runtimeView] 是根 FrameLayout 的**兄弟节点**，根容器必须保持
     * VISIBLE，否则子节点即便置为 VISIBLE 也不会绘制（父 GONE 连子一起隐藏）。因此这里只隐藏 GeckoView
     * 本身：门禁视图各自带不透明背景、按 XML 顺序绘制在 GeckoView 之上，足以完整接管画面。
     */
    private fun hideAllGates() {
        versionGateView.visibility = View.GONE
        runtimeErrorView.visibility = View.GONE
        runtimeView.visibility = View.GONE
    }

    private fun installedVersionCode(): Int {
        return try {
            packageManager.getPackageInfo(packageName, 0).versionCode
        } catch (_: Exception) {
            1
        }
    }

    /** Blob bytes already belong to Gecko: spool off the UI thread, never refetch the URL. */
    private fun saveExternalResponse(response: WebResponse) {
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

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == downloadSave?.first) {
            val file = downloadSave!!.second
            downloadSave = null
            val uri = data?.data
            if (resultCode != RESULT_OK || uri == null) {
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
            if (filePromptCopying) return // Ignore duplicate Activity results while copying.
            val (_, prompt, result) = request
            val uris = when {
                resultCode == RESULT_OK && data?.clipData != null ->
                    (0 until data.clipData!!.itemCount).map { data.clipData!!.getItemAt(it).uri }
                resultCode == RESULT_OK && data?.data != null -> listOf(data.data!!)
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
                        uris.forEach { files.add(FilePickerCache.spool(contentResolver, it, directory)) }
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
                            // Gecko may read DOM File bytes later: successful backing files live until TTL.
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
            // Expired requests and duplicate provider results must never belong to a retry.
            if (request.requestCode != requestCode || !request.pickerOpen) return
            request.pickerOpen = false
            if (resultCode != RESULT_OK) {
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
        // 授权回程的防御性兜底：正常投递路径是 PendingIntent → onCreate/onNewIntent。
        // Picker codes have their own owners, even if a late result carries unrelated extras.
        handleAuthorizationIntent(data)
    }

    override fun onBackPressed() {
        if (fullscreen) {
            // 通知 Gecko 退出 fullscreen，使 document.fullscreenElement / fullscreenchange 与 Vue 状态同步；
            // 系统 UI 在随后的 onFullScreen(false) 中恢复。
            runtime.exitFullScreen()
            return
        }
        if (runtime.canGoBack) runtime.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        exitFullscreen()
        destroyedRuntime = true
        val folderRequest = folderPickRequest
        folderPickRequest = null
        replayFolderPicker.destroy()
        folderRequest?.let { cancelFolderPickWork(it) }
        filePrompt?.let { (code, prompt, result) ->
            prompt.setDelegate(null)
            result.complete(prompt.dismiss())
            finishActivity(code)
        }
        downloadSave?.let { (code, file) -> finishActivity(code); file.delete() }
        downloadSave = null
        filePrompt = null
        connectivityMonitor.stop()
        authManager.removeListener(authChangedListener)
        runtime.close()
        localServer?.close()
        localServer = null
        executor.shutdown()
        super.onDestroy()
    }
}
