package com.wotbtools.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log

internal const val READY_NOTIFICATION_ID = 4000
private const val READY_CHANNEL = "verified-update"

/** 通知仅是导航入口；文件身份和安装资格仍由 coordinator 校验。 */
internal fun updateReadyNotification(applicationContext: Context, snapshot: UpdateStatus, verifiedToken: String?, currentVersionCode: Int) {
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
            .putExtra(UpdateCoordinator.OPEN_UPDATE_PANEL, true)
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
        Log.w("WotbUpdate", "update_notification_failed", error)
    }
}
