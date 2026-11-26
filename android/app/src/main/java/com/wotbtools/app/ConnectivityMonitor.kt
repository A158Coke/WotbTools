package com.wotbtools.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.util.Log

internal class ConnectivityMonitor(
    context: Context,
    private val onChanged: (String) -> Unit,
) {

    private val connectivityManager =
        context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var registered = false

    @Volatile
    var state: String = STATE_OFFLINE
        private set

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = refresh()

        override fun onLost(network: Network) = refresh()

        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = refresh()
    }

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

    fun stop() {
        if (!registered) return
        registered = false
        try {
            connectivityManager?.unregisterNetworkCallback(callback)
        } catch (_: Exception) {
        }
    }

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

        internal const val STATE_ONLINE = "online"

        internal const val STATE_OFFLINE = "offline"
    }
}
