package com.wotbtools.app

import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native Bridge —— 只暴露白名单能力（规格 §27），绝不做 readFile/http/execute/launch。
 * Web 侧通过 capability 探测（supports()）而非「if Android 就调用」。
 */
class NativeBridge(private val host: MainActivity) {

    @JavascriptInterface
    fun getCapabilities(): String = JSONArray(host.bridgeCapabilities()).toString()

    @JavascriptInterface
    fun getPendingReplay(): String {
        val pending = host.bridgePendingReplay() ?: return "null"
        return JSONObject()
            .put("name", pending.name ?: "replay.wotbreplay")
            .put("uri", pending.uri.toString())
            .put("size", pending.size)
            .toString()
    }

    @JavascriptInterface
    fun consumePendingReplay(): Boolean = host.bridgeConsumePendingReplay()

    @JavascriptInterface
    fun checkForUpdate(): Boolean = host.bridgeCheckForUpdate()

    @JavascriptInterface
    fun startUpdate(): Boolean = host.bridgeStartUpdate()
}
