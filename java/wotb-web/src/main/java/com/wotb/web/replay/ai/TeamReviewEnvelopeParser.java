package com.wotb.web.replay.ai;

import com.wotb.core.replay.evidence.TeamReviewEnvelope;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 解析并严格验证 Team Call #2 的 structured JSON envelope
 * （Natural Coach 轮：{@code primaryDiagnosis} + {@code reviewMarkdown} + {@code claims}）。
 * <p>容忍 markdown 代码围栏与 LLM 在 JSON 前后附加的说明文字；但任何契约不成立
 * （reviewMarkdown 为空 / primaryDiagnosis 缺 title 或 reasoning / claims 非数组 /
 * evidenceIds 非字符串数组）时 {@link #parse(String)} 返回 {@code null}，由编排器把
 * 「输出必须是合法 JSON envelope」反馈给 LLM 重写（targeted rewrite → full rewrite → fail-safe）。</p>
 * <p>Observability（docs/current-plan.md §44/§45）：{@link #parseDetailed(String)} 返回
 * 可诊断的 {@link ParseResult}，携带稳定低基数 {@link ParseFailureReason}——启用 DeepSeek
 * JSON Output 后剩余的 parser failure 类型必须可机器分类，不能只看到笼统的 null。</p>
 */
public final class TeamReviewEnvelopeParser {

    static final int MAX_CLAIMS = 40;
    static final int MAX_IDS_PER_CLAIM = 20;

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private TeamReviewEnvelopeParser() {
    }

    /** 解析 LLM 输出为 envelope；契约不成立时返回 null（兼容旧契约）。 */
    public static TeamReviewEnvelope parse(final String output) {
        return parseDetailed(output).envelope();
    }

    /**
     * 解析并返回可诊断结果：成功时 {@code envelope()} 非 null、{@code failureReason()} 为 null；
     * 失败时相反。供编排层记录低基数 parser failure 分类。
     */
    public static ParseResult parseDetailed(final String output) {
        if (output == null || output.isBlank()) {
            return ParseResult.fail(ParseFailureReason.EMPTY_OUTPUT);
        }
        try {
            final JsonNode root = MAPPER.readTree(extractJson(output));
            if (root == null || !root.isObject()) {
                return ParseResult.fail(ParseFailureReason.INVALID_JSON);
            }
            final JsonNode diagnosis = root.get("primaryDiagnosis");
            if (diagnosis == null || !diagnosis.isObject()) {
                return ParseResult.fail(ParseFailureReason.MISSING_PRIMARY_DIAGNOSIS);
            }
            final String title = text(diagnosis.get("title"));
            final String reasoning = text(diagnosis.get("reasoning"));
            if (title.isBlank() || reasoning.isBlank()) {
                return ParseResult.fail(ParseFailureReason.MISSING_PRIMARY_DIAGNOSIS);
            }
            final TeamReviewEnvelope.PrimaryDiagnosis primary =
                    new TeamReviewEnvelope.PrimaryDiagnosis(
                            title, reasoning, stringList(diagnosis.get("supportingEvidenceIds")));
            final String reviewMarkdown = text(root.get("reviewMarkdown"));
            if (reviewMarkdown.isBlank()) {
                return ParseResult.fail(ParseFailureReason.MISSING_REVIEW_MARKDOWN);
            }
            final JsonNode claimsNode = root.get("claims");
            if (claimsNode != null && !claimsNode.isArray()) {
                return ParseResult.fail(ParseFailureReason.INVALID_CLAIMS);
            }
            final List<TeamReviewEnvelope.Claim> claims = new ArrayList<>();
            if (claimsNode != null) {
                if (claimsNode.size() > MAX_CLAIMS) {
                    return ParseResult.fail(ParseFailureReason.TOO_MANY_CLAIMS);
                }
                for (final JsonNode item : claimsNode) {
                    if (item == null || !item.isObject()) {
                        return ParseResult.fail(ParseFailureReason.INVALID_CLAIMS);
                    }
                    final String claimText = text(item.get("text"));
                    if (claimText.isBlank()) {
                        return ParseResult.fail(ParseFailureReason.INVALID_CLAIMS);
                    }
                    final List<String> ids = stringList(item.get("evidenceIds"));
                    if (ids.size() > MAX_IDS_PER_CLAIM) {
                        return ParseResult.fail(ParseFailureReason.TOO_MANY_EVIDENCE_IDS);
                    }
                    // Review Blocker B1：structured factual contract（fail-close）——
                    // claimType 必填且必须属于 schema；每种 factual claimType 的 required machine
                    // 字段必须齐全；机器字段类型/取值非法（如 region="six"、timeSec="112"）→ 整体拒绝。
                    final String claimType = text(item.get("claimType")).toUpperCase(java.util.Locale.ROOT);
                    if (!CLAIM_TYPES.contains(claimType)) {
                        return ParseResult.fail(ParseFailureReason.UNKNOWN_CLAIM_TYPE); // 未知/禁止（LOS 等）
                    }
                    final NumField timeSecF = doubleField(item.get("timeSec"));
                    final NumField regionF = intField(item.get("region"), 1, 9);
                    final NumField countF = intField(item.get("count"), 0, 99);
                    final String subject = text(item.get("subject"));
                    // Review Blocker B1：稳定身份 subjectAccountId（可选；JSON number 正整数，类型错误 fail-close）
                    final NumField accF = longField(item.get("subjectAccountId"));
                    final String value = text(item.get("value"));
                    final String side = text(item.get("side")).toUpperCase(java.util.Locale.ROOT);
                    final String countSemantics = text(item.get("countSemantics")).toUpperCase(java.util.Locale.ROOT);
                    final String knowledge = text(item.get("knowledge")).toUpperCase(java.util.Locale.ROOT);
                    // fail-close：任何声明字段类型非法 → 拒绝（不静默 null）
                    if (timeSecF.invalid() || regionF.invalid() || countF.invalid() || accF.invalid()) {
                        return ParseResult.fail(ParseFailureReason.INVALID_MACHINE_FIELD_TYPE);
                    }
                    // 枚举字段：出现但非法 → 拒绝
                    if ((!side.isEmpty() && !SIDES.contains(side))
                            || (!countSemantics.isEmpty() && !COUNT_SEMANTICS.contains(countSemantics))
                            || (!knowledge.isEmpty() && !KNOWLEDGE_VALUES.contains(knowledge))) {
                        return ParseResult.fail(ParseFailureReason.INVALID_MACHINE_FIELD_TYPE);
                    }
                    // per-claimType required fields（fail-close）
                    switch (claimType) {
                        case "DEATH" -> {
                            if (subject.isBlank() || timeSecF.missing() || ids.isEmpty()) {
                                return ParseResult.fail(ParseFailureReason.MISSING_REQUIRED_MACHINE_FIELD);
                            }
                        }
                        case "ALIVE_TRANSITION" -> {
                            if (value.isBlank() || !MACHINE_TRANSITION.matcher(value).matches()
                                    || ids.isEmpty()) {
                                return ParseResult.fail(ParseFailureReason.MISSING_REQUIRED_MACHINE_FIELD);
                            }
                        }
                        case "POSITION_REGION" -> {
                            if (timeSecF.missing() || regionF.missing() || countF.missing()
                                    || !SIDES.contains(side)
                                    || !COUNT_SEMANTICS.contains(countSemantics)
                                    || ids.isEmpty()) {
                                return ParseResult.fail(ParseFailureReason.MISSING_REQUIRED_MACHINE_FIELD);
                            }
                        }
                        case "ENEMY_POSITION" -> {
                            if (subject.isBlank() || timeSecF.missing() || regionF.missing()
                                    || !KNOWLEDGE_VALUES.contains(knowledge)
                                    || ids.isEmpty()) {
                                return ParseResult.fail(ParseFailureReason.MISSING_REQUIRED_MACHINE_FIELD);
                            }
                        }
                        case "TACTICAL" -> {
                            // 纯战术观点：不要求 factual machine 字段
                        }
                        default -> {
                            return ParseResult.fail(ParseFailureReason.UNKNOWN_CLAIM_TYPE);
                        }
                    }
                    claims.add(new TeamReviewEnvelope.Claim(
                            claimText, ids, claimType,
                            timeSecF.missing() ? null : timeSecF.value(),
                            regionF.missing() ? null : (int) Math.round(regionF.value()),
                            countF.missing() ? null : (int) Math.round(countF.value()),
                            subject.isBlank() ? null : subject,
                            value.isBlank() ? null : value,
                            side.isEmpty() ? null : side,
                            countSemantics.isEmpty() ? null : countSemantics,
                            knowledge.isEmpty() ? null : knowledge,
                            accF.missing() ? null : (long) Math.round(accF.value())));
                }
            }
            final TeamReviewEnvelope envelope =
                    new TeamReviewEnvelope(primary, reviewMarkdown, claims);
            return envelope.hasContent() ? ParseResult.ok(envelope)
                    : ParseResult.fail(ParseFailureReason.MISSING_REVIEW_MARKDOWN);
        } catch (final Exception e) {
            return ParseResult.fail(ParseFailureReason.INVALID_JSON);
        }
    }

    /** 提取 JSON 主体：优先剥离 markdown 代码围栏；否则取首个 { 到末尾 }（容忍前后说明文字）。 */
    private static String extractJson(final String output) {
        final String trimmed = output.trim();
        if (trimmed.startsWith("```")) {
            final int first = trimmed.indexOf('\n');
            final int last = trimmed.lastIndexOf("```");
            if (first >= 0 && last > first) {
                return trimmed.substring(first + 1, last).trim();
            }
        }
        final int start = trimmed.indexOf('{');
        final int end = trimmed.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return trimmed.substring(start, end + 1);
        }
        return trimmed;
    }

    private static String text(final JsonNode node) {
        return node == null || node.isNull() ? "" : node.asText("");
    }

    /** Review Blocker B1：结构化 factual contract 的 machine 枚举值。 */
    static final Set<String> CLAIM_TYPES = Set.of(
            "DEATH", "ALIVE_TRANSITION", "POSITION_REGION", "ENEMY_POSITION", "TACTICAL");
    static final Set<String> SIDES = Set.of("FRIENDLY", "ENEMY");
    static final Set<String> COUNT_SEMANTICS = Set.of("EXACT", "AT_LEAST", "SUBSET");
    static final Set<String> KNOWLEDGE_VALUES = Set.of("CURRENT", "LAST_KNOWN");

    /** ALIVE_TRANSITION value 机器格式（三语通用）："7v7 -> 4v6" / "7v7 → 4v6"。 */
    static final Pattern MACHINE_TRANSITION = Pattern.compile(
            "\\d+\\s*[vV]\\s*\\d+\\s*(?:->|→)\\s*\\d+\\s*[vV]\\s*\\d+");

    /**
     * 数值字段（Review Blocker B1：fail-close）：
     * 字段缺失 → {@code MISSING}；字段存在但类型/取值非法（如 {@code "112"} 字符串、
     * {@code "three"}、非正数）→ {@code INVALID}（整个 envelope 拒绝，不静默 null）。
     */
    private static NumField doubleField(final JsonNode node) {
        if (node == null || node.isNull()) {
            return NumField.MISSING;
        }
        if (!node.isNumber()) {
            return NumField.INVALID;
        }
        final double v = node.asDouble();
        if (!Double.isFinite(v) || v <= 0) {
            return NumField.INVALID;
        }
        return NumField.of(v);
    }

    /** 长整数字段（fail-close）：正整数 JSON number；类型错误 → INVALID。 */
    private static NumField longField(final JsonNode node) {
        final NumField d = doubleField(node);
        if (d != NumField.MISSING && d != NumField.INVALID) {
            final double v = d.value();
            if (v != Math.floor(v)) {
                return NumField.INVALID;
            }
        }
        return d;
    }

    /** 整数字段（fail-close）：同 {@link #doubleField}，必须为整数，且按范围校验。 */
    private static NumField intField(final JsonNode node, final int min, final int max) {
        final NumField d = doubleField(node);
        if (d != NumField.MISSING && d != NumField.INVALID) {
            final double v = d.value();
            if (v != Math.floor(v)) {
                return NumField.INVALID; // count=5.7 这类非整数 → 拒绝
            }
            final int iv = (int) v;
            if (iv < min || iv > max) {
                return NumField.INVALID;
            }
            return NumField.of(iv);
        }
        return d;
    }

    /** 数值字段结果：MISSING（缺失）/ INVALID（类型或取值非法）/ 值。 */
    private static final class NumField {
        static final NumField MISSING = new NumField(false, false, 0);
        static final NumField INVALID = new NumField(false, true, 0);
        private final boolean present;
        private final boolean invalid;
        private final double value;

        private NumField(final boolean present, final boolean invalid, final double value) {
            this.present = present;
            this.invalid = invalid;
            this.value = value;
        }

        static NumField of(final double value) {
            return new NumField(true, false, value);
        }

        boolean missing() {
            return !present && !invalid;
        }

        boolean invalid() {
            return invalid;
        }

        double value() {
            return value;
        }
    }

    private static List<String> stringList(final JsonNode node) {
        final List<String> out = new ArrayList<>();
        if (node == null || !node.isArray()) {
            return out;
        }
        for (final JsonNode item : node) {
            if (item == null || !item.isValueNode() || item.isNull()) {
                return List.of(); // 非字符串数组 → 整体视为不可用
            }
            out.add(item.asText(""));
        }
        return out;
    }

    /**
     * 可诊断解析结果（§45）：成功时 {@code envelope} 非 null、{@code failureReason} 为 null；
     * 失败时相反。不要靠 catch 后统一「parse failed」——JSON Output 启用后剩余失败类型必须可分类。
     */
    public record ParseResult(TeamReviewEnvelope envelope, ParseFailureReason failureReason) {

        static ParseResult ok(final TeamReviewEnvelope envelope) {
            return new ParseResult(envelope, null);
        }

        static ParseResult fail(final ParseFailureReason reason) {
            return new ParseResult(null, reason);
        }

        public boolean failed() {
            return envelope == null;
        }
    }

    /** 稳定低基数 parser 失败分类（§44；日志/指标使用，不记录 rawJson）。 */
    public enum ParseFailureReason {
        EMPTY_OUTPUT,
        INVALID_JSON,
        MISSING_PRIMARY_DIAGNOSIS,
        MISSING_REVIEW_MARKDOWN,
        INVALID_CLAIMS,
        UNKNOWN_CLAIM_TYPE,
        INVALID_MACHINE_FIELD_TYPE,
        MISSING_REQUIRED_MACHINE_FIELD,
        TOO_MANY_CLAIMS,
        TOO_MANY_EVIDENCE_IDS
    }
}
