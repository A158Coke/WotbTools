package com.wotbtools.app

import android.content.Context
import android.app.DownloadManager
import android.os.Environment
import android.os.Looper
import java.io.File
import java.util.ArrayDeque
import java.util.concurrent.Executor
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowDownloadManager

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class UpdateCoordinatorTest {
    private lateinit var context: Context

    private class QueueExecutor : Executor {
        private val tasks = ArrayDeque<Runnable>()
        override fun execute(command: Runnable) { tasks.add(command) }
        fun drain() { while (tasks.isNotEmpty()) tasks.removeFirst().run() }
    }

    private data class ClassificationCase(val installed: Int, val latest: Int, val minimum: Int, val expected: String)

    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("android-updates", Context.MODE_PRIVATE).edit().clear().commit()
    }

    private fun manifest(latest: Int = 3028000, minimum: Int = 3017007) = VersionManifest(
        1, latest, "${latest / 1_000_000}.${latest / 1000 % 1000}.${latest % 1000}", minimum,
        3, "https://example.invalid/update.apk", "a".repeat(64), "2026-11-01T00:00:00Z", null,
    )

    private fun finish(state: QueueExecutor, io: QueueExecutor) {
        repeat(4) {
            state.drain()
            io.drain()
            state.drain()
            shadowOf(Looper.getMainLooper()).idle()
        }
    }

    @Test fun classificationMatrixUsesMinimumBeforeLatestAndDisplaysVersionName() {
        for ((installed, latest, minimum, expected) in listOf(
            ClassificationCase(3028000, 3028000, 3017007, "upToDate"),
            ClassificationCase(3029000, 3028000, 3017007, "upToDate"),
            ClassificationCase(3027002, 3028000, 3017007, "optional"),
            ClassificationCase(3017007, 3028000, 3017007, "optional"),
            ClassificationCase(3017006, 3028000, 3017007, "mandatory"),
            ClassificationCase(3027002, 3028000, 3028000, "mandatory"),
            ClassificationCase(3033000, 4000000, 4000000, "mandatory"),
            ClassificationCase(4000000, 4000000, 4000000, "upToDate"),
        )) {
            val state = QueueExecutor()
            val io = QueueExecutor()
            val coordinator = UpdateCoordinator(context, installed, "3.27.2",
                { StartupGate.Result.Ok(manifest(latest, minimum)) }, state, io)
            coordinator.refresh(true)
            finish(state, io)
            val result = coordinator.snapshot()
            assertEquals(expected, result.getString("state"))
            assertEquals("3.27.2", result.getString("currentVersionName"))
            assertEquals(installed < latest, coordinator.legacyCheckForUpdate())
            assertContract(result)
        }
    }

    @Test fun failedDeltaAutomaticallyStartsOneFullFallback() {
        val originalSource = context.applicationInfo.sourceDir
        try {
            ShadowDownloadManager.reset()
            val base = File(context.cacheDir, "coordinator-base.apk").apply { writeText("base fixture") }
            context.applicationInfo.sourceDir = base.path
            @Suppress("DEPRECATION")
            val installed = context.packageManager.getPackageInfo(context.packageName, 0).versionCode
            val digest = java.security.MessageDigest.getInstance("SHA-256").digest(base.readBytes())
                .joinToString("") { "%02x".format(it) }
            val patch = VersionManifest.Patch(installed, digest, "xdelta3-vcdiff", "https://example.invalid/patch",
                "a".repeat(64), 10)
            val state = QueueExecutor()
            val io = QueueExecutor()
            val coordinator = UpdateCoordinator(context, 3027002, "3.27.2",
                { StartupGate.Result.Ok(manifest().copy(patches = listOf(patch), apkSizeBytes = 1000)) }, state, io)
            coordinator.refresh(true)
            finish(state, io)
            var accepted = false
            coordinator.beginDownload(3028000) { accepted = it }
            state.drain(); io.drain(); state.drain()
            val pending = ApkUpdater(context).loadTask()!!
            val initialManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val initialShadow = Shadow.extract<ShadowDownloadManager>(initialManager)
            Shadow.extract<ShadowDownloadManager.ShadowRequest>(initialShadow.getRequest(pending.downloadId!!)).status = DownloadManager.STATUS_PENDING
            finish(state, io)
            assertTrue(accepted)
            val updater = ApkUpdater(context)
            val delta = updater.loadTask()!!
            assertEquals("delta", delta.packageType)
            val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val shadow = Shadow.extract<ShadowDownloadManager>(manager)
            val request = Shadow.extract<ShadowDownloadManager.ShadowRequest>(shadow.getRequest(delta.downloadId!!))
            request.status = DownloadManager.STATUS_FAILED
            coordinator.reconcile()
            finish(state, io)
            val full = updater.loadTask()!!
            assertEquals("full", full.packageType)
            assertTrue(full.fallback)
            assertEquals(1, shadow.requestCount)
            assertEquals("full", coordinator.status.download.packageType)
            assertEquals(full.downloadId, updater.loadTask()?.downloadId)
        } finally {
            context.applicationInfo.sourceDir = originalSource
        }
    }

    @Test fun downloadClickWaitsForConcurrentReconciliation() {
        val state = QueueExecutor()
        val io = QueueExecutor()
        val coordinator = UpdateCoordinator(context, 3027002, "3.27.2",
            { StartupGate.Result.Ok(manifest()) }, state, io)
        coordinator.refresh(true)
        finish(state, io)
        coordinator.reconcile()
        state.drain() // 对账 I/O 尚未执行。
        var accepted: Boolean? = null
        coordinator.beginDownload(3028000) { accepted = it }
        state.drain()
        assertNull(accepted)
        io.drain()
        state.drain()
        shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(100))
        finish(state, io)
        assertEquals(true, accepted)
        assertNotNull(ApkUpdater(context).loadTask())
    }

    @Test fun unknownOfflineAndNetworkFailureNeverInventCurrentRelease() {
        val state = QueueExecutor()
        val io = QueueExecutor()
        var fetches = 0
        val coordinator = UpdateCoordinator(context, 3027002, "3.27.2", {
            fetches++
            StartupGate.Result.VersionUnavailable("network")
        }, state, io)
        assertEquals("unknown", coordinator.state())
        assertFalse(coordinator.legacyCheckForUpdate())
        assertTrue(coordinator.snapshot().isNull("latestVersionCode"))
        assertContract(coordinator.snapshot())
        coordinator.refresh(false)
        finish(state, io)
        assertEquals(0, fetches)
        assertEquals("checkFailed", coordinator.state())
        assertEquals("offline", coordinator.status.checkFailureReason)
        coordinator.refresh(true)
        finish(state, io)
        assertEquals(1, fetches)
        assertEquals("network", coordinator.status.checkFailureReason)
        assertTrue(coordinator.snapshot().isNull("latestVersionName"))
        assertContract(coordinator.snapshot())
    }

    @Test fun concurrentRefreshSharesOneRequestAndReturnsSameTerminalRevision() {
        val state = QueueExecutor()
        val io = QueueExecutor()
        var fetches = 0
        val coordinator = UpdateCoordinator(context, 3027002, "3.27.2", {
            fetches++
            StartupGate.Result.Ok(manifest())
        }, state, io)
        val replies = mutableListOf<JSONObject>()
        coordinator.refresh(true, replies::add)
        coordinator.refresh(true, replies::add)
        state.drain()
        assertEquals("checking", coordinator.state())
        assertTrue(replies.isEmpty())
        val checkingRevision = coordinator.status.revision
        finish(state, io)
        assertEquals(1, fetches)
        assertEquals(2, replies.size)
        assertEquals(replies[0].toString(), replies[1].toString())
        assertEquals("succeeded", replies[0].getString("checkState"))
        assertTrue(replies[0].getLong("revision") > checkingRevision)
    }

    @Test fun failedRefreshRetainsKnownMandatoryDuringCheckAndAfterFailure() {
        val state = QueueExecutor()
        val io = QueueExecutor()
        var next: StartupGate.Result = StartupGate.Result.Ok(manifest(minimum = 3028000))
        val coordinator = UpdateCoordinator(context, 3027002, "3.27.2", { next }, state, io)
        coordinator.refresh(true)
        finish(state, io)
        val original = coordinator.latestManifest
        for (reason in listOf("network", "invalidManifest", "exception detail must not escape")) {
            next = StartupGate.Result.VersionUnavailable(reason)
            coordinator.refresh(true)
            state.drain()
            assertEquals("mandatory", coordinator.state())
            assertEquals("checking", coordinator.status.checkState)
            finish(state, io)
            assertSame(original, coordinator.latestManifest)
            assertEquals("mandatory", coordinator.snapshot().getString("state"))
            assertEquals("failed", coordinator.status.checkState)
            assertEquals(if (reason == "invalidManifest") reason else "network", coordinator.status.checkFailureReason)
            assertContract(coordinator.snapshot())
        }
    }

    @Test fun dismissalPersistsOnlySameOptionalVersionAndCannotSuppressMandatory() {
        val state = QueueExecutor()
        val io = QueueExecutor()
        var next = manifest()
        fun create() = UpdateCoordinator(context, 3027002, "3.27.2", { StartupGate.Result.Ok(next) }, state, io)
        val first = create()
        first.refresh(true)
        finish(state, io)
        var accepted = false
        first.dismissOptionalUpdate(3028000) { accepted = it }
        finish(state, io)
        assertTrue(accepted)
        assertTrue(first.status.optionalPromptSuppressed)
        val recreated = create()
        recreated.refresh(true)
        finish(state, io)
        assertTrue(recreated.status.optionalPromptSuppressed)
        assertEquals("optional", recreated.state()) // 手动检查仍暴露可更新状态。
        next = manifest(latest = 3029000)
        recreated.refresh(true)
        finish(state, io)
        assertFalse(recreated.status.optionalPromptSuppressed)
        recreated.dismissOptionalUpdate(3028000) { accepted = it }
        finish(state, io)
        assertFalse(accepted)
        next = manifest(minimum = 3028000)
        recreated.refresh(true)
        finish(state, io)
        assertEquals("mandatory", recreated.state())
        assertFalse(recreated.status.optionalPromptSuppressed)
        recreated.dismissOptionalUpdate(3028000) { accepted = it }
        finish(state, io)
        assertFalse(accepted)
        assertEquals(setOf("dismissedLatestVersionCode"), recreated.preferences.all.keys)
    }

    @Test fun malformedPresentationPreferenceCannotStrandManualCheckOrSuppressAnUpdate() {
        val state = QueueExecutor()
        val io = QueueExecutor()
        context.getSharedPreferences("android-updates", Context.MODE_PRIVATE).edit()
            .putString("dismissedLatestVersionCode", "3028000").commit()
        val coordinator = UpdateCoordinator(context, 3027002, "3.27.2", { StartupGate.Result.Ok(manifest()) }, state, io)
        var terminal: JSONObject? = null
        coordinator.refresh(true) { terminal = it }
        finish(state, io)
        assertNotNull(terminal)
        assertEquals("succeeded", terminal!!.getString("checkState"))
        assertEquals("optional", terminal!!.getString("state"))
        assertFalse(terminal!!.getBoolean("optionalPromptSuppressed"))
    }

    @Test fun detachedListenersReceiveNeitherQueuedInitialNorChangedNotification() {
        val state = QueueExecutor()
        val io = QueueExecutor()
        val coordinator = UpdateCoordinator(context, 3027002, "3.27.2", { StartupGate.Result.Ok(manifest()) }, state, io)
        var calls = 0
        val listener: () -> Unit = { calls++ }
        coordinator.addListener(listener)
        coordinator.removeListener(listener)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(0, calls)
        coordinator.addListener(listener)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(1, calls)
        coordinator.refresh(true)
        state.drain()
        coordinator.removeListener(listener)
        finish(state, io)
        assertEquals(1, calls)
    }

    @Test fun downloadProjectionKeepsUnknownProgressNullAndCannotMutateNativeSnapshot() {
        val state = QueueExecutor()
        val io = QueueExecutor()
        val coordinator = UpdateCoordinator(context, 3027002, "3.27.2", { StartupGate.Result.Ok(manifest()) }, state, io)
        coordinator.refresh(true)
        finish(state, io)
        coordinator.beginDownload(3028000) { assertTrue(it) }
        finish(state, io)
        val task = ApkUpdater(context).loadTask()!!
        val downloads: ShadowDownloadManager = Shadow.extract(context.getSystemService(Context.DOWNLOAD_SERVICE))
        val request: ShadowDownloadManager.ShadowRequest = Shadow.extract(downloads.getRequest(task.downloadId!!))
        request.status = DownloadManager.STATUS_PAUSED
        request.bytesSoFar = 1024
        request.totalSize = -1
        coordinator.reconcile()
        finish(state, io)
        val first = coordinator.snapshot()
        assertTrue(first.getJSONObject("download").isNull("totalBytes"))
        assertTrue(first.getJSONObject("download").isNull("progressPercent"))
        assertContract(first)
        first.getJSONObject("download").put("state", "ready")
        assertEquals("paused", coordinator.snapshot().getJSONObject("download").getString("state"))
    }

    @Test fun completedTaskIsPinnedReverifiedAndTamperingNeverProducesInstallFile() {
        val bytes = "independent controlled APK bytes".toByteArray()
        val hash = java.security.MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }
        var nextManifest = manifest().copy(sha256 = hash)
        val state = QueueExecutor()
        val io = QueueExecutor()
        val coordinator = UpdateCoordinator(context, 3027002, "3.27.2", { StartupGate.Result.Ok(nextManifest) }, state, io)
        coordinator.refresh(true)
        finish(state, io)
        coordinator.beginDownload(3028000) { assertTrue(it) }
        finish(state, io)
        val updater = ApkUpdater(context)
        val task = updater.loadTask()!!
        File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "updates/${task.token}.apk")
            .apply { parentFile!!.mkdirs(); writeBytes(bytes) }
        val downloads: ShadowDownloadManager = Shadow.extract(context.getSystemService(Context.DOWNLOAD_SERVICE))
        val request: ShadowDownloadManager.ShadowRequest = Shadow.extract(downloads.getRequest(task.downloadId!!))
        request.status = DownloadManager.STATUS_SUCCESSFUL
        coordinator.reconcile()
        finish(state, io)
        assertEquals("ready", coordinator.status.download.state)
        nextManifest = manifest(latest = 3029000).copy(sha256 = "b".repeat(64))
        coordinator.refresh(true)
        finish(state, io)
        assertEquals(3028000, coordinator.status.download.versionCode)
        assertEquals("3.28.0", coordinator.status.download.versionName)
        var prepared: File? = null
        coordinator.prepareInstall(task.token) { prepared = it }
        finish(state, io)
        assertNotNull(prepared)
        coordinator.installPermissionRequired(task.token)
        finish(state, io)
        assertEquals("installPermissionRequired", coordinator.status.download.state)
        coordinator.prepareInstall(task.token) { prepared = it }
        finish(state, io)
        assertNotNull(prepared)
        assertEquals(1, downloads.requestCount)
        updater.privateFile(task).writeText("tampered after ready")
        coordinator.prepareInstall(task.token) { prepared = it }
        finish(state, io)
        assertNull(prepared)
        assertEquals("verifyFailed", coordinator.status.download.state)
        assertEquals("hashMismatch", coordinator.status.download.failureReason)
        assertFalse(updater.privateFile(task).exists())
        assertEquals(0, downloads.requestCount) // 坏包及其系统任务已清理，绝不保留为可安装下载。
    }

    @Test fun newMinimumInvalidatesPinnedPackageBeforeInstallerHandoff() {
        val state = QueueExecutor()
        val io = QueueExecutor()
        var next = manifest()
        val coordinator = UpdateCoordinator(context, 3027002, "3.27.2", { StartupGate.Result.Ok(next) }, state, io)
        coordinator.refresh(true)
        finish(state, io)
        coordinator.beginDownload(3028000) { assertTrue(it) }
        finish(state, io)
        val task = ApkUpdater(context).loadTask()!!
        next = manifest(latest = 3029000, minimum = 3029000)
        coordinator.refresh(true)
        finish(state, io)
        assertEquals("mandatory", coordinator.state())
        assertEquals("unsupportedArtifact", coordinator.status.download.failureReason)
        var calls = 0
        coordinator.prepareInstall(task.token) { assertNull(it); calls++ }
        finish(state, io)
        assertEquals(1, calls)
    }

    /** 验证实际 producer JSON，而不是复制一份预期 wire shape。 */
    private fun assertContract(value: JSONObject) {
        val schema = JSONObject(File("../../contracts/android-native-bridge.json").readText())
            .getJSONObject("methods").getJSONObject("getUpdateStatus").getJSONObject("response")
        assertObject(value, schema)
    }

    private fun assertObject(value: JSONObject, schema: JSONObject) {
        val fields = schema.getJSONObject("fields")
        assertEquals(fields.keys().asSequence().toSet(), value.keys().asSequence().toSet())
        fields.keys().forEach { name ->
            val spec = fields.getJSONObject(name)
            val actual = value.get(name)
            if (actual === JSONObject.NULL) {
                assertTrue("$name must be nullable", spec.optBoolean("nullable"))
            } else {
                when (spec.getString("type")) {
                    "object" -> assertObject(actual as JSONObject, spec)
                    "string" -> assertTrue("$name must be string", actual is String)
                    "boolean" -> assertTrue("$name must be boolean", actual is Boolean)
                    "integer" -> {
                        assertTrue("$name must be integer", actual is Int || actual is Long)
                        val number = (actual as Number).toLong()
                        if (spec.has("minimum")) assertTrue(name, number >= spec.getLong("minimum"))
                        if (spec.has("maximum")) assertTrue(name, number <= spec.getLong("maximum"))
                    }
                }
                if (spec.has("enum")) {
                    val tokens = spec.getJSONArray("enum")
                    assertTrue("$name must match canonical enum", (0 until tokens.length()).any { tokens.get(it) == actual })
                }
            }
        }
    }
}
