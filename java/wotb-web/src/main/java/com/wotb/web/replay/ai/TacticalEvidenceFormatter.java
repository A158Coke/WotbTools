package com.wotb.web.replay.ai;

import com.wotb.core.replay.evidence.AiEvidence;
import com.wotb.core.replay.evidence.EntityRef;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * 把确定性证据渲染成 Call #2 Prompt 的中文证据段。
 * 数值 key 排序输出，保证确定性；所有时间统一使用 {@code X分XX秒}。
 */
final class TacticalEvidenceFormatter {

    private TacticalEvidenceFormatter() {
    }

    /**
     * 按给定证据列表渲染（调用方可先做 partial 过滤，避免把换血伤害数字送入 LLM）。
     */
    static String renderEvidenceSections(final List<AiEvidence> evidence) {
        final StringBuilder sb = new StringBuilder(2048);
        final List<AiEvidence> sorted = new ArrayList<>(evidence);
        sorted.sort(Comparator.comparingDouble(AiEvidence::startSec));
        for (final AiEvidence e : sorted) {
            sb.append("  ").append(PlayerAnalysisTerms.battleRange(e.startSec(), e.endSec()))
                    .append(" [").append(e.type().name()).append("] ")
                    .append(e.summary());
            if (e.confidence() != null) {
                sb.append(" | 置信度=").append(PlayerAnalysisTerms.confidenceLabel(e.confidence()));
            }
            sb.append('\n');
            final String numbers = renderNumbers(e.numbers());
            if (!numbers.isBlank()) {
                sb.append("      ").append(numbers).append('\n');
            }
            if (e.entities() != null && !e.entities().isEmpty()) {
                sb.append("      涉及: ")
                        .append(String.join(", ", e.entities().stream()
                                .map(EntityRef::label)
                                .toList()))
                        .append('\n');
            }
        }
        return sb.toString();
    }

    static String renderWindow(final AiEvidence window, final boolean withDetail) {
        final StringBuilder sb = new StringBuilder(256);
        sb.append("WINDOW ").append(PlayerAnalysisTerms.battleRange(window.startSec(), window.endSec()))
                .append(" priority=").append(window.priority().name())
                .append(" confidence=").append(PlayerAnalysisTerms.confidenceLabel(window.confidence()))
                .append('\n');
        sb.append("  ").append(window.summary()).append('\n');
        if (withDetail) {
            final String numbers = renderNumbers(window.numbers());
            if (!numbers.isBlank()) {
                sb.append("  ").append(numbers).append('\n');
            }
            if (window.labels() != null && !window.labels().isEmpty()) {
                sb.append("  labels=").append(renderLabels(window.labels())).append('\n');
            }
            sb.append("  provenance=").append(window.provenance().name()).append('\n');
        }
        return sb.toString();
    }

    private static String renderNumbers(final Map<String, Double> numbers) {
        if (numbers == null || numbers.isEmpty()) {
            return "";
        }
        final List<String> keys = new ArrayList<>(numbers.keySet());
        keys.sort(String::compareTo);
        final StringBuilder sb = new StringBuilder();
        for (final String key : keys) {
            if (sb.length() > 0) {
                sb.append(" ");
            }
            sb.append(key).append('=').append(formatNumber(numbers.get(key)));
        }
        return sb.toString();
    }

    private static String renderLabels(final Map<String, String> labels) {
        final List<String> keys = new ArrayList<>(labels.keySet());
        keys.sort(String::compareTo);
        final StringBuilder sb = new StringBuilder();
        for (final String key : keys) {
            if (sb.length() > 0) {
                sb.append(" ");
            }
            sb.append(key).append('=').append(labels.get(key));
        }
        return sb.toString();
    }

    private static String formatNumber(final Double value) {
        if (value == null || !Double.isFinite(value)) {
            return "UNKNOWN";
        }
        if (value == Math.rint(value)) {
            return String.valueOf(value.longValue());
        }
        return String.format("%.1f", value);
    }
}
