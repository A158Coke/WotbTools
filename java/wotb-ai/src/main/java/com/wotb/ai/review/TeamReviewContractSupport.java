package com.wotb.ai.review;

import com.wotb.ai.gateway.AiEventLog;
import com.wotb.ai.gateway.AiChatResponse;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;

import java.util.Set;

/** Prompt and diagnostic helpers for the structured team-review contract. */
final class TeamReviewContractSupport {
    private TeamReviewContractSupport() {
    }

    static String recoverySystemPrompt(final AllowedLanguage language) {
        return TeamPromptLocalizer.systemPrompt(language)
                + switch (language) {
                    case EN -> "\n\nRECOVERY STRICTNESS: output only the canonical TeamAiReviewResult object "
                            + "described above. Root and nested objects reject extra fields; never emit unknown_field, "
                            + "repair instructions, schema metadata, or explanatory prose. Use only authoritative roster "
                            + "playerKey values supplied in the user context; omit uncertain optional references.";
                    case RU -> "\n\nСТРОГИЙ RECOVERY-КОНТРАКТ: выводите только описанный выше канонический "
                            + "объект TeamAiReviewResult. Дополнительные поля в root и вложенных объектах запрещены; "
                            + "не выводите unknown_field, инструкции repair, метаданные schema или поясняющий текст. "
                            + "Используйте только authoritative roster playerKey из контекста; сомнительные optional references опускайте.";
                    case ZH -> "\n\nRECOVERY 严格约束：只输出上方 canonical TeamAiReviewResult object。"
                            + "root 与所有 nested object 都拒绝额外字段；禁止输出 unknown_field、repair instructions、schema metadata 或解释性文本。"
                            + "playerKey 只能使用 user context 提供的 authoritative roster key；无法确认的 optional reference 直接省略。";
                };
    }

    static String recoveryUserInstruction(
            final AllowedLanguage language,
            final Set<String> rosterKeys) {
        final String roster = rosterKeys.stream().sorted().collect(java.util.stream.Collectors.joining(", "));
        return switch (language) {
            case EN -> "=== RECOVERY REQUEST ===\n"
                    + "This is the only recovery attempt. Regenerate the complete team review from the same battle context. "
                    + "Reuse the TeamAiReviewResult contract from the system message strictly: root and nested objects "
                    + "must not contain extra fields; never emit unknown_field, repair instructions, or schema/error metadata. "
                    + "Output only the final JSON object, with no Markdown fence, explanation, or commentary outside JSON. "
                    + "playerKey values must be copied verbatim from the authoritative roster key set; omit uncertain optional "
                    + "references and never guess or invent playerKey. authoritative roster key set=[" + roster + "]. "
                    + "Keep the same tactical task and authoritative battle context; do not invent new facts.";
            case RU -> "=== RECOVERY REQUEST ===\n"
                    + "Это единственная попытка recovery. Повторно сформируйте полный командный разбор на основе того же контекста боя. "
                    + "Строго используйте контракт TeamAiReviewResult из системного сообщения: в root и вложенных объектах "
                    + "запрещены дополнительные поля; не выводите unknown_field, инструкции repair или schema/error metadata. "
                    + "Выводите только итоговый JSON object без Markdown fence, объяснений и комментариев вне JSON. "
                    + "Значения playerKey должны дословно соответствовать authoritative roster key set; сомнительные optional "
                    + "references опускайте и никогда не угадывайте или не изобретайте playerKey. authoritative roster key set=[" + roster + "]. "
                    + "Сохраните ту же тактическую задачу и authoritative battle context; не добавляйте новые факты.";
            case ZH -> "=== RECOVERY REQUEST ===\n"
                    + "这是唯一一次 recovery。请基于同一战局上下文重新生成完整团队复盘。"
                    + "严格复用系统消息中的 TeamAiReviewResult contract：root 和 nested object 都禁止 extra field，"
                    + "禁止 unknown_field、repair instructions、schema/error metadata；只输出最终 JSON object，"
                    + "不要输出 Markdown fence、解释或 JSON 外 commentary。"
                    + "playerKey 只能逐字取自 authoritative roster key set；无法确认的 optional reference 直接省略，"
                    + "不得猜测或发明 playerKey。authoritative roster key set=[" + roster + "]."
                    + "保持相同战术任务和权威战局上下文，不要发明新事实。";
        };
    }

    static String failurePaths(final TeamAiReviewResultParser.ParseResult parsed) {
        return parsed.failures().stream().map(item -> pathClass(item.path()))
                .distinct().sorted().collect(java.util.stream.Collectors.joining(","));
    }

    static String failureCategories(final TeamAiReviewResultParser.ParseResult parsed) {
        return parsed.failures().stream().map(TeamAiReviewResultParser.ParseFailure::category)
                .distinct().sorted().map(Enum::name)
                .collect(java.util.stream.Collectors.joining(","));
    }

    static String recoveryReason(final TeamAiReviewResultParser.ParseResult parsed) {
        if (parsed.fatal()) {
            return switch (parsed.failure()) {
                case TeamAiReviewResultParser.Failure.EMPTY_OUTPUT -> "EMPTY_RESPONSE";
                case TeamAiReviewResultParser.Failure.INVALID_JSON,
                        TeamAiReviewResultParser.Failure.OUTPUT_TOO_LARGE -> "UNPARSEABLE_RESPONSE";
                default -> "UNPARSEABLE_RESPONSE";
            };
        }
        return "MINIMUM_CONTRACT_UNRECOVERABLE";
    }

    static String pathClass(final String path) {
        if (path == null || path.isBlank()) return "root";
        final String normalized = path.replaceAll("\\[\\d+\\]", "");
        if (normalized.startsWith("root.")) return "root.unknown_field";
        if (normalized.startsWith("summary.")) return "summary.unknown_field";
        if (normalized.startsWith("episodes.")) {
            return switch (normalized) {
                case "episodes.id" -> "episodes.id";
                case "episodes.time" -> "episodes.time";
                case "episodes.playerKeys" -> "episodes.playerKeys";
                default -> "episodes.unknown_field";
            };
        }
        if (normalized.startsWith("trainingSuggestions.")) {
            return normalized.equals("trainingSuggestions.episodeId")
                    ? "trainingSuggestions.episodeId" : "trainingSuggestions.unknown_field";
        }
        if (normalized.startsWith("reviewFocus.")) {
            return switch (normalized) {
                case "reviewFocus.playerKey" -> "reviewFocus.playerKey";
                case "reviewFocus.episodeId" -> "reviewFocus.episodeId";
                default -> "reviewFocus.unknown_field";
            };
        }
        if (normalized.startsWith("highContributors.")) {
            return switch (normalized) {
                case "highContributors.playerKey" -> "highContributors.playerKey";
                case "highContributors.episodeId" -> "highContributors.episodeId";
                default -> "highContributors.unknown_field";
            };
        }
        return switch (normalized) {
            case "episodes", "trainingSuggestions", "reviewFocus", "highContributors" -> normalized;
            default -> "root";
        };
    }

    static void logContractFailure(
            final Logger logger,
            final MeterRegistry meterRegistry,
            final String correlationId,
            final TeamAiReviewResultParser.ParseResult parsed,
            final int attempt,
            final boolean countAsSchemaFailure) {
        logger.warn(AiEventLog.line("ai_review_contract_failed", correlationId,
                "attempt", attempt,
                "failureCategory", failureCategories(parsed),
                "failureCode", parsed.failure() == null ? "UNKNOWN" : parsed.failure(),
                "failurePath", failurePaths(parsed)));
        if (meterRegistry != null && attempt == 1 && countAsSchemaFailure) {
            parsed.failures().forEach(failure -> meterRegistry.counter(
                    "wotb_ai_team_review_schema_failure_total",
                    "reason", failure.code().name(),
                    "path_class", pathClass(failure.path())).increment());
        }
    }

    static void logContractSalvage(
            final Logger logger,
            final String correlationId,
            final TeamAiReviewResultParser.ParseResult parsed) {
        final String failurePaths = failurePaths(parsed);
        logger.info(AiEventLog.line("ai_review_contract_salvage_started", correlationId,
                "failureCategory", failureCategories(parsed),
                "failureCode", parsed.failure() == null ? "UNKNOWN" : parsed.failure(),
                "failurePath", failurePaths));
        final int removedReferences = (int) parsed.failures().stream()
                .filter(failure -> failure.code() == TeamAiReviewResultParser.Failure.INVALID_REFERENCE)
                .count();
        final int removedEntries = parsed.normalizations().stream()
                .filter(normalization -> normalization.type().endsWith("_item_dropped")
                        || normalization.type().equals("training_suggestion_dropped"))
                .mapToInt(TeamAiReviewResultParser.Normalization::count)
                .sum();
        logger.info(AiEventLog.line("ai_review_contract_salvage_completed", correlationId,
                "failureCategory", failureCategories(parsed),
                "failureCode", parsed.failure() == null ? "UNKNOWN" : parsed.failure(),
                "failurePath", failurePaths,
                "removedReferences", removedReferences,
                "removedEntries", removedEntries,
                "normalizationCount", parsed.normalizations().size(),
                "result", parsed.usable() ? "SUCCESS" : "STILL_INVALID"));
    }

    static void logRecoveryTriggered(
            final Logger logger,
            final MeterRegistry meterRegistry,
            final String correlationId,
            final int primaryResponseLength,
            final String reason) {
        logger.warn(AiEventLog.line("ai_review_recovery_triggered", correlationId,
                "reason", reason, "primaryResponseLength", primaryResponseLength));
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_team_review_repair_total", "result", "triggered").increment();
        }
    }

    static void logRecoveryFailed(
            final Logger logger,
            final String correlationId,
            final String reason) {
        logger.warn(AiEventLog.line("ai_review_recovery_failed", correlationId,
                "reason", reason));
    }

    static void countRepair(final MeterRegistry meterRegistry, final String result) {
        if (meterRegistry != null) {
            meterRegistry.counter("wotb_ai_team_review_repair_total", "result", result).increment();
        }
    }

    record PrimaryAttemptMetadata(int responseLength, long inputTokens, long outputTokens) {

        static PrimaryAttemptMetadata unavailable() {
            return new PrimaryAttemptMetadata(0, 0, 0);
        }

        static PrimaryAttemptMetadata from(final AiChatResponse response) {
            return new PrimaryAttemptMetadata(response.completionText().length(),
                    response.inputTokens(), response.outputTokens());
        }
    }

}
