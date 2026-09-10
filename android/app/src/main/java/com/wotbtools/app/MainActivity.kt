package com.wotbtools.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
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
import java.io.File
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
 * Navigation ownership（RC5）：verified auth return 恒为最高优先级；`inAuthFlow == true` 期间新来的
 * replay intent 只入队，绝不改变 WebView navigation（分发决策见纯策略 `ReplayDispatchPolicy`）。
 * Pending replay 跨 process death 由 metadata 恢复（RC7）：冷启动先恢复 active pending，再清理 orphan。
 * Pending replay 的 ACK 是 identity-matched 的 compare-and-clear（决策见纯策略 `PendingReplayAckPolicy`）：
 * 只有命名了当前 pending 的 ACK 才清，绝不接受无 identity 的 ACK。
 */
class MainActivity : Activity() {

    companion object {
        private const val BASE_URL = "https://wotbtools.com"
        // replay canonical view 的 marker 由 ReplayDispatchPolicy 拥有：分发决策所判断的 URL 与这里导航到的
        // URL 共用同一常量，避免两处字面量漂移。
        private const val REPLAY_URL = BASE_URL + "?" + ReplayDispatchPolicy.REPLAY_VIEW_MARKER
        private const val FILE_CHOOSER_REQUEST = 1001
        private const val BRIDGE_NAME = "WotbNative"

        /** Auth navigation 诊断日志 tag。 */
        private const val TAG = "WotbAuth"

        /** Native Bridge 唯一允许的调用 origin；绝不暴露给 Keycloak / IdP / 任意 frame。 */
        private val BRIDGE_ORIGINS = setOf(
            "https://wotbtools.com",
            "https://www.wotbtools.com"
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
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()

    @Volatile private var pendingReplay: PendingReplay? = null
    @Volatile private var pendingReplayEligible = true
    @Volatile private var latestManifest: VersionManifest? = null
    @Volatile private var downloadedApk: File? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    @Volatile private var inAuthFlow = false
    @Volatile private var awaitingUnknownSourcesPermission = false

    /** HTML Fullscreen API 在 Android WebView 中通过 WebChromeClient custom-view 回调落地。 */
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var fullscreenPreviousOrientation: Int = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    private var fullscreenPreviousSystemUiVisibility: Int = View.SYSTEM_UI_FLAG_VISIBLE

    /** 冷启动验证的 QQ broker callback；进入 startup gate 后作为 entry URL 一次性加载并清空。 */
    @Volatile private var pendingAuthReturn: Uri? = null

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

        findViewById<Button>(R.id.retryButton).setOnClickListener { hideAllGates(); startStartupFlow() }
        webErrorRetryButton.setOnClickListener { hideAllGates(); loadWeb() }
        versionPrimaryButton.setOnClickListener { onUpdatePrimary() }
        versionLaterButton.setOnClickListener { loadWeb() }

        val webViewOk = configureWebView()
        // 冷启动顺序（RC7）：先恢复 active pending（跨 QQ 登录期间 process death 存活），再清理不再被它
        // 引用的 orphan replay cache —— active backing file 绝不能删除。
        val restoredReplay = ReplayIntentHandler.restorePending(this)
        if (restoredReplay != null) {
            pendingReplay = restoredReplay
            pendingReplayEligible = true
            Log.d(TAG, "replay-pending restored ref=${restoredReplay.logRef}")
        }
        ReplayIntentHandler.cleanupOrphans(this, restoredReplay?.file)
        // 冷启动 intent 分类：verified auth return（QQ broker callback）优先于 replay ingress。
        if (intent != null && handleAuthReturnColdStart(intent)) {
            // pendingAuthReturn 已记录；startup gate 通过后作为 entry URL 加载。
        } else {
            handleIncomingIntent(intent)
        }
        if (webViewOk) startStartupFlow()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            showUnsupportedWebView()
            return false
        }
        val settings = webView.settings
        // Keycloak 与 provider 的跨站认证必须共享当前 WebView cookie jar；不读取或复制 Cookie。
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
                    replyProxy.postMessage(nativeBridge.handleMessage(data))
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
                val host = url?.let { Uri.parse(it).host }
                val scheme = url?.let { Uri.parse(it).scheme }
                val before = inAuthFlow
                val decision = AuthNavigationPolicy.decide(scheme, host, inAuthFlow)
                inAuthFlow = decision.inAuthFlow
                Log.d(
                    TAG,
                    "pageStart scheme=${scheme ?: "null"} host=${host ?: "null"} action=${decision.action} " +
                        "inAuthFlow=$before->$inAuthFlow mainFrame=true " +
                        "source=${AuthNavigationPolicy.sourceCategory(scheme, host)}"
                )
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                val host = request.url.host
                val scheme = request.url.scheme
                val before = inAuthFlow
                val decision = AuthNavigationPolicy.decide(scheme, host, inAuthFlow)
                inAuthFlow = decision.inAuthFlow
                val source = AuthNavigationPolicy.sourceCategory(scheme, host)
                Log.d(
                    TAG,
                    "nav scheme=${scheme ?: "null"} host=${host ?: "null"} action=${decision.action} " +
                        "inAuthFlow=$before->$inAuthFlow mainFrame=true source=$source"
                )
                return when (decision.action) {
                    AuthNavigationAction.AUTH_FAILURE -> {
                        // 未验证 host 进入 auth flow：阻断该导航并进入 auth-failure recovery。
                        enterAuthFailureRecovery(host)
                        true
                    }
                    AuthNavigationAction.NATIVE_AUTH_HANDOFF -> {
                        // 已验证 QQ native handoff：交给 QQ App，保留当前 WebView auth transaction。
                        launchNativeAuthHandoff(request.url, scheme, host)
                        true
                    }
                    AuthNavigationAction.OPEN_EXTERNAL -> {
                        try {
                            startActivity(Intent(Intent.ACTION_VIEW, request.url))
                        } catch (_: Exception) {
                            // 无可用 browser 时忽略，留在原页。
                        }
                        true
                    }
                    else -> false // ALLOW_WEBVIEW / ALLOW_AUTH_WEBVIEW 留在 WebView
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

    private fun entryUrl(): String {
        // 优先级：verified auth return > replay > BASE_URL。
        pendingAuthReturn?.let { return it.toString() }
        if (pendingReplay != null) return REPLAY_URL
        return BASE_URL
    }

    private fun loadWeb() {
        hideAllGates()
        webViewContainer.visibility = View.VISIBLE
        if (webView.url.isNullOrEmpty()) {
            val url = entryUrl()
            // callback 开始加载后清空，防止再次 loadWeb 重复加载同一 callback。
            pendingAuthReturn = null
            webView.loadUrl(url)
        } else {
            webView.reload()
        }
    }

    /**
     * auth transaction 失败恢复：退出 auth flow，不无限 reload、不停留在空白 WebView，
     * 返回可操作的 WotBTools 首页并给出明确的「登录失败，请重试」提示。
     * 仅此路径导航回首页；普通 WebView error（含任意 HTTP 500）保持既有行为，不触发本恢复。
     */
    private fun enterAuthFailureRecovery(reasonHost: String?) {
        val wasInAuthFlow = inAuthFlow
        inAuthFlow = false
        Log.d(
            TAG,
            "auth-recovery host=${reasonHost ?: "null"} inAuthFlow=$wasInAuthFlow->false"
        )
        toast(getString(R.string.auth_login_failed_retry))
        // 明确回首页，而不是 reload 当前（可能损坏的）auth URL，避免无限循环。
        webView.loadUrl(BASE_URL)
    }

    /**
     * Verified native login handoff (e.g. QQ `wtloginmqq://ptlogin`): hand the URI to the app
     * that owns it (ACTION_VIEW) while keeping the current WebView auth transaction alive.
     *
     * - Never enters auth-failure recovery, never reloads BASE_URL, never clears the auth-flow
     *   marker, and never falls back to the system browser.
     * - On no handler (QQ not installed) we show a clear prompt and stay in the current state;
     *   the user can install the app and retry, or back out manually.
     * - Logs only scheme/host/error category — never the full URI, query, code, or token.
     */
    private fun launchNativeAuthHandoff(uri: Uri, scheme: String?, host: String?) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
            Log.d(TAG, "native-handoff-failed scheme=${scheme ?: "null"} host=${host ?: "null"} category=no-qq-app")
            toast(getString(R.string.qq_client_missing_retry))
        } catch (e: Exception) {
            Log.d(TAG, "native-handoff-failed scheme=${scheme ?: "null"} host=${host ?: "null"} category=${e.javaClass.simpleName}")
            toast(getString(R.string.qq_client_missing_retry))
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
        // 热启动返回：verified auth return（QQ broker callback）恒为最高优先级，归 auth 所有，
        // 绝不进入 replay ingress / 分发（handleAuthReturnHot 语义未变）。
        if (handleAuthReturnHot(intent)) return
        val storedReplay = handleIncomingIntent(intent)
        if (storedReplay && inAuthFlow) {
            // RC5 navigation ownership：auth flow 期间 replay 只入队，绝不 loadUrl / evaluateJavascript。
            Log.d(TAG, "replay-pending deferred reason=auth-flow")
        }
        dispatchPendingReplayIfAllowed()
    }

    /**
     * pending replay 的唯一分发点。
     *
     * 「是否分发 / 怎么分发」完全由纯策略 [ReplayDispatchPolicy] 决定（JVM 单测覆盖），这里只执行动作：
     * 无 pending / auth flow 内 / WebView 容器不可见 → 不分发；已在 replay workspace → 通知 Web；否则切到
     * replay canonical view。auth 结束后刻意不新增「重新导航 replay」的第二套来源：登录完成后 Web 应用会
     * 重新加载并经 Native Bridge 自行消费 pending。
     */
    private fun dispatchPendingReplayIfAllowed() {
        val action = ReplayDispatchPolicy.decide(
            hasPendingReplay = pendingReplay != null,
            inAuthFlow = inAuthFlow,
            webViewVisible = webViewContainer.visibility == View.VISIBLE,
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
     * 登录期间被杀后恢复出来的 replay 会被一个无关 intent（如 launcher ACTION_MAIN）立刻丢掉。
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

    // ── Auth return（QQ native 登录 → verified App Link → 原 WebView）──

    /**
     * 冷启动：QQ App 在前台期间本进程被杀，App Link 经 onCreate(intent) 进入。
     * 记录 verified auth return 为 pendingAuthReturn 并置 inAuthFlow=true；
     * startup gate（网络/版本/强制更新）通过后由 entryUrl() 加载，不绕过强制更新。
     */
    private fun handleAuthReturnColdStart(intent: Intent): Boolean {
        val uri = intent.data ?: return false
        if (!verifyAuthReturn(intent, uri)) return false
        pendingAuthReturn = uri
        inAuthFlow = true
        Log.d(TAG, "auth-return action=ALLOW_AUTH_RETURN source=app-link cold=true")
        return true
    }

    /**
     * 热启动：App 已在运行（QQ 在前台期间未被杀），App Link 经 onNewIntent(intent) 进入。
     * 复用当前 WebView / CookieManager，把 callback URI 载回原 WebView，inAuthFlow 保持 true。
     */
    private fun handleAuthReturnHot(intent: Intent): Boolean {
        val uri = intent.data ?: return false
        if (!verifyAuthReturn(intent, uri)) return false
        inAuthFlow = true
        hideAllGates()
        webViewContainer.visibility = View.VISIBLE
        Log.d(TAG, "auth-return action=ALLOW_AUTH_RETURN source=app-link hot=true")
        webView.post { webView.loadUrl(uri.toString()) }
        return true
    }

    /** defense-in-depth 路由边界：仅接受验证的 Juhe QQ broker callback；不解释 state/code 载荷。 */
    private fun verifyAuthReturn(intent: Intent, uri: Uri): Boolean {
        if (intent.action != Intent.ACTION_VIEW) return false
        return AuthReturnPolicy.isVerifiedBrokerReturn(
            scheme = uri.scheme,
            host = uri.host,
            path = uri.path,
            type = uri.getQueryParameter("type"),
            hasState = !uri.getQueryParameter("state").isNullOrBlank(),
            hasCode = !uri.getQueryParameter("code").isNullOrBlank()
        )
    }

    // ── Native Bridge 白名单能力（供 Vue 端；origin-scoped）──

    fun bridgeCapabilities(): List<String> = listOf("replay-share", "replay-open", "app-update")

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

    // ── 通用 ──

    private fun hideAllGates() {
        networkGateView.visibility = View.GONE
        versionGateView.visibility = View.GONE
        webErrorView.visibility = View.GONE
        webViewContainer.visibility = View.GONE
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

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
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
        webViewContainer.removeAllViews()
        webView.destroy()
        executor.shutdown()
        super.onDestroy()
    }
}
