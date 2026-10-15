package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket

/**
 * [LocalRuntimeServer.sendResponse] 是 [ReplayIntentHandler.StreamResponse]`.data` 的唯一 owner：
 * 每条路径都必须 close **恰好一次**（不 double close、不漏 close）。socket 层的失败用可注入的
 * 输出流复现，另外补一个真实 loopback 往返来证明 `serve()` 确实把 ownership 接在这条路径上。
 */
class LocalRuntimeServerResponseTest {

    private fun response(body: InputStream?) =
        ReplayIntentHandler.StreamResponse(200, "OK", body, "text/plain")

    private fun send(open: () -> OutputStream, body: InputStream?, headOnly: Boolean = false) =
        LocalRuntimeServer.sendResponse(open, response(body), headOnly)

    @Test fun normalGetReadsTheBodyAndClosesItExactlyOnce() {
        val body = TrackingInput("payload".toByteArray())
        val out = ByteArrayOutputStream()
        send({ out }, body)
        val text = out.toString(Charsets.ISO_8859_1)
        assertTrue(text, text.startsWith("HTTP/1.1 200 OK\r\n"))
        assertTrue(text, text.contains("Content-Type: text/plain\r\n"))
        assertTrue(text, text.endsWith("payload"))
        assertEquals(1, body.closeCount)
    }

    @Test fun headRequestSkipsTheBodyButStillClosesItExactlyOnce() {
        val body = TrackingInput("payload".toByteArray())
        val out = ByteArrayOutputStream()
        send({ out }, body, headOnly = true)
        val text = out.toString(Charsets.ISO_8859_1)
        assertTrue(text, text.startsWith("HTTP/1.1 200 OK\r\n"))
        assertTrue(text, text.contains("Content-Type: text/plain\r\n"))
        assertTrue(text, !text.contains("payload"))
        assertEquals(1, body.closeCount)
    }

    @Test fun openingTheOutputStreamAfterRouteStillClosesTheBodyExactlyOnce() {
        val body = TrackingInput("payload".toByteArray())
        val failure = try {
            send({ throw IOException("getOutputStream failed") }, body)
            null
        } catch (e: IOException) {
            e
        }
        assertEquals("getOutputStream failed", failure?.message)
        assertEquals(1, body.closeCount)
    }

    /** 客户端在 header 交付阶段断开：底层 `write` 抛 IOException。 */
    @Test fun headerWriteFailureClosesTheBodyExactlyOnce() {
        val body = TrackingInput(ByteArray(100_000) { 'x'.code.toByte() })
        val failure = try {
            send({ WriteFailingOutput() }, body)
            null
        } catch (e: IOException) {
            e
        }
        assertEquals("write failed", failure?.message)
        assertEquals(1, body.closeCount)
    }

    /**
     * 修复前唯一会漏掉 body 的 header 路径：head 一次写满输出缓冲（超过 8 KiB，例如异常大的响应头），
     * 于是底层 `write` 在进入 body copy **之前**就抛 IOException —— 旧的
     * `output.write(head); response.data?.use { ... }` 覆盖不到这里。这里用超长头部把这条顺序钉死。
     */
    @Test fun oversizedHeadWriteFailureClosesTheBodyExactlyOnce() {
        val body = TrackingInput("payload".toByteArray())
        val response = ReplayIntentHandler.StreamResponse(
            200, "OK", body, "text/plain", mapOf("X-Pad" to "p".repeat(9_000))
        )
        val failure = try {
            LocalRuntimeServer.sendResponse({ WriteFailingOutput() }, response, headOnly = false)
            null
        } catch (e: IOException) {
            e
        }
        assertEquals("write failed", failure?.message)
        assertEquals(1, body.closeCount)
    }

    @Test fun bodyCopyFailureClosesTheBodyExactlyOnce() {
        val body = FailingRead(afterBytes = 3)
        val out = ByteArrayOutputStream()
        val failure = try {
            send({ out }, body)
            null
        } catch (e: IOException) {
            e
        }
        assertEquals("read failed", failure?.message)
        assertEquals(1, body.closeCount)
    }

    @Test fun flushFailureClosesTheBodyExactlyOnce() {
        val body = TrackingInput("payload".toByteArray())
        val failure = try {
            send({ FlushFailingOutput() }, body)
            null
        } catch (e: IOException) {
            e
        }
        assertEquals("flush failed", failure?.message)
        assertEquals(1, body.closeCount)
    }

    /** body 的 close 失败不值得把已经写完的响应变成失败，也不允许它替换正在传播的异常。 */
    @Test fun aFailingBodyCloseIsSwallowed() {
        val body = object : InputStream() {
            override fun read(): Int = -1
            override fun close() = throw IOException("close failed")
        }
        val out = ByteArrayOutputStream()
        send({ out }, body)
        assertTrue(out.toString(Charsets.ISO_8859_1).startsWith("HTTP/1.1 200 OK\r\n"))
    }

    @Test fun responsesWithoutABodyNeedNoClose() {
        val out = ByteArrayOutputStream()
        LocalRuntimeServer.sendResponse(
            { out },
            ReplayIntentHandler.StreamResponse(404, "Not Found", headers = LocalRuntimeServer.NO_STORE),
            headOnly = false
        )
        val text = out.toString(Charsets.ISO_8859_1)
        assertTrue(text, text.startsWith("HTTP/1.1 404 Not Found\r\n"))
        assertTrue(text, text.contains("Cache-Control: no-store\r\n"))
    }

    /** 端到端（真实 loopback）：`serve()` 必须在连接关闭前 close 路由返回的 body。 */
    @Test fun serveClosesTheRoutedBodyExactlyOnceOverTheWire() {
        val body = TrackingInput("routed-payload".toByteArray())
        var attempt = 0
        var port = 0
        var server: LocalRuntimeServer? = null
        while (server == null) {
            port = ServerSocket(0).use { it.localPort }
            val candidate = LocalRuntimeServer("http://${LocalRuntimeServer.HOST}:$port") {
                ReplayIntentHandler.StreamResponse(200, "OK", body, "text/plain")
            }
            try {
                candidate.start()
                server = candidate
            } catch (error: IOException) {
                candidate.close()
                if (++attempt >= 5) throw error
            }
        }
        try {
            Socket(LocalRuntimeServer.HOST, port).use { client ->
                client.soTimeout = 10_000
                client.getOutputStream().let {
                    it.write(
                        "GET /index.html HTTP/1.1\r\nHost: ${LocalRuntimeServer.HOST}:$port\r\n\r\n"
                            .toByteArray(Charsets.US_ASCII)
                    )
                    it.flush()
                }
                val text = client.getInputStream().readBytes().toString(Charsets.ISO_8859_1)
                assertTrue(text, text.startsWith("HTTP/1.1 200 OK\r\n"))
                assertTrue(text, text.endsWith("routed-payload"))
            }
            // EOF 只在 serve() 关掉连接后出现，而 body 的 close 在关连接之前 —— 这里读到的值必须是终值。
            assertEquals(1, body.closeCount)
        } finally {
            server.close()
        }
    }

    private class TrackingInput(private val bytes: ByteArray) : InputStream() {
        // 端到端用例由 worker 线程 close、测试线程断言。
        @Volatile
        var closeCount = 0
            private set
        private var index = 0

        override fun read(): Int = if (index < bytes.size) bytes[index++].toInt() and 0xff else -1

        override fun close() {
            closeCount++
        }
    }

    /** 读满 [afterBytes] 个字节后抛 IOException：body copy 的失败路径。 */
    private class FailingRead(private val afterBytes: Int) : InputStream() {
        @Volatile
        var closeCount = 0
            private set
        private var served = 0

        override fun read(): Int = if (served++ < afterBytes) 'x'.code else throw IOException("read failed")

        override fun close() {
            closeCount++
        }
    }

    /** 任何 write 都失败：header 交付时客户端已断开。 */
    private class WriteFailingOutput : OutputStream() {
        override fun write(b: Int): Unit = throw IOException("write failed")

        override fun write(b: ByteArray, off: Int, len: Int): Unit = throw IOException("write failed")
    }

    /** 接受写入但 flush 失败。 */
    private class FlushFailingOutput : OutputStream() {
        override fun write(b: Int) = Unit

        override fun write(b: ByteArray, off: Int, len: Int) = Unit

        override fun flush(): Unit = throw IOException("flush failed")
    }
}
