package com.wotb.web.replay.ai;

import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.replay.evidence.TeamAiReviewResult;
import com.wotb.core.replay.evidence.TeamGroundingFacts;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import com.wotb.web.config.AiModelProperties;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiChatResponse;
import com.wotb.web.replay.ai.gateway.AiResponseFormat;
import com.wotb.web.replay.ai.gateway.SpringAiChatGateway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.wotb.web.replay.ai.eval.TeamQualityGoldEvaluator;
import com.wotb.web.replay.ai.eval.TeamReplayQualityCase;
import com.wotb.web.replay.ai.eval.TeamReplayQualityCaseLoader;

import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * Explicit manual real-replay benchmark. The class intentionally has no Test
 * suffix, is ai-live tagged, and requires enabled + case/all + API key before a
 * provider object is created. It never adds gold text or an evaluation scenario
 * to the production prompt.
 *
 * Example (PowerShell, from java):
 * {@code $env:AI_API_KEY = "..."; mvn -pl wotb-web -am test
 * "-Dtest=TeamReplayQualityBenchmarkRunner" "-Dai.quality.enabled=true"
 * "-Dai.quality.case=A-flank-local-propagation"}
 */
@Tag("ai-live")
public class TeamReplayQualityBenchmarkRunner {

    private static final String REPORT_BASE = "team-replay-quality-report";
    private static final String PROMPT_VERSION = "team-single-reasoning-contract-v1";
    private static final int MAX_RUNS = 10;
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    @Test
    void runExplicitBenchmark() throws Exception {
        Assumptions.assumeTrue(Boolean.parseBoolean(
                        System.getProperty("ai.quality.enabled", "false")),
                "manual benchmark disabled; set -Dai.quality.enabled=true");
        final List<TeamReplayQualityCase> cases = selectedCases();
        final String apiKey = System.getenv("AI_API_KEY");
        Assumptions.assumeTrue(apiKey != null && !apiKey.isBlank(), "AI_API_KEY env missing");
        final int runs = runs();
        final String model = System.getenv().getOrDefault("AI_MODEL", "deepseek-v4-flash");
        final AiModelProperties properties = new AiModelProperties(
                apiKey,
                System.getenv().getOrDefault("AI_BASE_URL", "https://api.deepseek.com"),
                model,
                10, 120, 200, 1, 1000, 8000, 2.0,
                1_000_000, 940_000, 32768, 16384,
                false, "max", false, 4096);
        final SpringAiChatGateway gateway = SpringAiChatGateway.fromProperties(properties, null);
        final List<BenchmarkResult> results = new ArrayList<>();
        for (final TeamReplayQualityCase qualityCase : cases) {
            for (int run = 1; run <= runs; run++) {
                results.add(runCase(gateway, model, qualityCase, run));
            }
        }
        assertFalse(results.isEmpty(), "explicit benchmark must execute at least one case");
        writeReports(model, runs, results);
    }

    private static List<TeamReplayQualityCase> selectedCases() {
        final boolean all = Boolean.parseBoolean(System.getProperty("ai.quality.all", "false"));
        final String selected = System.getProperty("ai.quality.case", "").trim();
        if (!all && selected.isBlank()) {
            throw new IllegalArgumentException(
                    "provider benchmark requires explicit -Dai.quality.case=... or -Dai.quality.all=true");
        }
        if (all) {
            return TeamReplayQualityCaseLoader.loadAll();
        }
        return java.util.Arrays.stream(selected.split(","))
                .map(String::trim)
                .filter(value -> !value.isBlank())
                .map(TeamReplayQualityCaseLoader::load)
                .toList();
    }

    private static int runs() {
        final int runs = Integer.parseInt(System.getProperty("ai.quality.runs", "1"));
        if (runs < 1 || runs > MAX_RUNS) {
            throw new IllegalArgumentException("ai.quality.runs must be between 1 and " + MAX_RUNS);
        }
        return runs;
    }

    private static BenchmarkResult runCase(final SpringAiChatGateway gateway,
                                            final String model,
                                            final TeamReplayQualityCase qualityCase,
                                            final int run) throws IOException {
        final ReplayFactsFixtures.Facts processed = ReplayFactsFixtures.load(qualityCase.replay());
        final SingleTeamBattleAnalysisContext context = TeamContextBuilder.buildSingleTeamContext(
                processed.battle(), processed.reconstruction());
        final BattleTimelineResult timelineResult = BattleTimelineBuilder.build(
                context.battle(), context.reconstruction(), TimelinePerspective.team(context.perspectiveTeam()));
        if (!timelineResult.usable()) {
            return BenchmarkResult.failed(qualityCase, model, run,
                    "timeline unavailable: " + timelineResult.validation().errors());
        }
        final TeamGroundingFacts.GroundingFacts facts = TeamGroundingFacts.build(
                context.battle(), timelineResult.timeline(), context.perspectiveTeam());
        final String systemPrompt = TeamPromptLocalizer.localizeTeamSystemPrompt(
                TeamPromptLocalizer.SINGLE_TEAM_PROMPT, AllowedLanguage.ZH);
        final String userPrompt = TeamAiPromptBuilder.single(
                context, List.of(), null, new ConservativeDeepSeekTokenEstimator(),
                940_000, timelineResult.timeline()).content()
                + "\n" + TeamGroundingFacts.renderGroundingSection(facts);
        final AiChatResponse response;
        try {
            response = gateway.stream(new AiChatRequest(
                    systemPrompt, userPrompt, model, null, 4096, false, null, null,
                    "SINGLE_TEAM_BATTLE", 200, AiResponseFormat.JSON_OBJECT), delta -> { });
        } catch (final RuntimeException e) {
            return BenchmarkResult.failed(qualityCase, model, run,
                    e.getClass().getSimpleName() + ": " + safeMessage(e));
        }
        final TeamAiReviewResultParser.ParseResult parsed = TeamAiReviewResultParser.parse(
                response.completionText(), TeamRosterResolver.playerKeys(context));
        if (!parsed.usable()) {
            return BenchmarkResult.failed(qualityCase, model, run, "parse: " + parsed.failure());
        }
        final TeamAiReviewResult structured = parsed.result();
        final boolean contractPass = parsed.usable();
        final Map<String, Object> scores = new LinkedHashMap<>();
        // v0.5 contract：parser 可产出 minimum contract（summary + episodes）即为通过；
        // normalized 表示发生了确定性 salvage。legacy envelope 的 grounding validator /
        // structural shortcut validator 已随 legacy 契约层删除，不再参与评分（见 ai-evaluation 文档）。
        scores.put("contract", parsed.normalized() ? 1 : 2);
        final String review = reviewText(structured);
        final TeamQualityGoldEvaluator.Evaluation gold = TeamQualityGoldEvaluator.evaluate(qualityCase, review);
        scores.put("informationReasoning", score(review, "信息|information|vision|视野"));
        scores.put("objectiveReasoning", score(review, "目标|占点|点数|objective|points"));
        scores.put("localEngagement", score(review, "局部|交火|侧翼|local|engagement"));
        scores.put("crossLocalPropagation", score(review, "传播|主力|释放|交叉|propagation|crossfire"));
        scores.put("positionTempo", score(review, "位置|节奏|推进|轮转|position|tempo|rotation"));
        scores.put("settlementDiscipline", gold.mustNotViolations().isEmpty() ? 2 : 0);
        scores.put("causalDepth", gold.mustNoticeMisses().isEmpty() ? 2 : 1);
        scores.put("coachingUsefulness", review.contains("建议") || review.contains("复查")
                || review.toLowerCase(java.util.Locale.ROOT).contains("recommend") ? 2 : 0);
        scores.put("naturalChinese", review.codePoints().anyMatch(value -> value >= 0x4E00 && value <= 0x9FFF) ? 2 : 0);
        return new BenchmarkResult(qualityCase.id(), model, run, contractPass,
                parsed.failures().stream().map(failure -> failure.code().name()).distinct().toList(),
                scores, average(scores), gold.mustNoticeHits(), gold.mustNoticeMisses(),
                gold.mustNotViolations(), review, "");
    }

    /**
     * v0.5 structured result → 参与 gold / lexical 评分的正文文本：
     * summary 摘要 + episode 标题与分析 + 训练建议（legacy {@code reviewMarkdown} 的等价载体）。
     */
    private static String reviewText(final TeamAiReviewResult result) {
        final StringBuilder text = new StringBuilder();
        if (result.summary() != null) {
            text.append(nullSafe(result.summary().verdict())).append('\n')
                    .append(nullSafe(result.summary().primaryDiagnosis())).append('\n');
        }
        for (final TeamAiReviewResult.Episode episode : result.episodes()) {
            text.append(nullSafe(episode.title())).append('\n')
                    .append(nullSafe(episode.analysis())).append('\n');
        }
        for (final TeamAiReviewResult.TrainingSuggestion suggestion : result.trainingSuggestions()) {
            text.append(nullSafe(suggestion.title())).append('\n')
                    .append(nullSafe(suggestion.content())).append('\n');
        }
        return text.toString();
    }

    private static String nullSafe(final String value) {
        return value == null ? "" : value;
    }

    private static void writeReports(final String model, final int runs,
                                     final List<BenchmarkResult> results) throws IOException {
        final Path dir = Path.of("target", "ai-eval-report");
        Files.createDirectories(dir);
        final String gitSha = gitSha();
        final Path baselinePath = Path.of(System.getProperty("ai.quality.baseline",
                dir.resolve("team-replay-quality-baseline.json").toString()));
        final Double baselineOverall = readBaselineOverall(baselinePath);
        final double candidateOverall = results.stream().mapToDouble(BenchmarkResult::overall).average().orElse(0);
        final Map<String, Object> report = new LinkedHashMap<>();
        report.put("metadata", Map.of(
                "model", model,
                "promptVersion", PROMPT_VERSION,
                "gitSha", gitSha,
                "generatedAt", Instant.now().toString(),
                "runsPerCase", runs,
                "judge", "deterministic-only"));
        final Map<String, Object> comparison = new LinkedHashMap<>();
        comparison.put("baselinePath", baselinePath.toString());
        comparison.put("baselinePresent", baselineOverall != null);
        comparison.put("baselineOverall", baselineOverall);
        comparison.put("candidateOverall", candidateOverall);
        report.put("baselineComparison", comparison);
        report.put("summary", summary(results));
        report.put("results", results);
        Files.writeString(dir.resolve(REPORT_BASE + ".json"),
                MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(report), StandardCharsets.UTF_8);
        final StringBuilder markdown = new StringBuilder("# Team replay quality benchmark\n\n");
        markdown.append("model: ").append(model).append("\n")
                .append("promptVersion: ").append(PROMPT_VERSION).append("\n")
                .append("gitSha: ").append(gitSha).append("\n")
                .append("judge: deterministic-only\n\n");
        markdown.append("| case | mean | min | max | variance |\n|---|---:|---:|---:|---:|\n");
        for (final Map.Entry<String, Map<String, Double>> entry : summary(results).entrySet()) {
            markdown.append("| ").append(entry.getKey())
                    .append(" | ").append(entry.getValue().get("mean"))
                    .append(" | ").append(entry.getValue().get("min"))
                    .append(" | ").append(entry.getValue().get("max"))
                    .append(" | ").append(entry.getValue().get("variance"))
                    .append(" |\n");
        }
        markdown.append("\n");
        markdown.append("| case | run | contract | overall |\n|---|---:|---|---:|\n");
        for (final BenchmarkResult result : results) {
            markdown.append("| ").append(result.caseId()).append(" | ").append(result.run())
                    .append(" | ").append(result.contractPass() ? "PASS" : "FAIL")
                    .append(" | ").append(result.overall()).append(" |\n");
        }
        markdown.append("\nGold must_notice hits/misses and must_not violations are report-only lexical preflight;\n")
                .append("they are not a semantic tactical judge.\n");
        for (final BenchmarkResult result : results) {
            markdown.append("- ").append(result.caseId()).append(" run ").append(result.run())
                    .append(": notice hits=").append(result.mustNoticeHits())
                    .append(", notice misses=").append(result.mustNoticeMisses())
                    .append(", must_not violations=").append(result.mustNotViolations()).append("\n");
        }
        markdown.append("\nBaseline overall: ").append(baselineOverall)
                .append("; candidate overall: ").append(candidateOverall).append(".\n");
        Files.writeString(dir.resolve(REPORT_BASE + ".md"), markdown, StandardCharsets.UTF_8);
    }

    private static Map<String, Map<String, Double>> summary(final List<BenchmarkResult> results) {
        final Map<String, List<Double>> byCase = new LinkedHashMap<>();
        for (final BenchmarkResult result : results) {
            byCase.computeIfAbsent(result.caseId(), ignored -> new ArrayList<>()).add(result.overall());
        }
        final Map<String, Map<String, Double>> summary = new LinkedHashMap<>();
        for (final Map.Entry<String, List<Double>> entry : byCase.entrySet()) {
            final List<Double> values = entry.getValue();
            final double mean = values.stream().mapToDouble(Double::doubleValue).average().orElse(0);
            final double variance = values.stream().mapToDouble(value -> Math.pow(value - mean, 2)).average().orElse(0);
            final Map<String, Double> stats = new LinkedHashMap<>();
            stats.put("mean", mean);
            stats.put("min", values.stream().mapToDouble(Double::doubleValue).min().orElse(0));
            stats.put("max", values.stream().mapToDouble(Double::doubleValue).max().orElse(0));
            stats.put("variance", variance);
            summary.put(entry.getKey(), stats);
        }
        return summary;
    }

    private static Double readBaselineOverall(final Path path) {
        if (!Files.isRegularFile(path)) {
            return null;
        }
        try {
            final JsonNode node = MAPPER.readTree(Files.readString(path, StandardCharsets.UTF_8));
            final JsonNode comparison = node == null ? null : node.get("baselineComparison");
            final JsonNode candidate = comparison == null ? null : comparison.get("candidateOverall");
            return candidate == null || !candidate.isNumber() ? null : candidate.asDouble();
        } catch (final IOException | RuntimeException ignored) {
            return null;
        }
    }

    private static double average(final Map<String, Object> scores) {
        return scores.values().stream().filter(Number.class::isInstance)
                .mapToDouble(value -> ((Number) value).doubleValue()).average().orElse(0);
    }

    private static int score(final String review, final String markers) {
        final String text = review == null ? "" : review.toLowerCase(java.util.Locale.ROOT);
        return text.matches("(?s).*?(?:" + markers + ").*?(?:" + markers + ").*?") ? 2
                : text.matches("(?s).*?(?:" + markers + ").*?") ? 1 : 0;
    }

    private static String gitSha() {
        try {
            final Process process = new ProcessBuilder("git", "rev-parse", "HEAD").redirectErrorStream(true).start();
            final String value = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            process.waitFor();
            return value.isBlank() ? "unknown" : value;
        } catch (final Exception ignored) {
            return "unknown";
        }
    }

    private static String safeMessage(final RuntimeException exception) {
        final String message = exception.getMessage();
        return message == null ? "no message" : message.replaceAll("(?i)api[_ -]?key|authorization|bearer\\s+\\S+", "[REDACTED]");
    }

    public record BenchmarkResult(
            String caseId,
            String model,
            int run,
            boolean contractPass,
            List<String> contractFailures,
            Map<String, Object> dimensionScores,
            double overall,
            List<String> mustNoticeHits,
            List<String> mustNoticeMisses,
            List<String> mustNotViolations,
            String finalReview,
            String error
    ) {
        public BenchmarkResult {
            contractFailures = contractFailures == null ? List.of() : List.copyOf(contractFailures);
            dimensionScores = dimensionScores == null ? Map.of()
                    : Collections.unmodifiableMap(new LinkedHashMap<>(dimensionScores));
            mustNoticeHits = mustNoticeHits == null ? List.of() : List.copyOf(mustNoticeHits);
            mustNoticeMisses = mustNoticeMisses == null ? List.of() : List.copyOf(mustNoticeMisses);
            mustNotViolations = mustNotViolations == null ? List.of() : List.copyOf(mustNotViolations);
        }

        static BenchmarkResult failed(final TeamReplayQualityCase qualityCase,
                                      final String model, final int run, final String error) {
            final Map<String, Object> scores = new LinkedHashMap<>();
            scores.put("contract", 0);
            return new BenchmarkResult(qualityCase.id(), model, run, false, List.of(),
                    scores, 0, List.of(), qualityCase.mustNotice(), qualityCase.mustNot(), "", error);
        }
    }
}
