package com.wotbtools.app

import android.system.Os
import android.system.OsConstants
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** 调用 APK 中实际打包的 JNI；不替换 decoder，不运行 shell 解码器。 */
class DeltaApplierDeviceTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun <T> withFiles(block: (File, File, File, File) -> T): T {
        val dir = File(instrumentation.targetContext.cacheDir, "delta-test-${System.nanoTime()}")
        check(dir.mkdir())
        try {
            for (name in listOf("base.bin", "target.bin", "change.vcdiff")) {
                instrumentation.context.assets.open("delta/$name").use { input ->
                    File(dir, name).outputStream().use { input.copyTo(it) }
                }
            }
            return block(dir, File(dir, "base.bin"), File(dir, "change.vcdiff"), File(dir, "out.apk"))
        } finally { dir.deleteRecursively() }
    }
    private fun rejected(output: File, action: () -> Unit) {
        try { action(); fail("Decoder accepted invalid input") } catch (_: IOException) { }
        assertFalse("Failed decode left output", output.exists())
    }
    @Test fun decodesExactBytesAndHonorsExactLimit() = withFiles { dir, base, patch, out ->
        val target = File(dir, "target.bin")
        DeltaApplier.apply(base, patch, out, target.length())
        assertArrayEquals(target.readBytes(), out.readBytes())
    }
    @Test fun rejectsTruncationCorruptionWrongBaseAndOutputOverflow() = withFiles { dir, base, patch, out ->
        val bytes = patch.readBytes()
        for (length in listOf(0, 4, bytes.size / 2, bytes.size - 1)) {
            patch.writeBytes(bytes.copyOf(length))
            rejected(out) { DeltaApplier.apply(base, patch, out, 100000) }
        }
        patch.writeBytes(bytes)
        rejected(out) { DeltaApplier.apply(base, patch, out, 0) }
        rejected(out) { DeltaApplier.apply(base, patch, out, Int.MAX_VALUE.toLong() + 1) }
        rejected(out) { DeltaApplier.apply(base, patch, out, 1) }
        base.writeBytes(ByteArray(base.length().toInt()) { 1 })
        rejected(out) { DeltaApplier.apply(base, patch, out, 100000) }
        for (flag in listOf(1, 2, 4, 255)) {
            patch.writeBytes(bytes.copyOf().also { it[4] = flag.toByte() })
            rejected(out) { DeltaApplier.apply(base, patch, out, 100000) }
        }
        assertTrue(File(dir, "target.bin").exists())
    }
    @Test fun preservesExistingFilesAndRejectsSymlinkInputs() = withFiles { dir, base, patch, out ->
        out.writeText("preserve")
        try { DeltaApplier.apply(base, patch, out, 100000); fail() } catch (_: IOException) { }
        assertEquals("preserve", out.readText())
        assertTrue(out.delete())
        try { DeltaApplier.apply(base, patch, base, 100000); fail() } catch (_: IOException) { }
        assertTrue(base.exists())
        rejected(out) { DeltaApplier.apply(base, base, out, 100000) }
        val link = File(dir, "linked.bin")
        Os.symlink(base.path, link.path)
        rejected(out) { DeltaApplier.apply(link, patch, out, 100000) }
        assertTrue(base.readBytes().isNotEmpty())
    }
    @Test fun rejectsHardlinkInputsWhenSupported() = withFiles { dir, base, _, out ->
        val link = File(dir, "linked.bin")
        try { Os.link(base.path, link.path) } catch (failure: android.system.ErrnoException) {
            if (failure.errno !in setOf(OsConstants.EACCES, OsConstants.EPERM, OsConstants.EOPNOTSUPP)) throw failure
            assumeTrue("Filesystem does not permit hard links: $failure", false)
        }
        rejected(out) { DeltaApplier.apply(base, link, out, 100000) }
    }
    @Test fun boundedMalformedInputDoesNotCrashOrLeaveOutput() = withFiles { _, base, patch, out ->
        val random = java.util.Random(4081)
        repeat(64) {
            val bytes = ByteArray(128 + it * 31).also { random.nextBytes(it) }
            byteArrayOf(0xd6.toByte(), 0xc3.toByte(), 0xc4.toByte(), 0, 0).copyInto(bytes)
            patch.writeBytes(bytes)
            rejected(out) { DeltaApplier.apply(base, patch, out, 100000) }
        }
    }
    @Test fun reconstructsInstallableDebugUpgradeWhenFixtureProvided() {
        val args = InstrumentationRegistry.getArguments()
        val patchPath = args.getString("upgradePatchPath")
        assumeTrue("Provide a local signed debug upgrade fixture", patchPath != null)
        val expected = requireNotNull(args.getString("upgradeTargetSha"))
        val size = requireNotNull(args.getString("upgradeTargetSize")).toLong()
        val base = File(requireNotNull(instrumentation.targetContext.applicationInfo.sourceDir))
        val output = File(instrumentation.targetContext.cacheDir, "delta-debug-upgrade.apk")
        if (output.exists()) check(output.delete())
        DeltaApplier.apply(base, File(patchPath!!), output, size)
        assertEquals(size, output.length())
        val digest = MessageDigest.getInstance("SHA-256")
        output.inputStream().use { stream ->
            val buffer = ByteArray(1024 * 1024)
            while (true) { val count = stream.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
        }
        assertEquals(expected, digest.digest().joinToString("") { "%02x".format(it) })
        // Host 安装此精确文件后再清理；不会默认安装或触及其它应用。
    }

    @Test fun reconstructsOfficialApkPairWhenFixtureProvided() {
        val path = InstrumentationRegistry.getArguments().getString("deltaFixtureDir")
        assumeTrue("Provide real APK fixtures explicitly", path != null)
        val dir = File(path!!)
        val output = File(instrumentation.targetContext.cacheDir, "delta-official-${System.nanoTime()}.apk")
        try {
            DeltaApplier.apply(File(dir, "3.30.0.apk"), File(dir, "3.30-3.32-android.xdelta"), output, 203738834)
            assertEquals(203738834L, output.length())
            val digest = MessageDigest.getInstance("SHA-256")
            output.inputStream().use { stream ->
                val buffer = ByteArray(1024 * 1024)
                while (true) { val n = stream.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) }
            }
            assertEquals("cd00d0c2fda31b3d418b093c994586c8eed2b6b90d8b2e659054b05713c5c0bf",
                digest.digest().joinToString("") { "%02x".format(it) })
        } finally { output.delete() }
    }
}
