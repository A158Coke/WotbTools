package com.wotbtools.app

import org.json.JSONArray
import org.json.JSONObject

/**
 * origin-scoped bridge：经 WebView WebMessageListener，仅 wotbtools.com/www 可调。
 * 只暴露：capability/version discovery、pending replay handoff、app update 触发。
 * 禁止 arbitrary file/http/command/intent API（规格 §27）。
 */
class NativeBridge(private val host: MainActivity) {

    /** 处理来自页面的 JSON {id, method}，返回 JSON {id, result}。运行于 WebView 线程。 */
    fun handleMessage(json: String): String {
        val reply = JSONObject()
        var id: Any? = JSONObject.NULL
        var result: Any? = JSONObject.NULL
        try {
            val msg = JSONObject(json)
            id = msg.opt("id")
            when (msg.optString("method")) {
                "getCapabilities" -> result = JSONArray(host.bridgeCapabilities())
                "getPendingReplay" -> result = host.bridgePendingReplayJson()
                "consumePendingReplay" -> result = host.bridgeConsumePendingReplay()
                "checkForUpdate" -> result = host.bridgeCheckForUpdate()
                "startUpdate" -> {
                    host.bridgeStartUpdate()
                    result = true
                }
                else -> result = JSONObject.NULL
            }
        } catch (_: Exception) {
            result = JSONObject.NULL
        }
        reply.put("id", id)
        reply.put("result", result)
        return reply.toString()
    }
}
