package com.wotbtools.app

import android.content.Intent
import android.net.Uri
import android.test.InstrumentationTestCase
import android.webkit.WebView
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
