package com.wotbtools.app

import org.json.JSONObject

internal data class UpdateDownloadSnapshot(
    val taskToken: String? = null,
    val versionName: String? = null,
    val versionCode: Int? = null,
    val state: String = "idle",
    val downloadedBytes: Long? = null,
    val totalBytes: Long? = null,
    val progressPercent: Int? = null,
    val failureReason: String? = null,
    val packageType: String? = null,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("taskToken", taskToken ?: JSONObject.NULL)
        .put("versionName", versionName ?: JSONObject.NULL)
        .put("versionCode", versionCode ?: JSONObject.NULL)
        .put("state", state)
        .put("downloadedBytes", downloadedBytes ?: JSONObject.NULL)
        .put("totalBytes", totalBytes ?: JSONObject.NULL)
        .put("progressPercent", progressPercent ?: JSONObject.NULL)
        .put("failureReason", failureReason ?: JSONObject.NULL)
        .put("packageType", packageType ?: JSONObject.NULL)
}

internal data class UpdateStatus(
    val revision: Long = 0,
    val manifest: VersionManifest? = null,
    val checkState: String = "idle",
    val checkFailureReason: String? = null,
    val optionalPromptSuppressed: Boolean = false,
    val download: UpdateDownloadSnapshot = UpdateDownloadSnapshot(),
)

internal fun UpdateStatus.toBridgeJson(state: String, currentVersionName: String, currentVersionCode: Int): JSONObject {
    return JSONObject()
        .put("revision", this.revision)
        .put("state", state)
        .put("checkState", this.checkState)
        .put("checkFailureReason", this.checkFailureReason ?: JSONObject.NULL)
        .put("currentVersionName", currentVersionName)
        .put("currentVersionCode", currentVersionCode)
        .put("latestVersionName", manifest?.latestVersionName ?: JSONObject.NULL)
        .put("latestVersionCode", manifest?.latestVersionCode ?: JSONObject.NULL)
        .put("minSupportedVersionCode", manifest?.minSupportedVersionCode ?: JSONObject.NULL)
        .put("publishedAt", manifest?.publishedAt ?: JSONObject.NULL)
        .put("releaseNotes", manifest?.releaseNotes ?: JSONObject.NULL)
        .put("optionalPromptSuppressed", this.optionalPromptSuppressed)
        .put("download", this.download.toJson())
}
