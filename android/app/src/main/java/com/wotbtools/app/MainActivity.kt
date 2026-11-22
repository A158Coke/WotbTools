package com.wotbtools.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import com.wotbtools.app.auth.AuthManager
import org.json.JSONObject
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession.PromptDelegate
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebResponse
import java.io.File
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
        internal const val REPLAY_URL = LOCAL_APP_ENTRY + "?" + ReplayDispatchPolicy.REPLAY_VIEW_MARKER
        internal const val PICKER_REQUEST_MIN = 0x2000
        internal const val PICKER_REQUEST_MAX = 0xffff
        // All native pickers share this allocator; never reuse a code, including Activity recreation.
        internal val nextPickerRequestCode = AtomicInteger(PICKER_REQUEST_MIN)
        internal const val REPLAY_FOLDER_LIFETIME_MS = 9L * 60 * 1000
        internal const val REPLAY_FOLDER_SCAN_TIMEOUT_MS = 60L * 1000

        /** 日志 tag（导航 / replay / auth 诊断共用）。 */
        internal const val TAG = "WotbAuth"

        /** 原生认证变更后推给页面的全局（与 contracts/android-native-bridge.json 的 events 一致）。 */
        internal const val AUTH_CHANGED_GLOBAL = "wotbtoolsOnAuthChanged"

        /** 连通性变化后推给页面的全局（与 contracts/android-native-bridge.json 的 events 一致）。 */
        internal const val CONNECTIVITY_CHANGED_GLOBAL = "wotbtoolsOnConnectivityChanged"
        internal const val UPDATE_CHANGED_GLOBAL = "wotbtoolsOnUpdateStatusChanged"

        /** 已在 replay workspace 时通知页面消费 pending（与 contracts/android-native-bridge.json 的 events 一致）。 */
        internal const val REPLAY_GLOBAL = "wotbtoolsOnReplay"

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

    internal lateinit var runtimeView: GeckoView
    internal lateinit var runtime: GeckoWebRuntime
    internal var localServer: LocalRuntimeServer? = null
    /** 冷启动 / 引擎恢复期间的 Native 首帧占位；可见性规则归 [StartupSurfaceState]。 */
    internal lateinit var startupSurface: View
    internal val startupSurfaceState = StartupSurfaceState()
    private val startupStartedAt = SystemClock.elapsedRealtime()
    internal lateinit var versionGateView: View
    internal lateinit var runtimeErrorView: LinearLayout
    internal lateinit var versionTitle: TextView
    internal lateinit var versionMessage: TextView
    internal lateinit var versionCurrent: TextView
    internal lateinit var versionLatest: TextView
    private lateinit var runtimeErrorRetryButton: Button
    private lateinit var runtimeErrorBrowserButton: Button
    internal lateinit var runtimeErrorDiagnostics: TextView
    internal lateinit var versionPrimaryButton: Button
    internal lateinit var versionProgress: ProgressBar
    internal lateinit var versionStatus: TextView
    internal lateinit var versionBytes: TextView
    internal lateinit var updateCoordinator: UpdateCoordinator
    internal var updateForeground = false
    internal var legacyInstallVersionCode: Int? = null
    internal var preparingInstallToken: String? = null
    internal var preparingInstallReply: ((Boolean) -> Unit)? = null
    internal var installAttempt = 0L
    internal var permissionInstallToken: String? = null
    private val updateListener: () -> Unit = { onUpdateStateChanged() }
    internal lateinit var runtimeErrorTitle: TextView

    internal lateinit var apkUpdater: ApkUpdater
    private lateinit var nativeBridge: NativeBridge
    internal lateinit var authManager: AuthManager
    internal lateinit var connectivityMonitor: ConnectivityMonitor
    internal val executor: ExecutorService = Executors.newFixedThreadPool(2)

    @Volatile internal var pendingReplay: PendingReplay? = null
    @Volatile internal var pendingReplayEligible = true
    /** 进行中的普通 `<input type=file>` 选择（Gecko PromptDelegate）；同一时刻只有一个。 */
    internal var filePrompt: Triple<Int, PromptDelegate.FilePrompt, GeckoResult<PromptDelegate.PromptResponse>>? = null
    internal var filePromptCopying = false
    internal var downloadInFlight = false
    internal var downloadSave: Pair<Int, File>? = null
    internal val replayFolderPicker = ReplayFolderPicker()
    internal var folderPickRequest: FolderPickRequest? = null
    internal val folderTimeoutHandler = Handler(Looper.getMainLooper())

    internal class FolderPickRequest(
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

    /** 引擎是否已销毁：晚到的 bridge 回复 / 页面通知都必须先看这一位。 */
    @Volatile internal var destroyedRuntime = false

    /** HTML Fullscreen API：Gecko 经 ContentDelegate.onFullScreen 通知，宿主只管系统 UI 与方向。 */
    internal var fullscreen = false
    internal val fullscreenOrientation = FullscreenOrientation()
    internal var fullscreenPreviousSystemUiVisibility: Int = View.SYSTEM_UI_FLAG_VISIBLE

    /** 认证变更监听：`AuthManager` 的 listener 需要能注销，所以留一个稳定引用。 */
    private val authChangedListener = AuthManager.Listener { notifyAuthChanged() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        executor.execute { FilePickerCache.cleanup(File(cacheDir, "file-picker")) }
        setContentView(R.layout.activity_main)

        runtimeView = findViewById(R.id.runtimeView)
        startupSurface = findViewById(R.id.startupSurface)
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
        versionProgress = findViewById(R.id.versionProgress)
        versionStatus = findViewById(R.id.versionStatus)
        versionBytes = findViewById(R.id.versionBytes)

        apkUpdater = ApkUpdater(applicationContext)
        updateCoordinator = UpdateCoordinator.get(applicationContext)
        nativeBridge = NativeBridge(this)
        authManager = AuthManager.getInstance(applicationContext, MainActivity::class.java)
        authManager.addListener(authChangedListener)
        // discovery 只预热一次（进程内缓存），让 authLogin 能真正同步启动 external user-agent。
        // 连通性由系统 ConnectivityManager 权威判定；页面经 bridge 读取（绝不看 navigator.onLine）。
        connectivityMonitor = ConnectivityMonitor(this) { notifyConnectivityChanged() }
        connectivityMonitor.start()
        if (connectivityMonitor.state == "online") authManager.warmUp()

        runtimeErrorRetryButton.setOnClickListener { loadWeb() }
        runtimeErrorBrowserButton.setOnClickListener { openExternal(WEB_APP_URL) }
        versionPrimaryButton.setOnClickListener { onUpdatePrimary() }

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

    private val runtimeHost = object : GeckoWebRuntime.Host {
        override fun onBridgeMessage(json: String, reply: (String) -> Unit) =
            nativeBridge.handleMessage(json, reply)

        /** Main frame stays local; HTTPS/mailto external links use the system browser. */
        override fun onExternalNavigation(uri: String) = openExternal(uri)

        override fun onExternalResponse(response: WebResponse) = saveExternalResponse(response)

        override fun onFullScreen(fullScreen: Boolean) {
            if (fullScreen && updateCoordinator.state() == "mandatory") runtime.exitFullScreen()
            else if (fullScreen) enterFullscreen() else exitFullscreen()
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

        /** 首个内容绘制：Web 侧已有可显示内容，移除 Native 启动面。 */
        override fun onContentPainted() {
            startupSurfaceState.contentPainted()
            applyStartupSurface()
            Log.d(TAG, "startup content painted elapsedMs=${SystemClock.elapsedRealtime() - startupStartedAt}")
        }

        /** paint reset / crash / kill 恢复：已绘制内容不再显示，重新由启动面接管。 */
        override fun onContentUnavailable() {
            startupSurfaceState.contentUnavailable()
            applyStartupSurface()
            Log.d(TAG, "startup content unavailable")
        }
    }

    override fun onStart() {
        super.onStart()
        updateCoordinator.addListener(updateListener)
    }

    override fun onResume() {
        super.onResume()
        updateForeground = true
        runtime.onResume()
        updateCoordinator.setForeground(true)
        val token = permissionInstallToken
        permissionInstallToken = null
        if (token != null && updateCoordinator.status.download.taskToken == token) {
            if (packageManager.canRequestPackageInstalls()) bridgeInstallUpdate(token) { }
            else updateCoordinator.installPermissionRequired(token)
        } else updateCoordinator.reconcile()
    }

    override fun onPause() {
        updateForeground = false
        legacyInstallVersionCode = null
        preparingInstallToken?.let { updateCoordinator.cancelPendingInstall(it) }
        preparingInstallToken = null
        installAttempt++
        // 取消并使旧回调失效后，在 Activity 销毁前确认请求不会再启动安装器。
        val cancelledReply = preparingInstallReply
        preparingInstallReply = null
        cancelledReply?.invoke(false)
        updateCoordinator.setForeground(false)
        super.onPause()
    }

    override fun onStop() {
        updateCoordinator.removeListener(updateListener)
        super.onStop()
    }

    // ── Replay 意图生命周期（冷启动 / 热启动 / 后台恢复）──

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra(UpdateCoordinator.OPEN_UPDATE_PANEL, false)) {
            if (updateCoordinator.state() == "mandatory") showMandatoryUpdate(updateCoordinator.status)
            else runtime.load(entryUrl())
            return
        }
        // 授权回程（external user-agent 回来）归 auth 所有，绝不进入 replay ingress / 分发。
        if (handleAuthorizationIntent(intent)) return
        handleIncomingIntent(intent)
        dispatchPendingReplayIfAllowed()
    }

    // ── Native Bridge 白名单能力（供 Vue 端；origin-scoped）──

    fun bridgeVersion(): Int = BuildConfig.NATIVE_BRIDGE_VERSION

    fun bridgeCapabilities(): List<String> =
        listOf("native-auth", "replay-share", "replay-open", "app-update", "app-update-status", "connectivity", "replay-folder-picker", "screen-form", "haptics")

    internal fun isPhone(): Boolean = ScreenForm.isPhone(resources.configuration.smallestScreenWidthDp)

    /** `haptic`：页面事件种类 → 系统触感常量（跟随系统触摸反馈设置）。未知种类不振动。 */
    fun bridgeHaptic(kind: String?): Boolean {
        val constant = Haptics.feedbackConstant(kind) ?: return false
        if (destroyedRuntime || isDestroyed) return false
        return window.decorView.performHapticFeedback(constant)
    }

    /** `getScreenForm`：只报告手机 / 非手机，页面据此决定场景页是否强制横屏。 */
    fun bridgeScreenForm(): JSONObject = JSONObject().put("phone", isPhone())

    /**
     * `setOrientationLock`：手机上的页面方向锁（landscape / portrait / unspecified）；平板一律不锁（返回 false）。
     * HTML 全屏期间只更新全屏退出后要恢复的方向，不打断全屏自己的横屏。
     */
    fun bridgeSetOrientationLock(mode: String?): Boolean {
        if (!isPhone()) return false
        val orientation = ScreenForm.pageOrientation(mode) ?: return false
        fullscreenOrientation.setPageOrientation(orientation)?.let { requestedOrientation = it }
        return true
    }

    /**
     * 连通性状态 token（`connectivityGetState` 的 result）：Android 系统 `ConnectivityManager` 的
     * 权威判定（INTERNET + VALIDATED），页面**不得**用 `navigator.onLine` 代替它。
     */
    fun bridgeConnectivityState(): String = connectivityMonitor.state

    internal fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    fun bridgeAuthGetState() = authGetState()
    fun bridgeAuthLogin(uiLocale: String?) = authLogin(uiLocale)
    fun bridgeAuthLogout() = authLogout()
    fun bridgeAuthGetAccessToken(minValiditySeconds: Long) = authGetAccessToken(minValiditySeconds)

    fun bridgePickReplayFolder(requestId: String?, reply: (JSONObject) -> Unit) = pickReplayFolder(requestId, reply)
    fun bridgeCancelReplayFolderPicker(requestId: String?, reply: (Boolean) -> Unit) = cancelReplayFolderPicker(requestId, reply)
    fun bridgeReleaseReplayFolderSelection(selectionId: String?) = releaseReplayFolderSelection(selectionId)

    fun bridgePendingReplayJson() = pendingReplayJson()
    fun bridgeConsumePendingReplay(expectedPendingId: String?) = consumePendingReplay(expectedPendingId)

    fun bridgeCheckForUpdate() = checkForUpdate()
    fun bridgeGetUpdateStatus() = getUpdateStatus()
    fun bridgeRefreshUpdateStatus(reply: (JSONObject) -> Unit) = refreshUpdateStatus(reply)
    fun bridgeBeginUpdateDownload(expectedVersionCode: Int?, reply: (Boolean) -> Unit) = beginUpdateDownload(expectedVersionCode, reply)
    fun bridgeDismissOptionalUpdate(expectedVersionCode: Int?, reply: (Boolean) -> Unit) = dismissOptionalUpdate(expectedVersionCode, reply)
    fun bridgeInstallUpdate(expectedToken: String?, reply: (Boolean) -> Unit) = installUpdate(expectedToken, reply)
    fun bridgeStartUpdate() = startUpdate()

    internal val runtimeReady get() = ::runtime.isInitialized
    internal val updateCoordinatorReady get() = ::updateCoordinator.isInitialized

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        dispatchActivityResult(requestCode, resultCode, data)
    }

    override fun onBackPressed() {
        if (updateCoordinator.state() == "mandatory") {
            showMandatoryUpdate(updateCoordinator.status)
            return
        }
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
        legacyInstallVersionCode = null
        preparingInstallReply = null
        preparingInstallToken = null
        installAttempt++
        permissionInstallToken = null
        updateCoordinator.removeListener(updateListener)
        updateCoordinator.setForeground(false)
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
