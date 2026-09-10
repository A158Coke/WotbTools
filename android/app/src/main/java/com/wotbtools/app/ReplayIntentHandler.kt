package com.wotbtools.app

import android.annotation.SuppressLint
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/**
 * 待处理 replay：已复制到 app private cache，uri 为 app-owned FileProvider URI。
 *
 * `pendingId` 是这份 pending 的 **authoritative identity**（完整 UUID）：Web ACK 必须原样回传它，
 * 由 `PendingReplayAckPolicy` 做 compare-and-clear —— 没有任何「无 identity 清当前 pending」的路径。
 * 日志一律只允许用 short ref（[logRef]），绝不落完整 id。
 * `createdAt` 是本地 ingress 时刻，供 24h 本地 cache TTL 判断（与 Keycloak / QQ 的认证超时无关）。
 */
data class PendingReplay(
    val pendingId: String,
    val name: String,
    val file: File,
    val uri: Uri,
    val size: Long,
    val createdAt: Long
)

/** 日志 short ref 长度。**只**决定日志可读性，不参与任何 identity 判断。 */
private const val LOG_REF_LENGTH = 8

/**
 * 日志用 short ref（不足 8 位原样返回，null 记为 `none`）。
 *
 * 这是「short ref 只配做日志」这条规则在 JVM 单测里可覆盖的唯一入口 —— [PendingReplay] 带 Android 的
 * `Uri`，纯 JVM 测试无法构造实例。**禁止**用它的返回值做比较 / 清理决策：identity 永远是完整 pendingId。
 */
internal fun pendingLogRef(pendingId: String?): String = pendingId?.take(LOG_REF_LENGTH) ?: "none"

/** [PendingReplay] 的日志 short ref 便捷访问（等价于 `pendingLogRef(pendingId)`）。 */
internal val PendingReplay.logRef: String get() = pendingLogRef(pendingId)

/**
 * 持久化的 pending replay metadata（跨 process death 恢复用）。
 *
 * 只存恢复所需的最小信息：完整 pendingId、cache 文件名、原始显示名、size、createdAt。
 * **不存** replay 内容、不 Base64、不存 external 绝对路径、不存 token/cookie/凭据 —— 内容始终只存在于
 * app private cache 的 backing file，恢复时用同一 file path 重建 FileProvider URI。
 */
internal data class ReplayPendingMetadata(
    val pendingId: String,
    val cacheFilename: String,
    val originalName: String,
    val size: Long,
    val createdAt: Long
)

/**
 * Replay 入口意图 → 安全 ingress（规格 §6 原始计划）：
 * external content URI → ContentResolver → 最小验证(.wotbreplay) → stream copy 到 app private cache
 * → app-owned FileProvider URI → Native Bridge 交给 Web。不 Base64、不取真实路径、不解析 replay、
 * 不复制 20 MiB/100/200 MiB 业务 contract（只保留一个 infra 单文件硬上限）。
 * 非 replay intent 安全忽略（返回 null，绝不把任意 binary 交给 Web upload pipeline）。
 *
 * Android external replay 只有这一条 ingress（Intent → pending cache → Native Bridge →
 * Web `fetch(content://)` → 上传管线），没有 file chooser 注入路径。
 *
 * 跨 process death（RC7）：pending 的 metadata 落盘在 app private SharedPreferences；冷启动先恢复
 * active pending，再清理不再被引用的 orphan，避免 QQ 登录期间进程被杀后 replay 永久丢失。
 */
object ReplayIntentHandler {
    private const val CACHE_DIR = "replay"
    private const val BUFFER = 8192
    // infra safety hard ceiling（单文件），高于业务 20 MiB；不是业务 validator。
    private const val MAX_BYTES = 25L * 1024 * 1024

    /** pending metadata 存储（app private SharedPreferences，single slot）。 */
    private const val PREFS_NAME = "replay_pending"
    private const val KEY_METADATA = "metadata"

    /**
     * pendingId 的合法长度边界。完整 UUID 为 36 字符；下限 8 保留对升级前写入的短 id metadata 的
     * 向后兼容（否则一次 app update 就会把未消费的 pending 判成损坏而丢掉），上限 64 拒绝畸形 / 超长注入值。
     */
    internal const val PENDING_ID_MIN_LENGTH = 8
    internal const val PENDING_ID_MAX_LENGTH = 64

    /**
     * 本地 cache hygiene TTL：24h。这是本地 pending 生命周期，**不**与 Keycloak session / QQ 登录
     * 超时绑定；只保证一个陈旧 replay 不会在跨 process death 后被无限期当成有效 pending 恢复。
     */
    internal const val PENDING_TTL_MS = 24L * 60 * 60 * 1000

    /** metadata 编码版本；未知 / 缺失版本一律视为损坏（不恢复）。 */
    private const val METADATA_VERSION = "1"

    fun fromIntent(context: Context, intent: Intent?): PendingReplay? {
        if (intent == null) return null
        val uri: Uri = when (intent.action) {
            Intent.ACTION_SEND -> {
                @Suppress("DEPRECATION")
                if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
                }
            }
            Intent.ACTION_VIEW -> intent.data
            else -> null
        } ?: return null

        val resolver = context.contentResolver
        val displayName = queryDisplayName(resolver, uri) ?: fallbackName(uri)
        // 候选验证：非 .wotbreplay 一律忽略，绝不把任意 binary 传入 Web pipeline。
        if (!displayName.lowercase().endsWith(".wotbreplay")) return null

        val size = querySize(resolver, uri)
        val pendingId = newPendingId()
        val createdAt = System.currentTimeMillis()
        val file = copyToCache(context, resolver, uri, pendingId) ?: return null
        val fileUri = FileProvider.getUriForFile(context, fileProviderAuthority(context), file)
        return PendingReplay(pendingId, displayName, file, fileUri, size, createdAt)
    }

    // ── 跨 process death 持久化（metadata only）──

    /**
     * 落盘当前 pending 的 metadata（single slot：最新 pending 直接覆盖旧的）。
     *
     * 用 `commit()` 而不是 `apply()`：metadata 必须在进程被系统杀死之前真正写入磁盘 —— QQ 登录期间本进程
     * 随时可能被杀（RC7），延迟落盘会让重启后的恢复逻辑读到空值。
     */
    @SuppressLint("ApplySharedPref")
    fun savePendingMetadata(context: Context, pending: PendingReplay) {
        val metadata = ReplayPendingMetadata(
            pendingId = pending.pendingId,
            cacheFilename = pending.file.name,
            originalName = pending.name,
            size = pending.size,
            createdAt = pending.createdAt
        )
        metadataPrefs(context).edit().putString(KEY_METADATA, encodeMetadata(metadata)).commit()
    }

    /**
     * 清空持久化 metadata（Web consume / 损坏 / 过期 / backing file 缺失）。
     * 不删除 backing file：Chromium 可能仍在读取，留给下一次 startup orphan cleanup。
     */
    @SuppressLint("ApplySharedPref")
    fun clearPendingMetadata(context: Context) {
        metadataPrefs(context).edit().remove(KEY_METADATA).commit()
    }

    /**
     * 启动恢复（必须在 orphan cleanup 之前调用）：metadata 完整、未过期且 backing file 存在时，用同一
     * file path 重建 FileProvider URI 并返回 pending；过期 / 损坏 / 文件缺失一律清 metadata 且不恢复。
     */
    fun restorePending(context: Context): PendingReplay? {
        val raw = metadataPrefs(context).getString(KEY_METADATA, null) ?: return null
        val metadata = decodeMetadata(raw)
        val file = resolveRestorableBackingFile(metadata, cacheDir(context), System.currentTimeMillis())
        if (metadata == null || file == null) {
            clearPendingMetadata(context)
            return null
        }
        val uri = FileProvider.getUriForFile(context, fileProviderAuthority(context), file)
        return PendingReplay(
            metadata.pendingId,
            metadata.originalName,
            file,
            uri,
            metadata.size,
            metadata.createdAt
        )
    }

    /**
     * 确定性行编码（`key=value`，'\n' 分隔）。
     *
     * 刻意不用 org.json：JVM 单测里 android.jar 的 org.json 是 stub，会抛异常
     * （app 只依赖 junit:junit:4.13.2，没有 Robolectric），所以这份 metadata 必须能在纯 JVM 下编解码。
     */
    internal fun encodeMetadata(metadata: ReplayPendingMetadata): String = listOf(
        "version=$METADATA_VERSION",
        "pendingId=${metadata.pendingId}",
        "cacheFilename=${metadata.cacheFilename}",
        "originalName=${sanitizeName(metadata.originalName)}",
        "size=${metadata.size}",
        "createdAt=${metadata.createdAt}"
    ).joinToString("\n")

    /**
     * 解码 metadata。null / 空 / 畸形（缺字段、重复 key、畸形行、版本不符、数字不可解析、负 size、
     * 非正 createdAt、不安全的 cache 文件名、空白或越界的 pendingId）一律返回 null —— 调用方据此清 metadata。
     * 未知的额外 key 被忽略（为将来追加字段留出前向兼容）。
     */
    internal fun decodeMetadata(raw: String?): ReplayPendingMetadata? {
        if (raw.isNullOrEmpty()) return null
        val fields = LinkedHashMap<String, String>()
        for (line in raw.split('\n')) {
            val separator = line.indexOf('=')
            if (separator <= 0) return null
            val key = line.substring(0, separator)
            if (fields.put(key, line.substring(separator + 1)) != null) return null
        }
        if (fields["version"] != METADATA_VERSION) return null
        val pendingId = fields["pendingId"] ?: return null
        val cacheFilename = fields["cacheFilename"] ?: return null
        val originalName = fields["originalName"] ?: return null
        val size = fields["size"]?.toLongOrNull() ?: return null
        val createdAt = fields["createdAt"]?.toLongOrNull() ?: return null
        // identity 边界：非空白且长度在 8..64 —— 全空白的 8 位值同样不是 identity，必须单独拒绝。
        if (pendingId.isBlank()) return null
        if (pendingId.length !in PENDING_ID_MIN_LENGTH..PENDING_ID_MAX_LENGTH) return null
        if (!isSafeCacheFilename(cacheFilename)) return null
        if (size < 0L) return null
        if (createdAt <= 0L) return null
        return ReplayPendingMetadata(pendingId, cacheFilename, originalName, size, createdAt)
    }

    /**
     * 本地 TTL 判断：从 createdAt 起算满 24h（含刚好 24h）即过期；时钟回拨（now < createdAt）不算过期。
     */
    internal fun isExpired(createdAt: Long, now: Long): Boolean = now - createdAt >= PENDING_TTL_MS

    /**
     * 启动恢复决策（纯逻辑，无 Android 类型）：metadata 有效、未过期且 backing file 存在时才可恢复。
     * 返回应当保留（并作为 FileProvider URI 重建来源）的 backing file；null 表示不恢复 —— 调用方必须清
     * metadata，并让 startup orphan cleanup 以 active=null 运行（过期文件因此被安全清掉）。
     */
    internal fun resolveRestorableBackingFile(
        metadata: ReplayPendingMetadata?,
        dir: File,
        now: Long
    ): File? {
        if (metadata == null) return null
        if (isExpired(metadata.createdAt, now)) return null
        val file = File(dir, metadata.cacheFilename)
        if (!file.isFile) return null
        return file
    }

    // ── cache 清理 ──

    /**
     * 启动 orphan 清理：只删除不再被 active pending 引用的文件。
     * active backing file（含从 metadata 恢复的那份）绝不能删除；没有 active pending 时 activeFile 为
     * null，即退化成「清空整个 cache/replay」（与修复前的行为一致）。
     */
    fun cleanupOrphans(context: Context, activeFile: File?) {
        cleanupOrphansInDir(cacheDir(context), activeFile)
    }

    /** 纯文件系统清理（无 Android 类型，JVM 单测可用临时目录直接覆盖）。 */
    internal fun cleanupOrphansInDir(dir: File, activeFile: File?) {
        if (!dir.isDirectory) return
        val keep = activeFile?.absolutePath
        dir.listFiles()?.forEach { candidate ->
            if (keep != null && candidate.absolutePath == keep) return@forEach
            candidate.delete()
        }
    }

    // ── 内部工具 ──

    private fun copyToCache(
        context: Context,
        resolver: ContentResolver,
        uri: Uri,
        pendingId: String
    ): File? {
        val dir = cacheDir(context).apply { mkdirs() }
        val file = File(dir, "replay-$pendingId.wotbreplay")
        return try {
            resolver.openInputStream(uri)?.use { input ->
                FileOutputStream(file).use { out ->
                    val buf = ByteArray(BUFFER)
                    var total = 0L
                    while (true) {
                        val read = input.read(buf)
                        if (read == -1) break
                        total += read
                        if (total > MAX_BYTES) {
                            file.delete()
                            return null
                        }
                        out.write(buf, 0, read)
                    }
                }
            } ?: return null
            file
        } catch (_: Exception) {
            file.delete()
            null
        }
    }

    private fun queryDisplayName(resolver: ContentResolver, uri: Uri): String? {
        return try {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(c.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME)) else null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun querySize(resolver: ContentResolver, uri: Uri): Long {
        return try {
            resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(c.getColumnIndexOrThrow(OpenableColumns.SIZE))) {
                    c.getLong(c.getColumnIndexOrThrow(OpenableColumns.SIZE))
                } else 0L
            } ?: 0L
        } catch (_: Exception) {
            0L
        }
    }

    private fun fallbackName(uri: Uri): String {
        return uri.lastPathSegment?.substringAfterLast('/') ?: "replay.wotbreplay"
    }

    /**
     * 换行会破坏 `key=value` 行编码，而显示名只用于 UI / Web `File` 名，因此落盘前把 \r\n 换成空格。
     * 刻意不截断长度：Web 侧按扩展名校验，截断可能丢掉 `.wotbreplay` 后缀。
     */
    private fun sanitizeName(name: String): String = name.replace('\r', ' ').replace('\n', ' ')

    /**
     * backing file 名只允许是 cache/replay 目录内的扁平文件名：不含路径分隔符、不含 `..`、长度有界。
     * 防止 metadata 被篡改后把恢复路径指向 cache 目录之外。
     */
    private fun isSafeCacheFilename(name: String): Boolean {
        if (name.isBlank() || name.length > 128) return false
        if (name.contains('/') || name.contains('\\')) return false
        if (name.contains("..")) return false
        return true
    }

    private fun metadataPrefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun cacheDir(context: Context): File = File(context.cacheDir, CACHE_DIR)

    private fun fileProviderAuthority(context: Context): String = "${context.packageName}.fileprovider"

    /**
     * pending identity：完整 UUID（36 字符）。
     *
     * 刻意不用短 id：short ref 只配做日志（[logRef] / [pendingLogRef]），identity 必须全局唯一，否则
     * 「ACK 的那一份」与「当前 pending」无法可靠比较（PR review Blocker 2）。
     */
    internal fun newPendingId(): String = UUID.randomUUID().toString()
}
