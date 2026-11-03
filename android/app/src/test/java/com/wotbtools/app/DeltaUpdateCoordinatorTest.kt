package com.wotbtools.app

import android.app.DownloadManager
import android.content.Context
import android.os.Environment
import android.os.Looper
import java.io.File
import java.security.MessageDigest
import java.util.ArrayDeque
import java.util.concurrent.Executor
import org.json.JSONObject
import org.junit.After
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
class DeltaUpdateCoordinatorTest {
    private class QueueExecutor : Executor {
        private val tasks = ArrayDeque<Runnable>()
        override fun execute(command: Runnable) { tasks.add(command) }
        fun drain() { while (tasks.isNotEmpty()) tasks.removeFirst().run() }
    }

    private lateinit var context: Context
    private lateinit var manager: DownloadManager
    private lateinit var downloads: ShadowDownloadManager
    private var originalSource: String? = null
    private lateinit var base: File
    private var installed = 0
    private val state = QueueExecutor()
    private val io = QueueExecutor()

    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        originalSource = context.applicationInfo.sourceDir
        context.getSharedPreferences("android-updates", Context.MODE_PRIVATE).edit().clear().commit()
        ShadowDownloadManager.reset()
        manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        downloads = Shadow.extract(manager)
        base = File(context.cacheDir, "delta-coordinator-base.apk").apply { writeText("installed base fixture") }
        context.applicationInfo.sourceDir = base.path
        @Suppress("DEPRECATION")
        installed = context.packageManager.getPackageInfo(context.packageName, 0).versionCode
    }

    @After fun cleanup() { context.applicationInfo.sourceDir = originalSource }

    private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)
        .joinToString("") { "%02x".format(it) }

    private fun manifest(baseHash: String = sha(base.readBytes()), patchSize: Long = 100): VersionManifest {
        val patch = VersionManifest.Patch(installed, baseHash, "xdelta3-vcdiff",
            "https://example.invalid/update.delta", sha(byteArrayOf(1, 2)), patchSize)
        return VersionManifest(1, 4000000, "4.0.0", 4000000, 3,
            "https://example.invalid/update.apk", "a".repeat(64), null, null,
            patches = listOf(patch), apkSizeBytes = 1000)
    }

    private fun finish() {
        repeat(5) { state.drain(); io.drain(); state.drain(); shadowOf(Looper.getMainLooper()).idle() }
    }

    private fun coordinator(manifest: VersionManifest, updater: ApkUpdater? = null): UpdateCoordinator =
        UpdateCoordinator(context, 3027002, "3.27.2", { StartupGate.Result.Ok(manifest) }, state, io, updater)

    private fun start(manifest: VersionManifest, updater: ApkUpdater? = null): Pair<UpdateCoordinator, ApkUpdater.Task> {
        val coordinator = coordinator(manifest, updater)
        coordinator.refresh(true)
        finish()
        var accepted = false
        coordinator.beginDownload(4000000) { accepted = it }
        state.drain(); io.drain(); state.drain()
        ApkUpdater(context).loadTask()?.let { request(it).status = DownloadManager.STATUS_PENDING }
        finish()
        assertTrue(accepted)
        return coordinator to ApkUpdater(context).loadTask()!!
    }

    private fun request(task: ApkUpdater.Task): ShadowDownloadManager.ShadowRequest =
        Shadow.extract(downloads.getRequest(task.downloadId!!))

    @Test fun wrongBaseAndInsufficientSavingsChooseFullWhileThresholdBoundaryAllowsDelta() {
        val cases = listOf(
            Triple(sha("wrong".toByteArray()), 100L, "full"),
            Triple(sha(base.readBytes()), 101L, "full"),
            Triple(sha(base.readBytes()), 100L, "delta"),
        )
        for ((hash, size, expected) in cases) {
            context.getSharedPreferences("android-updates", Context.MODE_PRIVATE).edit().clear().commit()
            ShadowDownloadManager.reset()
            val (coordinator, task) = start(manifest(hash, size))
            assertEquals(expected, task.packageType)
            assertEquals(expected, coordinator.status.download.packageType)
            assertEquals(1, downloads.requestCount)
            assertEquals(if (expected == "delta") "https://example.invalid/update.delta" else "https://example.invalid/update.apk",
                request(task).uri.toString())
        }
    }

    @Test fun corruptPatchFallsBackOnceAndFailedFullDoesNotEnqueueAgain() {
        val (coordinator, delta) = start(manifest())
        assertEquals("delta", delta.packageType)
        File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "updates/${delta.token}.apk")
            .apply { parentFile!!.mkdirs(); writeBytes(byteArrayOf(8, 9)) }
        request(delta).status = DownloadManager.STATUS_SUCCESSFUL
        coordinator.reconcile()
        finish()
        val full = ApkUpdater(context).loadTask()!!
        assertEquals("full", full.packageType)
        assertTrue(full.fallback)
        assertEquals("https://example.invalid/update.apk", request(full).uri.toString())
        assertEquals(1, downloads.requestCount)
        request(full).status = DownloadManager.STATUS_FAILED
        repeat(3) { coordinator.reconcile(); finish() }
        assertEquals("downloadFailed", coordinator.status.download.state)
        assertEquals(full.downloadId, ApkUpdater(context).loadTask()!!.downloadId)
        assertEquals(1, downloads.requestCount)
    }

    @Test fun reconstructedTargetHashMismatchFallsBackAndNeverPublishesReady() {
        var decoded = false
        val updater = ApkUpdater(context) { _, _, output, size ->
            decoded = true
            output.writeBytes(ByteArray(size.toInt()) { 42 })
        }
        val (coordinator, delta) = start(manifest(patchSize = 2), updater)
        assertEquals("delta", delta.packageType)
        File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "updates/${delta.token}.apk")
            .apply { parentFile!!.mkdirs(); writeBytes(byteArrayOf(1, 2)) }
        request(delta).status = DownloadManager.STATUS_SUCCESSFUL
        coordinator.reconcile()
        finish()
        assertTrue(decoded)
        val full = updater.loadTask()!!
        assertEquals("full", full.packageType)
        assertTrue(full.fallback)
        assertFalse(updater.privateFile(full).exists())
        assertNotEquals("ready", coordinator.status.download.state)
        assertEquals("https://example.invalid/update.apk", request(full).uri.toString())
        repeat(2) { coordinator.reconcile(); finish() }
        assertEquals(full.downloadId, updater.loadTask()!!.downloadId)
        assertEquals(1, downloads.requestCount)
    }

    @Test fun tamperedReadyDeltaFallsBackBeforeInstallerHandoff() {
        val target = ByteArray(1000) { 42 }
        val update = manifest(patchSize = 2).copy(sha256 = sha(target))
        val updater = ApkUpdater(context) { _, _, output, _ -> output.writeBytes(target) }
        val (coordinator, delta) = start(update, updater)
        File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "updates/${delta.token}.apk")
            .apply { parentFile!!.mkdirs(); writeBytes(byteArrayOf(1, 2)) }
        request(delta).status = DownloadManager.STATUS_SUCCESSFUL
        coordinator.reconcile()
        finish()
        assertEquals("ready", coordinator.status.download.state)
        updater.privateFile(delta).writeBytes(byteArrayOf(7))
        var handedOff: File? = File("unexpected")
        coordinator.prepareInstall(delta.token) { handedOff = it }
        finish()
        assertNull(handedOff)
        val full = updater.loadTask()!!
        assertEquals("full", full.packageType)
        assertTrue(full.fallback)
        assertEquals("https://example.invalid/update.apk", request(full).uri.toString())
        assertEquals(1, downloads.requestCount)
    }
    @Test fun restartAdoptsEnqueuedFallbackAndDoesNotDuplicateItsIntent() {
        val update = manifest()
        val (first, delta) = start(update)
        request(delta).status = DownloadManager.STATUS_FAILED
        first.reconcile()
        finish()
        val full = ApkUpdater(context).loadTask()!!
        assertTrue(full.fallback)
        val preferences = context.getSharedPreferences("android-updates", Context.MODE_PRIVATE)
        val persisted = JSONObject(preferences.getString(ApkUpdater.TASK_KEY, null)!!)
        preferences.edit().putString(ApkUpdater.TASK_KEY, persisted.put("downloadId", JSONObject.NULL).toString()).commit()
        val restarted = coordinator(update)
        repeat(3) { restarted.reconcile(); finish() }
        val restored = ApkUpdater(context).loadTask()!!
        assertEquals(full.downloadId, restored.downloadId)
        assertEquals(full.token, restored.token)
        assertEquals("full", restarted.status.download.packageType)
        assertEquals(1, downloads.requestCount)
    }

    @Test fun restartEnqueuesSavedFallbackIntentExactlyOnceWhenNoRowExists() {
        val update = manifest()
        val (first, delta) = start(update)
        request(delta).status = DownloadManager.STATUS_FAILED
        first.reconcile()
        finish()
        val full = ApkUpdater(context).loadTask()!!
        manager.remove(full.downloadId!!)
        val preferences = context.getSharedPreferences("android-updates", Context.MODE_PRIVATE)
        val persisted = JSONObject(preferences.getString(ApkUpdater.TASK_KEY, null)!!)
        preferences.edit().putString(ApkUpdater.TASK_KEY, persisted.put("downloadId", JSONObject.NULL).toString()).commit()
        val restarted = coordinator(update)
        repeat(3) { restarted.reconcile(); finish() }
        val restored = ApkUpdater(context).loadTask()!!
        assertNotNull(restored.downloadId)
        assertNotEquals(full.downloadId, restored.downloadId)
        assertEquals(full.token, restored.token)
        assertEquals(1, downloads.requestCount)
    }
}
