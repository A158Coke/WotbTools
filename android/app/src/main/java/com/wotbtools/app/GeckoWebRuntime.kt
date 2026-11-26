package com.wotbtools.app

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.View
import com.wotbtools.app.NavigationPolicy.MainFrameNavigation
import org.json.JSONObject
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.ContentBlocking
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSession.NavigationDelegate
import org.mozilla.geckoview.GeckoSession.PermissionDelegate
import org.mozilla.geckoview.GeckoSession.PromptDelegate
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebExtension
import org.mozilla.geckoview.WebResponse
import org.mozilla.geckoview.WebRequestError

internal class GeckoWebRuntime(
    private val context: Context,
    private val view: GeckoView,
    private val host: Host
) {
    interface Host {
        fun onBridgeMessage(json: String, reply: (String) -> Unit)
        fun onExternalNavigation(uri: String)
        fun onFullScreen(fullScreen: Boolean)
        fun onExternalResponse(response: WebResponse)
        fun onFilePrompt(prompt: PromptDelegate.FilePrompt): GeckoResult<PromptDelegate.PromptResponse>
        fun onRuntimeFailure(crashLoop: Boolean)
        fun onContentPainted()
        fun onContentUnavailable()
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val session = GeckoSession()
    private var extension: WebExtension? = null
    private var extensionRequested = false
    private var port: WebExtension.Port? = null
    private var pendingUri: String? = null
    private val recovery = RuntimeRecovery()
    private var closed = false
    private val recentCrashes = ArrayDeque<Long>()
    private var crashCount = 0
    private var killCount = 0
    private var lastFailure = "none"
    private val choiceDialogs = GeckoChoiceDialogs(context) { closed }

    var currentUrl: String? = null
        private set
    var canGoBack = false
        private set

    fun load(uri: String) {
        if (closed) return
        recovery.requested(uri)
        pendingUri = uri
        if (extension == null) {
            requestExtension()
            return
        }
        pendingUri = null
        if (!session.isOpen) {
            session.open(runtime(context))
            attachBridge()
        }
        session.loadUri(uri)
    }

    fun reload() {
        val url = currentUrl
        if (url.isNullOrEmpty()) return
        if (!session.isOpen) load(url) else session.reload()
    }

    fun goBack() = session.goBack()

    fun exitFullScreen() = session.exitFullScreen()

    fun postEvent(global: String) {
        port?.let { post(it, JSONObject().put("type", "event").put("global", global)) }
    }

    fun onResume() {
        recovery.onResume()?.let {
            host.onContentUnavailable()
            load(it)
        }
    }

    fun close() {
        closed = true
        recovery.close()
        choiceDialogs.dismiss()
        port = null
        extension?.let { session.webExtensionController.setMessageDelegate(it, null, NATIVE_APP) }
        session.close()
    }

    fun diagnostics(): String =
        "GeckoView ${BuildConfig.GECKOVIEW_VERSION} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · " +
            "${Build.MANUFACTURER} ${Build.MODEL} · ${Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"} · " +
            "bridge v${BuildConfig.NATIVE_BRIDGE_VERSION} · crash=$crashCount kill=$killCount last=$lastFailure"

    private fun requestExtension() {
        if (extension != null || extensionRequested || closed) return
        extensionRequested = true
        withExtension(context, { ext ->
            extensionRequested = false
            if (closed) return@withExtension
            extension = ext
            attachBridge()
            pendingUri?.let { load(it) }
        }, {
            extensionRequested = false
            if (closed) return@withExtension
            lastFailure = "extension-install"
            host.onRuntimeFailure(crashLoop = false)
        })
    }

    private fun attachBridge() {
        val ext = extension ?: return
        session.webExtensionController.setMessageDelegate(ext, messageDelegate, NATIVE_APP)
    }

    private val messageDelegate = object : WebExtension.MessageDelegate {
        override fun onConnect(port: WebExtension.Port) {
            val sender = port.sender
            val trusted = sender.environmentType == WebExtension.MessageSender.ENV_TYPE_CONTENT_SCRIPT &&
                sender.isTopLevel && sender.session === session && MainActivity.isLocalAppUrl(sender.url)
            if (!trusted) {
                Log.w(TAG, "bridge port rejected")
                port.disconnect()
                return
            }
            this@GeckoWebRuntime.port = port
            port.setDelegate(object : WebExtension.PortDelegate {
                override fun onPortMessage(message: Any, port: WebExtension.Port) {
                    val json = message as? JSONObject ?: return
                    if (json.optString("type") != "rpc") return
                    val data = json.opt("data") as? String ?: return
                    host.onBridgeMessage(data) { reply ->
                        post(port, JSONObject().put("type", "reply").put("data", reply))
                    }
                }

                override fun onDisconnect(port: WebExtension.Port) {
                    if (this@GeckoWebRuntime.port === port) this@GeckoWebRuntime.port = null
                }
            })
            post(port, JSONObject().put("type", "ready"))
        }
    }

    private fun post(target: WebExtension.Port, message: JSONObject) {
        mainHandler.post {
            if (closed || port !== target) return@post
            try {
                target.postMessage(message)
            } catch (e: Exception) {
                Log.d(TAG, "bridge-reply dropped category=${e.javaClass.simpleName}")
            }
        }
    }

    private fun navigationDelegate() = object : NavigationDelegate {
        override fun onLocationChange(
            session: GeckoSession,
            url: String?,
            perms: List<PermissionDelegate.ContentPermission>,
            hasUserGesture: Boolean
        ) {
            currentUrl = url
            recovery.committed(url)
        }

        override fun onCanGoBack(session: GeckoSession, canGoBack: Boolean) {
            this@GeckoWebRuntime.canGoBack = canGoBack
        }

        override fun onLoadRequest(
            session: GeckoSession,
            request: NavigationDelegate.LoadRequest
        ): GeckoResult<AllowOrDeny> {
            val uri = request.uri
            return when (NavigationPolicy.classifyMainFrameNavigation(uri)) {
                MainFrameNavigation.LOCAL, MainFrameNavigation.BLANK -> {
                    if (request.target != NavigationDelegate.TARGET_WINDOW_NEW) {
                        GeckoResult.fromValue(AllowOrDeny.ALLOW)
                    } else {
                        mainHandler.post { load(uri) }
                        GeckoResult.fromValue(AllowOrDeny.DENY)
                    }
                }
                MainFrameNavigation.BLOB_DOWNLOAD -> {
                    Log.d(TAG, "nav blob download")
                    GeckoResult.fromValue(AllowOrDeny.ALLOW)
                }
                MainFrameNavigation.EXTERNAL -> {
                    Log.d(TAG, "nav external scheme=${uri.substringBefore(':', "").lowercase()}")
                    host.onExternalNavigation(uri)
                    GeckoResult.fromValue(AllowOrDeny.DENY)
                }
                MainFrameNavigation.DENY -> {
                    Log.d(TAG, "nav denied scheme=${uri.substringBefore(':', "").lowercase()}")
                    GeckoResult.fromValue(AllowOrDeny.DENY)
                }
            }
        }

        override fun onSubframeLoadRequest(
            session: GeckoSession,
            request: NavigationDelegate.LoadRequest
        ): GeckoResult<AllowOrDeny> = GeckoResult.fromValue(
            if (MainActivity.isLocalAppUrl(request.uri)) AllowOrDeny.ALLOW else AllowOrDeny.DENY
        )

        override fun onNewSession(session: GeckoSession, uri: String): GeckoResult<GeckoSession>? = null

        override fun onLoadError(
            session: GeckoSession,
            uri: String?,
            error: WebRequestError
        ): GeckoResult<String>? {
            if (uri != null && MainActivity.isLocalAppUrl(uri)) {
                lastFailure = "load-error-${error.code}"
                host.onRuntimeFailure(crashLoop = false)
            }
            return null
        }
    }

    private fun contentDelegate() = object : GeckoSession.ContentDelegate {
        override fun onFullScreen(session: GeckoSession, fullScreen: Boolean) = host.onFullScreen(fullScreen)

        override fun onExternalResponse(session: GeckoSession, response: WebResponse) = host.onExternalResponse(response)

        override fun onCrash(session: GeckoSession) {
            crashCount++
            lastFailure = "content-crash"
            port = null
            val now = SystemClock.elapsedRealtime()
            while (recentCrashes.isNotEmpty() && now - recentCrashes.first() > CRASH_WINDOW_MS) recentCrashes.removeFirst()
            recentCrashes.addLast(now)
            Log.w(TAG, "content process crashed count=$crashCount")
            if (recentCrashes.size >= 2) {
                host.onRuntimeFailure(crashLoop = true)
            } else {
                host.onContentUnavailable()
                recovery.onCrash()?.let { load(it) }
            }
        }

        override fun onKill(session: GeckoSession) {
            killCount++
            lastFailure = "content-kill"
            port = null
            Log.w(TAG, "content process killed count=$killCount")
            host.onContentUnavailable()
            recovery.onKill(visible = view.windowVisibility == View.VISIBLE)?.let { load(it) }
        }

        override fun onFirstContentfulPaint(session: GeckoSession) = host.onContentPainted()

        override fun onPaintStatusReset(session: GeckoSession) {
            Log.d(TAG, "paint status reset")
            host.onContentUnavailable()
        }
    }

    private val denyAllPermissions = object : PermissionDelegate {
        override fun onAndroidPermissionsRequest(
            session: GeckoSession,
            permissions: Array<out String>?,
            callback: PermissionDelegate.Callback
        ) = callback.reject()

        override fun onContentPermissionRequest(
            session: GeckoSession,
            perm: PermissionDelegate.ContentPermission
        ): GeckoResult<Int> = GeckoResult.fromValue(PermissionDelegate.ContentPermission.VALUE_DENY)

        override fun onMediaPermissionRequest(
            session: GeckoSession,
            uri: String,
            video: Array<out PermissionDelegate.MediaSource>?,
            audio: Array<out PermissionDelegate.MediaSource>?,
            callback: PermissionDelegate.MediaCallback
        ) = callback.reject()
    }

    init {
        session.navigationDelegate = navigationDelegate()
        session.contentDelegate = contentDelegate()
        session.promptDelegate = object : PromptDelegate {
            override fun onFilePrompt(
                session: GeckoSession,
                prompt: PromptDelegate.FilePrompt
            ): GeckoResult<PromptDelegate.PromptResponse> = host.onFilePrompt(prompt)

            override fun onChoicePrompt(
                session: GeckoSession,
                prompt: PromptDelegate.ChoicePrompt
            ): GeckoResult<PromptDelegate.PromptResponse> =
                GeckoResult<PromptDelegate.PromptResponse>().also { choiceDialogs.showChoicePrompt(prompt, it) }
        }
        session.permissionDelegate = denyAllPermissions
        session.open(runtime(context))
        view.setSession(session)
        requestExtension()
    }

    private companion object {
        const val TAG = "WotbRuntime"
        const val NATIVE_APP = "wotbtools"
        const val EXTENSION_URI = "resource://android/assets/gecko-bridge/"
        const val CRASH_WINDOW_MS = 60_000L

        private var runtime: GeckoRuntime? = null
        private var installedExtension: WebExtension? = null
        private var installing: MutableList<Pair<(WebExtension) -> Unit, () -> Unit>>? = null

        private fun writeRuntimeConfig(context: Context): String {
            val file = java.io.File(context.filesDir, GeckoRuntimeConfig.FILE_NAME)
            return try {
                val body = GeckoRuntimeConfig.yaml()
                if (!file.exists() || file.readText() != body) file.writeText(body)
                file.absolutePath
            } catch (e: java.io.IOException) {
                Log.w(TAG, "gecko config write failed category=${e.javaClass.simpleName}")
                ""
            }
        }

        fun runtime(context: Context): GeckoRuntime = runtime ?: GeckoRuntime.create(
            context.applicationContext,
            GeckoRuntimeSettings.Builder()
                .configFilePath(writeRuntimeConfig(context.applicationContext))
                .remoteDebuggingEnabled(BuildConfig.DEBUG)
                .consoleOutput(BuildConfig.DEBUG)
                .aboutConfigEnabled(false)
                .contentBlocking(
                    ContentBlocking.Settings.Builder()
                        .safeBrowsing(ContentBlocking.SafeBrowsing.NONE)
                        .build()
                )
                .build()
        ).also { runtime = it }

        fun withExtension(context: Context, onReady: (WebExtension) -> Unit, onFailure: () -> Unit) {
            installedExtension?.let { onReady(it); return }
            installing?.let { it.add(onReady to onFailure); return }
            val waiters = mutableListOf(onReady to onFailure)
            installing = waiters
            runtime(context).webExtensionController.installBuiltIn(EXTENSION_URI).accept({ ext ->
                installing = null
                if (ext == null) {
                    waiters.forEach { it.second() }
                } else {
                    installedExtension = ext
                    waiters.forEach { it.first(ext) }
                }
            }, { error ->
                installing = null
                Log.e(TAG, "bridge extension install failed category=${error?.javaClass?.simpleName}")
                waiters.forEach { it.second() }
            })
        }
    }
}

internal class RuntimeRecovery {
    private var target: String? = null
    private var resumePending = false
    private var closed = false

    fun requested(uri: String) {
        if (MainActivity.isLocalAppUrl(uri)) target = uri
    }

    fun committed(url: String?) {
        if (url != null && MainActivity.isLocalAppUrl(url)) target = url
    }

    fun onKill(visible: Boolean): String? {
        if (closed) return null
        if (!visible) {
            resumePending = true
            return null
        }
        resumePending = false
        return recoveryUri()
    }

    fun onResume(): String? {
        if (closed || !resumePending) return null
        resumePending = false
        return recoveryUri()
    }

    fun onCrash(): String? = if (closed) null else recoveryUri()

    fun close() {
        closed = true
        resumePending = false
    }

    private fun recoveryUri(): String = target ?: MainActivity.LOCAL_APP_ENTRY
}
