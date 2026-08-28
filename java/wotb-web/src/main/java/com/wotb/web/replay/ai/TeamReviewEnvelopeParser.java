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
 * <p>Observability（docs/features/team-ai-review.md §44/§45）：{@link #parseDetailed(String)} 返回
 * 可诊断的 {@link ParseResult}，携带稳定低基数 {@link ParseFailureReason}——启用 DeepSeek
 * JSON Output 后剩余的 parser failure 类型必须可机器分类，不能只看到笼统的 null。
 * 字符串数组字段（evidenceIds / supportingEvidenceIds）区分 MISSING（缺失）/ INVALID（存在但
 * 类型或元素非法，如字符串整体、{@code [{}]}、{@code [null]}）/ VALID（合法，可为空数组）三态，
 * malformed 字段进入 INVALID_MACHINE_FIELD_TYPE 而非误报 MISSING_REQUIRED_MACHINE_FIELD；
 * 合法 {@code []} 仍是合法空引用列表（factual claim 要求非空时才 → MISSING_REQUIRED_MACHINE_FIELD）。</p>
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
            // PR #106 review：supportingEvidenceIds 存在但不是合法字符串数组 → schema/type failure，
            // 不允许静默退化为空数组并 PASS（missing 仍合法——该字段可选）。
            final StringListField supportingIds = stringListField(diagnosis.get("supportingEvidenceIds"));
            if (supportingIds.invalid()) {
                return ParseResult.fail(ParseFailureReason.INVALID_MACHINE_FIELD_TYPE);
            }
            final TeamReviewEnvelope.PrimaryDiagnosis primary =
                    new TeamReviewEnvelope.PrimaryDiagnosis(
                            title, reasoning, supportingIds.missing() ? List.of() : supportingIds.value());
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
                    // PR #106 review：evidenceIds 必须区分缺失 / 类型非法 / 合法（含空数组）。
                    // malformed（字符串整体 / [{}] / [null] / number/boolean 元素）→ schema/type
                    // failure（INVALID_MACHINE_FIELD_TYPE），绝不静默视为「空」或误报
                    // MISSING_REQUIRED_MACHINE_FIELD；合法 [] 仍按空引用列表处理。
                    final StringListField evidenceIdsField = stringListField(item.get("evidenceIds"));
                    if (evidenceIdsField.invalid()) {
                        return ParseResult.fail(ParseFailureReason.INVALID_MACHINE_FIELD_TYPE);
                    }
                    final List<String> ids = evidenceIdsField.missing() ? List.of() : evidenceIdsField.value();
                    if (ids.size() > MAX_IDS_PER_CLAIM) {
                        return ParseResult.fail(ParseFailureReason.TOO_MANY_EVIDENCE_IDS);
                    }
                    // Review Blocker B1：structured factual contract（fail-close，P0-4 容错）——
                    // claimType 必填且必须属于 schema；缺失/未知时按机器字段确定性推断（能
                    // deterministic 修复的 schema 缺失不浪费 LLM retry）；显式禁止类型（LOS 等）
                    // 一律拒绝；每种 factual claimType 的 required machine 字段必须齐全；机器
                    // 字段类型/取值非法（如 region="six"、timeSec="112"）→ 整体拒绝。
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
                    final String rawClaimType = text(item.get("claimType")).toUpperCase(java.util.Locale.ROOT);
                    // V6m 边界：显式禁止类型（LOS/SPOTTING/VISION/LINE_OF_SIGHT）——正文也不允许
                    // 硬事实化表达，这里保持 fail-close（不推断、不降级）。
                    if (BANNED_CLAIM_TYPES.contains(rawClaimType)) {
                        return ParseResult.fail(ParseFailureReason.UNKNOWN_CLAIM_TYPE);
                    }
                    // P0-4：claimType 缺失 / 未知变体（如 DEATHS、ALIVE_COUNT_TRANSITION 全名）→
                    // 按机器字段确定性推断；纯文本陈述（无任何 factual 机器字段）降级 TACTICAL，
                    // 由 validator 的正文 deterministic 检查兜底（不浪费 LLM retry）。
                    final String claimType = CLAIM_TYPES.contains(rawClaimType)
                            ? rawClaimType
                            : inferClaimType(timeSecF, regionF, countF,
                                    subject, value, side, countSemantics, knowledge);
                    // per-claimType required fields（fail-close；推断类型同样校验）
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

    /** V6m 边界：显式禁止的 claimType（后端无对应 evidence kind）——不推断、不降级，一律拒绝。 */
    static final Set<String> BANNED_CLAIM_TYPES = Set.of(
            "LOS", "SPOTTING", "VISION", "LINE_OF_SIGHT");
    static final Set<String> SIDES = Set.of("FRIENDLY", "ENEMY");
    static final Set<String> COUNT_SEMANTICS = Set.of("EXACT", "AT_LEAST", "SUBSET");
    static final Set<String> KNOWLEDGE_VALUES = Set.of("CURRENT", "LAST_KNOWN");

    /** ALIVE_TRANSITION value 机器格式（三语通用）："7v7 -> 4v6" / "7v7 → 4v6"。 */
    static final Pattern MACHINE_TRANSITION = Pattern.compile(
            "\\d+\\s*[vV]\\s*\\d+\\s*(?:->|→)\\s*\\d+\\s*[vV]\\s*\\d+");


    /**
     * P0-4：claimType 缺失 / 未知变体时的 deterministic 推断（不浪费 LLM retry）。
     * 按机器字段唯一性从具体到抽象推断：knowledge → ENEMY_POSITION；region+count+side+
     * countSemantics → POSITION_REGION；value 机器存活变化 → ALIVE_TRANSITION；
     * subject+timeSec → DEATH；纯文本陈述（无任何 factual 机器字段）→ TACTICAL。
     * <p>推断基于机器字段，不猜测正文语义；推断出的类型仍走 per-claimType required
     * 校验（缺必需字段仍 fail-close）。禁止类型（LOS 等）由调用方先行拒绝，不进本方法。</p>
     */
    private static String inferClaimType(final NumField timeSecF,
                                         final NumField regionF,
                                         final NumField countF,
                                         final String subject,
                                         final String value,
                                         final String side,
                                         final String countSemantics,
                                         final String knowledge) {
        if (!knowledge.isEmpty() && KNOWLEDGE_VALUES.contains(knowledge)) {
            return "ENEMY_POSITION";
        }
        if (!regionF.missing() && !countF.missing()
                && SIDES.contains(side) && COUNT_SEMANTICS.contains(countSemantics)) {
            return "POSITION_REGION";
        }
        if (!value.isBlank() && MACHINE_TRANSITION.matcher(value).matches()) {
            return "ALIVE_TRANSITION";
        }
        if (!subject.isBlank() && !timeSecF.missing()) {
            return "DEATH";
        }
        return "TACTICAL";
    }

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

    /**
     * 字符串数组字段（evidenceIds / supportingEvidenceIds）解析（PR #106 review）：
     * <ul>
     *   <li>字段缺失 / JSON null → {@link StringListField#MISSING}（与 {@link NumField} 的 null 语义一致）；</li>
     *   <li>字段存在但不是 array，或 array 元素不是 JSON string（object/null/number/boolean）→
     *       {@link StringListField#INVALID}（schema/type failure，调用方按 INVALID_MACHINE_FIELD_TYPE 拒绝）；</li>
     *   <li>合法 array（可为空 {@code []}）→ {@link StringListField#VALID}。</li>
     * </ul>
     * 不再用空 List 同时表达 missing / invalid / valid-empty——否则 malformed evidenceIds 会被误报为
     * MISSING_REQUIRED_MACHINE_FIELD，或 supportingEvidenceIds 类型错误静默 PASS。
     */
    private static StringListField stringListField(final JsonNode node) {
        if (node == null || node.isNull()) {
            return StringListField.MISSING;
        }
        if (!node.isArray()) {
            return StringListField.INVALID;
        }
        final List<String> out = new ArrayList<>(node.size());
        for (final JsonNode item : node) {
            if (item == null || !item.isTextual()) {
                return StringListField.INVALID;
            }
            out.add(item.asText(""));
        }
        return StringListField.valid(out);
    }

    /**
     * 字符串数组字段解析状态（PR #106 review）：MISSING（缺失）/ INVALID（存在但类型或元素非法）/
     * VALID（合法，可为空数组）。与 {@link NumField} 同构，保证 missing 与 malformed 可区分。
     */
    private static final class StringListField {
        static final StringListField MISSING = new StringListField(false, false, List.of());
        static final StringListField INVALID = new StringListField(false, true, List.of());
        private final boolean present;
        private final boolean invalid;
        private final List<String> value;

        private StringListField(final boolean present, final boolean invalid, final List<String> value) {
            this.present = present;
            this.invalid = invalid;
            this.value = value;
        }

        static StringListField valid(final List<String> value) {
            return new StringListField(true, false, value);
        }

        boolean missing() {
            return !present && !invalid;
        }

        boolean invalid() {
            return invalid;
        }

        List<String> value() {
            return value;
        }
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
