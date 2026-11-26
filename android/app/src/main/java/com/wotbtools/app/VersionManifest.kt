package com.wotbtools.app

import org.json.JSONObject
import java.util.regex.Pattern

data class VersionManifest(
    val schemaVersion: Int,
    val latestVersionCode: Int,
    val latestVersionName: String,
    val minSupportedVersionCode: Int,
    val nativeBridgeVersion: Int,
    val apkUrl: String,
    val sha256: String,
    val publishedAt: String?,
    val releaseNotes: String?,
    val patches: List<Patch> = emptyList(),
    val apkSizeBytes: Long? = null,
) {
    data class Patch(
        val fromVersionCode: Int,
        val fromSha256: String,
        val algorithm: String,
        val url: String,
        val sha256: String,
        val size: Long,
    )

    companion object {
        private const val SUPPORTED_SCHEMA = 1
        private const val MAX_PATCHES = 32
        private const val MAX_SAFE_SIZE = 9_007_199_254_740_991L
        internal const val SUPPORTED_PATCH_ALGORITHM = "xdelta3-vcdiff"
        private val SHA256 = Pattern.compile("^[0-9a-fA-F]{64}$")

        fun fromJson(json: String): VersionManifest {
            val o = JSONObject(json)
            if (integer(o, "schemaVersion") != SUPPORTED_SCHEMA) {
                throw IllegalArgumentException("unsupported schemaVersion")
            }
            val latestCode = integer(o, "latestVersionCode")
            val minSupported = integer(o, "minSupportedVersionCode")
            val nativeBridge = integer(o, "nativeBridgeVersion")
            val latestName = text(o, "latestVersionName")
            val apkUrl = text(o, "apkUrl")
            val sha256 = text(o, "sha256")
            val parsedUrl = try { java.net.URI(apkUrl) } catch (_: java.net.URISyntaxException) {
                throw IllegalArgumentException("invalid version manifest")
            }
            if (latestCode < 0 || minSupported < 0 || minSupported > latestCode || nativeBridge < 0 || latestName.isBlank()
                || parsedUrl.scheme != "https" || parsedUrl.host.isNullOrBlank() || !SHA256.matcher(sha256).matches()
            ) {
                throw IllegalArgumentException("invalid version manifest")
            }
            val apkSize = positiveSize(o.opt("apkSizeBytes"))
            return VersionManifest(
                schemaVersion = SUPPORTED_SCHEMA,
                latestVersionCode = latestCode,
                latestVersionName = latestName,
                minSupportedVersionCode = minSupported,
                nativeBridgeVersion = nativeBridge,
                apkUrl = apkUrl,
                sha256 = sha256,
                publishedAt = optionalText(o, "publishedAt"),
                releaseNotes = optionalText(o, "releaseNotes"),
                patches = if (apkSize == null) emptyList() else patches(o, latestCode),
                apkSizeBytes = apkSize,
            )
        }

        private fun integer(json: JSONObject, key: String): Int = when (val value = json.opt(key)) {
            is Int -> value
            is Long -> value.takeIf { it in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong() }?.toInt()
                ?: throw IllegalArgumentException("invalid version manifest")
            else -> throw IllegalArgumentException("invalid version manifest")
        }

        private fun text(json: JSONObject, key: String): String = json.opt(key) as? String
            ?: throw IllegalArgumentException("invalid version manifest")

        private fun optionalText(json: JSONObject, key: String): String? =
            if (!json.has(key) || json.isNull(key)) null else text(json, key).takeIf { it.isNotBlank() }

        private fun positiveSize(value: Any?): Long? = when (value) {
            is Int -> value.toLong()
            is Long -> value
            else -> null
        }?.takeIf { it in 1..MAX_SAFE_SIZE }

        private fun patches(json: JSONObject, latestCode: Int): List<Patch> {
            if (!json.has("patches")) return emptyList()
            val array = json.opt("patches") as? org.json.JSONArray ?: return emptyList()
            if (array.length() > MAX_PATCHES) return emptyList()
            return try {
                val result = ArrayList<Patch>(array.length())
                val seen = HashSet<Int>()
                for (i in 0 until array.length()) {
                    val entry = array.opt(i) as? JSONObject ?: return emptyList()
                    val code = integer(entry, "fromVersionCode")
                    val fromSha = text(entry, "fromSha256")
                    val algorithm = text(entry, "algorithm")
                    val url = text(entry, "url")
                    val patchSha = text(entry, "sha256")
                    val size = positiveSize(entry.opt("size")) ?: return emptyList()
                    val uri = java.net.URI(url)
                    if (code < 0 || code >= latestCode || !seen.add(code) ||
                        !SHA256.matcher(fromSha).matches() || !SHA256.matcher(patchSha).matches() ||
                        algorithm != SUPPORTED_PATCH_ALGORITHM || uri.scheme != "https" ||
                        uri.host.isNullOrBlank() || uri.userInfo != null
                    ) return emptyList()
                    result.add(Patch(code, fromSha, algorithm, url, patchSha, size))
                }
                result
            } catch (_: Exception) {
                emptyList()
            }
        }
    }
}
