package com.wotbtools.app

import java.net.URI

internal object NavigationPolicy {
    const val ABOUT_BLANK = "about:blank"

    private const val BLOB_SCHEME = "blob:"

    private val BLOB_ID = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

    private val EXTERNAL_SCHEMES = setOf("https", "mailto")

    private val LOCAL_APP_AUTHORITY = MainActivity.LOCAL_APP_AUTHORITY

    enum class MainFrameNavigation { LOCAL, BLANK, BLOB_DOWNLOAD, EXTERNAL, DENY }

    fun classifyMainFrameNavigation(url: String): MainFrameNavigation = when {
        MainActivity.isLocalAppUrl(url) -> MainFrameNavigation.LOCAL
        url == ABOUT_BLANK -> MainFrameNavigation.BLANK
        isTrustedLocalBlobUrl(url) -> MainFrameNavigation.BLOB_DOWNLOAD
        url.substringBefore(':', "").lowercase() in EXTERNAL_SCHEMES -> MainFrameNavigation.EXTERNAL
        else -> MainFrameNavigation.DENY
    }

    fun isTrustedLocalBlobUrl(url: String): Boolean {
        if (!url.startsWith(BLOB_SCHEME)) return false
        val inner = try {
            URI(url.substring(BLOB_SCHEME.length))
        } catch (_: Exception) {
            return false
        }
        if (inner.scheme != "http") return false
        if (inner.rawAuthority != LOCAL_APP_AUTHORITY) return false
        if (inner.rawUserInfo != null || inner.rawQuery != null || inner.rawFragment != null) return false
        val path = inner.rawPath ?: return false
        return path.isNotEmpty() && path[0] == '/' && BLOB_ID.matches(path.substring(1))
    }
}
