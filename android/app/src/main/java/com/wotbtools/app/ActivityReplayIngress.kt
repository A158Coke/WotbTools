package com.wotbtools.app

import android.content.Intent
import android.util.Log
import android.view.View
import com.wotbtools.app.MainActivity.Companion.REPLAY_GLOBAL
import com.wotbtools.app.MainActivity.Companion.REPLAY_URL
import com.wotbtools.app.MainActivity.Companion.TAG
import org.json.JSONObject

/**
 * pending replay 的唯一分发点。
 *
 * 「是否分发 / 怎么分发」完全由纯策略 [ReplayDispatchPolicy] 决定（JVM 单测覆盖），这里只执行动作：
 * 无 pending / 页面不可见（门禁 / 错误 / 更新页接管中）→ 不分发；已在 replay workspace → 通知 Web；
 * 否则切到 replay canonical view。认证不再参与这个决策：登录在 external user-agent 里进行，不会占用
 * 页面导航，因此 replay 无需为 auth 让路。登录完成后 Web 应用就地同步认证状态，并经 Native Bridge
 * 自行消费 pending。
 */
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
            // 已在 replay workspace：直接通知导入（exactly-once 由 pending 被 consume 清空保证）。
            runtime.postEvent(REPLAY_GLOBAL)
        } else {
            // 切到 replay canonical view；ReplayPage 就绪后消费。
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
    // 旧 backing file 不立即删除（页面可能仍在读取），交给下一次 startup orphan cleanup。
    pendingReplay = pending
    pendingReplayEligible = true
    ReplayIntentHandler.savePendingMetadata(this, pending)
    Log.d(TAG, "replay-pending stored ref=${pending.logRef}")
    return true
}

/**
 * 清 pending slot + 持久 metadata（exactly-once）。
 *
 * 唯一调用方是 [bridgeConsumePendingReplay] 的 `SUCCESS` 分支 —— 即 ACK 的 identity 与当前 pending
 * 逐字符相等之后。这里刻意保持无参：identity 判断归 [PendingReplayAckPolicy]，清理点不复制第二份规则。
 */
internal fun MainActivity.clearPendingReplay() {
    // 重要：Web synthetic fetch 返回后本机 server 仍可能在流式读取该文件，不能立即删除 backing file。
    // 只清 pending slot + 持久 metadata（exactly-once），文件保留到下一次 app startup cleanupOrphans() 清理。
    pendingReplay = null
    pendingReplayEligible = false
    ReplayIntentHandler.clearPendingMetadata(this)
}

/**
 * pending replay 的 wire contract（`getPendingReplay` 的 result）：`pendingId` 是这份 pending 的
 * authoritative identity，Web 必须在本机分析完成后原样回传给 `consumePendingReplay`；其余字段与
 * 既有语义一致（`name` 仅显示名、`size` 仅提示、`uri` 为固定的同源 LocalRuntimeServer resource `http://127.0.0.1:21653/__native/replay-pending`）。
 */
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
            // 无 identity 的 ACK 一律拒绝：绝不退化成「清掉当前 pending」。
            Log.d(TAG, "replay-pending ack rejected reason=missing-identity")
            false
        }
        PendingReplayAckResult.STALE -> {
            // 当前 pending 不是这份 ACK 命名的那一份（已被更新的 replay 取代 / 已无 pending）：保留。
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
