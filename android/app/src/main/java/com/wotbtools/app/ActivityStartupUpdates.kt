package com.wotbtools.app

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.util.Log
import android.view.View
import com.wotbtools.app.MainActivity.Companion.LOCAL_APP_ENTRY
import com.wotbtools.app.MainActivity.Companion.REPLAY_URL
import com.wotbtools.app.MainActivity.Companion.TAG
import com.wotbtools.app.MainActivity.Companion.UPDATE_CHANGED_GLOBAL
import org.json.JSONObject
import org.mozilla.geckoview.GeckoView

// ── Local startup + bounded best-effort update discovery ──

internal fun MainActivity.startStartupFlow() {
    loadWeb()
    checkForUpdateAsync()
}

internal fun MainActivity.checkForUpdateAsync() {
    if (!destroyedRuntime && updateCoordinatorReady) {
        updateCoordinator.refresh(connectivityMonitor.state == "online")
    }
}

/** Native 和 Vue 消费同一快照；optional 绝不改变运行时可见性。 */
internal fun MainActivity.onUpdateStateChanged() {
    if (destroyedRuntime || !runtimeReady) return
    val snapshot = updateCoordinator.status
    if (updateCoordinator.state(snapshot) == "mandatory") {
        showMandatoryUpdate(snapshot)
    } else if (versionGateView.visibility == View.VISIBLE) {
        loadWeb()
    }
    if (!runtime.currentUrl.isNullOrEmpty()) runtime.postEvent(UPDATE_CHANGED_GLOBAL)
    val legacyVersion = legacyInstallVersionCode
    if (updateForeground && legacyVersion != null && snapshot.download.versionCode == legacyVersion &&
        snapshot.download.state == "ready" && snapshot.download.taskToken != null) {
        legacyInstallVersionCode = null
        bridgeInstallUpdate(snapshot.download.taskToken) { }
    }
}

/** Entry URL：有 pending replay 就进 replay canonical view，否则首页。认证回程不经这里。 */
internal fun MainActivity.entryUrl(): String {
    if (intent.getBooleanExtra(UpdateCoordinator.OPEN_UPDATE_PANEL, false)) {
        intent.removeExtra(UpdateCoordinator.OPEN_UPDATE_PANEL)
        return LOCAL_APP_ENTRY + "?view=more&androidUpdate=1"
    }
    return if (pendingReplay != null) REPLAY_URL else LOCAL_APP_ENTRY
}

internal fun MainActivity.loadWeb() {
    if (updateCoordinator.state() == "mandatory") {
        showMandatoryUpdate(updateCoordinator.status)
        return
    }
    startupSurfaceState.startLoading()
    applyStartupSurface()
    hideAllGates()
    if (!ensureLocalServer()) {
        showRuntimeError(R.string.runtime_error_port_title)
        return
    }
    runtimeView.visibility = View.VISIBLE
    if (runtime.currentUrl.isNullOrEmpty()) {
        runtime.load(entryUrl())
    } else {
        runtime.reload()
    }
}

/** 本地运行时错误页：标题说明原因，诊断行可长按复制（引擎 / 设备 / crash 计数，不含账号或回放信息）。 */
internal fun MainActivity.showRuntimeError(titleRes: Int) {
    if (updateCoordinator.state() == "mandatory") {
        showMandatoryUpdate(updateCoordinator.status)
        return
    }
    hideAllGates()
    startupSurfaceState.gateShown()
    applyStartupSurface()
    runtimeErrorTitle.text = getString(titleRes)
    runtimeErrorDiagnostics.text = runtime.diagnostics()
    runtimeErrorView.visibility = View.VISIBLE
    Log.w(TAG, "runtime error ${runtimeErrorDiagnostics.text}")
}

internal fun MainActivity.showMandatoryUpdate(snapshot: UpdateStatus) {
    if (fullscreen) runtime.exitFullScreen()
    hideAllGates()
    startupSurfaceState.gateShown()
    applyStartupSurface()
    versionGateView.visibility = View.VISIBLE
    versionTitle.text = getString(R.string.update_mandatory_title)
    versionMessage.text = getString(R.string.update_mandatory_message)
    versionCurrent.text = getString(R.string.update_current_version, updateCoordinator.currentVersionName)
    versionLatest.text = getString(R.string.update_latest_version, snapshot.manifest?.latestVersionName.orEmpty())
    val download = snapshot.download
    val active = download.state in setOf("selectingPackage", "queued", "downloading", "downloadingDelta", "paused", "verifying", "verifyingDelta", "applyingDelta", "verifyingTargetApk", "fallbackFull", "installRequested")
    versionPrimaryButton.isEnabled = (!active || download.failureReason == "unsupportedArtifact") && preparingInstallToken == null
    versionPrimaryButton.text = getString(when {
        download.failureReason == "unsupportedArtifact" -> R.string.update_replace_download
        download.state == "installPermissionRequired" -> R.string.update_allow_install
        download.state in setOf("ready", "installRequestFailed") -> R.string.update_install
        download.state in setOf("downloadFailed", "verifyFailed") -> R.string.update_retry
        else -> R.string.update_now
    })
    versionStatus.text = getString(download.failureReason?.let(::updateFailureText) ?: when (download.state) {
        "selectingPackage" -> R.string.update_selecting
        "queued" -> R.string.update_queued
        "downloading" -> R.string.update_downloading
        "downloadingDelta" -> R.string.update_downloading_delta
        "verifyingDelta" -> R.string.update_verifying_delta
        "applyingDelta" -> R.string.update_applying_delta
        "verifyingTargetApk" -> R.string.update_verifying_target
        "fallbackFull" -> R.string.update_fallback_full
        "paused" -> R.string.update_paused
        "verifying" -> R.string.update_verifying
        "ready" -> R.string.update_ready
        "installRequested" -> R.string.update_install_requested
        "installPermissionRequired" -> R.string.update_unknown_source_hint
        "downloadFailed", "verifyFailed", "installRequestFailed" -> R.string.update_failed
        else -> if (snapshot.checkState == "failed") R.string.update_check_failed else R.string.update_download_hint
    })
    versionProgress.visibility = if (download.state in setOf("selectingPackage", "queued", "downloading", "downloadingDelta", "paused", "verifying", "verifyingDelta", "applyingDelta", "verifyingTargetApk", "fallbackFull")) View.VISIBLE else View.GONE
    versionProgress.isIndeterminate = download.progressPercent == null || download.state in setOf("selectingPackage", "verifying", "verifyingDelta", "applyingDelta", "verifyingTargetApk", "fallbackFull")
    if (!versionProgress.isIndeterminate) versionProgress.progress = download.progressPercent ?: 0
    versionBytes.text = when {
        download.downloadedBytes == null -> ""
        download.totalBytes != null && download.progressPercent != null -> getString(R.string.update_bytes_progress,
            download.progressPercent,
            android.text.format.Formatter.formatShortFileSize(this, download.downloadedBytes),
            android.text.format.Formatter.formatShortFileSize(this, download.totalBytes))
        download.totalBytes != null -> getString(R.string.update_bytes,
            android.text.format.Formatter.formatShortFileSize(this, download.downloadedBytes),
            android.text.format.Formatter.formatShortFileSize(this, download.totalBytes))
        else -> android.text.format.Formatter.formatShortFileSize(this, download.downloadedBytes)
    }
    versionBytes.visibility = if (versionBytes.text.isEmpty()) View.GONE else View.VISIBLE
}

internal fun MainActivity.updateFailureText(reason: String): Int = when (reason) {
    "waitingNetwork" -> R.string.update_wait_network
    "waitingRetry" -> R.string.update_wait_retry
    "waitingWifi" -> R.string.update_wait_wifi
    "pausedUnknown" -> R.string.update_paused
    "insufficientStorage" -> R.string.update_storage_full
    "storageUnavailable" -> R.string.update_storage_unavailable
    "hashMismatch" -> R.string.update_hash_failed
    "unsupportedArtifact" -> R.string.update_unsupported_artifact
    "permissionDenied" -> R.string.update_unknown_source_hint
    "installerUnavailable" -> R.string.update_installer_unavailable
    "artifactMissing", "taskMissing" -> R.string.update_artifact_missing
    "cannotResume" -> R.string.update_cannot_resume
    "network", "http" -> R.string.update_network_failed
    "fileIo" -> R.string.update_file_failed
    else -> R.string.update_failed
}

internal fun MainActivity.onUpdatePrimary() {
    val download = updateCoordinator.status.download
    if (download.taskToken != null && download.failureReason != "unsupportedArtifact" &&
        download.state in setOf("ready", "installPermissionRequired", "installRequestFailed")) {
        bridgeInstallUpdate(download.taskToken) { }
    } else {
        updateCoordinator.latestManifest?.let { manifest ->
            updateCoordinator.beginDownload(manifest.latestVersionCode) { accepted ->
                if (accepted) requestUpdateNotificationPermission()
            }
        }
    }
}

internal fun MainActivity.openInstallPermissionSettings(token: String): Boolean {
    permissionInstallToken = token
    return try {
        startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
        true
    } catch (_: Exception) {
        permissionInstallToken = null
        updateCoordinator.installFailed(token, "permissionDenied")
        toast(getString(R.string.update_unknown_source_hint))
        false
    }
}

internal fun MainActivity.checkForUpdate(): Boolean = updateCoordinator.legacyCheckForUpdate()

internal fun MainActivity.getUpdateStatus(): JSONObject = updateCoordinator.snapshot()

internal fun MainActivity.refreshUpdateStatus(reply: (JSONObject) -> Unit) {
    updateCoordinator.refresh(connectivityMonitor.state == "online", reply)
}

internal fun MainActivity.beginUpdateDownload(expectedVersionCode: Int?, reply: (Boolean) -> Unit) {
    if (expectedVersionCode == null) { reply(false); return }
    updateCoordinator.beginDownload(expectedVersionCode) { accepted ->
        if (accepted) requestUpdateNotificationPermission()
        reply(accepted)
    }
}

internal fun MainActivity.requestUpdateNotificationPermission() {
    if (android.os.Build.VERSION.SDK_INT >= 33 &&
        checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED &&
        !isFinishing && !isDestroyed) {
        requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 0x1201)
    }
}

internal fun MainActivity.dismissOptionalUpdate(expectedVersionCode: Int?, reply: (Boolean) -> Unit) {
    if (expectedVersionCode == null) { reply(false); return }
    updateCoordinator.dismissOptionalUpdate(expectedVersionCode, reply)
}

/** 显式安装动作；异步哈希完成后仍须检查前台状态和同一任务 identity。 */
internal fun MainActivity.installUpdate(expectedToken: String?, reply: (Boolean) -> Unit) {
    runOnUiThread {
        if (expectedToken.isNullOrBlank() || !updateForeground || destroyedRuntime || preparingInstallToken != null) {
            reply(false)
            return@runOnUiThread
        }
        preparingInstallToken = expectedToken
        preparingInstallReply = reply
        val attempt = ++installAttempt
        updateCoordinator.prepareInstall(expectedToken) { file ->
            val stillValid = installAttempt == attempt && preparingInstallToken == expectedToken && updateForeground && !destroyedRuntime &&
                updateCoordinator.status.download.taskToken == expectedToken &&
                updateCoordinator.status.download.failureReason != "unsupportedArtifact"
            if (installAttempt != attempt) return@prepareInstall
            preparingInstallToken = null
            val completedReply = preparingInstallReply
            preparingInstallReply = null
            if (!stillValid || file == null) { completedReply?.invoke(false); return@prepareInstall }
            if (!packageManager.canRequestPackageInstalls()) {
                updateCoordinator.installPermissionRequired(expectedToken)
                completedReply?.invoke(openInstallPermissionSettings(expectedToken))
            } else {
                val accepted = try { apkUpdater.requestInstall(file) } catch (_: Exception) { false }
                if (accepted) updateCoordinator.installRequested(expectedToken)
                else updateCoordinator.installFailed(expectedToken, "installerUnavailable")
                completedReply?.invoke(accepted)
            }
        }
    }
}

/** 兼容旧调用的前台“一键更新”意图，不影响新下载 API 的只下载行为。 */
internal fun MainActivity.startUpdate() {
    runOnUiThread {
        if (!updateForeground || destroyedRuntime) return@runOnUiThread
        val download = updateCoordinator.status.download
        if (download.taskToken != null && download.failureReason != "unsupportedArtifact" &&
            download.state in setOf("ready", "installPermissionRequired", "installRequestFailed")) {
            bridgeInstallUpdate(download.taskToken) { }
        } else {
            val manifest = updateCoordinator.latestManifest ?: return@runOnUiThread
            legacyInstallVersionCode = manifest.latestVersionCode
            updateCoordinator.beginDownload(manifest.latestVersionCode) { accepted ->
                if (accepted) requestUpdateNotificationPermission()
                if (!accepted) legacyInstallVersionCode = null
            }
        }
    }
}

// ── 通用 ──

/**
 * 隐藏页面并收起版本/错误页。
 *
 * 门禁视图（version/runtimeError）与 [runtimeView] 是根 FrameLayout 的**兄弟节点**，根容器必须保持
 * VISIBLE，否则子节点即便置为 VISIBLE 也不会绘制（父 GONE 连子一起隐藏）。因此这里只隐藏 GeckoView
 * 本身：门禁视图各自带不透明背景、按 XML 顺序绘制在 GeckoView 之上，足以完整接管画面。
 * [startupSurface] 的可见性属于 [StartupSurfaceState]，不在这里隐式修改。
 */
internal fun MainActivity.hideAllGates() {
    versionGateView.visibility = View.GONE
    runtimeErrorView.visibility = View.GONE
    runtimeView.visibility = View.GONE
}

internal fun MainActivity.applyStartupSurface() {
    startupSurface.visibility = if (startupSurfaceState.visible) View.VISIBLE else View.GONE
}
