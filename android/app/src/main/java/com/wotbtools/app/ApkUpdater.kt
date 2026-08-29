package com.wotbtools.app

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.net.URL
import java.security.MessageDigest

/**
 * 下载 → SHA-256 校验 → 交给 Android Installer（未知来源授权另由 MainActivity 处理）。
 * 完整性校验失败禁止调用 installer（规格 §19）。
 */
class ApkUpdater(private val context: Context) {

    var onProgress: ((Int) -> Unit)? = null

    sealed class Result {
        data class Ok(val apk: File) : Result()
        data class Fail(val message: String) : Result()
    }

    fun downloadAndInstall(apkUrl: String, expectedSha256: String): Result {
        return try {
            val file = File(context.cacheDir, "wotbtools-update.apk")
            if (file.exists()) file.delete()
            val url = URL(apkUrl)
            val conn = url.openConnection()
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.connect()
            val total = conn.contentLengthLong
            FileOutputStream(file).use { out ->
                conn.getInputStream().use { input ->
                    val buf = ByteArray(8192)
                    var downloaded = 0L
                    while (true) {
                        val read = input.read(buf)
                        if (read == -1) break
                        out.write(buf, 0, read)
                        downloaded += read
                        if (total > 0) onProgress?.invoke((downloaded * 100 / total).toInt())
                    }
                }
            }
            val actualSha = sha256(file)
            if (!expectedSha256.equals(actualSha, ignoreCase = true)) {
                file.delete()
                return Result.Fail("SHA-256 mismatch")
            }
            Result.Ok(file)
        } catch (e: Exception) {
            Result.Fail(e.message ?: "download failed")
        }
    }

    fun requestInstall(apk: File): Boolean {
        return try {
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            true
        } catch (e: ActivityNotFoundException) {
            false
        }
    }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(8192)
            while (true) {
                val read = input.read(buf)
                if (read == -1) break
                md.update(buf, 0, read)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
