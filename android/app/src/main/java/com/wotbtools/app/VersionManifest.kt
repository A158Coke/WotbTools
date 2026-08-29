package com.wotbtools.app

import org.json.JSONObject

/**
 * Android 版本 manifest（对应 https://wotbtools.com/download/android/version.json）。
 * 若后端将来改为静态文件之外的实现，本 parse 仍保持兼容（schemaVersion=1）。
 */
data class VersionManifest(
    val schemaVersion: Int,
    val latestVersionCode: Int,
    val latestVersionName: String,
    val minSupportedVersionCode: Int,
    val nativeBridgeVersion: Int,
    val apkUrl: String?,
    val sha256: String?,
    val publishedAt: String?,
    val releaseNotes: String?
) {
    companion object {
        fun fromJson(json: String): VersionManifest {
            val o = JSONObject(json)
            return VersionManifest(
                schemaVersion = o.getInt("schemaVersion"),
                latestVersionCode = o.getInt("latestVersionCode"),
                latestVersionName = o.getString("latestVersionName"),
                minSupportedVersionCode = o.getInt("minSupportedVersionCode"),
                nativeBridgeVersion = o.optInt("nativeBridgeVersion", 1),
                apkUrl = o.optString("apkUrl").takeIf { it.isNotBlank() },
                sha256 = o.optString("sha256").takeIf { it.isNotBlank() },
                publishedAt = o.optString("publishedAt").takeIf { it.isNotBlank() },
                releaseNotes = o.optString("releaseNotes").takeIf { it.isNotBlank() }
            )
        }
    }
}
