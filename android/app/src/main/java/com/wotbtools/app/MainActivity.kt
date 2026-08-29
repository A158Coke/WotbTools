package com.wotbtools.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * WotBTools Android 壳 —— 现有 Vue 的纯联网 Thin Client。
 *
 * 职责：网络/版本门禁（fail-closed）→ 远程加载 https://wotbtools.com；
 * Replay 意图（ACTION_SEND/ACTION_VIEW）→ 经 onShowFileChooser 把 content URI 交给现有
 * Web upload pipeline；极薄 Native Bridge 能力探测。不解析 replay、不重复业务规则。
 */
class MainActivity : Activity() {

    companion object {
        private const val PRODUCTION_URL = "https://wotbtools.com"
        private const val BASE_URL = "https://wotbtools.com"
        private const val FILE_CHOOSER_REQUEST = 1001
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

    private lateinit var apkUpdater: ApkUpdater
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()

    private var pendingReplay: PendingReplay? = null
    private var pendingReplayEligible = true
    private var latestManifest: VersionManifest? = null
    private var downloadedApk: File? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

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
        versionPrimaryButton = findViewById(R.id.versionPrimaryButton)
        versionLaterButton = findViewById(R.id.versionLaterButton)

        apkUpdater = ApkUpdater(this)

        findViewById<Button>(R.id.retryButton).setOnClickListener { hideAllGates(); startStartupFlow() }
        webErrorRetryButton.setOnClickListener { hideAllGates(); loadWeb() }
        versionPrimaryButton.setOnClickListener { startUpdate() }
        versionLaterButton.setOnClickListener { loadWeb() }

        configureWebView()
        handleIncomingIntent(intent)
        startStartupFlow()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.setGeolocationEnabled(false)
        webView.addJavascriptInterface(NativeBridge(this), "WotbNative")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                val pending = pendingReplay
                if (pending != null && pendingReplayEligible) {
                    // 分享/打开导入：把 content URI 直接回传给 Web <input type="file">，
                    // 复用现有 FileUploader/validate/upload pipeline（规格 §39）。
                    pendingReplayEligible = false
                    callback.onReceiveValue(arrayOf(pending.uri))
                    clearPendingReplay()
                    return true
                }
                // 用户手动选择：启动系统文件选择器。
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
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val host = request.url.host ?: return false
                if (TrustedHosts.isTrusted(host)) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (_: Exception) {
                }
                return true
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (request.isForMainFrame) showWebError()
            }
        }
    }

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
                    // fail-closed：manifest 获取失败 → 不允许进入业务
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

    private fun loadWeb() {
        hideAllGates()
        webViewContainer.visibility = android.view.View.VISIBLE
        if (webView.url.isNullOrEmpty()) webView.loadUrl(BASE_URL)
        else webView.reload()
    }

    private fun showNetworkGate() {
        hideAllGates()
        networkGateView.visibility = android.view.View.VISIBLE
    }

    private fun showWebError() {
        hideAllGates()
        webErrorView.visibility = android.view.View.VISIBLE
    }

    private fun showMandatoryUpdate(manifest: VersionManifest, installed: Int) {
        hideAllGates()
        versionGateView.visibility = android.view.View.VISIBLE
        versionTitle.text = getString(R.string.update_mandatory_title)
        versionMessage.text = getString(R.string.update_mandatory_message)
        versionCurrent.text = getString(R.string.update_current_version, installed.toString())
        versionLatest.text = getString(R.string.update_latest_version, manifest.latestVersionName)
        versionPrimaryButton.text = getString(R.string.update_now)
        versionLaterButton.visibility = android.view.View.GONE
    }

    private fun showOptionalUpdate(manifest: VersionManifest, installed: Int) {
        hideAllGates()
        versionGateView.visibility = android.view.View.VISIBLE
        versionTitle.text = getString(R.string.update_optional_title)
        versionMessage.text = getString(R.string.update_optional_message)
        versionCurrent.text = getString(R.string.update_current_version, installed.toString())
        versionLatest.text = getString(R.string.update_latest_version, manifest.latestVersionName)
        versionPrimaryButton.text = getString(R.string.update_now)
        versionLaterButton.visibility = android.view.View.VISIBLE
        versionLaterButton.text = getString(R.string.update_later)
    }

    private fun startUpdate() {
        val manifest = latestManifest ?: return
        val apkUrl = manifest.apkUrl
        if (apkUrl.isNullOrBlank()) {
            toast(getString(R.string.update_apk_unavailable))
            return
        }
        versionPrimaryButton.isEnabled = false
        versionPrimaryButton.text = getString(R.string.update_downloading)
        executor.execute {
            val result = apkUpdater.downloadAndInstall(apkUrl, manifest.sha256)
            runOnUiThread {
                versionPrimaryButton.isEnabled = true
                versionPrimaryButton.text = getString(R.string.update_now)
                when (result) {
                    is ApkUpdater.Result.Ok -> {
                        downloadedApk = result.apk
                        if (!installDownloadedApk()) {
                            openInstallPermissionSettings()
                        }
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
        // 用户从「未知来源」设置返回后重试安装；未授权前绝不能进业务（强制更新屏仍占用）。
        if (downloadedApk != null && versionGateView.visibility == android.view.View.VISIBLE) {
            if (!installDownloadedApk()) {
                versionPrimaryButton.text = getString(R.string.update_downloading)
                versionPrimaryButton.isEnabled = false
            }
        }
    }

    // ── 生命周期：Replay 意图（冷启动 / 热启动 / 后台恢复）──

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
        pendingReplay?.let {
            webView.post { webView.evaluateJavascript("window.wotbtoolsOnReplay && window.wotbtoolsOnReplay()", null) }
        }
    }

    private fun handleIncomingIntent(intent: Intent?) {
        pendingReplay = ReplayIntentHandler.fromIntent(intent, contentResolver)
        pendingReplayEligible = pendingReplay != null
    }

    private fun clearPendingReplay() {
        pendingReplay = null
        pendingReplayEligible = false
    }

    // ── Native Bridge 白名单能力（供 Vue 端使用）──

    fun bridgeCapabilities(): List<String> {
        // 原生能力是「App 支持该通道」的静态声明，与当前是否有 pending replay 无关。
        return listOf("replay-share", "replay-open", "app-update")
    }

    fun bridgePendingReplay(): PendingReplay? = pendingReplay?.takeIf { pendingReplayEligible }

    fun bridgeConsumePendingReplay(): Boolean {
        val had = pendingReplay != null
        clearPendingReplay()
        return had
    }

    fun bridgeCheckForUpdate(): Boolean {
        val manifest = latestManifest ?: return false
        return installedVersionCode() < manifest.latestVersionCode
    }

    fun bridgeStartUpdate(): Boolean {
        startUpdate()
        return true
    }

    // ── 通用 ──

    private fun hideAllGates() {
        networkGateView.visibility = android.view.View.GONE
        versionGateView.visibility = android.view.View.GONE
        webErrorView.visibility = android.view.View.GONE
        webViewContainer.visibility = android.view.View.GONE
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

    /** WebView 内允许停留的 origin；其它外链走系统浏览器（规格 §28/§87）。 */
    private object TrustedHosts {
        val allowed = setOf(
            "wotbtools.com",
            "www.wotbtools.com",
            "auth.wotbtools.com"
        )
        fun isTrusted(host: String): Boolean = host in allowed
    }
}
