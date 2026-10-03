package com.wotbtools.app

import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * origin-scoped bridge：经 WebView WebMessageListener，仅 wotbtools.com/www 可调。
 * 只暴露：capability/version discovery、pending replay handoff、app update 触发、native auth。
 * 禁止 arbitrary file/http/command/intent API（规格 §27）。
 *
 * 消息形状 `{id, method, params}`；只有 `consumePendingReplay` 与 `authGetAccessToken` 使用 params
 * （前者必须携带 `pendingId` 作为 ACK 的 identity，后者可选 `minValiditySeconds`）。
 *
 * **回复是异步的**：[handleMessage] 不返回字符串，而是把回复交给 `reply` 回调。replay / update /
 * capability 这些纯本地读仍在**同一个调用栈内**立即回复（延迟与改动前一致）；只有认证方法会离开
 * WebView 线程（`authGetAccessToken` 可能需要 refresh 网络往返，`authLogin` 可能需要 discovery），
 * 在后台线程完成后回调 `reply`。WebView 线程绝不做网络 I/O。
 */
class NativeBridge(private val host: MainActivity) {

    /** 认证方法专用后台线程：WebView 线程只提交请求，不等待任何网络。 */
    private val authExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "wotb-bridge-auth")
    }

    /**
     * 处理来自页面的 JSON {id, method, params}，构建 JSON {id, result} 并交给 [reply]。
     *
     * 运行于 WebView 线程；[reply] 可能在该线程同步触发，也可能在**后台线程**稍后触发。
     * 未知方法 / 任何异常一律回复 `result: null`（fail-closed），绝不把异常抛回 WebView。
     */
    fun handleMessage(json: String, reply: (String) -> Unit) {
        try {
            val msg = JSONObject(json)
            val id = msg.opt("id")
            val params = msg.optJSONObject("params")
            when (msg.optString("method")) {
                // ── 立即回复（纯本地读 / 无网络）──
                "getBridgeVersion" -> reply(envelope(id, host.bridgeVersion()))
                "getCapabilities" -> reply(envelope(id, JSONArray(host.bridgeCapabilities())))
                "getPendingReplay" -> reply(envelope(id, host.bridgePendingReplayJson()))
                "consumePendingReplay" ->
                    reply(envelope(id, host.bridgeConsumePendingReplay(params?.optString("expectedPendingId"))))
                "checkForUpdate" -> reply(envelope(id, host.bridgeCheckForUpdate()))
                "startUpdate" -> {
                    host.bridgeStartUpdate()
                    reply(envelope(id, true))
                }

                // ── 认证：离开 WebView 线程，完成后回复（绝不阻塞页面）──
                "authGetState" -> dispatch(id, reply) { host.bridgeAuthGetState() }
                "authLogin" -> dispatch(id, reply) { host.bridgeAuthLogin() }
                "authLogout" -> dispatch(id, reply) { host.bridgeAuthLogout() }
                "authGetAccessToken" -> dispatch(id, reply) {
                    host.bridgeAuthGetAccessToken(minValiditySecondsOf(params?.opt("minValiditySeconds")))
                }

                else -> reply(envelope(id, JSONObject.NULL))
            }
        } catch (_: Exception) {
            // 解析 / 分发异常一律 fail-closed：id 也拿不到时按 null 回复，页面按自己的超时处理。
            reply(envelope(JSONObject.NULL, JSONObject.NULL))
        }
    }

    /** 认证方法分发：后台线程执行 [work]，结果（或异常 → null）经 [reply] 交回调用方。 */
    private fun dispatch(id: Any?, reply: (String) -> Unit, work: () -> Any?) {
        try {
            authExecutor.execute {
                val result = try {
                    work()
                } catch (_: Exception) {
                    // 认证失败永远表现为契约里的失败值（null / error 字段），绝不把异常抛给页面。
                    JSONObject.NULL
                }
                reply(envelope(id, result))
            }
        } catch (_: Exception) {
            // 线程池已关闭（进程收尾）：同样 fail-closed，立即回 null。
            reply(envelope(id, JSONObject.NULL))
        }
    }

    /** 唯一构造 `{id, result}` 的地方：同步路径与异步路径形状不可能漂移。 */
    private fun envelope(id: Any?, result: Any?): String = JSONObject()
        .put("id", id ?: JSONObject.NULL)
        .put("result", result ?: JSONObject.NULL)
        .toString()

    private companion object {
        /** `minValiditySeconds` 缺省 0（「现在可用即可」）；负数一律归零，绝不放宽判定。 */
        fun minValiditySecondsOf(raw: Any?): Long = when (raw) {
            is Number -> raw.toLong().coerceAtLeast(0L)
            else -> 0L
        }
    }
}
