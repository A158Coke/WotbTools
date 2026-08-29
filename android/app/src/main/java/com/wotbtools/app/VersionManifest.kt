package com.wotbtools.app

import org.json.JSONObject
import java.util.regex.Pattern

/**
 * Android 版本 manifest（对应 https://wotbtools.com/download/android/version.json）。
 * fail-closed：任何非法字段（sha256 缺失/格式错、apkUrl 缺失、schemaVersion 不支持、
 * 版本字段非法）都视为 manifest/update error，抛异常 → 启动门禁不放行、绝不绕过完整性校验。
 */
data class VersionManifest(
    val schemaVersion: Int,
    val latestVersionCode: Int,
    val latestVersionName: String,
    val minSupportedVersionCode: Int,
    val nativeBridgeVersion: Int,
    val apkUrl: String,
    val sha256: String,
    val publishedAt: String?,
    val releaseNotes: String?
) {
    companion object {
        private const val SUPPORTED_SCHEMA = 1
        private val SHA256 = Pattern.compile("^[0-9a-fA-F]{64}$")

        fun fromJson(json: String): VersionManifest {
            val o = JSONObject(json)
            if (o.optInt("schemaVersion", -1) != SUPPORTED_SCHEMA) {
                throw IllegalArgumentException("unsupported schemaVersion")
            }
            val latestCode = o.optInt("latestVersionCode", -1)
            val minSupported = o.optInt("minSupportedVersionCode", -1)
            val nativeBridge = o.optInt("nativeBridgeVersion", -1)
            val latestName = o.optString("latestVersionName", "")
            val apkUrl = o.optString("apkUrl", "")
            val sha256 = o.optString("sha256", "")
            if (latestCode < 0 || minSupported < 0 || nativeBridge < 0 || latestName.isBlank()
                || !apkUrl.startsWith("https://") || !SHA256.matcher(sha256).matches()
            ) {
                throw IllegalArgumentException("invalid version manifest")
            }
            return VersionManifest(
                schemaVersion = SUPPORTED_SCHEMA,
                latestVersionCode = latestCode,
                latestVersionName = latestName,
                minSupportedVersionCode = minSupported,
                nativeBridgeVersion = nativeBridge,
                apkUrl = apkUrl,
                sha256 = sha256,
                publishedAt = o.optString("publishedAt").takeIf { it.isNotBlank() },
                releaseNotes = o.optString("releaseNotes").takeIf { it.isNotBlank() }
            )
        }
    }
}
