package com.wotbtools.app

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream

class ReplayFolderPickerTest {
    private fun file(id: String, name: String = "$id.wotbreplay", size: Long? = 4L) =
        ReplayFolderPicker.Document(id, name, false, size, 1234L)

    private fun directory(id: String, name: String = id) =
        ReplayFolderPicker.Document(id, name, true, null, 0L)

    private fun scan(children: Map<String, List<ReplayFolderPicker.Document>>) =
        ReplayFolderPicker.enumerate("tree", "root", { id, emit ->
            children.getValue(id).forEach(emit)
        })

    private fun singleSelection(id: String = "replay", size: Long? = 4L) =
        scan(mapOf("root" to listOf(file(id, size = size))))

    private fun publish(picker: ReplayFolderPicker, selection: ReplayFolderPicker.Selection) {
        assertTrue(picker.complete(picker.begin()!!, selection))
    }

    @Test fun nestedAndMixedDocumentsRetainRelativePathsWithoutNativeBusinessFiltering() {
        val selection = scan(mapOf(
            "root" to listOf(directory("nested"), file("top", "same.wotbreplay"), file("text", "readme.txt")),
            "nested" to listOf(file("inner", "same.wotbreplay"), directory("deep")),
            "deep" to listOf(file("deeper", "last.WOTBREPLAY"))
        ))
        assertEquals(setOf("same.wotbreplay", "readme.txt", "nested/same.wotbreplay", "nested/deep/last.WOTBREPLAY"),
            selection.files.map { it.relativePath }.toSet())
        assertEquals(4, selection.files.map { it.fileId }.toSet().size)
        assertTrue(selection.files.all { it.lastModified == 1234L })
        // Published selections cannot be changed through an accidental mutable-list cast.
        assertThrows(UnsupportedOperationException::class.java) {
            (selection.files as MutableList<ReplayFolderPicker.FolderFile>).clear()
        }
    }

    @Test fun emptyDirectoryIsACompleteSelection() {
        assertTrue(scan(mapOf("root" to emptyList())).files.isEmpty())
    }

    @Test fun cyclesAndRepeatedDocumentsAreVisitedOnce() {
        val queried = ArrayList<String>()
        val graph = mapOf(
            "root" to listOf(directory("branch"), directory("branch"), directory("root"), file("shared")),
            "branch" to listOf(directory("root"), directory("branch"), file("shared"), file("child"))
        )
        val selection = ReplayFolderPicker.enumerate("tree", "root", { id, emit ->
            queried.add(id)
            graph.getValue(id).forEach(emit)
        })
        assertEquals(listOf("root", "branch"), queried)
        assertEquals(setOf("shared", "child"), selection.files.map { it.documentId }.toSet())
    }

    @Test fun unknownOrInvalidSizeRemainsUnknownAndMissingTimeIsZero() {
        val selection = scan(mapOf("root" to listOf(
            file("unknown", size = null), file("negative", size = -1L), file("empty", size = 0L),
            ReplayFolderPicker.Document("missing-time", "time.txt", false, 1L, -1L)
        )))
        val files = selection.files.associateBy { it.documentId }
        assertNull(files.getValue("unknown").size)
        assertNull(files.getValue("negative").size)
        assertEquals(0L, files.getValue("empty").size)
        assertEquals(0L, files.getValue("missing-time").lastModified)
    }

    @Test fun scanCeilingStopsRowEmissionBeforeAProviderChildListCanGrow() {
        var emitted = 0
        assertThrows(IOException::class.java) {
            ReplayFolderPicker.enumerate("tree", "root", { _, emit ->
                repeat(1_000_000) {
                    emitted++
                    // Repeated/cyclic rows must also consume the infrastructure budget.
                    emit(directory("root"))
                }
            })
        }
        assertEquals(ReplayFolderPicker.MAX_SCAN_ENTRIES + 1, emitted)
    }

    @Test fun scanCeilingIncludesNestedRowsAndAllowsTheExactBoundary() {
        var extraRow = false
        val visit: (String, (ReplayFolderPicker.Document) -> Unit) -> Unit = { id, emit ->
            if (id == "root") {
                emit(directory("nested"))
            } else {
                repeat(ReplayFolderPicker.MAX_SCAN_ENTRIES - 2) { emit(directory("root")) }
                emit(file("last"))
                if (extraRow) emit(file("over-limit"))
            }
        }
        assertEquals(1, ReplayFolderPicker.enumerate("tree", "root", visit).files.size)
        extraRow = true
        assertThrows(IOException::class.java) {
            ReplayFolderPicker.enumerate("tree", "root", visit)
        }
    }

    @Test fun aggregateMetadataAcceptsTheExactBudgetAndRejectsOneAdditionalIdentityCharacter() {
        fun scanWithFinalIdentity(lastId: String) = ReplayFolderPicker.enumerate("tree", "root", { _, emit ->
            repeat(124) { index ->
                emit(file(index.toString().padStart(16, '0'), "n$index".padEnd(4000, 'a')))
            }
            emit(file(lastId, "z".repeat(734)))
        })
        val selection = scanWithFinalIdentity("last")
        val retainedChars = selection.treeUri.length + "root".length + selection.selectionId.length +
            selection.files.sumOf { it.documentId.length + it.name.length + it.relativePath.length + it.fileId.length }
        assertEquals(ReplayFolderPicker.MAX_RETAINED_METADATA_CHARS, retainedChars)
        assertEquals(125, selection.files.size)
        assertThrows(IOException::class.java) { scanWithFinalIdentity("lastx") }
    }

    @Test fun aggregateBudgetIncludesNestedPathsAndStopsProviderEmissionEarly() {
        var emittedFiles = 0
        val failure = assertThrows(IOException::class.java) {
            ReplayFolderPicker.enumerate("tree", "root", { id, emit ->
                if (id == "root") {
                    emit(directory("nested", "p".repeat(7000)))
                } else {
                    repeat(ReplayFolderPicker.MAX_SCAN_ENTRIES) { index ->
                        emittedFiles++
                        emit(file(index.toString(), "f$index".padEnd(1001, 'a')))
                    }
                }
            })
        }
        assertEquals("Directory metadata budget exceeded", failure.message)
        // Each valid individual path fits 8192 chars; the aggregate must fail much earlier than 10k rows.
        assertTrue(emittedFiles in 1..1000)
    }

    @Test fun repeatedDocumentRowsDoNotAccumulateRetainedMetadata() {
        val repeated = file("same", "n".repeat(8192))
        val selection = ReplayFolderPicker.enumerate("tree", "root", { _, emit ->
            repeat(ReplayFolderPicker.MAX_SCAN_ENTRIES) { emit(repeated) }
        })
        assertEquals(1, selection.files.size)
    }

    @Test fun cancellationAndProviderFailureAbortTheEntireScan() {
        var cancelled = false
        assertThrows(IOException::class.java) {
            ReplayFolderPicker.enumerate("tree", "root", { _, emit ->
                emit(file("first"))
                cancelled = true
                emit(file("second"))
            }, cancelled = { cancelled })
        }
        assertThrows(IOException::class.java) {
            ReplayFolderPicker.enumerate("tree", "root", { _, emit ->
                emit(file("first"))
                throw IOException("provider query failed")
            })
        }
    }

    @Test fun cancellationAfterTheLastRowStillDoesNotPublishAPartialResult() {
        var cancelled = false
        assertThrows(IOException::class.java) {
            ReplayFolderPicker.enumerate("tree", "root", { _, emit ->
                emit(file("first"))
                cancelled = true
            }, cancelled = { cancelled })
        }
    }

    @Test fun cancelledPickerPreservesSelectionAndBusyOrLateRequestCannotReplaceIt() {
        val picker = ReplayFolderPicker()
        val first = singleSelection("first")
        publish(picker, first)
        val cancelledRequest = picker.begin()!!
        assertNull(picker.begin())
        assertTrue(picker.complete(cancelledRequest, null))
        val newerRequest = picker.begin()!!
        assertFalse(picker.complete(cancelledRequest, singleSelection("late")))
        assertTrue(picker.isActive(newerRequest))
        assertTrue(picker.complete(newerRequest, null))
        assertTrue(picker.release(first.selectionId))
    }

    @Test fun scanTimeoutEquivalentCompletionAllowsRetryAndRejectsTheLateWorker() {
        val picker = ReplayFolderPicker()
        val previous = singleSelection("previous")
        publish(picker, previous)
        val expired = picker.begin()!!
        // MainActivity's deadline completes this exact request with failed/no selection.
        assertTrue(picker.complete(expired, null))
        val retry = picker.begin()!!
        assertNotEquals(expired, retry)
        assertFalse(picker.complete(expired, singleSelection("late-provider-result")))
        assertTrue(picker.isActive(retry))
        val selected = singleSelection("retry-result")
        assertTrue(picker.complete(retry, selected))
        assertFalse(picker.release(previous.selectionId))
        assertFalse(picker.complete(expired, singleSelection("even-later")))
        assertTrue(picker.release(selected.selectionId))
    }

    @Test fun clientRequestIdentityMustBePresentBoundedAndComparedExactly() {
        val current = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
        listOf(null, "", " ", "\n\t", "x".repeat(ReplayFolderPicker.MAX_CLIENT_REQUEST_ID_LENGTH + 1)).forEach {
            assertFalse(ReplayFolderPicker.validClientRequestId(it))
            assertFalse(ReplayFolderPicker.ownsClientRequest(current, it))
        }
        assertTrue(ReplayFolderPicker.validClientRequestId("x".repeat(ReplayFolderPicker.MAX_CLIENT_REQUEST_ID_LENGTH)))
        assertTrue(ReplayFolderPicker.ownsClientRequest(current, current))
        assertFalse(ReplayFolderPicker.ownsClientRequest(current, current.take(8)))
        assertFalse(ReplayFolderPicker.ownsClientRequest(current, " $current"))
        assertFalse(ReplayFolderPicker.ownsClientRequest(null, current))
    }

    @Test fun staleClientCancellationPreservesNewRequestAndCompletedSelection() {
        val picker = ReplayFolderPicker()
        val completed = singleSelection("completed")
        publish(picker, completed)
        val currentGeneration = picker.begin()!!
        val currentClientId = "client-request-new"
        assertFalse(ReplayFolderPicker.ownsClientRequest(currentClientId, "client-request-old"))
        assertTrue(picker.isActive(currentGeneration))
        assertTrue(ReplayFolderPicker.ownsClientRequest(currentClientId, currentClientId))
        assertTrue(picker.complete(currentGeneration, null))
        // Cancellation has no completed-selection owner and must leave its separate resource readable.
        assertFalse(ReplayFolderPicker.ownsClientRequest(null, currentClientId))
        assertFalse(picker.complete(currentGeneration, singleSelection("late")))
        assertTrue(picker.release(completed.selectionId))
    }

    @Test fun staleReleaseDoesNotClearNewSelection() {
        val picker = ReplayFolderPicker()
        val old = singleSelection("old")
        val current = singleSelection("new")
        publish(picker, old)
        publish(picker, current)
        listOf(null, "", " ", old.selectionId, current.selectionId.take(8)).forEach {
            assertFalse(picker.release(it))
        }
        assertTrue(picker.release(current.selectionId))
        assertFalse(picker.release(current.selectionId))
    }

    @Test fun destroyRejectsLateScanAndClearsResourceOwnership() {
        val picker = ReplayFolderPicker()
        val selection = singleSelection()
        publish(picker, selection)
        val request = picker.begin()!!
        picker.destroy()
        assertFalse(picker.complete(request, singleSelection("late")))
        assertFalse(picker.isActive(request))
        assertNull(picker.begin())
        assertFalse(picker.release(selection.selectionId))
        assertEquals(404, picker.interceptFolderResource(
            ReplayFolderPicker.STREAM_URL, selection.selectionId, selection.files[0].fileId
        ) { _, _ -> fail("Destroyed selection must never open a document"); null }!!.status)
    }

    @Test fun exactSelectionAndFileIdentitiesAreBothRequiredBeforeOpening() {
        val picker = ReplayFolderPicker()
        val old = singleSelection("old")
        val current = singleSelection("new")
        publish(picker, old)
        publish(picker, current)
        var opens = 0
        fun resource(selectionId: String?, fileId: String?, method: String = "GET") =
            picker.interceptFolderResource(ReplayFolderPicker.STREAM_URL, selectionId, fileId, method) { tree, id ->
                opens++
                assertEquals("tree", tree)
                assertEquals("new", id)
                ByteArrayInputStream(byteArrayOf(1, 2, 3, 4))
            }!!
        listOf(null, "", " ", old.selectionId, current.selectionId.take(8)).forEach {
            assertEquals(409, resource(it, current.files[0].fileId).status)
        }
        listOf(null, "", " ").forEach {
            assertEquals(409, resource(current.selectionId, it).status)
        }
        assertEquals(404, resource(current.selectionId, old.files[0].fileId).status)
        assertEquals(404, resource(current.selectionId, current.files[0].fileId.take(8)).status)
        listOf("POST", "HEAD", "OPTIONS").forEach {
            assertEquals(405, resource(current.selectionId, current.files[0].fileId, it).status)
        }
        assertEquals(0, opens)
        val valid = resource(current.selectionId, current.files[0].fileId)
        assertEquals(200, valid.status)
        assertArrayEquals(byteArrayOf(1, 2, 3, 4), valid.data!!.use { it.readBytes() })
        assertEquals(1, opens)
    }

    @Test fun unrelatedUrlsCannotOpenAFolderDocument() {
        val picker = ReplayFolderPicker()
        val selection = singleSelection()
        publish(picker, selection)
        listOf(
            "https://wotbtools.com/__native/replay-folder",
            "http://appassets.androidplatform.net/__native/replay-folder",
            ReplayFolderPicker.STREAM_URL + "?file=other",
            ReplayFolderPicker.STREAM_URL + "/extra"
        ).forEach { url ->
            assertNull(picker.interceptFolderResource(url, selection.selectionId, selection.files[0].fileId) { _, _ ->
                fail("Only the exact resource may open a document")
                null
            })
        }
    }

    @Test fun openFailureAndMissingStreamReturnNativeErrorWithNoFallback() {
        val picker = ReplayFolderPicker()
        val selection = singleSelection()
        publish(picker, selection)
        assertEquals(500, picker.interceptFolderResource(
            ReplayFolderPicker.STREAM_URL, selection.selectionId, selection.files[0].fileId
        ) { _, _ -> throw IOException("provider unavailable") }!!.status)
        assertEquals(500, picker.interceptFolderResource(
            ReplayFolderPicker.STREAM_URL, selection.selectionId, selection.files[0].fileId
        ) { _, _ -> null }!!.status)
    }

    @Test fun knownInfrastructureOversizeIsRejectedBeforeOpening() {
        val picker = ReplayFolderPicker()
        val selection = singleSelection(size = ReplayIntentHandler.MAX_BYTES + 1L)
        publish(picker, selection)
        assertEquals(413, picker.interceptFolderResource(
            ReplayFolderPicker.STREAM_URL, selection.selectionId, selection.files[0].fileId
        ) { _, _ -> fail("Oversize source must not open"); null }!!.status)
    }

    @Test fun releaseDuringOpenClosesTheStreamAndRejectsTheResponse() {
        val picker = ReplayFolderPicker()
        val selection = singleSelection()
        publish(picker, selection)
        var closed = false
        val response = picker.interceptFolderResource(
            ReplayFolderPicker.STREAM_URL, selection.selectionId, selection.files[0].fileId
        ) { _, _ ->
            assertTrue(picker.release(selection.selectionId))
            object : ByteArrayInputStream(byteArrayOf(1)) {
                override fun close() { closed = true; super.close() }
            }
        }!!
        assertEquals(409, response.status)
        assertTrue(closed)
    }

    @Test fun releasedSelectionAlsoInvalidatesAnAlreadyOpenedStream() {
        val picker = ReplayFolderPicker()
        val selection = singleSelection()
        publish(picker, selection)
        var closed = false
        val stream = picker.interceptFolderResource(
            ReplayFolderPicker.STREAM_URL, selection.selectionId, selection.files[0].fileId
        ) { _, _ -> object : ByteArrayInputStream(byteArrayOf(1, 2)) {
            override fun close() { closed = true; super.close() }
        } }!!.data!!
        assertEquals(1, stream.read())
        picker.release(selection.selectionId)
        assertThrows(IOException::class.java) { stream.read() }
        assertTrue(closed)
    }

    @Test fun boundedStreamAllowsExactEofAndRejectsExtraActualBytesAcrossReadMethods() {
        ReplayFolderPicker.boundedStream(ByteArrayInputStream(byteArrayOf(1, 2, 3)), 3).use {
            assertArrayEquals(byteArrayOf(1, 2, 3), it.readBytes())
            assertEquals(-1, it.read())
        }
        ReplayFolderPicker.boundedStream(ByteArrayInputStream(byteArrayOf()), 0).use {
            assertEquals(-1, it.read())
        }
        val tooLarge = ReplayFolderPicker.boundedStream(ByteArrayInputStream(byteArrayOf(1, 2, 3)), 2)
        assertEquals(1, tooLarge.read())
        assertEquals(2, tooLarge.read())
        assertThrows(IOException::class.java) { tooLarge.read() }
        val bulk = ReplayFolderPicker.boundedStream(ByteArrayInputStream(ByteArray(5)), 3)
        assertThrows(IOException::class.java) { bulk.read(ByteArray(10)) }
        val skipped = ReplayFolderPicker.boundedStream(ByteArrayInputStream(ByteArray(5)), 3)
        assertThrows(IOException::class.java) { skipped.skip(5) }
    }

    @Test fun unknownSizeIsStillBoundedByActualNativeStreamBytes() {
        val picker = ReplayFolderPicker()
        val selection = singleSelection(size = null)
        publish(picker, selection)
        // Synthetic generator avoids allocating a 25 MiB fixture just to test the stream ceiling.
        var remaining = ReplayIntentHandler.MAX_BYTES + 1L
        var closed = false
        val stream = picker.interceptFolderResource(
            ReplayFolderPicker.STREAM_URL, selection.selectionId, selection.files[0].fileId
        ) { _, _ -> object : InputStream() {
            override fun read(): Int = if (remaining-- > 0) 1 else -1
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                if (remaining <= 0) return -1
                val count = minOf(length.toLong(), remaining).toInt()
                remaining -= count
                return count
            }
            override fun close() { closed = true }
        } }!!.data!!
        assertThrows(IOException::class.java) {
            val buffer = ByteArray(8192)
            while (stream.read(buffer) != -1) Unit
        }
        assertTrue(closed)
    }

    @Test fun streamReadFailureClosesProviderAndPropagatesForWholeBatchFailure() {
        var closed = false
        val stream = ReplayFolderPicker.boundedStream(object : InputStream() {
            override fun read(): Int = throw IOException("provider read failed")
            override fun close() { closed = true }
        }, 10)
        assertThrows(IOException::class.java) { stream.read(ByteArray(2)) }
        assertTrue(closed)
    }
}
