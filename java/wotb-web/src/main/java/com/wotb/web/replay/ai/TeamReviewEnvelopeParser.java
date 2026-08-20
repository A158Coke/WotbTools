package com.wotb.web.replay.ai;

import com.wotb.core.replay.evidence.TeamReviewEnvelope;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;

/**
 * 解析并严格验证 Team Call #2 的 structured JSON envelope
 * （Natural Coach 轮：{@code primaryDiagnosis} + {@code reviewMarkdown} + {@code claims}）。
 * <p>容忍 markdown 代码围栏与 LLM 在 JSON 前后附加的说明文字；但任何契约不成立
 * （reviewMarkdown 为空 / primaryDiagnosis 缺 title 或 reasoning / claims 非数组 /
 * evidenceIds 非字符串数组）时返回 {@code null}，由编排器把「输出必须是合法 JSON envelope」
 * 反馈给 LLM 重写（targeted rewrite → full rewrite → fail-safe）。</p>
 */
public final class TeamReviewEnvelopeParser {

    static final int MAX_CLAIMS = 40;
    static final int MAX_IDS_PER_CLAIM = 20;

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private TeamReviewEnvelopeParser() {
    }

    /** 解析 LLM 输出为 envelope；契约不成立时返回 null。 */
    public static TeamReviewEnvelope parse(final String output) {
        if (output == null || output.isBlank()) {
            return null;
        }
        try {
            final JsonNode root = MAPPER.readTree(extractJson(output));
            if (root == null || !root.isObject()) {
                return null;
            }
            final JsonNode diagnosis = root.get("primaryDiagnosis");
            if (diagnosis == null || !diagnosis.isObject()) {
                return null;
            }
            final String title = text(diagnosis.get("title"));
            final String reasoning = text(diagnosis.get("reasoning"));
            if (title.isBlank() || reasoning.isBlank()) {
                return null;
            }
            final TeamReviewEnvelope.PrimaryDiagnosis primary =
                    new TeamReviewEnvelope.PrimaryDiagnosis(
                            title, reasoning, stringList(diagnosis.get("supportingEvidenceIds")));
            final String reviewMarkdown = text(root.get("reviewMarkdown"));
            if (reviewMarkdown.isBlank()) {
                return null;
            }
            final JsonNode claimsNode = root.get("claims");
            if (claimsNode != null && !claimsNode.isArray()) {
                return null;
            }
            final List<TeamReviewEnvelope.Claim> claims = new ArrayList<>();
            if (claimsNode != null) {
                if (claimsNode.size() > MAX_CLAIMS) {
                    return null;
                }
                for (final JsonNode item : claimsNode) {
                    if (item == null || !item.isObject()) {
                        return null;
                    }
                    final String claimText = text(item.get("text"));
                    if (claimText.isBlank()) {
                        return null;
                    }
                    final List<String> ids = stringList(item.get("evidenceIds"));
                    if (ids.size() > MAX_IDS_PER_CLAIM) {
                        return null;
                    }
                    // Review B1-2：可选机器校验字段（timeSec/region/count/subject/value/claimType）
                    // 容忍缺失（纯战术观点可无机器字段）；类型不符时按缺失处理而非整体拒绝。
                    final Double timeSec = doubleOrNull(item.get("timeSec"));
                    final Integer region = intOrNull(item.get("region"));
                    final Integer count = intOrNull(item.get("count"));
                    final String subject = text(item.get("subject"));
                    final String value = text(item.get("value"));
                    final String claimType = text(item.get("claimType"));
                    claims.add(new TeamReviewEnvelope.Claim(
                            claimText, ids,
                            claimType.isBlank() ? null : claimType,
                            timeSec, region, count,
                            subject.isBlank() ? null : subject,
                            value.isBlank() ? null : value));
                }
            }
            final TeamReviewEnvelope envelope =
                    new TeamReviewEnvelope(primary, reviewMarkdown, claims);
            return envelope.hasContent() ? envelope : null;
        } catch (final Exception e) {
            return null;
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

    /** 数值字段（机器格式）；缺失/非数值 → null（容忍，不拒绝整个 claim）。 */
    private static Double doubleOrNull(final JsonNode node) {
        if (node == null || node.isNull() || !node.isNumber()) {
            return null;
        }
        final double v = node.asDouble();
        return Double.isFinite(v) && v > 0 ? v : null;
    }

    /** 整数字段（机器格式）；缺失/非整数 → null（容忍）。 */
    private static Integer intOrNull(final JsonNode node) {
        if (node == null || node.isNull() || !node.isNumber()) {
            return null;
        }
        final int v = node.asInt();
        return v > 0 ? v : null;
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
}