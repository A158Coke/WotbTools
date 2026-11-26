package com.wotbtools.app

import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class NativeBridge(private val host: MainActivity) {

    private val authExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "wotb-bridge-auth")
    }

    fun handleMessage(json: String, reply: (String) -> Unit) {
        try {
            val msg = JSONObject(json)
            val id = msg.opt("id")
            val params = msg.optJSONObject("params")
            when (msg.optString("method")) {
                "getBridgeVersion" -> reply(envelope(id, host.bridgeVersion()))
                "getCapabilities" -> reply(envelope(id, JSONArray(host.bridgeCapabilities())))
                "connectivityGetState" -> reply(envelope(id, host.bridgeConnectivityState()))
                "getScreenForm" -> reply(envelope(id, host.bridgeScreenForm()))
                "haptic" -> reply(envelope(id, host.bridgeHaptic(params?.opt("kind") as? String)))
                "setOrientationLock" -> reply(envelope(id, host.bridgeSetOrientationLock(params?.optString("orientation", ""))))
                "getPendingReplay" -> reply(envelope(id, host.bridgePendingReplayJson()))
                "consumePendingReplay" ->
                    reply(envelope(id, host.bridgeConsumePendingReplay(params?.optString("expectedPendingId"))))
                "pickReplayFolder" ->
                    host.bridgePickReplayFolder(params?.opt("requestId") as? String) { result -> reply(envelope(id, result)) }
                "cancelReplayFolderPicker" ->
                    host.bridgeCancelReplayFolderPicker(params?.opt("requestId") as? String) { result -> reply(envelope(id, result)) }
                "releaseReplayFolderSelection" ->
                    reply(envelope(id, host.bridgeReleaseReplayFolderSelection(params?.optString("selectionId"))))
                "checkForUpdate" -> reply(envelope(id, host.bridgeCheckForUpdate()))
                "startUpdate" -> {
                    host.bridgeStartUpdate()
                    reply(envelope(id, true))
                }
                "getUpdateStatus" -> reply(envelope(id, host.bridgeGetUpdateStatus()))
                "refreshUpdateStatus" -> host.bridgeRefreshUpdateStatus { result -> reply(envelope(id, result)) }
                "beginUpdateDownload" -> host.bridgeBeginUpdateDownload(
                    updateVersionCodeOf(params?.opt("expectedLatestVersionCode"))
                ) { result -> reply(envelope(id, result)) }
                "installUpdate" -> host.bridgeInstallUpdate(
                    (params?.opt("expectedTaskToken") as? String)?.takeIf { it.isNotBlank() }
                ) { result -> reply(envelope(id, result)) }
                "dismissOptionalUpdate" -> host.bridgeDismissOptionalUpdate(
                    updateVersionCodeOf(params?.opt("expectedLatestVersionCode"))
                ) { result -> reply(envelope(id, result)) }

                "authGetState" -> dispatch(id, reply) { host.bridgeAuthGetState() }
                "authLogin" -> dispatch(id, reply) { host.bridgeAuthLogin(uiLocaleOf(params?.opt("locale"))) }
                "authLogout" -> dispatch(id, reply) { host.bridgeAuthLogout() }
                "authGetAccessToken" -> dispatch(id, reply) {
                    host.bridgeAuthGetAccessToken(minValiditySecondsOf(params?.opt("minValiditySeconds")))
                }

                else -> reply(envelope(id, JSONObject.NULL))
            }
        } catch (_: Exception) {
            reply(envelope(JSONObject.NULL, JSONObject.NULL))
        }
    }

    private fun dispatch(id: Any?, reply: (String) -> Unit, work: () -> Any?) {
        try {
            authExecutor.execute {
                val result = try {
                    work()
                } catch (_: Exception) {
                    JSONObject.NULL
                }
                reply(envelope(id, result))
            }
        } catch (_: Exception) {
            reply(envelope(id, JSONObject.NULL))
        }
    }

    private fun envelope(id: Any?, result: Any?): String = JSONObject()
        .put("id", id ?: JSONObject.NULL)
        .put("result", result ?: JSONObject.NULL)
        .toString()

    internal companion object {
        internal fun updateVersionCodeOf(raw: Any?): Int? = when (raw) {
            is Int -> raw.takeIf { it >= 0 }
            is Long -> raw.takeIf { it in 0..Int.MAX_VALUE.toLong() }?.toInt()
            else -> null
        }
        internal fun uiLocaleOf(raw: Any?): String? = (raw as? String)?.takeIf { it in UI_LOCALES }
        private val UI_LOCALES = setOf("zh", "en", "ru")
        private fun minValiditySecondsOf(raw: Any?): Long = when (raw) {
            is Number -> raw.toLong().coerceAtLeast(0L)
            else -> 0L
        }
    }
}
