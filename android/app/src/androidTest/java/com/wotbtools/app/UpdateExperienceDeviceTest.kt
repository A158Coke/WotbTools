package com.wotbtools.app

import android.app.Activity
import android.app.Instrumentation
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test

/**
 * 实际 Activity / Gecko / DownloadManager 验证，不替换下载器或 installer wiring。
 * 只在测试内替换 manifest 发现结果；当前身份读取实际已安装 APK 的 PackageInfo。
 */
class UpdateExperienceDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    @Suppress("DEPRECATION")
    private val installedCode = context.packageManager.getPackageInfo(context.packageName, 0).versionCode
    private val installedName = requireNotNull(context.packageManager.getPackageInfo(context.packageName, 0).versionName)
    private val stateExecutor = Executors.newSingleThreadExecutor()
    private val ioExecutor = Executors.newSingleThreadExecutor()
    private val result = AtomicReference<StartupGate.Result>()
    private val singleton = UpdateCoordinator::class.java.getDeclaredField("instance").apply { isAccessible = true }
    private var previous: UpdateCoordinator? = null
    private var scenario: ActivityScenario<MainActivity>? = null
    private lateinit var coordinator: UpdateCoordinator
    private val updater = ApkUpdater(context)
    private var dismissedWasPresent = false
    private var originalDismissed = -1
    private val monitors = mutableListOf<Instrumentation.ActivityMonitor>()

    @Before fun setUp() {
        // 不接管设备中与本测试无关的既有下载。
        val existing = updater.loadTask()
        val restoreToken = InstrumentationRegistry.getArguments().getString("restoreTaskToken")
        if (restoreToken == null) {
            assertNull("Device already owns an update task; use a dedicated test device", existing)
        } else {
            // 外部 adb 明确 SIGKILL 后，只允许恢复同一个测试夹具任务，不接受任意设备任务。
            assertEquals(restoreToken, existing?.token)
            val deltaUrl = InstrumentationRegistry.getArguments().getString("deltaPatchUrl")
            if (InstrumentationRegistry.getArguments().getString("restoreReadyNotification") == "true") {
                assertEquals(SMALL_URL, existing?.apkUrl)
                assertEquals(SMALL_SHA, existing?.sha256)
            } else if (deltaUrl == null) {
                assertEquals(LARGE_URL, existing?.apkUrl)
                assertEquals(LARGE_SHA, existing?.sha256)
            } else {
                assertEquals("delta", existing?.packageType)
                assertEquals(deltaUrl, existing?.patchUrl)
                assertEquals(InstrumentationRegistry.getArguments().getString("deltaPatchSha"), existing?.patchSha256)
                assertEquals(fileSha256(File(requireNotNull(context.applicationInfo.sourceDir))), existing?.sha256)
            }
            assertEquals(latestCode, existing?.versionCode)
            assertEquals(InstrumentationRegistry.getArguments().getString("restoreDownloadId")!!.toLong(), existing?.downloadId)
        }
        val preferences = context.getSharedPreferences("android-updates", Context.MODE_PRIVATE)
        dismissedWasPresent = preferences.contains("dismissedLatestVersionCode")
        originalDismissed = preferences.getInt("dismissedLatestVersionCode", -1)
        if (restoreToken == null) assertTrue(preferences.edit().clear().commit())
        previous = singleton.get(null) as? UpdateCoordinator
        previous?.setForeground(false)
        coordinator = UpdateCoordinator(context, installedCode, installedName,
            { result.get() }, stateExecutor, ioExecutor)
        singleton.set(null, coordinator)
        Log.i(TAG, "installed_version=$installedName code=$installedCode")
    }

    @After fun tearDown() {
        scenario?.close()
        if (::coordinator.isInitialized) coordinator.setForeground(false)
        instrumentation.waitForIdleSync()
        try {
            // 等待已开始的 hash 与串行回调退出后，才清本测试的精确任务。
            repeat(2) {
                ioExecutor.submit {}.get(45, TimeUnit.SECONDS)
                stateExecutor.submit {}.get(45, TimeUnit.SECONDS)
            }
            updater.loadTask()?.let(updater::cleanup)
        } finally {
            stateExecutor.shutdownNow()
            ioExecutor.shutdownNow()
            monitors.forEach(instrumentation::removeMonitor)
            singleton.set(null, previous)
            val editor = context.getSharedPreferences("android-updates", Context.MODE_PRIVATE).edit().clear()
            if (dismissedWasPresent) editor.putInt("dismissedLatestVersionCode", originalDismissed)
            assertTrue(editor.commit())
            // Android14 撤销 REQUEST_INSTALL_PACKAGES 会杀目标进程；由 host 在 runner 外恢复，
            // 不可在此撤权而把一个已完成的真实权限往返误报为 instrumentation crash。
        }
    }

    @Test fun optionalKeepsRealRuntimeVisibleAndManualFailureIsExplicit() {
        launch(manifest())
        awaitRuntime()
        assertOptionalVisible()
        val checked = awaitReply<JSONObject> { reply -> onActivity { it.bridgeRefreshUpdateStatus(reply) } }
        assertEquals("optional", checked.getString("state"))
        assertEquals("succeeded", checked.getString("checkState"))
        assertEquals(installedName, checked.getString("currentVersionName"))

        val dismissed = awaitReply<Boolean> { coordinator.dismissOptionalUpdate(latestCode, it) }
        assertTrue(dismissed)
        assertTrue(coordinator.snapshot().getBoolean("optionalPromptSuppressed"))
        onActivity { assertTrue(it.bridgeCheckForUpdate()) }

        result.set(StartupGate.Result.VersionUnavailable("network"))
        val failed = awaitReply<JSONObject> { reply -> onActivity { it.bridgeRefreshUpdateStatus(reply) } }
        assertEquals("failed", failed.getString("checkState"))
        assertEquals("network", failed.getString("checkFailureReason"))
        assertEquals("optional", failed.getString("state"))
        assertOptionalVisible()
        scenario!!.recreate()
        awaitRuntime()
        assertOptionalVisible()
        assertTrue(coordinator.snapshot().getBoolean("optionalPromptSuppressed"))
        Log.i(TAG, "optional_runtime_visible manual_failure_explicit recreation_preserved")
    }

    @Test fun mandatoryUsesVersionNameAndHardwareBackCannotDismissGate() {
        launch(manifest(minimum = latestCode))
        waitUntil("mandatory gate") {
            onActivityValue { it.findViewById<View>(R.id.versionGateView).isShown }
        }
        assertMandatoryVisible()
        shell("input keyevent KEYCODE_BACK")
        instrumentation.waitForIdleSync()
        assertMandatoryVisible()
        result.set(StartupGate.Result.VersionUnavailable("network"))
        val failed = awaitReply<JSONObject> { coordinator.refresh(true, it) }
        assertEquals("mandatory", failed.getString("state"))
        assertEquals("failed", failed.getString("checkState"))
        scenario!!.recreate()
        assertMandatoryVisible()
        Log.i(TAG, "mandatory_gate_back_blocked version_name_visible failure_keeps_gate")
    }

    @Test fun verifiedCompletionNotificationOpensUpdatePanel() {
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            shell("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS")
        }
        val realApk = InstrumentationRegistry.getArguments().getString("notificationRealApk") == "true"
        val expectedSha = if (realApk) LARGE_SHA else SMALL_SHA
        result.set(StartupGate.Result.Ok(manifest(url = if (realApk) LARGE_URL else SMALL_URL, sha = expectedSha)))
        awaitReply<JSONObject> { coordinator.refresh(true, it) }
        val first = instrumentation.startActivitySync(Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        var opened: MainActivity? = null
        val installer = installerMonitor()
        val coldStart = InstrumentationRegistry.getArguments().getString("notificationColdStart") == "true"
        try {
            assertTrue(awaitReply<Boolean> { coordinator.beginDownload(latestCode, it) })
            waitUntil("HTTPS fixture ready", if (realApk) 180_000 else 90_000) { coordinator.status.download.state == "ready" }
            val task = requireNotNull(updater.loadTask())
            val id = requireNotNull(task.downloadId)
            assertEquals(expectedSha, fileSha256(updater.privateFile(task)))
            if (realApk) assertNotNull(context.packageManager.getPackageArchiveInfo(updater.privateFile(task).path, 0))
            shell("input keyevent KEYCODE_HOME")
            if (coldStart) instrumentation.runOnMainSync { first.finish() }
            waitUntil("launcher foreground before notification shade") {
                val focus = focusedWindowLine()
                focus.isNotEmpty() && !focus.contains(context.packageName)
            }
            val monitor = instrumentation.addMonitor(MainActivity::class.java.name, null, false).also(monitors::add)
            shell("cmd statusbar expand-notifications")
            val automation = instrumentation.uiAutomation
            val serviceInfo = automation.serviceInfo
            serviceInfo.flags = serviceInfo.flags or
                android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
            automation.serviceInfo = serviceInfo
            var lastExpand = SystemClock.elapsedRealtime()
            waitUntil("verified notification in system UI", 30_000) {
                val bounds = android.graphics.Rect()
                val title = context.getString(R.string.update_notification_title)
                val roots = listOfNotNull(automation.rootInActiveWindow) + automation.windows.mapNotNull { it.root }
                // Search notification body, not a status-bar icon whose content description
                // also contains the title. The fixture version identifies this task's row.
                fun findBody(node: android.view.accessibility.AccessibilityNodeInfo): Boolean {
                    if (node.viewIdResourceName == "android:id/text" &&
                        node.text?.toString()?.contains("WotBTools ${task.versionName}") == true) {
                        node.getBoundsInScreen(bounds)
                        return !bounds.isEmpty
                    }
                    for (i in 0 until node.childCount) if (node.getChild(i)?.let(::findBody) == true) return true
                    return false
                }
                roots.any(::findBody)
                if (bounds.isEmpty) {
                    val focus = focusedWindowLine()
                    if (!focus.contains("NotificationShade") && !focus.contains("StatusBar") &&
                        SystemClock.elapsedRealtime() - lastExpand > 1_000) {
                        shell("cmd statusbar expand-notifications")
                        lastExpand = SystemClock.elapsedRealtime()
                    }
                    return@waitUntil false
                }
                Log.i(TAG, "actual_system_ui_notification_tap api=${android.os.Build.VERSION.SDK_INT} title=$title bounds=$bounds before=${focusedWindowLine()}")
                shell("input tap ${bounds.centerX()} ${bounds.centerY()}")
                true
            }
            waitUntil("notification reopens MainActivity", 30_000) {
                focusedWindowLine().contains("com.wotbtools.app/com.wotbtools.app.MainActivity")
            }
            // singleTask may deliver onNewIntent to the existing Activity instead of creating one.
            val notifiedActivity = (monitor.waitForActivityWithTimeout(1_000) as? MainActivity)
                ?: first.also { assertFalse("cold start must create an Activity", coldStart) }
            opened = notifiedActivity
            waitUntil("notification opens visible update panel", 60_000) { updatePanelVisible(notifiedActivity) }
            instrumentation.waitForIdleSync()
            assertTrue("update panel remains visible after route marker is consumed", updatePanelVisible(notifiedActivity))
            assertEquals(id, updater.loadTask()?.downloadId)
            assertEquals(task.token, updater.loadTask()?.token)
            assertEquals(0, installer.hits)
            Log.i(TAG, "verified_system_notification_clicked api=${android.os.Build.VERSION.SDK_INT} cold_start=$coldStart real_apk=$realApk task_id=$id token=${task.token} same_token no_redownload no_installer focus=${focusedWindowLine()}")
        } finally {
            instrumentation.runOnMainSync { opened?.finish(); first.finish() }
        }
    }

    @Test fun readyInstallWaitsForBlockedReconcileWithoutSecondClick() {
        // 使用系统安装 intent 监控器阻止真正安装；下载和文件校验均为真实执行。
        assertTrue("Grant REQUEST_INSTALL_PACKAGES app-op before running this test",
            context.packageManager.canRequestPackageInstalls())
        val installer = installerMonitor()
        launch(manifest())
        assertTrue(awaitReply<Boolean> { coordinator.beginDownload(latestCode, it) })
        waitUntil("real download verified ready", 90_000) { coordinator.status.download.state == "ready" }
        val task = requireNotNull(updater.loadTask())
        val downloadId = requireNotNull(task.downloadId)
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val replied = CountDownLatch(1)
        val accepted = AtomicReference<Boolean>()
        try {
            // 队列屏障让 reconcile 真正进入 busy，再由 UI 发出一次安装请求。
            ioExecutor.execute {
                entered.countDown()
                check(release.await(45, TimeUnit.SECONDS))
            }
            assertTrue("I/O barrier entered", entered.await(10, TimeUnit.SECONDS))
            coordinator.reconcile()
            stateExecutor.submit {}.get(10, TimeUnit.SECONDS)
            onActivity { activity ->
                activity.bridgeInstallUpdate(task.token) { value -> accepted.set(value); replied.countDown() }
            }
            stateExecutor.submit {}.get(10, TimeUnit.SECONDS)
            assertEquals("install must wait for reconcile", 1L, replied.count)
            release.countDown()
            assertTrue("queued install completes", replied.await(45, TimeUnit.SECONDS))
            assertEquals(true, accepted.get())
            waitUntil("one installer intent") { installer.hits == 1 }
            assertEquals(task.token, updater.loadTask()?.token)
            assertEquals(downloadId, updater.loadTask()?.downloadId)
            assertEquals(1, installer.hits)
            Log.i(TAG, "ready_reconcile_install queued_one_click installer_requests=1 task_id=$downloadId")
        } finally {
            release.countDown()
        }
    }

    @Test fun activityRecreationCancelsQueuedInstallAndPreservesVerifiedApk() {
        val installer = installerMonitor()
        launch(manifest())
        assertTrue(awaitReply<Boolean> { coordinator.beginDownload(latestCode, it) })
        waitUntil("verified ready") { coordinator.status.download.state == "ready" }
        val task = requireNotNull(updater.loadTask())
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val callbacks = java.util.concurrent.atomic.AtomicInteger()
        val cancelled = AtomicReference<Boolean>()
        try {
            ioExecutor.execute { entered.countDown(); check(release.await(45, TimeUnit.SECONDS)) }
            assertTrue(entered.await(10, TimeUnit.SECONDS))
            coordinator.reconcile()
            stateExecutor.submit {}.get(10, TimeUnit.SECONDS)
            onActivity { it.bridgeInstallUpdate(task.token) { accepted -> cancelled.set(accepted); callbacks.incrementAndGet() } }
            stateExecutor.submit {}.get(10, TimeUnit.SECONDS)
            assertEquals(0, callbacks.get())
            scenario!!.recreate()
            assertEquals("pause confirms cancellation before destruction", false, cancelled.get())
            assertEquals(1, callbacks.get())
            stateExecutor.submit {}.get(10, TimeUnit.SECONDS)
            release.countDown()
            repeat(3) { ioExecutor.submit {}.get(45, TimeUnit.SECONDS); stateExecutor.submit {}.get(45, TimeUnit.SECONDS) }
            instrumentation.waitForIdleSync()
            assertEquals("destroyed Activity must not receive another install callback", 1, callbacks.get())
            assertEquals(0, installer.hits)
            waitUntil("new Activity recovered READY") { coordinator.status.download.state == "ready" }
            assertEquals(task.token, updater.loadTask()?.token)
            assertEquals(task.downloadId, updater.loadTask()?.downloadId)
            assertEquals(SMALL_SHA, fileSha256(updater.privateFile(task)))
            assertNotNull(awaitReply<File?> { coordinator.prepareInstall(task.token, it) })
            Log.i(TAG, "recreated_activity_queued_install_cancelled cancellation_callbacks=1 post_destroy_callbacks=0 installer=0 ready_preserved id=${task.downloadId}")
        } finally { release.countDown() }
    }

    @Test fun notificationPermissionDenialKeepsManualPanelAndMandatoryGateUsable() {
        assumeTrue(android.os.Build.VERSION.SDK_INT >= 33)
        assertManualPanelAndMandatoryGate()
    }

    @Test fun api26ManualPanelAndMandatoryGateWithoutRuntimeNotificationPermission() {
        assumeTrue(android.os.Build.VERSION.SDK_INT == 26)
        assertManualPanelAndMandatoryGate()
    }

    private fun assertManualPanelAndMandatoryGate() {
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            shell("pm revoke ${context.packageName} android.permission.POST_NOTIFICATIONS")
            assertFalse(context.getSystemService(android.app.NotificationManager::class.java).areNotificationsEnabled())
        }
        val installer = installerMonitor()
        launch(manifest())
        assertTrue(awaitReply<Boolean> { coordinator.beginDownload(latestCode, it) })
        waitUntil("READY despite denied notification permission", 90_000) { coordinator.status.download.state == "ready" }
        val task = requireNotNull(updater.loadTask())
        if (android.os.Build.VERSION.SDK_INT >= 33) assertTrue(readyNotifications().isEmpty())
        onActivity { activity ->
            val runtime = MainActivity::class.java.getDeclaredField("runtime").apply { isAccessible = true }.get(activity) as GeckoWebRuntime
            runtime.load(MainActivity.LOCAL_APP_ENTRY + "?view=more")
        }
        waitUntil("More route without update panel") {
            onActivityValue { activity ->
                val runtime = MainActivity::class.java.getDeclaredField("runtime").apply { isAccessible = true }.get(activity) as GeckoWebRuntime
                runtime.currentUrl?.contains("view=more") == true
            }
        }
        assertFalse("More foreground alone must not satisfy the panel oracle", updatePanelVisible(onActivityValue { it }))
        onActivity { activity ->
            // ActivityScenario 1.7.0 的 lifecycle observer 按 launch intent 的 action/categories 匹配。
            // 复制 launcher identity，仍通过真实 singleTask onNewIntent 递交打开面板的 extra。
            activity.startActivity(Intent(activity.intent)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(UpdateCoordinator.OPEN_UPDATE_PANEL, true))
        }
        waitUntil("manual update panel without notification", 60_000) { updatePanelVisible(onActivityValue { it }) }
        instrumentation.waitForIdleSync()
        assertTrue("update panel remains visible after route marker is consumed", updatePanelVisible(onActivityValue { it }))
        assertNotNull(awaitReply<File?> { coordinator.prepareInstall(task.token, it) })
        assertEquals(0, installer.hits)
        result.set(StartupGate.Result.Ok(manifest(minimum = latestCode)))
        awaitReply<JSONObject> { coordinator.refresh(true, it) }
        instrumentation.waitForIdleSync()
        assertMandatoryVisible()
        assertEquals(task.token, updater.loadTask()?.token)
        assertEquals(task.downloadId, updater.loadTask()?.downloadId)
        Log.i(TAG, "manual_panel_safe api=${android.os.Build.VERSION.SDK_INT} notification_denied=${android.os.Build.VERSION.SDK_INT >= 33} marker_consumed=true mandatory_gate=true verified_file=true")
        // 显式结束本测试 Activity，并断言 DESTROYED，避免遗留任务污染下一条测试。
        onActivity { it.finish() }
        waitUntil("manual panel Activity destroyed") { scenario!!.state == Lifecycle.State.DESTROYED }
    }

    @Test fun verifiedReadyNotificationRecoversAfterProcessRestart() {
        val args = InstrumentationRegistry.getArguments()
        if (android.os.Build.VERSION.SDK_INT >= 33)
            shell("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS")
        val installer = installerMonitor()
        val restoredToken = args.getString("restoreTaskToken")
        launch(manifest())
        if (restoredToken == null) assertTrue(awaitReply<Boolean> { coordinator.beginDownload(latestCode, it) })
        else coordinator.reconcile()
        waitUntil("recovered and reverified READY notification", 90_000) {
            coordinator.status.download.state == "ready" && readyNotifications().size == 1
        }
        val task = requireNotNull(updater.loadTask())
        assertEquals(SMALL_SHA, fileSha256(updater.privateFile(task)))
        assertEquals(DownloadManager.STATUS_SUCCESSFUL, systemStatus(requireNotNull(task.downloadId)))
        if (restoredToken != null) {
            assertEquals(restoredToken, task.token)
            assertEquals(args.getString("restoreDownloadId")!!.toLong(), task.downloadId)
        }
        assertEquals(0, installer.hits)
        Log.i(TAG, "ready_notification_recovery pid=${android.os.Process.myPid()} restored=${restoredToken != null} token=${task.token} id=${task.downloadId} exact_sha=true no_installer")
        if (args.getString("killAfterReady") == "true") {
            // Host 将这个已持久化的精确 identity 传入新 instrumentation；进程退出本身不是 PASS。
            android.os.Process.killProcess(android.os.Process.myPid())
            fail("Process did not terminate")
        }
    }

    private fun readyNotifications() = context.getSystemService(android.app.NotificationManager::class.java)
        .activeNotifications.filter { it.notification.channelId == "verified-update" }

    @Test fun realHttpsBadHashNeverRequestsInstaller() {
        val installer = installerMonitor()
        launch(manifest(sha = "0".repeat(64)))
        assertTrue(awaitReply<Boolean> { coordinator.beginDownload(latestCode, it) })
        waitUntil("actual DM bad-hash rejection", 90_000) { coordinator.status.download.state == "verifyFailed" }
        assertEquals("hashMismatch", coordinator.status.download.failureReason)
        assertTrue(readyNotifications().isEmpty())
        val token = coordinator.status.download.taskToken
        assertNotNull(token)
        assertFalse(File(context.filesDir, "updates/$token.apk").exists())
        val accepted = awaitReply<Boolean> { reply -> onActivity { it.bridgeInstallUpdate(token, reply) } }
        assertFalse(accepted)
        assertEquals(0, installer.hits)
        Log.i(TAG, "actual_dm_bad_hash installer_requests=0")
    }

    @Test fun permissionDenialAndInstallerCancellationReuseVerifiedTask() {
        val installer = installerMonitor()
        launch(manifest())
        assertTrue(awaitReply<Boolean> { coordinator.beginDownload(latestCode, it) })
        waitUntil("small HTTPS fixture ready", 90_000) { coordinator.status.download.state == "ready" }
        val task = requireNotNull(updater.loadTask())
        val downloadId = requireNotNull(task.downloadId)
        assertTrue(updater.privateFile(task).isFile)
        assertFalse(context.packageManager.canRequestPackageInstalls())

        assertTrue(awaitReply<Boolean> { reply -> onActivity { it.bridgeInstallUpdate(task.token, reply) } })
        waitForSettingsWindow()
        assertEquals(0, installer.hits)
        assertEquals("installPermissionRequired", coordinator.status.download.state)
        assertTrue(updater.privateFile(task).isFile)
        returnFromSettings()
        assertFalse(context.packageManager.canRequestPackageInstalls())
        assertEquals(downloadId, updater.loadTask()?.downloadId)

        assertTrue(awaitReply<Boolean> { reply -> onActivity { it.bridgeInstallUpdate(task.token, reply) } })
        waitForSettingsWindow()
        shell("appops set ${context.packageName} REQUEST_INSTALL_PACKAGES allow")
        waitUntil("unknown-source permission granted") { context.packageManager.canRequestPackageInstalls() }
        returnFromSettings()
        waitUntil("installer intent after permission return") { installer.hits == 1 }
        assertEquals(downloadId, updater.loadTask()?.downloadId)
        assertTrue(updater.privateFile(task).isFile)
        assertEquals(DownloadManager.STATUS_SUCCESSFUL, systemStatus(downloadId))
        scenario!!.recreate()
        waitUntil("ready after installer cancellation") { coordinator.status.download.state == "ready" }
        assertEquals(1, installer.hits)
        assertEquals(downloadId, updater.loadTask()?.downloadId)
        Log.i(TAG, "permission_denied_granted installer_cancelled task_id=$downloadId no_redownload")
    }

    @Test fun realDeltaDownloadReconstructsInstalledApkExactly() {
        assumeTrue("Provide a real HTTPS patch fixture", InstrumentationRegistry.getArguments().getString("deltaPatchUrl") != null)
        val patchUrl = requireNotNull(InstrumentationRegistry.getArguments().getString("deltaPatchUrl"))
        val patchSha = requireNotNull(InstrumentationRegistry.getArguments().getString("deltaPatchSha"))
        val patchSize = requireNotNull(InstrumentationRegistry.getArguments().getString("deltaPatchSize")).toLong()
        val base = File(requireNotNull(context.applicationInfo.sourceDir))
        val targetSha = fileSha256(base)
        val patch = VersionManifest.Patch(installedCode, targetSha, "xdelta3-vcdiff", patchUrl, patchSha, patchSize)
        val update = manifest(sha = targetSha).copy(apkSizeBytes = base.length(), patches = listOf(patch))
        launch(update)
        val restoreToken = InstrumentationRegistry.getArguments().getString("restoreTaskToken")
        if (restoreToken == null) {
            assertTrue(awaitReply<Boolean> { coordinator.beginDownload(latestCode, it) })
        } else {
            coordinator.reconcile()
        }
        val initialTask = requireNotNull(updater.loadTask())
        if (InstrumentationRegistry.getArguments().getString("requireDeltaNetworkPause") == "true") {
            waitUntil("delta waits for network", 120_000) { coordinator.status.download.state in setOf("queued", "paused") }
            assertEquals(initialTask.downloadId, updater.loadTask()?.downloadId)
            Log.i(TAG, "delta_network_paused id=${initialTask.downloadId}")
        }
        if (InstrumentationRegistry.getArguments().getString("killDuringDeltaApply") == "true") {
            waitUntil("delta applying", 120_000) { coordinator.status.download.state == "applyingDelta" }
            val active = requireNotNull(updater.loadTask())
            Log.i(TAG, "delta_kill_during_apply token=${active.token} id=${active.downloadId}")
            android.os.Process.killProcess(android.os.Process.myPid())
            fail("Process did not terminate")
        }
        waitUntil("real delta reconstructed and verified", 240_000) {
            val state = coordinator.status.download.state
            assertFalse("Delta failed: ${coordinator.snapshot()}", state in setOf("downloadFailed", "verifyFailed"))
            state == "ready"
        }
        val task = requireNotNull(updater.loadTask())
        assertEquals("delta", task.packageType)
        assertEquals(initialTask.downloadId, task.downloadId)
        if (restoreToken != null) {
            assertEquals(restoreToken, task.token)
            assertEquals(InstrumentationRegistry.getArguments().getString("restoreDownloadId")!!.toLong(), task.downloadId)
        }
        assertFalse(task.fallback)
        assertEquals(base.length(), updater.privateFile(task).length())
        assertEquals(targetSha, fileSha256(updater.privateFile(task)))
        Log.i(TAG, "real_delta_download_reconstructed task_id=${task.downloadId} exact_target_sha=true")
    }

    @Test fun realCorruptDeltaFallsBackToOneFullDownload() {
        val args = InstrumentationRegistry.getArguments()
        val url = args.getString("deltaPatchUrl")
        assumeTrue("Provide a real HTTPS patch fixture", url != null)
        val size = requireNotNull(args.getString("deltaPatchSize")).toLong()
        val base = File(requireNotNull(context.applicationInfo.sourceDir))
        val patchSha = args.getString("deltaPatchSha") ?: "0".repeat(64)
        val patch = VersionManifest.Patch(installedCode, fileSha256(base), "xdelta3-vcdiff", url!!, patchSha, size)
        val declaredTargetSize = args.getString("declaredTargetSize")?.toLong() ?: base.length()
        launch(manifest().copy(apkSizeBytes = declaredTargetSize, patches = listOf(patch)))
        assertTrue(awaitReply<Boolean> { coordinator.beginDownload(latestCode, it) })
        val delta = requireNotNull(updater.loadTask())
        assertEquals("delta", delta.packageType)
        val id = requireNotNull(delta.downloadId)
        if (args.getString("interruptMidTransfer") == "true") {
            waitUntil("delta has partially downloaded", 120_000) { systemBytes(id) in 1 until size }
            Log.i(TAG, "delta_partial_download id=$id bytes=${systemBytes(id)}")
            try {
                shell("svc wifi disable")
                shell("svc data disable")
                waitUntil("delta waits for interrupted network", 120_000) { systemStatus(id) == DownloadManager.STATUS_PAUSED }
                Log.i(TAG, "delta_interrupted id=$id bytes=${systemBytes(id)}")
            } finally {
                shell("svc wifi enable")
                shell("svc data enable")
            }
        }
        waitUntil("corrupt delta falls back to verified full fixture", 240_000) {
            coordinator.status.download.state == "ready" && updater.loadTask()?.fallback == true
        }
        val full = requireNotNull(updater.loadTask())
        assertEquals("full", full.packageType)
        assertNotEquals(id, full.downloadId)
        assertEquals(SMALL_SHA, fileSha256(updater.privateFile(full)))
        repeat(3) { coordinator.reconcile(); SystemClock.sleep(300) }
        assertEquals(full.downloadId, updater.loadTask()?.downloadId)
        Log.i(TAG, "real_corrupt_delta_fallback_once original=$id full=${full.downloadId}")
    }

    private fun fileSha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { stream ->
            val buffer = ByteArray(1024 * 1024)
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    @Test fun realLargeSystemDownloadSurvivesBackgroundAndActivityRecreation() {
        // 固定不可变生产 APK 仅作为下载夹具；不尝试安装版本低于测试 APK 的产物。
        launch(manifest(url = LARGE_URL, sha = LARGE_SHA))
        if (InstrumentationRegistry.getArguments().getString("restoreTaskToken") == null) {
            assertTrue(awaitReply<Boolean> { coordinator.beginDownload(latestCode, it) })
        } else {
            // 外部 SIGKILL 后，恢复只 query，不再次执行用户下载动作。
            coordinator.reconcile()
        }
        waitUntil("large task has real bytes", 120_000) {
            (coordinator.status.download.downloadedBytes ?: 0) > 0
        }
        val first = requireNotNull(updater.loadTask())
        val id = requireNotNull(first.downloadId)
        scenario!!.recreate()
        assertEquals(id, updater.loadTask()?.downloadId)
        Log.i(TAG, "large_download_active task_id=$id token=${first.token} bytes=${systemBytes(id)}")
        scenario!!.moveToState(Lifecycle.State.CREATED)
        val beforeBackground = systemBytes(id)
        waitUntil("system download continues with Activity stopped", 120_000) {
            systemBytes(id) > beforeBackground || systemStatus(id) == DownloadManager.STATUS_SUCCESSFUL
        }
        scenario!!.moveToState(Lifecycle.State.RESUMED)
        waitUntil("large task hash-verified ready", 900_000) {
            val state = coordinator.status.download.state
            assertFalse("Large task failed: ${coordinator.snapshot()}", state in setOf("downloadFailed", "verifyFailed"))
            state == "ready"
        }
        assertEquals(id, updater.loadTask()?.downloadId)
        assertEquals(203_738_834L, updater.privateFile(first).length())
        assertEquals(first.token, coordinator.status.download.taskToken)
        assertOptionalVisible()
        Log.i(TAG, "product_large_ready task_id=$id bytes=203738834 recreated_background_same_task")
    }

    private val latestCode get() = installedCode + 1

    private fun manifest(minimum: Int = installedCode, url: String = SMALL_URL, sha: String = SMALL_SHA) =
        VersionManifest(1, latestCode, "device-download-fixture", minimum, BuildConfig.NATIVE_BRIDGE_VERSION,
            url, sha, "2026-11-01T00:00:00Z", "Controlled device update fixture")

    private fun launch(manifest: VersionManifest) {
        result.set(StartupGate.Result.Ok(manifest))
        awaitReply<JSONObject> { coordinator.refresh(true, it) }
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitUntil("Activity resumed") { scenario!!.state == Lifecycle.State.RESUMED }
    }

    private fun awaitRuntime() {
        waitUntil("real bundled Gecko bridge connected", 120_000) {
            onActivityValue { activity ->
                val runtime = MainActivity::class.java.getDeclaredField("runtime").apply { isAccessible = true }.get(activity)
                GeckoWebRuntime::class.java.getDeclaredField("port").apply { isAccessible = true }.get(runtime) != null
            }
        }
    }

    private fun assertOptionalVisible() = onActivity {
        assertEquals(View.GONE, it.findViewById<View>(R.id.versionGateView).visibility)
        assertTrue(it.findViewById<View>(R.id.runtimeView).isShown)
        assertFalse(it.isFinishing)
    }

    private fun assertMandatoryVisible() = onActivity {
        val gate = it.findViewById<ViewGroup>(R.id.versionGateView)
        assertTrue(gate.isShown)
        assertEquals(View.GONE, it.findViewById<View>(R.id.runtimeView).visibility)
        assertEquals(it.getString(R.string.update_current_version, installedName),
            it.findViewById<TextView>(R.id.versionCurrent).text.toString())
        assertEquals(1, visibleButtons(gate).size)
        assertFalse(it.isFinishing)
    }

    private fun visibleButtons(root: View): List<Button> = when {
        !root.isShown -> emptyList()
        root is Button -> listOf(root)
        root is ViewGroup -> (0 until root.childCount).flatMap { visibleButtons(root.getChildAt(it)) }
        else -> emptyList()
    }

    private fun installerMonitor(): Instrumentation.ActivityMonitor {
        val filter = IntentFilter(Intent.ACTION_VIEW).apply {
            addDataScheme("content")
            addDataType("application/vnd.android.package-archive")
        }
        // 拦截只模拟系统安装页取消；测试不安装任何 APK，也不把拦截冒充真实 installer UI。
        return instrumentation.addMonitor(filter, Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null), true)
            .also(monitors::add)
    }

    private fun updatePanelVisible(activity: MainActivity): Boolean {
        val url = AtomicReference<String?>()
        instrumentation.runOnMainSync {
            val runtime = MainActivity::class.java.getDeclaredField("runtime").apply { isAccessible = true }.get(activity)
            url.set((runtime as GeckoWebRuntime).currentUrl)
        }
        if (url.get()?.contains("view=more") != true || url.get()?.contains("androidUpdate=1") == true) return false
        val screen = android.graphics.Rect(0, 0, context.resources.displayMetrics.widthPixels,
            context.resources.displayMetrics.heightPixels)
        fun visiblePanel(node: android.view.accessibility.AccessibilityNodeInfo): Boolean {
            if (node.viewIdResourceName == "android-update-panel" && node.className == "android.app.Dialog") {
                val bounds = android.graphics.Rect(); node.getBoundsInScreen(bounds)
                return node.isVisibleToUser && !bounds.isEmpty && android.graphics.Rect.intersects(bounds, screen)
            }
            return (0 until node.childCount).any { index -> node.getChild(index)?.let(::visiblePanel) == true }
        }
        // Gecko virtual descendants need traversal; release notes may be outside the sheet viewport.
        // A transiently unavailable accessibility tree is not evidence of a visible panel.
        return try {
            val automation = instrumentation.uiAutomation
            val info = automation.serviceInfo
            val reportIds = android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
            if (info.flags and reportIds == 0) {
                info.flags = info.flags or reportIds
                automation.serviceInfo = info
            }
            automation.rootInActiveWindow?.let(::visiblePanel) == true
        } catch (_: NullPointerException) { false }
    }

    private fun onActivity(action: (MainActivity) -> Unit) { scenario!!.onActivity(action) }

    private fun <T> onActivityValue(action: (MainActivity) -> T): T {
        val value = AtomicReference<T>()
        onActivity { value.set(action(it)) }
        return value.get()
    }

    private fun <T> awaitReply(start: ((T) -> Unit) -> Unit): T {
        val latch = CountDownLatch(1)
        val value = AtomicReference<T>()
        start { value.set(it); latch.countDown() }
        assertTrue("Native callback timed out", latch.await(45, TimeUnit.SECONDS))
        return value.get()
    }

    private fun waitUntil(label: String, timeoutMs: Long = 20_000, condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) {
            if (condition()) return
            SystemClock.sleep(100)
        }
        logAccessibilityHierarchy()
        fail("Timed out: $label; status=${if (::coordinator.isInitialized) coordinator.snapshot() else "uninitialized"}")
    }

    private fun logAccessibilityHierarchy() {
        Log.e(TAG, "accessibility_timeout focus=${focusedWindowLine()}")
        var remaining = 300
        fun logNode(node: android.view.accessibility.AccessibilityNodeInfo, depth: Int) {
            if (depth > 30 || remaining-- <= 0) return
            val bounds = android.graphics.Rect(); node.getBoundsInScreen(bounds)
            Log.e(TAG, "accessibility_node depth=$depth class=${node.className} id=${node.viewIdResourceName} text=${node.text} visible=${node.isVisibleToUser} bounds=$bounds")
            for (i in 0 until node.childCount) node.getChild(i)?.let { logNode(it, depth + 1) }
        }
        try {
            val automation = instrumentation.uiAutomation
            (listOfNotNull(automation.rootInActiveWindow) + automation.windows.mapNotNull { it.root })
                .forEach { logNode(it, 0) }
        } catch (error: Exception) { Log.e(TAG, "accessibility_dump_unavailable", error) }
    }

    private fun shell(command: String): String = instrumentation.uiAutomation.executeShellCommand(command).use { descriptor ->
        android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).bufferedReader().use { it.readText() }
    }

    private fun focusedWindowLine(): String = shell("dumpsys window").lineSequence()
        .firstOrNull { it.contains("mCurrentFocus=") }.orEmpty()

    private fun waitForSettingsWindow() {
        // Activity resumed 早于窗口真正可接收按键；系统 ANR 覆盖层不能冒充设置页。
        waitUntil("settings window focused: ${focusedWindowLine()}", 45_000) {
            focusedWindowLine().contains("com.android.settings")
        }
        instrumentation.uiAutomation.waitForIdle(500, 10_000)
        assertTrue("Settings lost window focus: ${focusedWindowLine()}",
            focusedWindowLine().contains("com.android.settings"))
        Log.i(TAG, "settings_window_ready ${focusedWindowLine()}")
    }

    private fun returnFromSettings() {
        // API34 设置页可经 ManageExternalSources → SpaActivity 跳转，按真实 Back 栈返回。
        repeat(3) {
            if (scenario!!.state == Lifecycle.State.RESUMED) return
            waitForSettingsWindow()
            val before = focusedWindowLine()
            shell("input keyevent KEYCODE_BACK")
            waitUntil("settings Back transition; focus=${focusedWindowLine()}", 10_000) {
                scenario!!.state == Lifecycle.State.RESUMED || focusedWindowLine() != before
            }
            instrumentation.uiAutomation.waitForIdle(500, 10_000)
        }
        waitUntil("return from actual permission settings; focus=${focusedWindowLine()}") {
            scenario!!.state == Lifecycle.State.RESUMED
        }
    }

    private fun systemStatus(id: Long): Int = systemColumn(id, DownloadManager.COLUMN_STATUS).toInt()
    private fun systemBytes(id: Long): Long = systemColumn(id, DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)

    private fun systemColumn(id: Long, column: String): Long {
        val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        manager.query(DownloadManager.Query().setFilterById(id)).use { cursor ->
            assertNotNull(cursor)
            assertTrue("System task disappeared: $id", cursor!!.moveToFirst())
            return cursor.getLong(cursor.getColumnIndexOrThrow(column))
        }
    }

    companion object {
        private const val TAG = "UpdateDeviceTest"
        private const val SMALL_URL = "https://raw.githubusercontent.com/A158Coke/WotbTools/e71e4d667bbc929b418358d014fb8526a134e025/frontend/.nvmrc"
        private const val SMALL_SHA = "68ca3fba3b7e864770cb61aeb306d4bd4354b68ab4dd38450860c5d823e42a53"
        private const val LARGE_URL = "https://wotbtools.com/download/android/wotbtools-android-v3.32.0.apk"
        private const val LARGE_SHA = "cd00d0c2fda31b3d418b093c994586c8eed2b6b90d8b2e659054b05713c5c0bf"
    }
}
