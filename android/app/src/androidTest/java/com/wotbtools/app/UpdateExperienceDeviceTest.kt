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
            if (deltaUrl == null) {
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

    @Test fun completedDownloadNotificationReceiverRecognizesOnlyOwnedTask() {
        result.set(StartupGate.Result.Ok(manifest()))
        awaitReply<JSONObject> { coordinator.refresh(true, it) }
        val first = instrumentation.startActivitySync(Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        var opened: MainActivity? = null
        try {
            waitUntil("real bundled Gecko bridge connected", 120_000) {
                val ready = AtomicReference(false)
                instrumentation.runOnMainSync {
                    val field = MainActivity::class.java.getDeclaredField("runtime").apply { isAccessible = true }
                    val runtime = field.get(first) as GeckoWebRuntime
                    val port = GeckoWebRuntime::class.java.getDeclaredField("port").apply { isAccessible = true }
                    ready.set(port.get(runtime) != null)
                }
                ready.get()
            }
            assertTrue(awaitReply<Boolean> { coordinator.beginDownload(latestCode, it) })
            waitUntil("HTTPS fixture ready", 90_000) { coordinator.status.download.state == "ready" }
            val task = requireNotNull(updater.loadTask())
            val id = requireNotNull(task.downloadId)
            shell("input keyevent KEYCODE_HOME")
            val activityMonitor = instrumentation.addMonitor(MainActivity::class.java.name, null, false).also(monitors::add)
            fun sendClick(clicked: Long) {
                context.sendBroadcast(Intent(DownloadManager.ACTION_NOTIFICATION_CLICKED)
                    .setClass(context, UpdateCoordinator.NotificationReceiver::class.java)
                    .putExtra(DownloadManager.EXTRA_NOTIFICATION_CLICK_DOWNLOAD_IDS, longArrayOf(clicked)))
            }
            sendClick(id + 1_000_000)
            SystemClock.sleep(1_000)
            assertEquals("unrelated task must not reopen app", 0, activityMonitor.hits)
            assertEquals(id, updater.loadTask()?.downloadId)
            sendClick(id)
            opened = activityMonitor.waitForActivityWithTimeout(30_000) as? MainActivity
            assertNotNull("owned notification reopens MainActivity", opened)
            waitUntil("owned notification routes to update panel", 30_000) {
                val url = AtomicReference<String?>()
                instrumentation.runOnMainSync {
                    val field = MainActivity::class.java.getDeclaredField("runtime").apply { isAccessible = true }
                    url.set((field.get(opened!!) as GeckoWebRuntime).currentUrl)
                }
                url.get()?.contains("androidUpdate=1") == true
            }
            assertEquals(id, updater.loadTask()?.downloadId)
            assertEquals(task.token, updater.loadTask()?.token)
            Log.i(TAG, "owned_notification_routes_update_panel id=$id unrelated_ignored no_redownload")
        } finally {
            instrumentation.runOnMainSync { opened?.finish(); first.finish() }
        }
    }

    @Test fun realHttpsBadHashNeverRequestsInstaller() {
        val installer = installerMonitor()
        launch(manifest(sha = "0".repeat(64)))
        assertTrue(awaitReply<Boolean> { coordinator.beginDownload(latestCode, it) })
        waitUntil("actual DM bad-hash rejection", 90_000) { coordinator.status.download.state == "verifyFailed" }
        assertEquals("hashMismatch", coordinator.status.download.failureReason)
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
        fail("Timed out: $label; status=${if (::coordinator.isInitialized) coordinator.snapshot() else "uninitialized"}")
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
