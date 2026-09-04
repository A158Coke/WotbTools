package com.wotbtools.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
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
 * 现有 Web upload pipeline；origin-scoped Native Bridge（仅 wotbtools.com/www 可用）。
 */
class MainActivity : Activity() {

    companion object {
        private const val BASE_URL = "https://wotbtools.com"
        private const val REPLAY_URL = BASE_URL + "?view=replay"
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
        // startup 清理 orphan replay cache，再处理冷启动 intent（可能新增一份）。
        ReplayIntentHandler.cleanupOrphans(this)
        handleIncomingIntent(intent)
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
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: WebChromeClient.FileChooserParams
            ): Boolean {
                val pending = pendingReplay
                if (pending != null && pendingReplayEligible) {
                    // 分享/打开导入：回传 app-owned FileProvider URI（已复制到 private cache），
                    // 复用现有 FileUploader/validate/upload pipeline（规格 §39）。
                    pendingReplayEligible = false
                    callback.onReceiveValue(arrayOf(pending.uri))
                    clearPendingReplay()
                    return true
                }
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
                val decision = AuthNavigationPolicy.decide(host, inAuthFlow)
                inAuthFlow = decision.inAuthFlow
                Log.d(
                    TAG,
                    "pageStart scheme=${scheme ?: "null"} host=${host ?: "null"} action=${decision.action} " +
                        "inAuthFlow=$before->$inAuthFlow mainFrame=true " +
                        "source=${AuthNavigationPolicy.sourceCategory(host)}"
                )
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                val host = request.url.host
                val scheme = request.url.scheme
                val before = inAuthFlow
                val decision = AuthNavigationPolicy.decide(host, inAuthFlow)
                inAuthFlow = decision.inAuthFlow
                val source = AuthNavigationPolicy.sourceCategory(host)
                Log.d(
                    TAG,
                    "nav scheme=${scheme ?: "null"} host=${host ?: "null"} action=${decision.action} " +
                        "inAuthFlow=$before->$inAuthFlow mainFrame=true source=$source"
                )
                if (decision.action == AuthNavigationAction.AUTH_FAILURE) {
                    // 未验证 host 进入 auth flow：阻断该导航并进入 auth-failure recovery。
                    enterAuthFailureRecovery(host)
                    return true
                }
                if (host == null) return false
                if (decision.action != AuthNavigationAction.OPEN_EXTERNAL) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (_: Exception) {
                    // 无可用 browser 时忽略，留在原页。
                }
                return true
            }

            /**
             * Android 外部 replay handoff：Web 侧 readPendingFile 用 fetch(pending.uri) 读取字节。
             * 该 content:// URI 指向 app private cache（FileProvider），这里拦截并返回文件流，
             * 让字节「app-owned 安全路径」进入现有上传管线。绝不 Base64 / file:// / 放宽 WebView 边界。
             */
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val pending = pendingReplay ?: return null
                if (pending.uri.toString() != request.url.toString()) return null
                val file = pending.file
                return try {
                    if (!file.exists()) {
                        WebResourceResponse("application/octet-stream", "utf-8", 404, "Not Found", null, null)
                    } else {
                        WebResourceResponse(
                            "application/octet-stream",
                            "utf-8",
                            200,
                            "OK",
                            mapOf("Access-Control-Allow-Origin" to "*"),
                            file.inputStream()
                        )
                    }
                } catch (_: Exception) {
                    null
                }
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

    private fun entryUrl(): String = if (pendingReplay != null) REPLAY_URL else BASE_URL

    private fun loadWeb() {
        hideAllGates()
        webViewContainer.visibility = View.VISIBLE
        if (webView.url.isNullOrEmpty()) webView.loadUrl(entryUrl())
        else webView.reload()
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
        handleIncomingIntent(intent)
        val replayPending = pendingReplay != null
        if (replayPending && webViewContainer.visibility == View.VISIBLE) {
            val current = webView.url
            if (current != null && current.contains("view=replay")) {
                // 已在 replay workspace：直接通知导入（exactly-once 由 pending 被消费清空保证）。
                webView.post {
                    webView.evaluateJavascript("window.wotbtoolsOnReplay && window.wotbtoolsOnReplay()", null)
                }
            } else {
                // 切到 replay canonical view；ReplayPage 就绪后消费。
                webView.post { webView.loadUrl(REPLAY_URL) }
            }
        }
    }

    private fun handleIncomingIntent(intent: Intent?) {
        val pending = ReplayIntentHandler.fromIntent(this, intent)
        pendingReplay = pending
        pendingReplayEligible = pending != null
    }

    private fun clearPendingReplay() {
        // 重要：chooser 返回 URI 后 WebView/Chromium 仍可能读取该文件，不能立即删除 backing file。
        // 只标记已消费、不可再次注入；文件保留到下一次 app startup cleanupOrphans() 安全清理。
        pendingReplay = null
        pendingReplayEligible = false
    }

    // ── Native Bridge 白名单能力（供 Vue 端；origin-scoped）──

    fun bridgeCapabilities(): List<String> = listOf("replay-share", "replay-open", "app-update")

    fun bridgePendingReplayJson(): Any {
        val pending = pendingReplay?.takeIf { pendingReplayEligible } ?: return org.json.JSONObject.NULL
        return org.json.JSONObject()
            .put("name", pending.name)
            .put("size", pending.size)
            .put("uri", pending.uri.toString())
    }

    fun bridgeConsumePendingReplay(): Boolean {
        val had = pendingReplay != null
        clearPendingReplay()
        return had
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
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        webViewContainer.removeAllViews()
        webView.destroy()
        executor.shutdown()
        super.onDestroy()
    }
}
