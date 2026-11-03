package com.wotbtools.app

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.system.ErrnoException
import android.system.OsConstants
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.UUID
import org.json.JSONObject

/** 系统下载、任务身份和私有 APK 完整性操作；调用方在 IO 线程串行执行。 */
class ApkUpdater(context: Context, private val applyDelta: (File, File, File, Long) -> Unit = DeltaApplier::apply) {
    private val appContext = context.applicationContext
    private val downloads = appContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private val preferences = appContext.getSharedPreferences("android-updates", Context.MODE_PRIVATE)

    data class Task(
        val token: String,
        val versionCode: Int,
        val versionName: String,
        val sha256: String,
        val apkUrl: String,
        val downloadId: Long? = null,
        val packageType: String = "full",
        val patchUrl: String? = null,
        val patchSha256: String? = null,
        val patchSize: Long? = null,
        val baseSha256: String? = null,
        val baseVersionCode: Int? = null,
        val targetSize: Long? = null,
        val fallback: Boolean = false,
        val fallbackEnqueueFailed: Boolean = false,
    )

    data class Report(
        val task: Task,
        val state: String,
        val downloadedBytes: Long? = null,
        val totalBytes: Long? = null,
        val reason: String? = null,
    )

    class Failure(val reason: String) : IOException(reason)

    private data class Row(val id: Long, val localUri: String?, val status: Int,
        val downloaded: Long?, val total: Long?, val reason: Int)

    fun loadTask(): Task? {
        val encoded = preferences.getString(TASK_KEY, null) ?: return null
        return try {
            val json = JSONObject(encoded)
            Task(json.getString("token"), json.getInt("versionCode"), json.getString("versionName"),
                json.getString("sha256"), json.getString("apkUrl"),
                if (json.isNull("downloadId")) null else json.getLong("downloadId"),
                json.optString("packageType", "full"),
                nullableString(json, "patchUrl"),
                nullableString(json, "patchSha256"),
                if (json.has("patchSize") && !json.isNull("patchSize")) json.getLong("patchSize") else null,
                nullableString(json, "baseSha256"),
                if (json.has("baseVersionCode") && !json.isNull("baseVersionCode")) json.getInt("baseVersionCode") else null,
                if (json.has("targetSize") && !json.isNull("targetSize")) json.getLong("targetSize") else null,
                json.optBoolean("fallback", false), json.optBoolean("fallbackEnqueueFailed", false))
                .also(::validate)
        } catch (failure: Failure) {
            throw failure
        } catch (_: Exception) {
            throw Failure("fileIo")
        }
    }

    /** durable intent 先于 enqueue；相同身份的有效任务重复点击不再入队。 */
    fun begin(manifest: VersionManifest, retry: Boolean = false): Task {
        val existing = loadTask()
        var forceFullRetry = false
        if (existing != null) {
            val same = existing.versionCode == manifest.latestVersionCode &&
                existing.sha256.equals(manifest.sha256, true) && existing.apkUrl == manifest.apkUrl
            if (same) {
                val report = query(existing)
                if (report.state != "downloadFailed") return report.task
                if (!retry) {
                    // 崩溃发生在 intent 保存后、enqueue 前：排除所有尚未确定 destination 的候选后才可续入队。
                    if (existing.downloadId == null && rows(existing).none { it.localUri == null || matches(existing, it) } &&
                        !externalFile(existing).exists()) return enqueue(existing)
                    return existing
                }
            } else if (!retry) {
                throw Failure("taskMissing")
            }
            forceFullRetry = same && existing.fallback
            cleanup(existing)
        }
        val full = Task(UUID.randomUUID().toString(), manifest.latestVersionCode,
            manifest.latestVersionName, manifest.sha256, manifest.apkUrl)
        val task = if (forceFullRetry) full.copy(fallback = true) else selectPackage(full, manifest)
        validate(task)
        externalFile(task) // 在保存 intent 前确认目标目录可用。
        save(task)
        return enqueue(task)
    }

    private fun downloadUrl(task: Task): String = if (task.packageType == "delta") requireNotNull(task.patchUrl) else task.apkUrl

    /** 只在正式 base identity、收益和空间均可证明时使用 delta。 */
    private fun selectPackage(full: Task, manifest: VersionManifest): Task {
        val targetSize = manifest.apkSizeBytes ?: return full
        if (targetSize > Int.MAX_VALUE.toLong()) return full
        val info = appContext.applicationInfo
        if (!info.splitSourceDirs.isNullOrEmpty()) return full
        @Suppress("DEPRECATION")
        val installed = try { appContext.packageManager.getPackageInfo(appContext.packageName, 0).versionCode } catch (_: Exception) { return full }
        val patch = manifest.patches.singleOrNull { it.fromVersionCode == installed } ?: return full
        if (patch.algorithm != "xdelta3-vcdiff" || patch.size > targetSize / 10) return full
        val base = File(info.sourceDir ?: return full)
        return try {
            if (!base.isFile || !patch.fromSha256.equals(hash(base), true)) return full
            val readyDir = privateDirectory()
            val external = appContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return full
            val required = Math.addExact(targetSize, Math.multiplyExact(patch.size, 2))
            if (readyDir.usableSpace < required || external.usableSpace < required) return full
            full.copy(packageType = "delta", patchUrl = patch.url, patchSha256 = patch.sha256,
                patchSize = patch.size, baseSha256 = patch.fromSha256, baseVersionCode = patch.fromVersionCode,
                targetSize = targetSize)
        } catch (_: Exception) { full }
    }

    private fun enqueue(task: Task): Task {
        return try {
            val request = DownloadManager.Request(Uri.parse(downloadUrl(task)))
                .setTitle("WotBTools " + task.versionName)
                .setMimeType("application/octet-stream")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                .setDestinationInExternalFilesDir(appContext, Environment.DIRECTORY_DOWNLOADS, "updates/${task.token}.apk")
            val id = downloads.enqueue(request)
            task.copy(downloadId = id).also(::save)
        } catch (failure: Failure) {
            // enqueue 后 ID commit 失败也保留先前 durable intent，恢复时按精确 URL/destination 认领。
            throw failure
        } catch (error: Exception) {
            throw Failure("unknown").apply { initCause(error) }
        }
    }

    /** 系统 SUCCESSFUL 与私有文件存在都只返回 verifying，绝不直接认定 ready。 */
    fun query(task: Task): Report {
        validate(task)
        val readyFile = privateFile(task)
        if (readyFile.isFile) return Report(task, "verifying", readyFile.length(), readyFile.length().takeIf { it > 0 })
        externalFile(task)
        val candidates = rows(task)
        val exact = candidates.filter { matches(task, it) }
        val ownedPending = candidates.firstOrNull { it.id == task.downloadId && it.localUri == null }
        val unresolved = candidates.any { it.localUri == null && it.id != task.downloadId }
        if (unresolved) return Report(task, "queued", reason = "waitingRetry")
        if (exact.size > 1) return Report(task, "downloadFailed", reason = "taskMissing")
        val row = exact.singleOrNull() ?: ownedPending
            ?: return Report(task, "downloadFailed", reason = "taskMissing")
        val restored = if (task.downloadId != row.id) task.copy(downloadId = row.id).also(::save) else task
        val state = when (row.status) {
            DownloadManager.STATUS_PENDING -> "queued"
            DownloadManager.STATUS_RUNNING -> "downloading"
            DownloadManager.STATUS_PAUSED -> "paused"
            DownloadManager.STATUS_SUCCESSFUL -> "verifying"
            else -> "downloadFailed"
        }
        return Report(restored, state, row.downloaded, row.total, reason(row.status, row.reason))
    }

    private fun rows(task: Task): List<Row> = try {
        val result = mutableListOf<Row>()
        val cursor = downloads.query(DownloadManager.Query()) ?: throw Failure("unknown")
        cursor.use {
            while (it.moveToNext()) {
                if (it.getString(it.getColumnIndexOrThrow(DownloadManager.COLUMN_URI)) != downloadUrl(task)) continue
                val state = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                result.add(Row(it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)),
                    it.getString(it.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI)), state,
                    it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)).takeIf { bytes -> bytes >= 0 },
                    it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)).takeIf { bytes -> bytes > 0 },
                    if (state == DownloadManager.STATUS_FAILED || state == DownloadManager.STATUS_PAUSED)
                        it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)) else 0))
            }
        }
        result
    } catch (failure: Failure) {
        throw failure
    } catch (_: Exception) {
        throw Failure("unknown")
    }

    private fun matches(task: Task, row: Row): Boolean {
        val uri = row.localUri ?: return false
        return try {
            val parsed = Uri.parse(uri)
            parsed.scheme == "file" && parsed.path?.let { File(it).canonicalFile == externalFile(task) } == true
        } catch (_: Exception) { false }
    }

    /** 已有 private ready 也重新 hash；复制阶段 hash 的是即将安装的私有副本。 */
    fun verify(task: Task, phase: (String) -> Unit = {}): File {
        validate(task)
        val ready = privateFile(task)
        val temporary = privateTemp(task)
        if (task.packageType == "delta" && !ready.isFile) return verifyDelta(task, temporary, ready, phase)
        try {
            if (ready.isFile) {
                if (!task.sha256.equals(hash(ready), true)) {
                    invalidate(task)
                    throw Failure("hashMismatch")
                }
                return ready
            }
            val source = externalFile(task)
            if (!source.isFile) throw Failure("artifactMissing")
            if (ready.parentFile!!.usableSpace < source.length()) throw Failure("insufficientStorage")
            val digest = MessageDigest.getInstance("SHA-256")
            source.inputStream().use { input ->
                FileOutputStream(temporary).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                    }
                    output.fd.sync()
                }
            }
            if (!task.sha256.equals(hex(digest.digest()), true)) {
                invalidate(task)
                throw Failure("hashMismatch")
            }
            if (!temporary.renameTo(ready)) throw Failure("fileIo")
            return ready
        } catch (failure: Failure) {
            temporary.delete()
            throw failure
        } catch (error: Exception) {
            temporary.delete()
            val noSpace = generateSequence<Throwable>(error) { it.cause }
                .any { it is ErrnoException && it.errno == OsConstants.ENOSPC }
            throw Failure(if (noSpace) "insufficientStorage" else "fileIo")
        }
    }

    /** 先验证 base/patch，再应用并核对目标 full SHA；进程重启可从已下载 patch 重做。 */
    private fun verifyDelta(task: Task, temporary: File, ready: File, phase: (String) -> Unit): File {
        try {
            val info = appContext.applicationInfo
            @Suppress("DEPRECATION")
            val installed = appContext.packageManager.getPackageInfo(appContext.packageName, 0).versionCode
            val base = File(info.sourceDir ?: throw Failure("baseHashMismatch"))
            if (!info.splitSourceDirs.isNullOrEmpty() || installed != task.baseVersionCode || !base.isFile ||
                !requireNotNull(task.baseSha256).equals(hash(base), true)) throw Failure("baseHashMismatch")
            val sourcePatch = externalFile(task)
            val patch = privatePatch(task)
            val patchSize = requireNotNull(task.patchSize)
            val targetSize = requireNotNull(task.targetSize)
            phase("verifyingDelta")
            if (!sourcePatch.isFile || sourcePatch.length() != patchSize) throw Failure("patchHashMismatch")
            if (ready.parentFile!!.usableSpace < Math.addExact(targetSize, patchSize))
                throw Failure("insufficientStorage")
            // 不在 app-specific external 上执行已校验 patch：复制并 hash 私有副本，避免 TOCTOU。
            if (patch.exists() && !patch.delete()) throw Failure("fileIo")
            val digest = MessageDigest.getInstance("SHA-256")
            var copied = 0L
            sourcePatch.inputStream().use { input ->
                FileOutputStream(patch).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        copied += count
                        if (copied > patchSize) throw Failure("patchHashMismatch")
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                    }
                    output.fd.sync()
                }
            }
            if (copied != patchSize || !requireNotNull(task.patchSha256).equals(hex(digest.digest()), true))
                throw Failure("patchHashMismatch")
            if (temporary.exists() && !temporary.delete()) throw Failure("fileIo")
            phase("applyingDelta")
            try {
                applyDelta(base, patch, temporary, targetSize)
            } catch (_: LinkageError) {
                throw Failure("patchApplyFailed")
            } catch (_: OutOfMemoryError) {
                throw Failure("patchApplyFailed")
            } catch (_: Exception) {
                throw Failure("patchApplyFailed")
            }
            phase("verifyingTargetApk")
            if (temporary.length() != targetSize || !task.sha256.equals(hash(temporary), true)) throw Failure("targetHashMismatch")
            if (!temporary.renameTo(ready)) throw Failure("fileIo")
            patch.delete()
            return ready
        } catch (error: Exception) {
            temporary.delete()
            privatePatch(task).delete()
            throw error
        }
    }

    /** 先安全清掉旧 patch，再持久化 full intent；崩溃恢复不重复入队。 */
    fun fallbackToFull(task: Task): Task {
        if (task.packageType != "delta") throw Failure("taskMissing")
        cleanupOwnedFiles(task)
        val full = task.copy(downloadId = null, packageType = "full", patchUrl = null, patchSha256 = null,
            patchSize = null, baseSha256 = null, baseVersionCode = null, fallback = true)
        save(full)
        return enqueueFallback(full)
    }

    private fun enqueueFallback(task: Task): Task = try {
        enqueue(task)
    } catch (error: Exception) {
        save(task.copy(fallbackEnqueueFailed = true))
        throw error
    }

    fun recoverFallback(task: Task): Task {
        if (!task.fallback || task.fallbackEnqueueFailed || task.downloadId != null || task.packageType != "full") return task
        val report = query(task)
        if (report.state != "downloadFailed") return report.task
        if (rows(task).none { it.localUri == null || matches(task, it) } && !externalFile(task).exists()) return enqueueFallback(task)
        return report.task
    }

    fun privateFile(task: Task): File {
        validate(task)
        return child(privateDirectory(), task.token + ".apk")
    }

    private fun privateTemp(task: Task): File = child(privateDirectory(), task.token + ".tmp")
    private fun privatePatch(task: Task): File = child(privateDirectory(), task.token + ".patch")

    private fun externalFile(task: Task): File {
        validate(task)
        val base = appContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: throw Failure("storageUnavailable")
        return child(directory(base, "updates"), task.token + ".apk")
    }

    private fun privateDirectory(): File = directory(appContext.filesDir, "updates")

    private fun directory(base: File, name: String): File {
        val canonicalBase = base.canonicalFile
        val result = File(canonicalBase, name)
        if (result.canonicalFile.parentFile != canonicalBase || (!result.isDirectory && !result.mkdirs()))
            throw Failure("storageUnavailable")
        return result.canonicalFile
    }

    private fun child(directory: File, name: String): File {
        val result = File(directory, name).canonicalFile
        if (result.parentFile != directory.canonicalFile) throw Failure("fileIo")
        return result
    }

    /** 只清本 token 精确 destination；未确定 destination 的 orphan 不猜测归属。 */
    fun cleanup(task: Task) {
        cleanupOwnedFiles(task)
        if (loadTask()?.token == task.token && !preferences.edit().remove(TASK_KEY).commit()) throw Failure("fileIo")
    }

    private fun cleanupOwnedFiles(task: Task) {
        validate(task)
        val candidates = rows(task)
        if (candidates.any { it.localUri == null && it.id != task.downloadId }) throw Failure("taskMissing")
        if (candidates.any { it.id == task.downloadId && it.localUri != null && !matches(task, it) })
            throw Failure("taskMissing")
        val ids = candidates.filter { matches(task, it) || (it.id == task.downloadId && it.localUri == null) }.map { it.id }
        if (ids.isNotEmpty() && downloads.remove(*ids.toLongArray()) != ids.size) throw Failure("taskMissing")
        for (file in listOf(externalFile(task), privateFile(task), privateTemp(task), privatePatch(task))) {
            if (file.exists() && !file.delete()) throw Failure("fileIo")
        }
    }

    private fun invalidate(task: Task) {
        // 校验失败时先去掉所有本任务产物；任何清理异常都不能把失败变成可安装。
        listOf(privateFile(task), privateTemp(task)).forEach { it.delete() }
        try { externalFile(task).delete() } catch (_: Exception) { }
        try {
            val ids = rows(task).filter { matches(task, it) }.map { it.id }
            if (ids.isNotEmpty()) downloads.remove(*ids.toLongArray())
        } catch (_: Exception) { }
    }

    /** 调用方须先在后台 verify；UI 线程这里只做窄 FileProvider 的 installer handoff。 */
    fun requestInstall(apk: File): Boolean = try {
        val task = loadTask()
        if (task == null || apk.canonicalFile != privateFile(task) || !apk.isFile) false else {
            val uri = FileProvider.getUriForFile(appContext, "${appContext.packageName}.fileprovider", apk)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            appContext.startActivity(intent)
            true
        }
    } catch (_: Exception) { false }

    private fun save(task: Task) {
        validate(task)
        val json = JSONObject().put("token", task.token).put("versionCode", task.versionCode)
            .put("versionName", task.versionName).put("sha256", task.sha256).put("apkUrl", task.apkUrl)
            .put("downloadId", task.downloadId ?: JSONObject.NULL)
            .put("packageType", task.packageType).put("patchUrl", task.patchUrl ?: JSONObject.NULL)
            .put("patchSha256", task.patchSha256 ?: JSONObject.NULL).put("patchSize", task.patchSize ?: JSONObject.NULL)
            .put("baseSha256", task.baseSha256 ?: JSONObject.NULL).put("baseVersionCode", task.baseVersionCode ?: JSONObject.NULL)
            .put("targetSize", task.targetSize ?: JSONObject.NULL).put("fallback", task.fallback)
            .put("fallbackEnqueueFailed", task.fallbackEnqueueFailed)
        if (!preferences.edit().putString(TASK_KEY, json.toString()).commit()) throw Failure("fileIo")
    }

    private fun validate(task: Task) {
        val tokenValid = try { UUID.fromString(task.token).toString() == task.token } catch (_: Exception) { false }
        val url = try { java.net.URI(task.apkUrl) } catch (_: Exception) { null }
        val deltaUrl = try { task.patchUrl?.let { java.net.URI(it) } } catch (_: Exception) { null }
        val deltaValid = task.packageType != "delta" || (deltaUrl?.scheme == "https" && !deltaUrl.host.isNullOrBlank() &&
            task.patchSha256?.let(SHA256::matches) == true && task.baseSha256?.let(SHA256::matches) == true &&
            task.patchSize?.let { it > 0 } == true && task.targetSize?.let { it > 0 } == true &&
            task.baseVersionCode?.let { it >= 0 && it < task.versionCode } == true && !task.fallback)
        if (!tokenValid || task.versionCode < 0 || task.versionName.isBlank() || !SHA256.matches(task.sha256) ||
            url?.scheme != "https" || url.host.isNullOrBlank() || (task.downloadId != null && task.downloadId < 0) ||
            task.packageType !in setOf("full", "delta") || !deltaValid)
            throw Failure("fileIo")
    }

    private fun nullableString(json: JSONObject, key: String): String? =
        if (!json.has(key) || json.isNull(key)) null else json.getString(key)

    private fun hash(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return hex(digest.digest())
    }

    private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    internal companion object {
        internal const val TASK_KEY = "downloadTask"
        private val SHA256 = Regex("^[0-9a-fA-F]{64}$")
        internal fun reason(status: Int, code: Int): String? = when (status) {
            DownloadManager.STATUS_PAUSED -> when (code) {
                DownloadManager.PAUSED_WAITING_FOR_NETWORK -> "waitingNetwork"
                DownloadManager.PAUSED_WAITING_TO_RETRY -> "waitingRetry"
                DownloadManager.PAUSED_QUEUED_FOR_WIFI -> "waitingWifi"
                else -> "pausedUnknown"
            }
            DownloadManager.STATUS_FAILED -> when (code) {
                DownloadManager.ERROR_INSUFFICIENT_SPACE -> "insufficientStorage"
                DownloadManager.ERROR_DEVICE_NOT_FOUND -> "storageUnavailable"
                DownloadManager.ERROR_FILE_ERROR, DownloadManager.ERROR_FILE_ALREADY_EXISTS -> "fileIo"
                DownloadManager.ERROR_CANNOT_RESUME -> "cannotResume"
                DownloadManager.ERROR_HTTP_DATA_ERROR -> "network"
                DownloadManager.ERROR_UNHANDLED_HTTP_CODE, DownloadManager.ERROR_TOO_MANY_REDIRECTS -> "http"
                in 400..599 -> "http"
                else -> "unknown"
            }
            else -> null
        }
    }
}
