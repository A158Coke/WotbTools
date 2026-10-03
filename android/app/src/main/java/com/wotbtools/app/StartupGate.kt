package com.wotbtools.app

import java.net.HttpURLConnection
import java.net.URL

/** Best-effort update manifest discovery; local startup never awaits this request. */
object StartupGate {
    private const val VERSION_URL = "https://wotbtools.com/download/android/version.json"
    private const val CONNECT_TIMEOUT_MS = 3_000
    private const val READ_TIMEOUT_MS = 3_000

    sealed class Result {
        data class Ok(val manifest: VersionManifest) : Result()
        data class VersionUnavailable(val reason: String) : Result()
    }

    fun checkVersion(): Result {
        return try {
            val conn = URL(VERSION_URL).openConnection() as HttpURLConnection
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            conn.readTimeout = READ_TIMEOUT_MS
            conn.instanceFollowRedirects = true
            try {
                if (conn.responseCode != 200) {
                    return Result.VersionUnavailable("HTTP ${conn.responseCode}")
                }
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                Result.Ok(VersionManifest.fromJson(body))
            } finally {
                conn.disconnect()
            }
        } catch (e: Exception) {
            Result.VersionUnavailable(e.message ?: "network error")
        }
    }
}
