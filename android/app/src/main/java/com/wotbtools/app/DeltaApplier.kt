package com.wotbtools.app

import java.io.File
import java.io.IOException
import java.nio.file.Files

/** 仅重建字节；调用方仍必须核验目标长度、SHA-256、包身份与签名，再发布 ready。 */
internal object DeltaApplier {
    private val loaded by lazy { System.loadLibrary("wotb_delta") }

    /** 后台同步调用。output 必须是应用私有目录中的全新路径，失败不会留下部分产物。 */
    @Throws(IOException::class)
    fun apply(base: File, patch: File, output: File, maxOutputBytes: Long) {
        if (maxOutputBytes !in 1..Int.MAX_VALUE.toLong()) throw IOException("Invalid delta output limit")
        val files = listOf(base, patch, output)
        if (files.any { Files.isSymbolicLink(it.toPath()) }) throw IOException("Symbolic delta path")
        val paths = files.map { it.canonicalFile }
        if (paths.map { it.path }.toSet().size != 3) throw IOException("Aliased delta path")
        try {
            loaded
            nativeApply(paths[0].path, paths[1].path, paths[2].path, maxOutputBytes)?.let {
                throw IOException("Delta decoding failed: $it")
            }
        } catch (error: LinkageError) {
            throw IOException("Delta decoder unavailable", error)
        }
    }

    private external fun nativeApply(base: String, patch: String, output: String, limit: Long): String?
}
