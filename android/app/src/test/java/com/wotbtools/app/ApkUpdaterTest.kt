package com.wotbtools.app

import android.app.DownloadManager
import android.content.Context
import android.database.Cursor
import android.database.CursorWrapper
import android.net.Uri
import android.os.Environment
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowDownloadManager

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE, shadows = [ApkUpdaterTest.InitialDestinationShadow::class])
class ApkUpdaterTest {
    @Implements(DownloadManager::class)
    class InitialDestinationShadow : ShadowDownloadManager() {
        companion object { var destinationUnknown = false }

        /** API26 实测的初始 local_uri=null；复用原生 shadow 的其余 query 行为。 */
        @Implementation
        protected override fun query(query: DownloadManager.Query): Cursor {
            val cursor = super.query(query)
            return object : CursorWrapper(cursor) {
                override fun getString(columnIndex: Int): String? =
                    if (destinationUnknown && columnIndex == getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)) null
                    else super.getString(columnIndex)
            }
        }
    }

    private lateinit var context: Context
    private lateinit var manager: DownloadManager
    private lateinit var shadow: ShadowDownloadManager
    private lateinit var updater: ApkUpdater
    private val content = "controlled APK fixture".toByteArray()
    private var originalSourceDir: String? = null

    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        originalSourceDir = context.applicationInfo.sourceDir
        context.getSharedPreferences("android-updates", Context.MODE_PRIVATE).edit().clear().commit()
        InitialDestinationShadow.destinationUnknown = false
        ShadowDownloadManager.reset()
        manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        shadow = Shadow.extract(manager)
        updater = ApkUpdater(context)
    }

    @After fun restoreSource() {
        context.applicationInfo.sourceDir = originalSourceDir
    }

    private fun manifest() = VersionManifest(1, 3029000, "3.29.0", 3017007, 3,
        "https://wotbtools.com/download/android/immutable-fixture.apk", sha(content), null, null)

    private fun sha(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it) }

    private fun source(task: ApkUpdater.Task): File = File(
        context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "updates/${task.token}.apk")

    private fun request(task: ApkUpdater.Task): ShadowDownloadManager.ShadowRequest =
        Shadow.extract(shadow.getRequest(task.downloadId!!))

    private fun forgetSavedId() {
        val preferences = context.getSharedPreferences("android-updates", Context.MODE_PRIVATE)
        val json = JSONObject(preferences.getString(ApkUpdater.TASK_KEY, null)!!)
        preferences.edit().putString(ApkUpdater.TASK_KEY, json.put("downloadId", JSONObject.NULL).toString()).commit()
    }

    @Test fun deltaMismatchFallsBackOnceAndRecoversFullEnqueueIntent() {
        val base = File(context.cacheDir, "installed-base.apk").apply { writeText("official base fixture") }
        context.applicationInfo.sourceDir = base.path
        @Suppress("DEPRECATION")
        val installed = context.packageManager.getPackageInfo(context.packageName, 0).versionCode
        val patch = VersionManifest.Patch(installed, sha(base.readBytes()), "xdelta3-vcdiff",
            "https://example.invalid/update.delta", sha(byteArrayOf(1, 2)), 2)
        val update = manifest().copy(patches = listOf(patch), apkSizeBytes = 1000)
        val delta = updater.begin(update)
        assertEquals("delta", delta.packageType)
        assertEquals(patch.url, request(delta).uri.toString())
        assertEquals(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED, request(delta).notificationVisibility)
        assertEquals(delta, ApkUpdater(context).loadTask())
        request(delta).status = DownloadManager.STATUS_SUCCESSFUL
        source(delta).writeBytes(byteArrayOf(8, 9))
        assertEquals("patchHashMismatch", assertThrows(ApkUpdater.Failure::class.java) { updater.verify(delta) }.reason)
        val full = updater.fallbackToFull(delta)
        assertEquals("full", full.packageType)
        assertTrue(full.fallback)
        assertEquals(update.apkUrl, request(full).uri.toString())
        assertEquals(1, shadow.requestCount)
        // Crash after saving fallback intent but before enqueue: recovery creates exactly one full task.
        manager.remove(full.downloadId!!)
        forgetSavedId()
        val pending = ApkUpdater(context).loadTask()!!
        val restored = ApkUpdater(context).recoverFallback(pending)
        assertEquals("full", restored.packageType)
        assertEquals(1, shadow.requestCount)
        assertEquals(restored, ApkUpdater(context).recoverFallback(restored))
        assertEquals(1, shadow.requestCount)
    }

    @Test fun unsuitableDeltaChoosesFullWithoutChangingInstalledPackage() {
        val base = File(context.cacheDir, "installed-base.apk").apply { writeText("base") }
        context.applicationInfo.sourceDir = base.path
        @Suppress("DEPRECATION")
        val installed = context.packageManager.getPackageInfo(context.packageName, 0).versionCode
        val patch = VersionManifest.Patch(installed, sha("different".toByteArray()), "xdelta3-vcdiff",
            "https://example.invalid/update.delta", sha(byteArrayOf(1)), 1)
        val task = updater.begin(manifest().copy(patches = listOf(patch), apkSizeBytes = 1000))
        assertEquals("full", task.packageType)
        assertEquals("base", base.readText())
    }

    @Test fun taskIdentityAndSystemRequestAreDurableAndDuplicateClickIsIdempotent() {
        val task = updater.begin(manifest())
        request(task).status = DownloadManager.STATUS_PENDING
        assertEquals(task, ApkUpdater(context).loadTask())
        assertEquals(task, updater.begin(manifest()))
        assertEquals(1, shadow.requestCount)
        assertEquals(manifest().apkUrl, request(task).uri.toString())
        assertEquals(source(task).canonicalFile, File(request(task).destination.path!!).canonicalFile)
        assertEquals(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED, request(task).notificationVisibility)
        assertEquals("application/octet-stream", request(task).mimeType)
    }

    @Test fun enqueueBeforeIdCommitCrashIsRecoveredWithoutSecondRequest() {
        val task = updater.begin(manifest())
        request(task).status = DownloadManager.STATUS_RUNNING
        forgetSavedId()
        val restarted = ApkUpdater(context)
        val intent = restarted.loadTask()!!
        assertNull(intent.downloadId)
        val recovered = restarted.query(intent)
        assertEquals(task.downloadId, recovered.task.downloadId)
        assertEquals(task.token, recovered.task.token)
        assertEquals("downloading", recovered.state)
        assertEquals(recovered.task, restarted.loadTask())
        assertEquals(1, shadow.requestCount)
    }

    @Test fun nullInitialDestinationWaitsBeforeIdAdoptionAndNeverBlindlyEnqueues() {
        val task = updater.begin(manifest())
        request(task).status = DownloadManager.STATUS_PENDING
        forgetSavedId()
        InitialDestinationShadow.destinationUnknown = true
        val restarted = ApkUpdater(context)
        val intent = restarted.loadTask()!!
        val pending = restarted.query(intent)
        assertEquals("queued", pending.state)
        assertEquals("waitingRetry", pending.reason)
        assertNull(pending.task.downloadId)
        assertNull(restarted.begin(manifest()).downloadId)
        assertEquals(1, shadow.requestCount)
        assertEquals("taskMissing", assertThrows(ApkUpdater.Failure::class.java) { restarted.cleanup(intent) }.reason)
        assertEquals(intent, restarted.loadTask())
        InitialDestinationShadow.destinationUnknown = false
        val recovered = restarted.query(intent)
        assertEquals(task.downloadId, recovered.task.downloadId)
        assertEquals(1, shadow.requestCount)
    }

    @Test fun preEnqueueDurableIntentCanBeEnqueuedOnlyAfterQueryConfirmsNoCandidate() {
        val task = updater.begin(manifest())
        manager.remove(task.downloadId!!)
        forgetSavedId()
        val restarted = ApkUpdater(context)
        val recovered = restarted.begin(manifest())
        assertEquals(task.token, recovered.token)
        assertNotEquals(task.downloadId, recovered.downloadId)
        assertEquals(1, shadow.requestCount)
    }

    @Test fun retryRemovesFailedRowAndPartialArtifactAndUsesFreshToken() {
        val task = updater.begin(manifest())
        request(task).status = DownloadManager.STATUS_FAILED
        source(task).writeBytes(byteArrayOf(1, 2, 3))
        val retry = updater.begin(manifest(), retry = true)
        assertNotEquals(task.token, retry.token)
        assertNotEquals(task.downloadId, retry.downloadId)
        assertFalse(source(task).exists())
        assertEquals(retry, updater.loadTask())
        assertEquals(1, shadow.requestCount)
    }

    @Test fun renamedPersistedRowCannotBeAbandonedByCleanupOrRetry() {
        val task = updater.begin(manifest())
        request(task).status = DownloadManager.STATUS_RUNNING
        val renamed = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "unexpected-renamed.apk")
            .apply { writeText("must remain owned by its existing row") }
        shadow.getRequest(task.downloadId!!).setDestinationUri(Uri.fromFile(renamed))
        assertEquals("taskMissing", updater.query(task).reason)
        assertEquals("taskMissing", assertThrows(ApkUpdater.Failure::class.java) { updater.cleanup(task) }.reason)
        assertEquals(task, updater.loadTask())
        assertEquals("taskMissing", assertThrows(ApkUpdater.Failure::class.java) {
            updater.begin(manifest(), retry = true)
        }.reason)
        assertEquals(task, updater.loadTask())
        assertEquals(1, shadow.requestCount)
        assertTrue(renamed.isFile)
    }

    @Test fun multipleExactRowsRequireExplicitCleanupWithoutTouchingAnotherDestination() {
        val task = updater.begin(manifest())
        request(task).status = DownloadManager.STATUS_RUNNING
        manager.enqueue(DownloadManager.Request(Uri.parse(task.apkUrl)).setDestinationUri(Uri.fromFile(source(task))))
        val otherFile = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "unrelated.apk")
            .apply { writeText("keep") }
        val otherId = manager.enqueue(DownloadManager.Request(Uri.parse(task.apkUrl)).setDestinationUri(Uri.fromFile(otherFile)))
        forgetSavedId()
        val intent = updater.loadTask()!!
        assertEquals("taskMissing", updater.query(intent).reason)
        assertNull(updater.begin(manifest()).downloadId)
        assertEquals(3, shadow.requestCount)
        updater.cleanup(intent)
        assertEquals(1, shadow.requestCount)
        assertNotNull(shadow.getRequest(otherId))
        assertEquals("keep", otherFile.readText())
        assertNull(updater.loadTask())
    }

    @Test fun successfulSystemDownloadStillRequiresHashAndReturnsVerifying() {
        val task = updater.begin(manifest())
        request(task).status = DownloadManager.STATUS_SUCCESSFUL
        source(task).writeBytes(content)
        assertEquals("verifying", updater.query(task).state)
        val ready = updater.verify(task)
        assertArrayEquals(content, ready.readBytes())
        assertEquals(File(context.filesDir, "updates/${task.token}.apk").canonicalFile, ready)
        assertFalse(File(context.filesDir, "updates/${task.token}.tmp").exists())
        // 即使系统 row 消失，私有 ready 也必须先重新校验，不能被 query 宣称 ready。
        manager.remove(task.downloadId!!)
        assertEquals("verifying", ApkUpdater(context).query(task).state)
        assertArrayEquals(content, ApkUpdater(context).verify(task).readBytes())
    }

    @Test fun hashMismatchDeletesArtifactAndNeverOffersInstallerInput() {
        val task = updater.begin(manifest())
        request(task).status = DownloadManager.STATUS_SUCCESSFUL
        source(task).writeBytes("tampered".toByteArray())
        val failure = assertThrows(ApkUpdater.Failure::class.java) { updater.verify(task) }
        assertEquals("hashMismatch", failure.reason)
        assertFalse(source(task).exists())
        assertFalse(updater.privateFile(task).exists())
        assertFalse(File(context.filesDir, "updates/${task.token}.tmp").exists())
        assertFalse(updater.requestInstall(updater.privateFile(task)))
        assertEquals(0, shadow.requestCount)
    }

    @Test fun restoredPrivateReadyIsNotTrustedAfterTampering() {
        val task = updater.begin(manifest())
        source(task).writeBytes(content)
        val ready = updater.verify(task)
        ready.writeBytes("changed after verification".toByteArray())
        val restarted = ApkUpdater(context)
        assertEquals("verifying", restarted.query(task).state)
        assertEquals("hashMismatch", assertThrows(ApkUpdater.Failure::class.java) { restarted.verify(task) }.reason)
        assertFalse(ready.exists())
        assertFalse(source(task).exists())
    }

    @Test fun pathValidationAndCleanupProtectAdjacentFilesAndNewerTaskMetadata() {
        val task = updater.begin(manifest())
        val neighbor = File(context.filesDir, "keep.txt").apply { writeText("keep") }
        assertEquals("fileIo", assertThrows(ApkUpdater.Failure::class.java) {
            updater.privateFile(task.copy(token = "../keep"))
        }.reason)
        assertFalse(updater.requestInstall(neighbor))
        val preferences = context.getSharedPreferences("android-updates", Context.MODE_PRIVATE)
        val newer = JSONObject(preferences.getString(ApkUpdater.TASK_KEY, null)!!)
            .put("token", UUID.randomUUID().toString()).put("downloadId", JSONObject.NULL)
        preferences.edit().putString(ApkUpdater.TASK_KEY, newer.toString()).commit()
        updater.cleanup(task)
        assertEquals("keep", neighbor.readText())
        assertEquals(newer.getString("token"), updater.loadTask()!!.token)
    }

    @Test fun missingTaskAndUnknownTotalRemainExplicitInsteadOfInventingProgress() {
        val task = updater.begin(manifest())
        request(task).apply { status = DownloadManager.STATUS_RUNNING; totalSize = -1; bytesSoFar = 1024 }
        val report = updater.query(task)
        assertEquals(1024L, report.downloadedBytes)
        assertNull(report.totalBytes)
        assertNull(report.reason)
        manager.remove(task.downloadId!!)
        assertEquals("taskMissing", updater.query(task).reason)
    }

    @Test fun systemReasonsAreBoundedAndOnlyReadForFailedOrPausedStates() {
        assertEquals("waitingNetwork", ApkUpdater.reason(DownloadManager.STATUS_PAUSED, DownloadManager.PAUSED_WAITING_FOR_NETWORK))
        assertEquals("waitingRetry", ApkUpdater.reason(DownloadManager.STATUS_PAUSED, DownloadManager.PAUSED_WAITING_TO_RETRY))
        assertEquals("waitingWifi", ApkUpdater.reason(DownloadManager.STATUS_PAUSED, DownloadManager.PAUSED_QUEUED_FOR_WIFI))
        assertEquals("pausedUnknown", ApkUpdater.reason(DownloadManager.STATUS_PAUSED, -1))
        assertEquals("insufficientStorage", ApkUpdater.reason(DownloadManager.STATUS_FAILED, DownloadManager.ERROR_INSUFFICIENT_SPACE))
        assertEquals("storageUnavailable", ApkUpdater.reason(DownloadManager.STATUS_FAILED, DownloadManager.ERROR_DEVICE_NOT_FOUND))
        assertEquals("cannotResume", ApkUpdater.reason(DownloadManager.STATUS_FAILED, DownloadManager.ERROR_CANNOT_RESUME))
        assertEquals("http", ApkUpdater.reason(DownloadManager.STATUS_FAILED, 503))
        assertEquals("unknown", ApkUpdater.reason(DownloadManager.STATUS_FAILED, -999))
        assertNull(ApkUpdater.reason(DownloadManager.STATUS_RUNNING, DownloadManager.ERROR_INSUFFICIENT_SPACE))
    }
}
