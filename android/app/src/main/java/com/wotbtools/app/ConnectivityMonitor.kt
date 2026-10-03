package com.wotbtools.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * 设备连通性的**系统权威**（计划 §4）：Android framework 的 `ConnectivityManager`。
 *
 * 为什么不把 `navigator.onLine` 当真相：WebView 里那个布尔值只反映「设备认为自己有默认路由」，
 * 不区分「连上了 Wi-Fi 但出不了网」。这里用 `NET_CAPABILITY_INTERNET` + `NET_CAPABILITY_VALIDATED`：
 * 前者表示网络声明可用，后者表示系统**实际**校验过可达性（captive portal / 假连接不算在线）。
 *
 * 状态 token 是 wire 契约的一部分（`connectivityGetState` 的返回值），与前端
 * `ConnectivityState` 对齐，当前只有两个生产者：
 *  - `online`：存在同时具备 INTERNET + VALIDATED 的网络；
 *  - `offline`：没有这样的网络。
 * 预留 `degraded` / `service-unavailable` 由服务端可达性探测引入，本类不猜测它们。
 *
 * 线程：`registerDefaultNetworkCallback` 的回调发生在 binder 线程；状态读写成原子引用，
 * 通知一律 hop 到主线程（WebView 只能在它自己的线程上碰）。
 */
internal class ConnectivityMonitor(
    context: Context,
    private val onChanged: (String) -> Unit,
) {

    private val connectivityManager =
        context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var registered = false

    /** 当前状态 token；未注册 / 系统服务缺失时按 offline 处理（fail-closed，绝不假装在线）。 */
    @Volatile
    var state: String = STATE_OFFLINE
        private set

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = refresh()

        override fun onLost(network: Network) = refresh()

        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = refresh()
    }

    /** 注册监听并立即回读一次。重复调用是 no-op（幂等），异常一律降级为 offline。 */
    fun start() {
        if (registered) return
        val manager = connectivityManager
        if (manager == null) {
            Log.d(TAG, "connectivity unavailable reason=no-system-service")
            return
        }
        registered = try {
            manager.registerDefaultNetworkCallback(callback)
            true
        } catch (e: Exception) {
            Log.d(TAG, "connectivity unavailable category=${e.javaClass.simpleName}")
            false
        }
        refresh()
    }

    /** 注销监听（Activity 销毁）。 */
    fun stop() {
        if (!registered) return
        registered = false
        try {
            connectivityManager?.unregisterNetworkCallback(callback)
        } catch (_: Exception) {
            // 已注销 / 系统收尾：无需处理。
        }
    }

    /** 回读系统状态：只有「有默认网络且该网络已验证可达」才算 online。 */
    fun read(): String {
        val manager = connectivityManager ?: return STATE_OFFLINE
        return try {
            val network = manager.activeNetwork ?: return STATE_OFFLINE
            val capabilities = manager.getNetworkCapabilities(network) ?: return STATE_OFFLINE
            if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            ) {
                STATE_ONLINE
            } else {
                STATE_OFFLINE
            }
        } catch (_: Exception) {
            // 系统服务异常：离线是安全默认值（本地功能照常，联网功能会先给提示而不是发请求）。
            STATE_OFFLINE
        }
    }

    private fun refresh() {
        val next = read()
        if (next == state) return
        state = next
        mainHandler.post { onChanged(next) }
    }

    internal companion object {
        private const val TAG = "WotbAuth"

        /** wire token：与前端 `ConnectivityState.ONLINE` 一致。 */
        internal const val STATE_ONLINE = "online"

        /** wire token：与前端 `ConnectivityState.OFFLINE` 一致。 */
        internal const val STATE_OFFLINE = "offline"
    }
}
