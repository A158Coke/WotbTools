package com.wotbtools.app

import android.app.AlertDialog
import android.content.Context
import android.content.DialogInterface
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

/**
 * GeckoView 引擎适配（Android 3.0 起取代 System WebView）。
 *
 * 所有权：进程级 [GeckoRuntime] + 内置 bridge 扩展（companion，懒创建，只在主进程）；Activity 级
 * [GeckoSession] 与 delegates（本类实例）。引擎只承载 [MainActivity.LOCAL_APP_ORIGIN] 一个 origin：
 * 外部 `https:` / `mailto:` 交系统浏览器，其余一律拒绝（唯一例外见 [NavigationPolicy]：内嵌 origin 等于
 * 本机 origin 的 `blob:` 下载派发）；权限请求一律拒绝。
 *
 * Bridge：内置扩展的 content script 暴露与 v2 同形的 `window.WotbNative`，经 native messaging port 到这里；
 * 只接受「content script ∧ top frame ∧ 本 session ∧ exact local origin」的 port，消息原样交给
 * [NativeBridge]，因此 RPC 语义完全不变（contracts/android-native-bridge.json）。
 *
 * 故障：content 进程 crash 首次自动重开并重载当前页，[CRASH_WINDOW_MS] 内第二次交给宿主显示错误页，避免重启风暴；
 * 低内存 kill 不算故障，回到前台时静默重载。Gecko parent 进程在 App 进程内，它的 native crash 不在此范围。
 */
internal class GeckoWebRuntime(
    private val context: Context,
    private val view: GeckoView,
    private val host: Host
) {
    /** 宿主（MainActivity）提供的系统能力；全部在主线程回调。 */
    interface Host {
        fun onBridgeMessage(json: String, reply: (String) -> Unit)
        fun onExternalNavigation(uri: String)
        fun onFullScreen(fullScreen: Boolean)
        fun onExternalResponse(response: WebResponse)
        fun onFilePrompt(prompt: PromptDelegate.FilePrompt): GeckoResult<PromptDelegate.PromptResponse>
        /** [crashLoop] = content 进程短时间内连续崩溃；否则为本地页面 / 扩展加载失败。 */
        fun onRuntimeFailure(crashLoop: Boolean)
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val session = GeckoSession()
    private var extension: WebExtension? = null
    private var extensionRequested = false
    private var port: WebExtension.Port? = null
    private var pendingUri: String? = null
    private var killed = false
    private var closed = false
    private val recentCrashes = ArrayDeque<Long>()
    private var crashCount = 0
    private var killCount = 0
    private var lastFailure = "none"
    private var choiceDialog: AlertDialog? = null

    /** 当前主文档 URL（取代 `WebView.url`）；尚未加载过任何页面时为 null。 */
    var currentUrl: String? = null
        private set
    var canGoBack = false
        private set

    /** 扩展就绪（message delegate 已注册）之前不加载页面：首屏前 bridge 必须可用。 */
    fun load(uri: String) {
        if (closed) return
        pendingUri = uri
        if (extension == null) {
            requestExtension() // 安装失败后，错误页的「重新加载」从这里重试
            return
        }
        pendingUri = null
        session.loadUri(uri)
    }

    fun reload() {
        val url = currentUrl
        if (url.isNullOrEmpty()) return
        if (!session.isOpen) reopen(url) else session.reload()
    }

    fun goBack() = session.goBack()

    fun exitFullScreen() = session.exitFullScreen()

    /** Native → Web 事件；global 必须是 contract events 之一（bridge.js 只认白名单）。 */
    fun postEvent(global: String) {
        port?.let { post(it, JSONObject().put("type", "event").put("global", global)) }
    }

    /** 低内存 kill 后回到前台：静默重开并重载被杀前的页面。 */
    fun onResume() {
        if (!killed || closed) return
        killed = false
        reopen(currentUrl ?: return)
    }

    fun close() {
        closed = true
        choiceDialog?.dismiss()
        port = null
        extension?.let { session.webExtensionController.setMessageDelegate(it, null, NATIVE_APP) }
        session.close()
    }

    /** 错误页 / logcat 共用的一行诊断（不含任何账号、文件或回放信息）。 */
    fun diagnostics(): String =
        "GeckoView ${BuildConfig.GECKOVIEW_VERSION} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · " +
            "${Build.MANUFACTURER} ${Build.MODEL} · ${Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"} · " +
            "bridge v${BuildConfig.NATIVE_BRIDGE_VERSION} · crash=$crashCount kill=$killCount last=$lastFailure"

    private fun reopen(uri: String) {
        if (closed) return
        if (!session.isOpen) session.open(runtime(context))
        attachBridge()
        load(uri)
    }

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

    /** Port 只能在主线程使用；回复可能来自 bridge 的后台线程，且可能晚于页面销毁（丢弃即可，JS 侧有超时）。 */
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

    /**
     * HTML `<select>` 的原生选择菜单（Gecko 把 select 点击转成 choice prompt；默认实现返回 null = 取消，
     * 页面就无法改选）。optgroup 展开为不可选的组标题，disabled 选项不可选。生命周期：页面侧关闭弹窗
     * （导航 / 元素移除）收起对话框并完成 result；弹窗打开期间选项更新时用新 prompt 重绘，结果仍回给同一个 [result]。
     */
    private fun showChoicePrompt(
        prompt: PromptDelegate.ChoicePrompt,
        result: GeckoResult<PromptDelegate.PromptResponse>
    ) {
        choiceDialog?.dismiss()
        choiceDialog = null
        if (closed) {
            result.complete(prompt.dismiss())
            return
        }
        var settled = false
        fun settle(response: () -> PromptDelegate.PromptResponse) {
            if (settled) return
            settled = true
            prompt.setDelegate(null)
            result.complete(response())
        }
        val rows = ArrayList<Pair<PromptDelegate.ChoicePrompt.Choice, Int>>()
        fun collect(choices: Array<PromptDelegate.ChoicePrompt.Choice>, depth: Int) {
            for (choice in choices) {
                if (choice.separator) continue
                rows.add(choice to depth)
                choice.items?.let { collect(it, depth + 1) }
            }
        }
        collect(prompt.choices, 0)
        val labels = rows.map { (choice, depth) -> "　".repeat(depth) + choice.label }.toTypedArray()
        fun selectable(index: Int) = rows[index].first.let { !it.disabled && it.items == null }

        val builder = AlertDialog.Builder(context)
        prompt.title?.takeIf { it.isNotBlank() }?.let { builder.setTitle(it) }
        if (prompt.type == PromptDelegate.ChoicePrompt.Type.MULTIPLE) {
            val checked = BooleanArray(rows.size) { rows[it].first.selected }
            builder.setMultiChoiceItems(labels, checked) { dialog, which, isChecked ->
                if (selectable(which)) checked[which] = isChecked
                else (dialog as AlertDialog).listView.setItemChecked(which, checked[which])
            }
            builder.setPositiveButton(android.R.string.ok) { _, _ ->
                settle { prompt.confirm(rows.indices.filter { checked[it] }.map { rows[it].first }.toTypedArray()) }
            }
            builder.setNegativeButton(android.R.string.cancel, null)
        } else {
            val onPick = DialogInterface.OnClickListener { dialog, which ->
                if (!selectable(which)) return@OnClickListener
                settle { prompt.confirm(rows[which].first) }
                dialog.dismiss()
            }
            if (prompt.type == PromptDelegate.ChoicePrompt.Type.MENU) builder.setItems(labels, onPick)
            else builder.setSingleChoiceItems(labels, rows.indexOfFirst { it.first.selected }, onPick)
        }
        val dialog = builder.create()
        // 返回键 / 点外部 / 取消按钮：等价于 select 未改选。
        dialog.setOnDismissListener {
            if (choiceDialog === dialog) choiceDialog = null
            settle { prompt.dismiss() }
        }
        prompt.setDelegate(object : PromptDelegate.PromptInstanceDelegate {
            override fun onPromptDismiss(dismissed: PromptDelegate.BasePrompt) {
                dialog.setOnDismissListener(null)
                if (choiceDialog === dialog) choiceDialog = null
                settle { dismissed.dismiss() }
                dialog.dismiss()
            }

            override fun onPromptUpdate(updatedPrompt: PromptDelegate.BasePrompt) {
                val updated = updatedPrompt as? PromptDelegate.ChoicePrompt
                if (updated != null) {
                    settled = true
                    prompt.setDelegate(null)
                    showChoicePrompt(updated, result)
                } else {
                    dialog.dismiss()
                }
            }
        })
        choiceDialog = dialog
        dialog.show()
    }

    private fun navigationDelegate() = object : NavigationDelegate {
        override fun onLocationChange(
            session: GeckoSession,
            url: String?,
            perms: List<PermissionDelegate.ContentPermission>,
            hasUserGesture: Boolean
        ) {
            currentUrl = url
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
                        // 没有多窗口：本机链接的 _blank / window.open 与 2.x 一样在当前页打开。
                        mainHandler.post { load(uri) }
                        GeckoResult.fromValue(AllowOrDeny.DENY)
                    }
                }
                // blob 下载派发：Gecko 先过 onLoadRequest，再进 ContentDelegate.onExternalResponse，
                // 因此这里必须 ALLOW。刻意不看 request.target：下载不需要 session，若 target=_blank
                // 而这次又真的是页面导航，onNewSession 返回 null 会让它落空（fail-closed），
                // 绝不 load(uri)、绝不交系统浏览器、也不进 Bridge 的 origin trust。
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
                reopen(currentUrl ?: MainActivity.LOCAL_APP_ENTRY)
            }
        }

        override fun onKill(session: GeckoSession) {
            killCount++
            lastFailure = "content-kill"
            port = null
            Log.w(TAG, "content process killed count=$killCount")
            // 通常发生在后台（低内存回收）：等回到前台再重载；若窗口正可见则立即重载，避免停在空白页。
            if (view.windowVisibility == View.VISIBLE) reopen(currentUrl ?: return) else killed = true
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

    // 必须在所有 delegate 属性之后：扩展已缓存时 requestExtension 会同步回调。
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
                GeckoResult<PromptDelegate.PromptResponse>().also { showChoicePrompt(prompt, it) }
        }
        session.permissionDelegate = denyAllPermissions
        session.open(runtime(context))
        view.setSession(session)
        requestExtension()
    }

    private companion object {
        const val TAG = "WotbRuntime"
        /** content script 的 `runtime.connectNative(...)` 名称（bridge.js）。 */
        const val NATIVE_APP = "wotbtools"
        const val EXTENSION_URI = "resource://android/assets/gecko-bridge/"
        const val CRASH_WINDOW_MS = 60_000L

        private var runtime: GeckoRuntime? = null
        private var installedExtension: WebExtension? = null
        private var installing: MutableList<Pair<(WebExtension) -> Unit, () -> Unit>>? = null

        /** GeckoRuntime 每进程只能创建一次；只在主线程、首次需要时创建。 */
        fun runtime(context: Context): GeckoRuntime = runtime ?: GeckoRuntime.create(
            context.applicationContext,
            GeckoRuntimeSettings.Builder()
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

        /**
         * 每个进程安装一次内置扩展。用 installBuiltIn（每次都重装）而不是 ensureBuiltIn（同版本跳过）：
         * 扩展只有两个小文件，换来升级 APK 后一定运行新 bridge.js，不需要维护扩展版本号。
         */
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
