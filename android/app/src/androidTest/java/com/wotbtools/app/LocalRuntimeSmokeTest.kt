package com.wotbtools.app

import android.content.Intent
import android.net.Uri
import android.test.InstrumentationTestCase
import android.webkit.WebView
import com.wotbtools.app.auth.AuthSession
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Real WebView/ContentResolver/WASM smoke; physical/provider validation remains a separate gate. */
@Suppress("DEPRECATION")
class LocalRuntimeSmokeTest : InstrumentationTestCase() {
    private var activity: MainActivity? = null
    private var originalAirplane = "0"

    override fun setUp() {
        super.setUp()
        originalAirplane = shell("settings get global airplane_mode_on").trim()
        shell("cmd connectivity airplane-mode enable")
    }

    override fun tearDown() {
        activity?.let { current -> instrumentation.runOnMainSync { current.finish() } }
        shell("cmd connectivity airplane-mode " + if (originalAirplane == "1") "enable" else "disable")
        super.tearDown()
    }

    fun testOfflineColdStartRestartBridgeAndExternalReplayParseAck() {
        activity = launch()
        awaitCondition("bundled local shell") {
            js("location.origin") == "https://appassets.androidplatform.net" &&
                js("!!document.querySelector('[data-testid=app-footer]')") == "true"
        }
        assertEquals("/index.html", js("location.pathname"))
        instrumentation.runOnMainSync { activity!!.finish() }
        instrumentation.waitForIdleSync()
        activity = launch()
        awaitCondition("local shell after restart") { js("!!document.querySelector('[data-testid=app-footer]')") == "true" }

        js("""(() => {
            window.__nativeSmoke = {};
            WotbNative.addEventListener('message', e => {
                const reply = JSON.parse(e.data);
                if (String(reply.id).startsWith('smoke-')) window.__nativeSmoke[reply.id] = reply.result;
            });
            for (const method of ['getBridgeVersion', 'getCapabilities', 'connectivityGetState'])
                WotbNative.postMessage(JSON.stringify({id: 'smoke-' + method, method, params: {}}));
            return true;
        })()""")
        awaitCondition("native bridge version/connectivity") {
            js("window.__nativeSmoke['smoke-getBridgeVersion']") == "2" &&
                js("window.__nativeSmoke['smoke-connectivityGetState']") == "offline"
        }
        assertTrue(js("window.__nativeSmoke['smoke-getCapabilities'].includes('native-auth')").toBoolean())

        val replayIntent = Intent(Intent.ACTION_SEND).apply {
            setClass(instrumentation.targetContext, MainActivity::class.java)
            type = "application/octet-stream"
            putExtra(Intent.EXTRA_STREAM, Uri.parse(ReplayFixtureProvider.URI))
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        // Defer dispatch while the document is not visible, so persisted ingress can be restored.
        instrumentation.runOnMainSync { activity!!.findViewById<WebView>(R.id.webView).visibility = android.view.View.GONE }
        instrumentation.targetContext.startActivity(replayIntent)
        awaitCondition("external content copied and pending persisted") { pendingSnapshot() != null }
        val pendingIdentity = pendingSnapshot()!!.getString("pendingId")
        assertEquals(36, pendingIdentity.length)
        instrumentation.runOnMainSync { activity!!.finish() }
        instrumentation.waitForIdleSync()
        activity = launch()
        val restored = pendingSnapshot()
        assertNotNull("Pending must restore before page can parse", restored)
        assertEquals(pendingIdentity, restored!!.getString("pendingId"))
        assertEquals("https://appassets.androidplatform.net/__native/replay-pending", restored.getString("uri"))
        // Parse + ACK can only complete after real Native bytes and bundled WASM are usable offline.
        awaitCondition("external replay parsed and ACKed", 90_000) {
            js("location.search.includes('view=replay')") == "true" &&
                js("!!document.querySelector('[data-testid=data-toolbar]')") == "true" &&
                pendingCleared()
        }
        assertEquals("false", js("!!document.querySelector('[data-testid=result-failures]')"))
        assertEquals("https://appassets.androidplatform.net", js("location.origin"))
    }

    fun testOfflineExpiredCachedSessionProjectsLocalClaimsWithoutAnApiToken() {
        activity = launch()
        awaitCondition("local shell for cached-session bridge") {
            js("!!document.querySelector('[data-testid=app-footer]')") == "true"
        }
        awaitCondition("native system offline") {
            var offline = false
            instrumentation.runOnMainSync { offline = activity!!.bridgeConnectivityState() == "offline" }
            offline
        }
        val managerField = MainActivity::class.java.getDeclaredField("authManager").apply { isAccessible = true }
        val manager = requireNotNull(managerField.get(activity))
        val sessionField = manager.javaClass.getDeclaredField("session").apply { isAccessible = true }
        val lockField = manager.javaClass.getDeclaredField("lock").apply { isAccessible = true }
        val sessionLock = requireNotNull(lockField.get(manager))
        val originalSession = synchronized(sessionLock) { sessionField.get(manager) }
        try {
            // Test-only in-memory fixture: no real provider token or persistent/auth store mutation.
            synchronized(sessionLock) {
                sessionField.set(manager, AuthSession(
                    accessToken = "expired-offline-instrumentation-fixture",
                    hasIdToken = true,
                    expiresAtSeconds = 1L,
                    claims = mapOf(
                        "realm_access" to JSONObject().put("roles", JSONArray().put("wotbtools-admin")),
                        "preferred_username" to "offline-admin-fixture"
                    )
                ))
            }
            // Recreate the host and load a fresh local document with the fixture already cached.
            instrumentation.runOnMainSync { activity!!.finish() }
            instrumentation.waitForIdleSync()
            activity = launch()
            instrumentation.runOnMainSync {
                activity!!.findViewById<WebView>(R.id.webView).loadUrl(MainActivity.LOCAL_APP_ENTRY + "?view=replay")
            }
            awaitCondition("cached admin claims keep local shots and reviewed 3D entries visible") {
                js("""!!document.querySelector('[data-testid="ws-tab"][data-cap="shots"]') && !!document.querySelector('[data-testid="ws-tab"][data-cap="3d"]')""") == "true"
            }
            js("""(() => {
                window.__cachedSessionReply = null;
                WotbNative.addEventListener('message', e => {
                    const reply = JSON.parse(e.data);
                    if (reply.id === 'smoke-cached-session') window.__cachedSessionReply = reply.result;
                });
                WotbNative.postMessage(JSON.stringify({id:'smoke-cached-session', method:'authGetAccessToken', params:{minValiditySeconds:30}}));
                return true;
            })()""")
            awaitCondition("expired cached-session Native RPC reply") {
                js("!!window.__cachedSessionReply") == "true"
            }
            assertEquals("refresh-failed", js("window.__cachedSessionReply.error"))
            assertEquals("true", js("window.__cachedSessionReply.token === null"))
            assertEquals("1", js("window.__cachedSessionReply.expiresAt"))
            assertEquals("wotbtools-admin", js("window.__cachedSessionReply.claims.realm_access.roles[0]"))
            assertEquals("offline-admin-fixture", js("window.__cachedSessionReply.claims.preferred_username"))
            // A genuinely cleared Native session still has no claims, expiry or token projection.
            synchronized(sessionLock) { sessionField.set(manager, AuthSession.unauthenticated()) }
            val unauthenticatedReply = activity!!.bridgeAuthGetAccessToken(30)
            assertEquals("unauthenticated", unauthenticatedReply.getString("error"))
            assertTrue(unauthenticatedReply.isNull("token"))
            assertTrue(unauthenticatedReply.isNull("claims"))
            assertTrue(unauthenticatedReply.isNull("expiresAt"))
        } finally {
            synchronized(sessionLock) { sessionField.set(manager, originalSession) }
        }
    }

    private fun pendingSnapshot(): JSONObject? {
        var pending: JSONObject? = null
        instrumentation.runOnMainSync { pending = activity!!.bridgePendingReplayJson() as? JSONObject }
        return pending
    }

    private fun pendingCleared(): Boolean = pendingSnapshot() == null

    private fun launch(): MainActivity = instrumentation.startActivitySync(
        Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ) as MainActivity

    private fun shell(command: String): String = instrumentation.uiAutomation.executeShellCommand(command)
        .use { descriptor -> android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).bufferedReader().use { it.readText() } }

    private fun js(expression: String): String {
        val latch = CountDownLatch(1)
        var result = "null"
        instrumentation.runOnMainSync {
            activity!!.findViewById<WebView>(R.id.webView).evaluateJavascript(expression) {
                result = JSONArray("[$it]").optString(0, "null")
                latch.countDown()
            }
        }
        assertTrue("JavaScript callback timed out", latch.await(10, TimeUnit.SECONDS))
        return result
    }

    private fun awaitCondition(label: String, timeout: Long = 30_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeout
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(200)
        }
        fail("Timed out: $label; url=" + js("location.href") + "; result=" +
            js("JSON.stringify({toolbar:!!document.querySelector('[data-testid=data-toolbar]'), failure:document.querySelector('[data-testid=result-failures]')?.textContent, workspace:!!document.querySelector('.replay-workspace')})"))
    }
}
