package com.wotbtools.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.View
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.webkit.WebViewFeature
import androidx.webkit.WebViewCompat
import com.wotbtools.app.auth.AuthFailureReason
import com.wotbtools.app.auth.AuthManager
import com.wotbtools.app.auth.AuthResult
import java.io.File
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * WotBTools Android 壳 —— 现有 Vue 的纯联网 Thin Client。
 *
 * 职责：网络/版本门禁（fail-closed）→ 远程加载 https://wotbtools.com（有 pending replay 时加载
 * ?view=replay）；Replay 意图（ACTION_SEND/ACTION_VIEW）经安全 ingress 复制到 app cache 后交给
 * 现有 Web upload pipeline（**唯一** ingress：Native Bridge）；origin-scoped Native Bridge
 * （仅 wotbtools.com/www 可用）。
 *
 * Navigation ownership：pending replay 的分发完全由纯策略 `ReplayDispatchPolicy` 决定；认证不再参与
 * 这个决策 —— 登录跑在 external user-agent 里，永远不会占用 WebView navigation。
 * Pending replay 跨 process death 由 metadata 恢复：冷启动先恢复 active pending，再清理 orphan。
 * Pending replay 的 ACK 是 identity-matched 的 compare-and-clear（决策见纯策略 `PendingReplayAckPolicy`）：
 * 只有命名了当前 pending 的 ACK 才清，绝不接受无 identity 的 ACK。
 *
 * Auth ownership：**Native 拥有认证**（AppAuth / RFC 8252，见 `auth/AuthManager`）。WebView 只保留
 * 一个 residual origin boundary：主 frame 导航到 app 自有 host 之外一律交给系统浏览器并阻断在
 * WebView 内，所以 Keycloak / provider 页面永远不会在 WebView 里渲染。
 */
class MainActivity : Activity() {

    companion object {
        private const val BASE_URL = "https://wotbtools.com"
        // replay canonical view 的 marker 由 ReplayDispatchPolicy 拥有：分发决策所判断的 URL 与这里导航到的
        // URL 共用同一常量，避免两处字面量漂移。
        private const val REPLAY_URL = BASE_URL + "?" + ReplayDispatchPolicy.REPLAY_VIEW_MARKER
        private const val FILE_CHOOSER_REQUEST = 1001
        private const val BRIDGE_NAME = "WotbNative"

        /** 日志 tag（导航 / replay / auth 诊断共用）。 */
        private const val TAG = "WotbAuth"

        /** 原生认证变更后推给页面的全局（与 contracts/android-native-bridge.json 的 events 一致）。 */
        private const val AUTH_CHANGED_GLOBAL = "wotbtoolsOnAuthChanged"

        /** Native Bridge 唯一允许的调用 origin；绝不暴露给 Keycloak / IdP / 任意 frame。 */
        private val BRIDGE_ORIGINS = setOf(
            "https://wotbtools.com",
            "https://www.wotbtools.com"
        )

        /** app 自有 host：主 frame 导航里唯一允许留在 WebView 的集合（大小写不敏感 + 去尾部点）。 */
        private val APP_HOSTS = setOf(
            "wotbtools.com",
            "www.wotbtools.com"
        )
    }

    private lateinit var webView: WebView
    private lateinit var webViewContainer: FrameLayout
    private lateinit var networkGateView: LinearLayout
    private lateinit var versionGateView: LinearLayout
    private lateinit var webErrorView: LinearLayout
    private lateinit var versionTitle: TextView
    private lateinit var versionMessage: TextView
    private lateinit var versionCurrent: TextView
    private lateinit var versionLatest: TextView
    private lateinit var webErrorRetryButton: Button
    private lateinit var versionPrimaryButton: Button
    private lateinit var versionLaterButton: Button
    private lateinit var webErrorTitle: TextView

    private lateinit var apkUpdater: ApkUpdater
    private lateinit var nativeBridge: NativeBridge
    private lateinit var authManager: AuthManager
    private val executor: ExecutorService = Executors.newFixedThreadPool(2)

    @Volatile private var pendingReplay: PendingReplay? = null
    @Volatile private var pendingReplayEligible = true
    @Volatile private var latestManifest: VersionManifest? = null
    @Volatile private var downloadedApk: File? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    @Volatile private var awaitingUnknownSourcesPermission = false

    /** WebView 是否已销毁：晚到的 bridge 回复 / JS 通知都必须先看这一位。 */
    @Volatile private var destroyedWebView = false

    /** HTML Fullscreen API 在 Android WebView 中通过 WebChromeClient custom-view 回调落地。 */
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var fullscreenPreviousOrientation: Int = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    private var fullscreenPreviousSystemUiVisibility: Int = View.SYSTEM_UI_FLAG_VISIBLE

    /** 认证变更监听：`AuthManager` 的 listener 需要能注销，所以留一个稳定引用。 */
    private val authChangedListener = AuthManager.Listener { notifyAuthChanged() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        webViewContainer = findViewById(R.id.webViewContainer)
        networkGateView = findViewById(R.id.networkGateView)
        versionGateView = findViewById(R.id.versionGateView)
        webErrorView = findViewById(R.id.webErrorView)
        versionTitle = findViewById(R.id.versionTitle)
        versionMessage = findViewById(R.id.versionMessage)
        versionCurrent = findViewById(R.id.versionCurrent)
        versionLatest = findViewById(R.id.versionLatest)
        webErrorRetryButton = findViewById(R.id.webErrorRetryButton)
        webErrorTitle = findViewById(R.id.webErrorTitle)
        versionPrimaryButton = findViewById(R.id.versionPrimaryButton)
        versionLaterButton = findViewById(R.id.versionLaterButton)

        apkUpdater = ApkUpdater(this)
        nativeBridge = NativeBridge(this)
        authManager = AuthManager.getInstance(applicationContext, MainActivity::class.java)
        authManager.addListener(authChangedListener)
        // discovery 只预热一次（进程内缓存），让 authLogin 能真正同步启动 external user-agent。
        authManager.warmUp()

        findViewById<Button>(R.id.retryButton).setOnClickListener { hideAllGates(); startStartupFlow() }
        webErrorRetryButton.setOnClickListener { hideAllGates(); loadWeb() }
        versionPrimaryButton.setOnClickListener { onUpdatePrimary() }
        versionLaterButton.setOnClickListener { loadWeb() }

        val webViewOk = configureWebView()
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
        if (webViewOk) startStartupFlow()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            showUnsupportedWebView()
            return false
        }
        val settings = webView.settings
        // WebView 仍需要 cookie jar 才能维持 wotbtools.com 自己的会话；认证已不在 WebView 内发生，
        // 因此不再需要为跨站 IdP 打开 third-party cookie。
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.setGeolocationEnabled(false)

        // origin-scoped Native Bridge：仅 wotbtools.com/www；替代 addJavascriptInterface 的全 frame 暴露。
        WebViewCompat.addWebMessageListener(
            webView,
            BRIDGE_NAME,
            BRIDGE_ORIGINS,
            WebViewCompat.WebMessageListener { _, message, _, _, replyProxy ->
                val data = message.data
                if (data != null) {
                    // 认证方法会稍后才完成：replyProxy 必须按次捕获，由 postReply 兜住「回复时页面已销毁」，
                    // 绝不把已失效的 proxy 交给后台线程。
                    nativeBridge.handleMessage(data) { reply -> postReply(replyProxy, reply) }
                }
            }
        )

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (view == null || callback == null) {
                    callback?.onCustomViewHidden()
                    return
                }
                showFullscreenView(view, callback)
            }

            override fun onHideCustomView() {
                hideFullscreenView(notifyWeb = false)
            }

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: WebChromeClient.FileChooserParams
            ): Boolean {
                // 普通 Web file chooser：始终交给 Android 系统 picker（既有 UX 不变）。
                // Android external replay 绝不在这里注入：唯一 ingress 是 Intent → pending cache →
                // Native Bridge（getPendingReplay / fetch(content://) / consumePendingReplay）→ 上传管线。
                val intent = try {
                    params.createIntent()
                } catch (_: Exception) {
                    Intent(Intent.ACTION_GET_CONTENT)
                }
                fileChooserCallback = callback
                return try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST)
                    true
                } catch (_: Exception) {
                    fileChooserCallback = null
                    callback.onReceiveValue(null)
                    false
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                val uri = url?.let { Uri.parse(it) }
                Log.d(
                    TAG,
                    "pageStart scheme=${uri?.scheme ?: "null"} host=${uri?.host ?: "null"} " +
                        "category=${originCategory(uri?.host)} mainFrame=true"
                )
            }

            /**
             * residual origin boundary（App 自有 origin 边界）：主 frame 导航只允许留在 app 自有 host；
             * 其它一切（Keycloak / provider / 普通外链 / 无 host 的怪 URI）交给系统浏览器并在 WebView 内
             * 阻断 —— 认证页面因此永远不会在 App 的 WebView 里渲染。
             */
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                val uri = request.url
                if (isAppHost(uri.host)) {
                    Log.d(TAG, "nav in-app scheme=${uri.scheme ?: "null"} host=${uri.host ?: "null"}")
                    return false
                }
                Log.d(TAG, "nav external scheme=${uri.scheme ?: "null"} host=${uri.host ?: "null"}")
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    true
                } catch (_: Exception) {
                    // 无可用 browser 时同样阻断：宁可停在这一页，也不在 WebView 内加载非 app origin。
                    true
                }
            }

            /**
             * Android 外部 replay handoff：Web 侧 readPendingFile 用 fetch(pending.uri) 读取字节。
             * 固定 same-origin HTTPS resource 始终由 Native 返回文件流或明确错误，不能落到真实网络。
             */
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                if (request.url.toString() != ReplayIntentHandler.STREAM_URL) return null
                Log.d(TAG, "replay-pending stream requested")
                val pending = pendingReplay?.takeIf { pendingReplayEligible }
                val expectedId = request.requestHeaders.entries.firstOrNull {
                    it.key.equals(ReplayIntentHandler.IDENTITY_HEADER, ignoreCase = true)
                }?.value
                val response = ReplayIntentHandler.interceptPendingResource(
                    request.url.toString(), pending?.file, pending?.pendingId, expectedId
                ) ?: error("Synthetic replay resource must be Native-owned")
                val event = when (response.status) {
                    200 -> "served"
                    404 -> "missing"
                    else -> "failed"
                }
                Log.d(TAG, "replay-pending stream $event status=${response.status} ref=${pendingLogRef(pending?.pendingId)}")
                return WebResourceResponse(
                    "application/octet-stream", null, response.status, response.reason,
                    mapOf("Cache-Control" to "no-store"), response.data
                )
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (request.isForMainFrame) showWebError()
            }
        }
        return true
    }

    /**
     * Android WebView 的 HTML Fullscreen API 不会自动替 Activity 切换系统 UI。
     * Chromium 通过 WebChromeClient custom-view 回调把 fullscreen element 交给宿主；
     * 这里才是真正的 native fullscreen 边界。BattlePlayback 继续使用标准 requestFullscreen()，
     * 不需要 Android 专用前端分支，也不会 reset playback state。
     */
    private fun showFullscreenView(view: View, callback: WebChromeClient.CustomViewCallback) {
        if (fullscreenView != null) {
            callback.onCustomViewHidden()
            return
        }

        fullscreenPreviousOrientation = requestedOrientation
        fullscreenPreviousSystemUiVisibility = window.decorView.systemUiVisibility
        fullscreenView = view
        fullscreenCallback = callback

        webView.visibility = View.GONE
        webViewContainer.addView(
            view,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

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

    /**
     * notifyWeb=true 用于 Android Back：通知 Chromium 结束 fullscreen，使 document.fullscreenElement /
     * fullscreenchange 与 Vue 状态同步；Web 自己退出时 onHideCustomView 已表示 Chromium 完成退出，
     * 此时不能再次 callback，避免重复退出。
     */
    private fun hideFullscreenView(notifyWeb: Boolean) {
        val view = fullscreenView ?: return
        val callback = fullscreenCallback

        webViewContainer.removeView(view)
        fullscreenView = null
        fullscreenCallback = null
        webView.visibility = View.VISIBLE

        requestedOrientation = fullscreenPreviousOrientation
        window.decorView.systemUiVisibility = fullscreenPreviousSystemUiVisibility

        if (notifyWeb) callback?.onCustomViewHidden()
    }

    // ── 启动门禁（fail-closed）──

    private fun startStartupFlow() {
        executor.execute {
            if (!isNetworkAvailable()) {
                runOnUiThread { showNetworkGate() }
                return@execute
            }
            val result = StartupGate.checkVersion()
            runOnUiThread {
                when (result) {
                    is StartupGate.Result.Ok -> onVersionReady(result.manifest)
                    is StartupGate.Result.VersionUnavailable -> showNetworkGate()
                }
            }
        }
    }

    private fun onVersionReady(manifest: VersionManifest) {
        latestManifest = manifest
        val installed = installedVersionCode()
        when {
            installed < manifest.minSupportedVersionCode -> showMandatoryUpdate(manifest, installed)
            installed < manifest.latestVersionCode -> showOptionalUpdate(manifest, installed)
            else -> loadWeb()
        }
    }

    /** Entry URL：有 pending replay 就进 replay canonical view，否则首页。认证回程不经这里。 */
    private fun entryUrl(): String = if (pendingReplay != null) REPLAY_URL else BASE_URL

    private fun loadWeb() {
        hideAllGates()
        webView.visibility = View.VISIBLE
        if (webView.url.isNullOrEmpty()) {
            webView.loadUrl(entryUrl())
        } else {
            webView.reload()
        }
    }

    private fun showNetworkGate() {
        hideAllGates()
        networkGateView.visibility = View.VISIBLE
    }

    private fun showWebError() {
        hideAllGates()
        webErrorView.visibility = View.VISIBLE
    }

    private fun showUnsupportedWebView() {
        hideAllGates()
        webErrorView.visibility = View.VISIBLE
        webErrorTitle.text = getString(R.string.webview_unsupported_title)
        webErrorRetryButton.visibility = View.GONE
    }

    private fun showMandatoryUpdate(manifest: VersionManifest, installed: Int) {
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
     * 无 pending / WebView 不可见（门禁 / 错误 / 更新页接管中）→ 不分发；已在 replay workspace → 通知 Web；
     * 否则切到 replay canonical view。认证不再参与这个决策：登录在 external user-agent 里进行，不会占用
     * WebView navigation，因此 replay 无需为 auth 让路。登录完成后 Web 应用会重新加载并经 Native Bridge
     * 自行消费 pending。
     */
    private fun dispatchPendingReplayIfAllowed() {
        val action = ReplayDispatchPolicy.decide(
            hasPendingReplay = pendingReplay != null,
            webViewVisible = webView.visibility == View.VISIBLE,
            currentUrl = webView.url
        )
        if (action == ReplayDispatchAction.NONE) return
        Log.d(TAG, "replay-pending dispatched")
        val notifyWeb = action == ReplayDispatchAction.NOTIFY_WEB
        webView.post {
            if (notifyWeb) {
                // 已在 replay workspace：直接通知导入（exactly-once 由 pending 被 consume 清空保证）。
                webView.evaluateJavascript("window.wotbtoolsOnReplay && window.wotbtoolsOnReplay()", null)
            } else {
                // 切到 replay canonical view；ReplayPage 就绪后消费。
                webView.loadUrl(REPLAY_URL)
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
        // 旧 backing file 不立即删除（Chromium 可能仍在读取），交给下一次 startup orphan cleanup。
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
        // 重要：Web `fetch(content://)` 返回后 WebView/Chromium 仍可能读取该文件，不能立即删除 backing file。
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
        // 两种失败不需要用户干预：
        //  - cancelled：用户主动放弃，页面保持未认证即可；
        //  - already-processed：系统把同一个回程 intent 又交付了一次，不是一次新的登录失败。
        if (result.detail == AuthManager.ALREADY_PROCESSED_DETAIL) return
        if (result.reason == AuthFailureReason.CANCELLED) return
        toast(getString(R.string.auth_login_failed_retry))
    }

    /**
     * Native 认证变更 → 通知页面（全局 `wotbtoolsOnAuthChanged`），并顺带同步一次页面可见的会话状态。
     * 只在 WebView 真的加载了页面时发送；没有页面就没有可通知的消费者。
     */
    private fun notifyAuthChanged() {
        // 这个 listener 可能由后台线程触发（bridge 的认证线程 / 库回调）：WebView 的任何方法都必须在
        // 它自己的线程上调用，所以连「有没有页面」这个判断也放进 post 里，绝不在调用线程碰 WebView。
        webView.post {
            if (destroyedWebView || webView.url.isNullOrEmpty()) return@post
            // 全局名来自 wire 契约（events.authChanged.global），页面据此重新拉 authGetState / authGetAccessToken。
            webView.evaluateJavascript(
                "window.$AUTH_CHANGED_GLOBAL && window.$AUTH_CHANGED_GLOBAL()",
                null
            )
        }
    }

    // ── Native Bridge 白名单能力（供 Vue 端；origin-scoped）──

    fun bridgeVersion(): Int = BuildConfig.NATIVE_BRIDGE_VERSION

    fun bridgeCapabilities(): List<String> =
        listOf("native-auth", "replay-share", "replay-open", "app-update")

    /**
     * pending replay 的 wire contract（`getPendingReplay` 的 result）：`pendingId` 是这份 pending 的
     * authoritative identity，Web 必须在 server 接受后原样回传给 `consumePendingReplay`；其余字段与
     * 既有语义一致（`name` 仅显示名、`size` 仅提示、`uri` 为固定 same-origin HTTPS resource）。
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
     * 「A 被 server 接受后才发出的 ACK」会误清处理 A 期间新到的 B。刻意不存在无 identity 的 ACK 重载。
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

    fun bridgeCheckForUpdate(): Boolean {
        val manifest = latestManifest ?: return false
        return installedVersionCode() < manifest.latestVersionCode
    }

    /** @JavascriptInterface 等效的 bridge 调用运行在 WebView 线程；UI 动作必须分发到主线程。 */
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
    fun bridgeAuthGetAccessToken(minValiditySeconds: Long): org.json.JSONObject =
        when (val result = authManager.accessTokenOrRefresh(minValiditySeconds)) {
            is AuthResult.Success -> sessionJson(result.session)
            is AuthResult.Failure -> tokenFailureJson(result.wireError)
            // `accessTokenOrRefresh` 只可能给出 Success / Failure（ExchangeStarted 属于授权回程路径）；
            // 新增结果类型时这里保持 fail-closed 的未认证投影，绝不静默当成已登录。
            else -> tokenFailureJson("unauthenticated")
        }

    /** `authGetAccessToken` 的失败形状（契约封闭集合：null 字段 + error）。 */
    private fun tokenFailureJson(error: String): org.json.JSONObject = org.json.JSONObject()
        .put("token", org.json.JSONObject.NULL)
        .put("expiresAt", org.json.JSONObject.NULL)
        .put("claims", org.json.JSONObject.NULL)
        .put("error", error)

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
     * 隐藏 WebView 内容并收起三个门禁/错误页。
     *
     * 门禁视图（network/version/webError）与 [webView] 是根 FrameLayout 的**兄弟节点**，根容器必须保持
     * VISIBLE，否则子节点即便置为 VISIBLE 也不会绘制（父 GONE 连子一起隐藏）。因此这里只隐藏 WebView
     * 本身：门禁视图各自带不透明背景、按 XML 顺序绘制在 WebView 之上，足以完整接管画面。
     */
    private fun hideAllGates() {
        networkGateView.visibility = View.GONE
        versionGateView.visibility = View.GONE
        webErrorView.visibility = View.GONE
        webView.visibility = View.GONE
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun installedVersionCode(): Int {
        return try {
            packageManager.getPackageInfo(packageName, 0).versionCode
        } catch (_: Exception) {
            1
        }
    }

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    /** 主 frame 导航边界用：host 归一化（去尾部点 + 小写）后是否属于 app 自有 host。 */
    private fun isAppHost(host: String?): Boolean {
        val normalized = host?.trim()?.trimEnd('.')?.takeIf { it.isNotEmpty() }
            ?.lowercase(Locale.ROOT) ?: return false
        return normalized in APP_HOSTS
    }

    /** 导航日志用的分类：只暴露 host 归属，不落完整 URI。 */
    private fun originCategory(host: String?): String = when {
        isAppHost(host) -> "app"
        host.isNullOrBlank() -> "hostless"
        else -> "external"
    }

    /**
     * bridge 回复投递：认证方法在后台线程完成，回调可能晚于页面销毁。
     *
     * 因此回复通过**本次消息自己的** `JavaScriptReplyProxy` 投递（页面侧 listener 仍然有效时才会送达），
     * 并且只在 WebView 尚未销毁时尝试；投递失败一律丢弃 —— JS 侧有自己的超时，绝不能因为回复而碰到
     * 已销毁的 WebView 或让原生崩溃。
     */
    private fun postReply(replyProxy: androidx.webkit.JavaScriptReplyProxy, json: String) {
        // JavaScriptReplyProxy 是 @UiThread（当前未强制，但契约要求）：认证回复来自后台线程，
        // 因此统一投递到主线程 —— 主线程上 runOnUiThread 就是立即执行，同步路径延迟不变。
        runOnUiThread {
            if (isDestroyed || destroyedWebView) return@runOnUiThread
            try {
                replyProxy.postMessage(json)
            } catch (e: Exception) {
                Log.d(TAG, "bridge-reply dropped category=${e.javaClass.simpleName}")
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        // 授权回程的防御性兜底：正常投递路径是 PendingIntent → onCreate/onNewIntent，
        // 但只要 intent 里带响应/异常就按授权结果处理（同一份逻辑，不重复实现）。
        if (handleAuthorizationIntent(data)) return
        if (requestCode == FILE_CHOOSER_REQUEST && fileChooserCallback != null) {
            val uris = when {
                resultCode == RESULT_OK && data?.clipData != null ->
                    (0 until data.clipData!!.itemCount).map { data.clipData!!.getItemAt(it).uri }.toTypedArray()
                resultCode == RESULT_OK && data?.data != null -> arrayOf(data.data!!)
                else -> null
            }
            fileChooserCallback?.onReceiveValue(uris)
            fileChooserCallback = null
        }
    }

    override fun onBackPressed() {
        if (fullscreenView != null) {
            hideFullscreenView(notifyWeb = true)
            return
        }
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        if (fullscreenView != null) hideFullscreenView(notifyWeb = true)
        destroyedWebView = true
        authManager.removeListener(authChangedListener)
        webViewContainer.removeAllViews()
        webView.destroy()
        executor.shutdown()
        super.onDestroy()
    }
}
