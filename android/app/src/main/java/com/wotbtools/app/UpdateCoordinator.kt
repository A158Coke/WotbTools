package com.wotbtools.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Notification
import androidx.core.content.ContextCompat
import java.io.File
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import org.json.JSONObject

/** 进程级更新事实所有者；Activity 只订阅投影，不拥有检查或下载生命周期。 */
internal class UpdateCoordinator internal constructor(
    context: Context,
    val currentVersionCode: Int,
    val currentVersionName: String,
    private val fetchManifest: () -> StartupGate.Result = StartupGate::checkVersion,
    // 状态与 compare-and-act 始终串行；网络/文件操作不得阻塞这条队列。
    private val stateExecutor: Executor = Executors.newSingleThreadExecutor(),
    private val ioExecutor: Executor = Executors.newSingleThreadExecutor(),
    private val updaterOverride: ApkUpdater? = null,
) {
    private val applicationContext = context.applicationContext
    init {
        // 进程重启后旧通知不再作为 READY 证明；恢复对账重新验证后才重新显示。
        (applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .cancel(READY_NOTIFICATION_ID)
    }
    private val updater by lazy { updaterOverride ?: ApkUpdater(applicationContext) }
    internal val preferences = context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    private val mainHandler = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    private val pendingRefreshReplies = mutableListOf<(JSONObject) -> Unit>()
    private class InstallRequest(val token: String, @Volatile var callback: ((File?) -> Unit)?)
    private var pendingInstall: InstallRequest? = null
    @Volatile private var activeInstall: InstallRequest? = null
    private var downloadBusy = false
    @Volatile private var verifiedToken: String? = null
    @Volatile private var activeDownloadId: Long? = null
    @Volatile private var foreground = false
    private val progressTick = object : Runnable {
        override fun run() {
            if (!foreground) return
            reconcile()
            mainHandler.postDelayed(this, 1_000)
        }
    }
    private val completionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            // 广播只触发对账；真实状态和完整性仍取自系统 query / SHA。
            if (intent?.action == DownloadManager.ACTION_DOWNLOAD_COMPLETE &&
                intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) == activeDownloadId &&
                instance === this@UpdateCoordinator) reconcile()
        }
    }
    private var receiverRegistered = false

    data class DownloadSnapshot(
        val taskToken: String? = null,
        val versionName: String? = null,
        val versionCode: Int? = null,
        val state: String = "idle",
        val downloadedBytes: Long? = null,
        val totalBytes: Long? = null,
        val progressPercent: Int? = null,
        val failureReason: String? = null,
        val packageType: String? = null,
    ) {
        fun toJson(): JSONObject = JSONObject()
            .put("taskToken", taskToken ?: JSONObject.NULL)
            .put("versionName", versionName ?: JSONObject.NULL)
            .put("versionCode", versionCode ?: JSONObject.NULL)
            .put("state", state)
            .put("downloadedBytes", downloadedBytes ?: JSONObject.NULL)
            .put("totalBytes", totalBytes ?: JSONObject.NULL)
            .put("progressPercent", progressPercent ?: JSONObject.NULL)
            .put("failureReason", failureReason ?: JSONObject.NULL)
            .put("packageType", packageType ?: JSONObject.NULL)
    }

    data class Status(
        val revision: Long = 0,
        val manifest: VersionManifest? = null,
        val checkState: String = "idle",
        val checkFailureReason: String? = null,
        val optionalPromptSuppressed: Boolean = false,
        val download: DownloadSnapshot = DownloadSnapshot(),
    )

    @Volatile
    var status = Status()
        private set

    val latestManifest: VersionManifest?
        get() = status.manifest

    /** 一个分类实现，供 Native renderer 和 bridge 投影共同使用。 */
    fun state(snapshot: Status = status): String {
        val manifest = snapshot.manifest
        return if (manifest != null) classify(currentVersionCode, manifest) else when (snapshot.checkState) {
            "checking" -> "checking"
            "failed" -> "checkFailed"
            else -> "unknown"
        }
    }

    fun snapshot(): JSONObject = json(status)

    private fun json(snapshot: Status): JSONObject {
        val manifest = snapshot.manifest
        return JSONObject()
            .put("revision", snapshot.revision)
            .put("state", state(snapshot))
            .put("checkState", snapshot.checkState)
            .put("checkFailureReason", snapshot.checkFailureReason ?: JSONObject.NULL)
            .put("currentVersionName", currentVersionName)
            .put("currentVersionCode", currentVersionCode)
            .put("latestVersionName", manifest?.latestVersionName ?: JSONObject.NULL)
            .put("latestVersionCode", manifest?.latestVersionCode ?: JSONObject.NULL)
            .put("minSupportedVersionCode", manifest?.minSupportedVersionCode ?: JSONObject.NULL)
            .put("publishedAt", manifest?.publishedAt ?: JSONObject.NULL)
            .put("releaseNotes", manifest?.releaseNotes ?: JSONObject.NULL)
            .put("optionalPromptSuppressed", snapshot.optionalPromptSuppressed)
            .put("download", snapshot.download.toJson())
    }

    fun legacyCheckForUpdate(): Boolean = latestManifest?.let { currentVersionCode < it.latestVersionCode } ?: false

    /** 回调总在主线程；detach 会过滤已排队、尚未分发的通知。 */
    fun addListener(listener: () -> Unit) {
        listeners.add(listener)
        mainHandler.post { if (listeners.contains(listener)) listener() }
    }

    fun removeListener(listener: () -> Unit) {
        listeners.remove(listener)
    }

    private fun notifyListeners() {
        listeners.forEach { listener ->
            mainHandler.post { if (listeners.contains(listener)) listener() }
        }
    }

    /** 通知仅是导航入口；文件身份和安装资格仍由 coordinator 校验。 */
    private fun updateReadyNotification(snapshot: Status) {
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val download = snapshot.download
        val valid = download.state == "ready" && download.taskToken != null &&
            download.taskToken == verifiedToken && download.versionCode != null &&
            download.versionCode > currentVersionCode && download.failureReason != "unsupportedArtifact" &&
            snapshot.manifest?.let { download.versionCode >= it.minSupportedVersionCode } != false
        if (!valid) {
            manager.cancel(READY_NOTIFICATION_ID)
            return
        }
        try {
            manager.createNotificationChannel(NotificationChannel(READY_CHANNEL,
                applicationContext.getString(R.string.update_notification_channel), NotificationManager.IMPORTANCE_DEFAULT))
            val intent = Intent(applicationContext, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(OPEN_UPDATE_PANEL, true)
            val pending = PendingIntent.getActivity(applicationContext, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val notification = Notification.Builder(applicationContext, READY_CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(applicationContext.getString(R.string.update_notification_title))
                .setContentText(applicationContext.getString(R.string.update_notification_text, download.versionName ?: ""))
                .setContentIntent(pending).setAutoCancel(true).setOnlyAlertOnce(true).build()
            manager.notify(READY_NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // 通知权限是可选入口，拒绝时不影响校验和安装。
        } catch (error: RuntimeException) {
            // 通知服务异常不能使更新状态机停止。
            Log.w(TAG, "update_notification_failed", error)
        }
    }

    private fun publish(next: Status) {
        status = next.copy(revision = status.revision + 1)
        updateReadyNotification(status)
        notifyListeners()
    }

    /** 并发调用加入同一次检查；网络失败不替换已经发现的支持门槛。 */
    fun refresh(online: Boolean, reply: (JSONObject) -> Unit = {}) {
        stateExecutor.execute {
            pendingRefreshReplies.add(reply)
            if (status.checkState == "checking") return@execute
            publish(status.copy(checkState = "checking", checkFailureReason = null))
            Log.i(TAG, "update_check_started")
            if (!online) {
                completeCheck(StartupGate.Result.VersionUnavailable("offline"))
                return@execute
            }
            ioExecutor.execute {
                val result = try { fetchManifest() } catch (_: Exception) {
                    StartupGate.Result.VersionUnavailable("network")
                }
                stateExecutor.execute { completeCheck(result) }
            }
        }
    }

    /** 仅由 stateExecutor 调用，先发布 terminal snapshot，再回答所有同次调用方。 */
    private fun completeCheck(result: StartupGate.Result) {
        when (result) {
            is StartupGate.Result.Ok -> {
                val manifest = result.manifest
                val classification = classify(currentVersionCode, manifest)
                val suppressed = classification == "optional" &&
                    (preferences.all[DISMISSED_VERSION] as? Int) == manifest.latestVersionCode
                publish(status.copy(manifest = manifest, checkState = "succeeded", checkFailureReason = null,
                    optionalPromptSuppressed = suppressed))
                if (status.download.versionCode?.let { it < manifest.minSupportedVersionCode } == true) {
                    publish(status.copy(download = status.download.copy(failureReason = "unsupportedArtifact")))
                }
                Log.i(TAG, "update_check_success")
                val event = when (classification) {
                    "mandatory" -> "mandatory"
                    "optional" -> "optional"
                    else -> "up_to_date"
                }
                Log.i(TAG, "update_classified_$event")
            }
            is StartupGate.Result.VersionUnavailable -> {
                val reason = when (result.reason) {
                    "offline" -> "offline"
                    "invalidManifest" -> "invalidManifest"
                    else -> "network"
                }
                publish(status.copy(checkState = "failed", checkFailureReason = reason))
                Log.i(TAG, "update_check_failed reason=$reason")
            }
        }
        val completed = status
        val replies = pendingRefreshReplies.toList()
        pendingRefreshReplies.clear()
        replies.forEach { callback -> mainHandler.post { callback(json(completed)) } }
    }

    fun dismissOptionalUpdate(expectedLatestVersionCode: Int, reply: (Boolean) -> Unit) {
        stateExecutor.execute {
            val manifest = status.manifest
            val accepted = manifest != null && manifest.latestVersionCode == expectedLatestVersionCode &&
                classify(currentVersionCode, manifest) == "optional" &&
                preferences.edit().putInt(DISMISSED_VERSION, expectedLatestVersionCode).commit()
            if (accepted) publish(status.copy(optionalPromptSuppressed = true)) else notifyListeners()
            mainHandler.post { reply(accepted) }
        }
    }

    /** 只停止界面采样；系统下载和应用级 I/O 均不属于 Activity。 */
    fun setForeground(value: Boolean) {
        foreground = value
        mainHandler.post {
            mainHandler.removeCallbacks(progressTick)
            if (value) {
                verifiedToken = null
                if (!receiverRegistered) {
                    ContextCompat.registerReceiver(applicationContext, completionReceiver,
                        IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_EXPORTED)
                    receiverRegistered = true
                }
                progressTick.run()
            }
        }
    }

    private fun taskSnapshot(task: ApkUpdater.Task, state: String, bytes: Long? = null,
                             total: Long? = null, reason: String? = null): DownloadSnapshot {
        val unsupported = status.manifest?.let { task.versionCode < it.minSupportedVersionCode } == true
        val displayedState = if (task.packageType == "delta" && state == "downloading") "downloadingDelta" else state
        return DownloadSnapshot(task.token, task.versionName, task.versionCode, displayedState, bytes, total,
            if (bytes != null && total != null && total > 0) ((bytes.toDouble() / total * 100).toInt().coerceIn(0, 100)) else null,
            if (unsupported) "unsupportedArtifact" else reason, task.packageType)
    }

    private fun publishDownload(next: DownloadSnapshot) {
        if (status.download != next) publish(status.copy(download = next))
    }

    private fun reason(error: Exception): String = (error as? ApkUpdater.Failure)?.reason ?: "fileIo"

    /** 一条 I/O 队列只对账已有任务，绝不隐式 enqueue。 */
    fun reconcile() {
        stateExecutor.execute {
            if (downloadBusy) return@execute
            downloadBusy = true
            ioExecutor.execute {
                var task: ApkUpdater.Task? = null
                var report: ApkUpdater.Report? = null
                var failure: String? = null
                var installed = false
                try {
                    task = updater.loadTask()
                    if (task != null) {
                        if (status.download.taskToken != task.token) Log.i(TAG, "update_download_restored code=${task.versionCode}")
                        if (task.versionCode <= currentVersionCode) {
                            updater.cleanup(task)
                            installed = true
                        } else {
                            task = updater.recoverFallback(task)
                            report = updater.query(task)
                            task = report.task
                            if (task.packageType == "delta" && report.state == "downloadFailed") throw ApkUpdater.Failure("patchDownloadFailed")
                            if (!updater.privateFile(task).isFile) verifiedToken = null
                            if (report.state == "verifying" && verifiedToken != task.token) {
                                val checking = task
                                stateExecutor.execute { publishDownload(taskSnapshot(checking, "verifying")) }
                                Log.i(TAG, "update_verify_started")
                                updater.verify(task) { phase ->
                                    stateExecutor.execute {
                                        if (status.download.taskToken == checking.token && status.download.packageType == "delta")
                                            publishDownload(taskSnapshot(checking, phase))
                                    }
                                }
                                verifiedToken = task.token
                                Log.i(TAG, "update_verify_success")
                            }
                        }
                    }
                } catch (error: Exception) {
                    failure = reason(error)
                    val failedTask = task
                    if (failedTask?.packageType == "delta" && failure in setOf("patchDownloadFailed", "patchHashMismatch",
                            "baseHashMismatch", "patchApplyFailed", "targetHashMismatch", "hashMismatch", "insufficientStorage", "storageUnavailable", "fileIo", "artifactMissing")) {
                        val fallbackReason = failure
                        stateExecutor.execute { publishDownload(taskSnapshot(failedTask, "fallbackFull")) }
                        Log.i(TAG, "delta_fallback_full reason=$fallbackReason")
                        try {
                            task = updater.fallbackToFull(failedTask)
                            report = updater.query(task)
                            verifiedToken = null
                            failure = null
                        } catch (fallbackError: Exception) { failure = reason(fallbackError) }
                    } else if (failure == "hashMismatch") {
                        Log.i(TAG, "update_verify_failed reason=hashMismatch")
                        task?.let { try { updater.cleanup(it) } catch (_: Exception) { } }
                        verifiedToken = null
                    }
                }
                val foundTask = task
                val foundReport = report
                val foundFailure = failure
                stateExecutor.execute {
                    downloadBusy = false
                    when {
                        foundFailure != null -> {
                            val prior = foundTask?.let { taskSnapshot(it, "downloadFailed") } ?: status.download
                            publishDownload(prior.copy(state = if (foundFailure == "hashMismatch") "verifyFailed" else "downloadFailed",
                                failureReason = foundFailure))
                            Log.i(TAG, "update_download_failed reason=$foundFailure")
                        }
                        installed -> { verifiedToken = null; publishDownload(DownloadSnapshot()) }
                        foundTask == null -> {
                            verifiedToken = null
                            activeDownloadId = null
                            if (status.download.state in setOf("ready", "verifying", "installPermissionRequired", "installRequestFailed", "installRequested"))
                                publishDownload(DownloadSnapshot())
                            // 保留刚才的下载/校验失败，直到显式用户重试。
                        }
                        foundReport != null -> {
                            activeDownloadId = foundTask.downloadId
                            val ready = foundReport.state == "verifying" && verifiedToken == foundTask.token
                            val state = if (ready) {
                                if (status.download.taskToken == foundTask.token && status.download.state in
                                    setOf("installPermissionRequired", "installRequestFailed")) status.download.state else "ready"
                            } else foundReport.state
                            publishDownload(taskSnapshot(foundTask, state, foundReport.downloadedBytes,
                                foundReport.totalBytes, if (state == "installPermissionRequired") "permissionDenied" else foundReport.reason))
                        }
                    }
                    pendingInstall?.let { request ->
                        pendingInstall = null
                        prepareInstallOnState(request)
                    }
                }
            }
        }
    }

    fun beginDownload(expectedLatestCode: Int, reply: (Boolean) -> Unit) {
        stateExecutor.execute {
            // 前台定时对账与用户点击可能重叠；等对账完成后重新检查版本身份，不能让正常点击随机失败。
            if (downloadBusy) {
                mainHandler.postDelayed({ beginDownload(expectedLatestCode, reply) }, 100)
                return@execute
            }
            val manifest = status.manifest
            if (manifest == null || manifest.latestVersionCode != expectedLatestCode ||
                manifest.latestVersionCode <= currentVersionCode) {
                notifyListeners(); mainHandler.post { reply(false) }; return@execute
            }
            downloadBusy = true
            val retry = status.download.state in setOf("downloadFailed", "verifyFailed")
            publishDownload(status.download.copy(state = "selectingPackage", failureReason = null))
            ioExecutor.execute {
                var task: ApkUpdater.Task? = null
                var failure: String? = null
                try {
                    val old = updater.loadTask()
                    if (old != null && old.versionCode != manifest.latestVersionCode) {
                        updater.cleanup(old) // 显式用户选择替换，不在发现新版本时自动执行。
                        verifiedToken = null
                    }
                    task = updater.begin(manifest, retry)
                } catch (error: Exception) { failure = reason(error) }
                val acceptedTask = task
                val failed = failure
                stateExecutor.execute {
                    downloadBusy = false
                    if (acceptedTask != null) {
                        publishDownload(taskSnapshot(acceptedTask, "queued"))
                        Log.i(TAG, "update_download_enqueued")
                    } else {
                        publishDownload(status.download.copy(state = "downloadFailed", failureReason = failed ?: "unknown"))
                    }
                    mainHandler.post { reply(acceptedTask != null) }
                    reconcile()
                }
            }
        }
    }

    /** 不信任 ready 标志；每次显式安装都离开主线程重新校验当前私有文件。 */
    fun prepareInstall(expectedToken: String, reply: (File?) -> Unit) {
        val request = InstallRequest(expectedToken, reply)
        stateExecutor.execute { prepareInstallOnState(request) }
    }

    /** Activity 销毁后移除尚未执行的回调，避免进程级 coordinator 持有过期界面。 */
    fun cancelPendingInstall(expectedToken: String) {
        // 主线程先释放正在校验或等待主线程分发的回调；I/O 不持有 Activity。
        activeInstall?.takeIf { it.token == expectedToken }?.callback = null
        stateExecutor.execute {
            if (pendingInstall?.token == expectedToken) {
                pendingInstall?.callback = null
                pendingInstall = null
            }
            if (activeInstall?.token == expectedToken) activeInstall = null
        }
    }

    private fun replyInstall(request: InstallRequest, file: File?) {
        mainHandler.post {
            val callback = request.callback
            request.callback = null
            if (activeInstall === request) activeInstall = null
            val download = status.download
            val stillValid = file != null && file.isFile && download.taskToken == request.token &&
                verifiedToken == request.token && download.state in setOf("ready", "installPermissionRequired", "installRequestFailed") &&
                download.versionCode?.let { code -> code > currentVersionCode &&
                    status.manifest?.let { code >= it.minSupportedVersionCode } != false } == true &&
                download.failureReason != "unsupportedArtifact"
            callback?.invoke(file.takeIf { stillValid })
        }
    }

    private fun prepareInstallOnState(request: InstallRequest) {
            val expectedToken = request.token
            val download = status.download
            if (download.taskToken != expectedToken || download.failureReason == "unsupportedArtifact" ||
                download.state !in setOf("ready", "installPermissionRequired", "installRequestFailed")) {
                replyInstall(request, null); return
            }
            if (downloadBusy) {
                if (pendingInstall == null && activeInstall == null) {
                    pendingInstall = request
                    activeInstall = request
                } else replyInstall(request, null)
                return
            }
            if (activeInstall != null && activeInstall !== request) {
                replyInstall(request, null); return
            }
            activeInstall = request
            downloadBusy = true
            publishDownload(download.copy(state = "verifying", failureReason = null))
            ioExecutor.execute {
                var task: ApkUpdater.Task? = null
                var file: File? = null
                var failure: String? = null
                try {
                    task = updater.loadTask()
                    Log.i(TAG, "update_verify_started")
                    if (task?.token == expectedToken) file = updater.verify(task) else failure = "taskMissing"
                } catch (error: Exception) { failure = reason(error) }
                var fallback: ApkUpdater.Task? = null
                if (failure == "hashMismatch") {
                    Log.i(TAG, "update_verify_failed reason=hashMismatch")
                    val failedTask = task
                    if (failedTask?.packageType == "delta") {
                        stateExecutor.execute { publishDownload(taskSnapshot(failedTask, "fallbackFull")) }
                        try {
                            fallback = updater.fallbackToFull(failedTask)
                            failure = null
                        } catch (error: Exception) { failure = reason(error) }
                    } else {
                        failedTask?.let { try { updater.cleanup(it) } catch (_: Exception) { } }
                    }
                    verifiedToken = null
                }
                val fallbackTask = fallback
                val verifiedTask = task
                val verifiedFile = file
                val failed = failure
                stateExecutor.execute {
                    downloadBusy = false
                    val unsupported = verifiedTask != null && status.manifest?.let {
                        verifiedTask.versionCode < it.minSupportedVersionCode
                    } == true
                    if (status.download.taskToken != expectedToken) {
                        replyInstall(request, null)
                    } else if (fallbackTask != null) {
                        publishDownload(taskSnapshot(fallbackTask, "queued"))
                        replyInstall(request, null)
                        reconcile()
                    } else if (failed == null && verifiedTask != null && verifiedFile != null && !unsupported &&
                        status.download.taskToken == expectedToken && verifiedTask.versionCode > currentVersionCode) {
                        Log.i(TAG, "update_verify_success")
                        verifiedToken = expectedToken
                        publishDownload(taskSnapshot(verifiedTask, "ready", download.downloadedBytes, download.totalBytes))
                        replyInstall(request, verifiedFile)
                    } else {
                        publishDownload(download.copy(state = if (failed == "hashMismatch") "verifyFailed" else "installRequestFailed",
                            failureReason = if (unsupported) "unsupportedArtifact" else failed ?: "artifactMissing"))
                        replyInstall(request, null)
                    }
                }
            }
    }

    private fun installationState(token: String, state: String, failure: String? = null) {
        stateExecutor.execute {
            if (status.download.taskToken == token) {
                val unsupported = status.download.versionCode?.let { code ->
                    status.manifest?.let { code < it.minSupportedVersionCode }
                } == true
                publishDownload(status.download.copy(state = state,
                    failureReason = if (unsupported) "unsupportedArtifact" else failure))
            }
        }
    }
    fun installPermissionRequired(token: String) {
        Log.i(TAG, "update_install_permission_required")
        installationState(token, "installPermissionRequired", "permissionDenied")
    }
    fun installRequested(token: String) {
        Log.i(TAG, "update_install_requested")
        installationState(token, "installRequested")
    }
    fun installFailed(token: String, reason: String) = installationState(token, "installRequestFailed", reason)

    companion object {
        internal const val OPEN_UPDATE_PANEL = "com.wotbtools.app.OPEN_UPDATE_PANEL"
        private const val READY_CHANNEL = "verified-update"
        private const val READY_NOTIFICATION_ID = 4000
        private const val TAG = "WotbUpdate"
        private const val PREFERENCES = "android-updates"
        private const val DISMISSED_VERSION = "dismissedLatestVersionCode"
        @Volatile private var instance: UpdateCoordinator? = null

        fun get(context: Context): UpdateCoordinator = instance ?: synchronized(this) {
            instance ?: UpdateCoordinator(context.applicationContext, BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME)
                .also { instance = it }
        }

        internal fun classify(installed: Int, manifest: VersionManifest): String = when {
            installed < manifest.minSupportedVersionCode -> "mandatory"
            installed < manifest.latestVersionCode -> "optional"
            else -> "upToDate"
        }
    }
}
