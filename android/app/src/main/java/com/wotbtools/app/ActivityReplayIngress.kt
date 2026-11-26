package com.wotbtools.app

import android.content.Intent
import android.util.Log
import android.view.View
import com.wotbtools.app.MainActivity.Companion.REPLAY_GLOBAL
import com.wotbtools.app.MainActivity.Companion.REPLAY_URL
import com.wotbtools.app.MainActivity.Companion.TAG
import org.json.JSONObject

internal fun MainActivity.dispatchPendingReplayIfAllowed() {
    val action = ReplayDispatchPolicy.decide(
        hasPendingReplay = pendingReplay != null,
        webViewVisible = runtimeView.visibility == View.VISIBLE,
        currentUrl = runtime.currentUrl
    )
    if (action == ReplayDispatchAction.NONE) return
    Log.d(TAG, "replay-pending dispatched")
    val notifyWeb = action == ReplayDispatchAction.NOTIFY_WEB
    runtimeView.post {
        if (destroyedRuntime || updateCoordinator.state() == "mandatory") return@post
        if (notifyWeb) {
            runtime.postEvent(REPLAY_GLOBAL)
        } else {
            runtime.load(REPLAY_URL)
        }
    }
}

/**
 * replay ingress：存入新 pending（single pending slot，最新 replay 取代旧 pending）并落盘 metadata。
 *
 * 非 replay intent 不清空既有 pending：pending 只由 Web consume、TTL/损坏判断或更新的一份取代 —— 否则
 * 后台被系统杀掉后恢复出来的 replay 会被一个无关 intent（如 launcher ACTION_MAIN）立刻丢掉。
 *
 * @return true 表示本次 intent 确实存入了新的 pending replay。
 */
internal fun MainActivity.handleIncomingIntent(intent: Intent?): Boolean {
    val pending = ReplayIntentHandler.fromIntent(this, intent) ?: return false
    pendingReplay = pending
    pendingReplayEligible = true
    ReplayIntentHandler.savePendingMetadata(this, pending)
    Log.d(TAG, "replay-pending stored ref=${pending.logRef}")
    return true
}

internal fun MainActivity.clearPendingReplay() {
    pendingReplay = null
    pendingReplayEligible = false
    ReplayIntentHandler.clearPendingMetadata(this)
}

internal fun MainActivity.pendingReplayJson(): Any {
    val pending = pendingReplay?.takeIf { pendingReplayEligible } ?: return org.json.JSONObject.NULL
    return org.json.JSONObject()
        .put("pendingId", pending.pendingId)
        .put("name", pending.name)
        .put("size", pending.size)
        .put("uri", ReplayIntentHandler.STREAM_URL)
}

/**
 * Web ACK：compare-and-clear。
 *
 * 只有 Web 明确 ACK 的那份 pending（identity = 完整 pendingId）**仍是**当前 pending 时才清理；
 * identity 缺失或已被更新的 replay 取代一律**不清理**（见 [PendingReplayAckPolicy]）—— 否则
 * 「A 本机分析完成后才发出的 ACK」会误清处理 A 期间新到的 B。刻意不存在无 identity 的 ACK 重载。
 *
 * @return true 仅表示本次 ACK 真的清掉了它命名的那份 pending。
 */
internal fun MainActivity.consumePendingReplay(expectedPendingId: String?): Boolean {
    val current = pendingReplay?.takeIf { pendingReplayEligible }
    return when (PendingReplayAckPolicy.decide(current?.pendingId, expectedPendingId)) {
        PendingReplayAckResult.MISSING_IDENTITY -> {
            Log.d(TAG, "replay-pending ack rejected reason=missing-identity")
            false
        }
        PendingReplayAckResult.STALE -> {
            Log.d(
                TAG,
                "replay-pending ack mismatch expected=${pendingLogRef(expectedPendingId)} " +
                    "current=${pendingLogRef(current?.pendingId)}"
            )
            false
        }
        PendingReplayAckResult.SUCCESS -> {
            clearPendingReplay()
            Log.d(TAG, "replay-pending ack success ref=${pendingLogRef(expectedPendingId)}")
            true
        }
    }
}
