package com.wotbtools.app

import com.wotbtools.app.NavigationPolicy.MainFrameNavigation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 纯 JVM：GeckoView 的 `NavigationDelegate` 无法在 JVM 里实例化，导航判断因此全部放在
 * [NavigationPolicy] 的纯函数里，这里穷举放行 / 拒绝的 URL 形态。
 */
class NavigationPolicyTest {
    private val origin = MainActivity.LOCAL_APP_ORIGIN

    @Test fun trustedLocalBlobDownloadUrlsAreAccepted() {
        listOf(
            "blob:$origin/8f4c0b1e-2c3f-4a5b-9d6e-7f8a9b0c1d2e",
            "blob:$origin/1",
            "blob:$origin/AbC-123_z.9~0"
        ).forEach { assertTrue(it, NavigationPolicy.isTrustedLocalBlobUrl(it)) }
    }

    @Test fun blobUrlsOutsideTheExactLocalOriginAreRejected() {
        listOf(
            "blob:http://127.0.0.1:9999/8f4c0b1e-2c3f-4a5b-9d6e-7f8a9b0c1d2e",
            "blob:https://wotbtools.com/8f4c0b1e-2c3f-4a5b-9d6e-7f8a9b0c1d2e",
            "blob:https://evil.example/8f4c0b1e-2c3f-4a5b-9d6e-7f8a9b0c1d2e",
            "blob:http://127.0.0.1:21653.evil.example/uuid",
            "blob:http://user@127.0.0.1:21653/uuid",
            "blob:http://localhost:21653/8f4c0b1e-2c3f-4a5b-9d6e-7f8a9b0c1d2e",
            "blob:http://127.0.0.2:21653/uuid",
            "blob:http://[::1]:21653/uuid",
            "blob:null/uuid",
            "blob:null",
            "blob:",
            "blob:uuid",
            "blob:http://127.0.0.1:21653",
            "blob:http://127.0.0.1:21653/",
            "blob:http://127.0.0.1:21653/a/b",
            "blob:http://127.0.0.1:21653/%2e%2e%2findex.html",
            "blob:http://127.0.0.1:21653/..%2findex.html",
            "blob:http://127.0.0.1:21653/uuid?x=1",
            "blob:http://127.0.0.1:21653/uuid#frag",
            "blob:http://127.0.0.1:21653/u uid",
            "blob:http://127.0.0.1:21653/" + "a".repeat(129),
            "blob:ftp://127.0.0.1:21653/uuid",
            "blob:file:///data/user/0/com.wotbtools.app/files/replay.wotbreplay",
            "BLOB:$origin/uuid",
            " data:$origin/uuid"
        ).forEach { assertFalse(it, NavigationPolicy.isTrustedLocalBlobUrl(it)) }
    }

    @Test fun nonBlobSchemesAreNeverTrustedBlobDownloads() {
        listOf(
            "data:text/plain,x",
            "data:text/html,<script>alert(1)</script>",
            "file:///data/user/0/com.wotbtools.app/files/replay.wotbreplay",
            "javascript:alert(1)",
            "content://com.android.providers.downloads.documents/document/1",
            "http://127.0.0.1:21653.evil.example/index.html",
            "http://127.0.0.1:21653/index.html",
            "https://wotbtools.com/",
            origin,
            "$origin/index.html",
            "",
            "not a url"
        ).forEach { assertFalse(it, NavigationPolicy.isTrustedLocalBlobUrl(it)) }
    }

    @Test fun mainFrameNavigationOnlyAllowsLocalBlankAndTrustedBlob() {
        assertEquals(MainFrameNavigation.LOCAL, NavigationPolicy.classifyMainFrameNavigation("$origin/index.html"))
        assertEquals(
            MainFrameNavigation.LOCAL,
            NavigationPolicy.classifyMainFrameNavigation("$origin/index.html?view=replay")
        )
        assertEquals(MainFrameNavigation.BLANK, NavigationPolicy.classifyMainFrameNavigation("about:blank"))
        assertEquals(
            MainFrameNavigation.BLOB_DOWNLOAD,
            NavigationPolicy.classifyMainFrameNavigation("blob:$origin/8f4c0b1e-2c3f-4a5b-9d6e-7f8a9b0c1d2e")
        )
        assertEquals(MainFrameNavigation.EXTERNAL, NavigationPolicy.classifyMainFrameNavigation("https://wotbtools.com/"))
        assertEquals(MainFrameNavigation.EXTERNAL, NavigationPolicy.classifyMainFrameNavigation("mailto:support@wotbtools.com"))
        // https 即使在 loopback 端口上也不是应用 origin（isLocalAppUrl 为 false），继续交系统浏览器。
        assertEquals(
            MainFrameNavigation.EXTERNAL,
            NavigationPolicy.classifyMainFrameNavigation("https://127.0.0.1:21653/index.html")
        )
    }

    @Test fun mainFrameNavigationFailsClosedForEverythingElse() {
        listOf(
            "http://127.0.0.1:9999/index.html",
            "http://localhost:21653/index.html",
            "http://127.0.0.1:21653.evil.example/index.html",
            "blob:https://evil.example/uuid",
            "blob:null/uuid",
            "blob:",
            "data:text/html,x",
            "file:///index.html",
            "javascript:alert(1)",
            "content://com.android.providers.downloads.documents/document/1",
            "intent://scan/#Intent;scheme=zxing;end",
            "about:config",
            "not a url"
        ).forEach { assertEquals(it, MainFrameNavigation.DENY, NavigationPolicy.classifyMainFrameNavigation(it)) }
    }

    /**
     * blob 只是下载派发的例外，不是 application origin：Native Bridge 的 sender 校验
     * （[MainActivity.isLocalAppUrl]）必须继续只接受 `http://127.0.0.1:21653`。
     */
    @Test fun aTrustedBlobUrlIsNeverATrustedApplicationOrigin() {
        val blob = "blob:$origin/8f4c0b1e-2c3f-4a5b-9d6e-7f8a9b0c1d2e"
        assertTrue(NavigationPolicy.isTrustedLocalBlobUrl(blob))
        assertEquals(MainFrameNavigation.BLOB_DOWNLOAD, NavigationPolicy.classifyMainFrameNavigation(blob))
        assertFalse(MainActivity.isLocalAppUrl(blob))
        assertTrue(MainActivity.isLocalAppUrl("$origin/index.html"))
    }
}
