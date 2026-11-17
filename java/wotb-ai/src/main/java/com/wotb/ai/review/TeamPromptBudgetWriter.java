package com.wotb.ai.review;

import com.wotb.core.ai.AiTokenEstimator;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Owns mandatory/optional prompt block budgeting for Team prompt assembly. */
final class TeamPromptBudgetWriter {

    private static final String TRUNCATION_LINE = "\nLIMITATION: AI_INPUT_TRUNCATED\n";

    final StringBuilder content = new StringBuilder(4096);
    boolean truncated;

    TeamPromptBudgetWriter() {
    }

    void append(final String value) {
        if (StringUtils.hasText(value)) {
            content.append(value);
        }
    }

    void appendRequired(final String value) {
        if (StringUtils.hasText(value)) {
            content.append(value);
        }
    }

    void appendRequiredBlock(final String block) {
        if (StringUtils.hasText(block)) {
            content.append(block);
        }
    }

    String content() {
        return content.toString();
    }

    boolean isTruncated() {
        return truncated;
    }

    void markTruncated() {
        truncated = true;
    }

    TeamAiPromptBuilder.PromptInput finish(
            final AiTokenEstimator estimator,
            final int maxInputTokens,
            final Set<String> suppliedGlobalLimitations,
            final Set<String> includedIds,
            final Set<String> omittedIds,
            final Set<String> truncatedIds,
            final Map<String, List<String>> perUnitLimitations
    ) {
        final Set<String> globalLimitations = new LinkedHashSet<>(suppliedGlobalLimitations);
        // 在 finish 时估算 token 数，如果超限则标记 truncated
        if (estimator != null) {
            final String currentContent = content.toString();
            if (estimator.estimateTextTokens(currentContent) > maxInputTokens) {
                truncated = true;
            }
        }
        if (truncated) {
            globalLimitations.add("AI_INPUT_TRUNCATED");
            content.append(TRUNCATION_LINE);
        }
        return new TeamAiPromptBuilder.PromptInput(
                content.toString(),
                includedIds,
                omittedIds,
                truncatedIds,
                perUnitLimitations,
                new ArrayList<>(globalLimitations));
    }
}
