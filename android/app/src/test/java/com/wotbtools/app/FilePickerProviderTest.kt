package com.wotbtools.app

import android.content.ContentProvider
import android.content.ContentValues
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.provider.DocumentsContract
import java.io.IOException
import java.io.RandomAccessFile
import java.io.File
import java.security.MessageDigest
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.rules.TemporaryFolder
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class FilePickerProviderTest {
    @get:Rule val temporary = TemporaryFolder()

    class Provider : ContentProvider() {
        lateinit var fixture: File
        var displayName: String? = "random-battle-example.wotbreplay"
        var declaredSize: Long? = null
        var modified: Long? = 946684800000L
        var mime: String = "application/octet-stream"
        override fun onCreate() = true
        override fun getType(uri: Uri) = mime
        override fun query(uri: Uri, projection: Array<out String>?, selection: String?,
            selectionArgs: Array<out String>?, sortOrder: String?): Cursor =
            MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED)).apply {
                addRow(arrayOf<Any?>(displayName, declaredSize, modified))
            }
        override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor =
            ParcelFileDescriptor.open(fixture, ParcelFileDescriptor.MODE_READ_ONLY)
        override fun insert(uri: Uri, values: ContentValues?): Uri? = null
        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
        override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
    }

    @Test fun documentProviderFixtureArrivesIntactWithOriginalName() {
        val fixture = File("../../common/fixtures/replays/random-battle-example.wotbreplay")
        val provider = Provider().apply { this.fixture = fixture }
        provider.attachInfo(RuntimeEnvironment.getApplication(), ProviderInfo().apply { authority = "picker-test" })
        ShadowContentResolver.registerProviderInternal("picker-test", provider)
        val output = FilePickerCache.spool(RuntimeEnvironment.getApplication().contentResolver,
            Uri.parse("content://picker-test/document/opaque-id"), temporary.root)
        assertEquals(fixture.name, output.name)
        assertEquals(provider.modified, output.lastModified())
        assertArrayEquals(MessageDigest.getInstance("SHA-256").digest(fixture.readBytes()),
            MessageDigest.getInstance("SHA-256").digest(output.readBytes()))
    }

    @Test fun missingDisplayNameUsesImageMimeAndDoesNotInventReplayExtension() {
        val provider = Provider().apply {
            fixture = temporary.newFile("source").apply { writeBytes(byteArrayOf(1, 2, 3)) }
            displayName = null
            mime = "image/png"
        }
        provider.attachInfo(RuntimeEnvironment.getApplication(), ProviderInfo().apply { authority = "picker-image" })
        ShadowContentResolver.registerProviderInternal("picker-image", provider)
        val output = FilePickerCache.spool(RuntimeEnvironment.getApplication().contentResolver,
            Uri.parse("content://picker-image/opaque"), temporary.newFolder("cache"))
        assertEquals("picked-file.png", output.name)
        assertArrayEquals(provider.fixture.readBytes(), output.readBytes())
    }
    @Test fun unknownAndUnderstatedSizeCannotBypassStreamingCeiling() {
        val provider = Provider().apply {
            fixture = temporary.newFile("large")
            RandomAccessFile(fixture, "rw").use { it.setLength(ReplayIntentHandler.MAX_BYTES + 1) }
        }
        provider.attachInfo(RuntimeEnvironment.getApplication(), ProviderInfo().apply { authority = "picker-large" })
        ShadowContentResolver.registerProviderInternal("picker-large", provider)
        val cache = temporary.newFolder("cache")
        for (size in listOf(null, 1L)) {
            provider.declaredSize = size
            assertThrows(IOException::class.java) {
                FilePickerCache.spool(RuntimeEnvironment.getApplication().contentResolver,
                    Uri.parse("content://picker-large/document/a"), cache)
            }
            assertTrue(cache.listFiles()!!.isEmpty())
        }
    }

    @Test fun aggregateOverflowRejectsAndCleansWholeSelection() {
        val provider = Provider().apply {
            fixture = temporary.newFile("batch-source")
            RandomAccessFile(fixture, "rw").use { it.setLength(ReplayIntentHandler.MAX_BYTES) }
        }
        provider.attachInfo(RuntimeEnvironment.getApplication(), ProviderInfo().apply { authority = "picker-batch" })
        ShadowContentResolver.registerProviderInternal("picker-batch", provider)
        val cache = temporary.newFolder("batch-cache")
        val uris = (1..11).map { Uri.parse("content://picker-batch/document/$it") }
        assertThrows(IOException::class.java) {
            FilePickerCache.spoolSelection(RuntimeEnvironment.getApplication().contentResolver, uris, cache)
        }
        assertTrue(cache.listFiles()!!.isEmpty())
    }

}
