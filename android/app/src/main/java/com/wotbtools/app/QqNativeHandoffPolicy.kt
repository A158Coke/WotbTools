package com.wotbtools.app

import java.util.Locale

/** native QQ handoff 是否允许把 QQ 的 return callback 改写成 app-owned scheme。 */
internal enum class QqHandoffRewrite { REWRITE_ALLOWED, DO_NOT_REWRITE }

/** `schemacallback` 值的分类（只看 scheme 段，value 本身绝不返回、绝不落日志）。 */
internal enum class QqCallbackCategory { BROWSER, APP, UNKNOWN }

/**
 * native QQ handoff 决策 + 可安全输出的诊断信息。
 *
 * @param rewrite 是否允许改写 `schemacallback`。当前生产恒为 [QqHandoffRewrite.DO_NOT_REWRITE]
 *   （见 [QqNativeHandoffPolicy.RECOGNIZED_SHAPE_EVIDENCE]）。
 * @param hasSchemaCallback QQ URI 是否带 `schemacallback`（只记录**存在性**）。
 * @param callbackCategory `schemacallback` 值的 scheme 分类（不含 value）。
 * @param reason 安全 reason token（无 URI / 无 value），用于 `native-handoff rewrite=fallback reason=...`。
 */
internal data class QqHandoffPlan(
    val rewrite: QqHandoffRewrite,
    val hasSchemaCallback: Boolean,
    val callbackCategory: QqCallbackCategory,
    val reason: String
)

/**
 * QQ native login handoff 的**改写决策**边界（纯逻辑，无 Android 类型）。
 *
 * 职责分离：[AuthNavigationPolicy] 是「这个 (scheme, host) 是否可信、是否算 auth flow 内的 native
 * handoff」的**唯一**信任 SSOT；本 policy 只回答「已可信的 handoff 是否可以把 QQ 的 return callback
 * 改写成本 App 自己的 scheme」。因此这里不复制第二份 `(scheme, host)` 字面量，而是直接读
 * [AuthNavigationPolicy.NATIVE_AUTH_TARGETS]。
 *
 * 安全立场：QQ 的 URI 形状属于**未经证实的私有 contract**。在没有真机证据前，[RECOGNIZED_SHAPE_EVIDENCE]
 * 恒为 false ⇒ 一律 [QqHandoffRewrite.DO_NOT_REWRITE] ⇒ 调用方沿用 QQ 原始 URI，行为与改动前逐字节一致。
 * 绝不因为「看起来像」而猜测 `p` / `state` / `code` / `ticket` 等内部参数。
 */
internal object QqNativeHandoffPolicy {

    /** QQ return callback 参数名（只判断存在性，不记录 value）。 */
    internal const val SCHEMA_CALLBACK_PARAM = "schemacallback"

    /** 本 App 自有 return scheme（PR B 启用 rewrite 时使用，见 `docs/android/architecture.md`）。 */
    internal const val APP_RETURN_SCHEME = "wotbtools"

    /**
     * 是否已拿到真机证据、足以识别 QQ return callback 的**形状**。
     *
     * 证据要求（记录在 `docs/android/architecture.md` 的 QQ native handoff evidence 小节）：
     * `wtloginmqq://ptlogin/...` 的 path 形状、query **key 名**集合、`schemacallback` 是否存在，
     * 以及 QQ 是否把可恢复的 HTTPS continuation 交给该 callback。
     *
     * 拿到证据前恒为 `false`：rewrite 分支不启用，handoff 一律走原 URI（PR B 才设计真正的 return
     * ownership 与 rewrite）。
     */
    internal const val RECOGNIZED_SHAPE_EVIDENCE = false

    /**
     * 决策入口。`scheme` / `host` 是否可信由 [AuthNavigationPolicy.NATIVE_AUTH_TARGETS] 判定（这里只做
     * 大小写 / 尾部点归一化后比对）；[hasSchemaCallback] 只表达**存在性**，[schemaCallbackScheme] 只用于
     * 分类 —— 两者都不接受、也不返回 `schemacallback` 的 value。`recognizedShape` 是取证开关，生产调用点
     * 不传即取 [RECOGNIZED_SHAPE_EVIDENCE]。
     */
    fun plan(
        inAuthFlow: Boolean,
        scheme: String?,
        host: String?,
        hasSchemaCallback: Boolean,
        schemaCallbackScheme: String?,
        recognizedShape: Boolean = RECOGNIZED_SHAPE_EVIDENCE
    ): QqHandoffPlan {
        val normalizedScheme = normalize(scheme)
        // host 归一化与 AuthNavigationPolicy 保持一致（大小写不敏感 + 去掉尾部点），避免两处对同一个
        // exact target 得出不同结论。
        val normalizedHost = normalize(host)?.trimEnd('.')?.takeIf { it.isNotEmpty() }
        val category = categorize(schemaCallbackScheme)

        fun fallback(reason: String) = QqHandoffPlan(
            QqHandoffRewrite.DO_NOT_REWRITE,
            hasSchemaCallback,
            category,
            reason
        )

        if (!inAuthFlow) return fallback("outside-auth-flow")
        val trustedScheme = AuthNavigationPolicy.NATIVE_AUTH_TARGETS.any { it.first == normalizedScheme }
        if (!trustedScheme) return fallback("wrong-scheme")
        val trustedTarget = AuthNavigationPolicy.NATIVE_AUTH_TARGETS
            .any { it.first == normalizedScheme && it.second == normalizedHost }
        if (!trustedTarget) return fallback("wrong-host")
        // 没有 schemacallback 就没有可改写的东西：原样交给 QQ。
        if (!hasSchemaCallback) return fallback("no-schema-callback")
        if (!recognizedShape) return fallback("unsupported-shape")
        return QqHandoffPlan(QqHandoffRewrite.REWRITE_ALLOWED, true, category, "recognized")
    }

    private fun categorize(schemaCallbackScheme: String?): QqCallbackCategory =
        when (normalize(schemaCallbackScheme)) {
            "http", "https" -> QqCallbackCategory.BROWSER
            APP_RETURN_SCHEME -> QqCallbackCategory.APP
            else -> QqCallbackCategory.UNKNOWN
        }

    private fun normalize(value: String?): String? = value
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?.lowercase(Locale.ROOT)
}

/**
 * **DEBUG-only 取证**：把 native handoff URI 的**形状**渲染成一行可安全打印的文本。
 *
 * 只接受 path 与 query **key 名**集合 —— 签名里根本不存在 value，调用方无法误传；输出因此不可能包含
 * 完整 URI、任何 query value 或 `p` / `state` / `code` / `ticket` / `token` 的值。仅用于拿到真机
 * `wtloginmqq://ptlogin/...` 形状（见 [QqNativeHandoffPolicy.RECOGNIZED_SHAPE_EVIDENCE]），
 * 取证完成后可整体删除。
 */
internal fun describeQqHandoffShape(
    path: String?,
    queryNames: Collection<String>,
    hasSchemaCallback: Boolean
): String {
    val safePath = path?.takeIf { it.isNotEmpty() } ?: "-"
    val keys = queryNames
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .distinct()
        .sorted()
    return "path=$safePath keys=[${keys.joinToString(",")}] schemacallback=$hasSchemaCallback"
}
