package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket

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

    @Test fun aFailingBodyCloseIsSwallowed() {
        val checked = object : InputStream() {
            override fun read(): Int = -1
            override fun close() = throw IOException("close failed")
        }
        val unchecked = object : InputStream() {
            override fun read(): Int = -1
            override fun close() = throw IllegalStateException("close failed")
        }
        for (body in listOf(checked, unchecked)) {
            val out = ByteArrayOutputStream()
            send({ out }, body)
            assertTrue(out.toString(Charsets.ISO_8859_1).startsWith("HTTP/1.1 200 OK\r\n"))
        }
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

    @Test fun serveClosesTheRoutedBodyWhenTheSocketOutputCannotBeOpened() {
        val body = TrackingInput("payload".toByteArray())
        val server = LocalRuntimeServer(MainActivity.LOCAL_APP_ORIGIN) {
            ReplayIntentHandler.StreamResponse(200, "OK", body, "text/plain")
        }
        val request = "GET /index.html HTTP/1.1\r\nHost: 127.0.0.1:21653\r\n\r\n".toByteArray(Charsets.US_ASCII)
        val client = object : Socket() {
            override fun setSoTimeout(timeout: Int) = Unit

            override fun getInputStream(): InputStream = ByteArrayInputStream(request)

            override fun getOutputStream(): OutputStream = throw IOException("output stream unavailable")
        }
        server.serve(client)
        assertEquals(1, body.closeCount)
    }

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
            assertEquals(1, body.closeCount)
        } finally {
            server.close()
        }
    }

    private class TrackingInput(private val bytes: ByteArray) : InputStream() {
        @Volatile
        var closeCount = 0
            private set
        private var index = 0

        override fun read(): Int = if (index < bytes.size) bytes[index++].toInt() and 0xff else -1

        override fun close() {
            closeCount++
        }
    }

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

    private class WriteFailingOutput : OutputStream() {
        override fun write(b: Int): Unit = throw IOException("write failed")

        override fun write(b: ByteArray, off: Int, len: Int): Unit = throw IOException("write failed")
    }

    private class FlushFailingOutput : OutputStream() {
        override fun write(b: Int) = Unit

        override fun write(b: ByteArray, off: Int, len: Int) = Unit

        override fun flush(): Unit = throw IOException("flush failed")
    }
}
