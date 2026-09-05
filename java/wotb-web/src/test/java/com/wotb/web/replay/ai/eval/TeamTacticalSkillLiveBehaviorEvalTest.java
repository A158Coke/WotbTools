package com.wotb.web.replay.ai.eval;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.replay.evidence.TeamFactualConsistencyValidator;
import com.wotb.core.replay.evidence.TeamGroundingFacts;
import com.wotb.core.replay.evidence.TeamReviewEnvelope;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import com.wotb.web.config.AiModelProperties;
import com.wotb.web.replay.ai.AiPromptLibrary;
import com.wotb.web.replay.ai.TeamReviewEnvelopeParser;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiChatResponse;
import com.wotb.web.replay.ai.gateway.AiResponseFormat;
import com.wotb.web.replay.ai.gateway.SpringAiChatGateway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Opt-in DeepSeek behavior evaluation for Tactical Skill v0.1.
 *
 * <p>This is deliberately a live-provider test, not a default CI test. It sends
 * the existing Team Call #2 JSON request through {@link SpringAiChatGateway},
 * parses the final envelope, and checks the final model text against explicit
 * behavior contracts. The A-H prompt golden cases remain a separate static
 * contract suite and are not treated as behavior evidence.</p>
 *
 * <p>Run from {@code java} after supplying the key out of band:
 * {@code $env:AI_API_KEY = "..."; mvn -pl wotb-web -am test
 * "-Dtest=TeamTacticalSkillLiveBehaviorEvalTest"
 * "-Dai.probe.excludedGroups=" "-Dai.tactical.live.enabled=true"}</p>
 */
@Tag("ai-live")
class TeamTacticalSkillLiveBehaviorEvalTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String PROVIDER_NAME = "DeepSeek";
    private static final String REPORT_BASENAME = "team-tactical-skill-live-report";
    private static final int CONNECT_TIMEOUT_SEC = 10;
    private static final int READ_TIMEOUT_SEC = 120;
    private static final int CALL_TIMEOUT_SEC = 200;
    private static final int RETRY_MAX_ATTEMPTS = 1;
    private static final long RETRY_INITIAL_BACKOFF_MILLIS = 1_000;
    private static final long RETRY_MAX_BACKOFF_MILLIS = 8_000;
    private static final double RETRY_BACKOFF_MULTIPLIER = 2.0;
    private static final int CONTEXT_WINDOW_TOKENS = 1_000_000;
    private static final int MAX_INPUT_TOKENS = 940_000;
    private static final int MAX_OUTPUT_TOKENS = 32_768;
    private static final int PROMPT_SAFETY_MARGIN_TOKENS = 16_384;
    private static final int TEAM_REVIEW_MAX_OUTPUT_TOKENS = 4_096;
    private static final int REQUEST_COMPLETION_TOKENS = 200;
    private static final Pattern COMMUNICATION_ATTRIBUTION = Pattern.compile(
            "沟通(?:失误|问题|责任|导致|不到位|不畅)|通信(?:失误|问题|责任|导致)|"
                    + "语音(?:失误|问题|责任|导致)|call(?:失误|问题|责任|导致)|"
                    + "指挥(?:失误|问题|责任|导致)|"
                    + "(?:因为|由于|归因于|blame|due to)[^。；\\n]{0,12}"
                    + "(?:沟通|通信|语音|call|指挥|communication|voice|commander)",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern PRESCRIPTIVE_RETREAT = Pattern.compile(
            "(必须|应该|应当|立即|立刻)([^。；\\n]{0,8})?(撤退|回撤)");
    private static final Map<String, BehaviorSpec> SPECS = specs();

    @Test
    void tacticalSkillBehaviorIsEvaluatedAgainstFinalProviderOutput() throws Exception {
        Assumptions.assumeTrue(Boolean.parseBoolean(
                        System.getProperty("ai.tactical.live.enabled", "false")),
                "explicit opt-in required: -Dai.tactical.live.enabled=true");
        final String apiKey = System.getenv("AI_API_KEY");
        Assumptions.assumeTrue(apiKey != null && !apiKey.isBlank(), "AI_API_KEY env missing");

        final String model = System.getenv().getOrDefault("AI_MODEL", "deepseek-v4-flash");
        final String baseUrl = System.getenv().getOrDefault("AI_BASE_URL", "https://api.deepseek.com");
        final AiModelProperties properties = new AiModelProperties(
                apiKey, baseUrl, model, CONNECT_TIMEOUT_SEC, READ_TIMEOUT_SEC, CALL_TIMEOUT_SEC,
                RETRY_MAX_ATTEMPTS, RETRY_INITIAL_BACKOFF_MILLIS, RETRY_MAX_BACKOFF_MILLIS,
                RETRY_BACKOFF_MULTIPLIER, CONTEXT_WINDOW_TOKENS, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS,
                PROMPT_SAFETY_MARGIN_TOKENS, false, "max", false, TEAM_REVIEW_MAX_OUTPUT_TOKENS);
        final SpringAiChatGateway gateway = SpringAiChatGateway.fromProperties(properties, null);
        final String systemPrompt = AiPromptLibrary.zh("team/single");
        final List<LiveResult> results = new ArrayList<>();

        for (final AiEvalCase caze : AiEvalCaseLoader.loadAll()) {
            final BehaviorSpec spec = SPECS.get(caze.id());
            if (spec == null) {
                continue;
            }
            results.add(runCase(gateway, systemPrompt, model, caze, spec));
        }
        writeReport(baseUrl, model, results);

        final List<String> failures = results.stream()
                .filter(result -> !result.passed())
                .map(result -> result.caseId() + ": " + result.violationReason())
                .toList();
        assertTrue(results.size() == SPECS.size(), "A-H behavior cases must all execute: " + results);
        assertTrue(failures.isEmpty(), "live tactical behavior failures: " + failures);
    }

    private static LiveResult runCase(
            final SpringAiChatGateway gateway,
            final String systemPrompt,
            final String model,
            final AiEvalCase caze,
            final BehaviorSpec spec
    ) {
        final SingleTeamBattleAnalysisContext context = AiEvalFixtures.context(caze.fixtureKey());
        final BattleTimelineResult timelineResult = BattleTimelineBuilder.build(
                context.battle(), context.reconstruction(),
                TimelinePerspective.team(context.perspectiveTeam()));
        final String caseId = caze.id();
        if (!timelineResult.usable() || timelineResult.timeline() == null) {
            return LiveResult.failed(caseId, "timeline unavailable", "", "", List.of());
        }
        final TeamGroundingFacts.GroundingFacts facts = TeamGroundingFacts.build(
                context.battle(), timelineResult.timeline(), context.perspectiveTeam());
        final String evidencePrompt = com.wotb.web.replay.ai.TeamAiPromptBuilder.single(
                context, List.of(), null, new ConservativeDeepSeekTokenEstimator(), MAX_INPUT_TOKENS,
                timelineResult.timeline()).content();
        final String userPrompt = evidencePrompt + "\n"
                + TeamGroundingFacts.renderGroundingSection(facts)
                + "\n\n=== LIVE BEHAVIOR EVALUATION SCENARIO ===\n"
                + spec.scenario() + "\n"
                + "这是评估用的额外、明确标注的场景事实；只据此和上面的后端证据作答。"
                + "请仍然输出唯一 JSON envelope，不要输出 JSON 之外的解释。";
        final AiChatRequest request = new AiChatRequest(
                systemPrompt, userPrompt, model, null, TEAM_REVIEW_MAX_OUTPUT_TOKENS, false, null, null,
                "SINGLE_TEAM_BATTLE", REQUEST_COMPLETION_TOKENS, AiResponseFormat.JSON_OBJECT);
        final AiChatResponse response;
        try {
            response = gateway.stream(request, delta -> { });
        } catch (final Exception e) {
            final String reason = e.getClass().getSimpleName() + ": " + e.getMessage();
            return LiveResult.failed(caseId, reason, "", "", List.of());
        }
        final String raw = response.completionText() == null ? "" : response.completionText();
        final TeamReviewEnvelopeParser.ParseResult parsed = TeamReviewEnvelopeParser.parseDetailed(raw);
        if (parsed.failed()) {
            return LiveResult.failed(caseId, "parse: " + parsed.failureReason(), raw, "", List.of());
        }
        final TeamReviewEnvelope envelope = parsed.envelope();
        final String finalText = finalText(envelope);
        final List<CheckResult> checks = checks(finalText, envelope, facts, spec);
        final String reason = checks.stream().filter(check -> !check.passed())
                .map(CheckResult::reason).findFirst().orElse("");
        return new LiveResult(caseId, checks.stream().allMatch(CheckResult::passed),
                reason, raw, finalText, checks);
    }

    private static List<CheckResult> checks(
            final String text,
            final TeamReviewEnvelope envelope,
            final TeamGroundingFacts.GroundingFacts facts,
            final BehaviorSpec spec
    ) {
        final List<CheckResult> checks = new ArrayList<>();
        checks.add(check("primaryDiagnosis present", envelope.primaryDiagnosis() != null
                && envelope.primaryDiagnosis().hasContent(), "primaryDiagnosis missing or empty"));
        checks.add(check("natural team review", text.contains("## 团队复盘"),
                "final reviewMarkdown lacks required team-review heading"));
        final List<TeamFactualConsistencyValidator.FactConflict> conflicts =
                TeamFactualConsistencyValidator.validate(envelope, facts);
        checks.add(check("grounding validator", conflicts.isEmpty(),
                "grounding conflicts: " + conflicts));
        checks.add(check("no communication/call attribution", !hasCommunicationAttribution(text),
                "final output guesses communication/call/command responsibility"));
        final String forbiddenLabels = "GOOD_TRADE|BAD_PUSH|HALF_COMMIT_ERROR";
        checks.add(check("no authoritative tactical label", !Pattern.compile(forbiddenLabels,
                        Pattern.CASE_INSENSITIVE).matcher(text).find(),
                "final output introduced an authoritative tactical label"));

        checks.add(check("case behavior", spec.predicate().test(text), spec.violationReason()));
        return checks;
    }

    private static String finalText(final TeamReviewEnvelope envelope) {
        final TeamReviewEnvelope.PrimaryDiagnosis diagnosis = envelope.primaryDiagnosis();
        return diagnosis.title() + "\n" + diagnosis.reasoning() + "\n" + envelope.reviewMarkdown();
    }

    private static CheckResult check(final String name, final boolean passed, final String reason) {
        return new CheckResult(name, passed, passed ? "" : reason);
    }

    private static void writeReport(final String baseUrl, final String model,
                                    final List<LiveResult> results) throws IOException {
        final Path dir = Path.of("target", "ai-eval-report");
        Files.createDirectories(dir);
        final List<Map<String, Object>> json = results.stream().map(result -> {
            final Map<String, Object> item = new LinkedHashMap<>();
            item.put("caseId", result.caseId());
            item.put("provider", PROVIDER_NAME);
            item.put("baseUrl", baseUrl);
            item.put("model", model);
            item.put("rawResponse", result.rawResponse());
            item.put("finalAnalysis", result.finalAnalysis());
            item.put("passed", result.passed());
            item.put("violationReason", result.violationReason());
            item.put("checks", result.checks());
            return item;
        }).toList();
        Files.writeString(dir.resolve(REPORT_BASENAME + ".json"),
                MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(json), StandardCharsets.UTF_8);
        final StringBuilder markdown = new StringBuilder("# Team Tactical Skill live behavior report\n\n");
        markdown.append("provider: ").append(PROVIDER_NAME).append("\nbaseUrl: ").append(baseUrl)
                .append("\nmodel: ").append(model).append("\n\n");
        markdown.append("| case id | result | violation reason |\n|---|---|---|\n");
        for (final LiveResult result : results) {
            markdown.append("| ").append(result.caseId()).append(" | ")
                    .append(result.passed() ? "PASS" : "FAIL").append(" | ")
                    .append(result.violationReason()).append(" |\n");
        }
        markdown.append("\nRaw/final output and per-check details are in ")
                .append(REPORT_BASENAME).append(".json.\n");
        Files.writeString(dir.resolve(REPORT_BASENAME + ".md"), markdown, StandardCharsets.UTF_8);
    }

    private static Map<String, BehaviorSpec> specs() {
        final Map<String, BehaviorSpec> specs = new LinkedHashMap<>();
        specs.put("team-tactical-skill-v01-a-half-commit", new BehaviorSpec(
                "A：3 辆先进入，1 辆滞后且没有明确脱离；判断为可观察的执行不同步/半跟进，只讨论执行现象，不猜原因。",
                text -> containsAny(text, "half-commit", "半跟进", "执行断层", "脱节", "未同步", "跟进不完整"),
                "final output did not identify the observable half-commit/execution split"));
        specs.put("team-tactical-skill-v01-b-commitment", new BehaviorSpec(
                "B：队伍已经越过暴露路段并完成承诺动作后，新增敌人出现在后方；评估完成动作、可达掩护和重组价值，不把新增敌情机械转换为立即撤退。",
                text -> !mechanicalRetreat(text), "final output mechanically prescribed retreat after commitment"));
        specs.put("team-tactical-skill-v01-c-second-attack", new BehaviorSpec(
                "C：队伍已在一条线路取得成功并获得目标价值；敌方随后恢复防守，继续二次进攻的到达时间和 HP 代价都很高。应讨论保留位置、转移优势或机会成本。",
                text -> secondAttackCostAware(text),
                "final output did not discuss the cost of a second attack"));
        specs.put("team-tactical-skill-v01-d-no-error", new BehaviorSpec(
                "D：当前可确认/可观察证据不足以支持一个足以作为主要问题的明显执行失误；不要强行找锅，也不要把结论写成证明本场完全没有问题。",
                text -> boundedNoError(text) && !unboundedNoError(text),
                "final output did not keep the no-confirmed-error conclusion evidence-bounded"));
        specs.put("team-tactical-skill-v01-e-no-communication-blame", new BehaviorSpec(
                "E：回放只显示位置、进入时序、人数和交火结果，没有语音、聊天或 call 证据；只能写可观察执行现象，不能归因沟通或指挥失误。",
                text -> !hasCommunicationAttribution(text),
                "final output guessed communication/call/commander failure"));
        specs.put("team-tactical-skill-v01-f-supremacy", new BehaviorSpec(
                "F：争霸赛当前只确认低于约 750 分；一个约 1–2 秒内可确认的击杀通常带来约 +40 的模式价值。不要机械放弃短击杀，但仍要比较 HP 与位置代价。",
                text -> shortKillValueAware(text),
                "final output did not account for the short-kill +40 Supremacy value"));
        specs.put("team-tactical-skill-v01-g-supremacy", new BehaviorSpec(
                "G：争霸赛约 800 分，追击目标需要很长时间才能兑现；相较低分阶段，应明显提高目标压力和占点/回防优先级。不要把追击当默认正确。",
                text -> longChaseObjectivePressureAware(text),
                "final output did not raise objective pressure for the ~800-point long chase"));
        specs.put("team-tactical-skill-v01-h-assault", new BehaviorSpec(
                "H：攻防战进攻方还有约 25–40 秒时，不应机械回防/转基地；当只剩约 70–80 秒时，才明显提高基地优先级并结合重置可能性判断。",
                text -> assaultTimingAware(text),
                "final output did not distinguish the 25–40s and 70–80s Assault priorities"));
        return Map.copyOf(specs);
    }

    private static boolean containsAny(final String text, final String... needles) {
        for (final String needle : needles) {
            if (text.contains(needle)) {
                return true;
            }
        }
        return false;
    }

    private static boolean mechanicalRetreat(final String text) {
        final String softened = text.replace("不应机械撤退", "")
                .replace("不要机械撤退", "").replace("不必机械撤退", "");
        return PRESCRIPTIVE_RETREAT.matcher(softened).find()
                || softened.contains("机械地撤退") || softened.contains("机械撤退");
    }

    private static boolean hasCommunicationAttribution(final String text) {
        final String evidenceBounded = text
                .replace("没有语音、聊天或 call 证据", "")
                .replace("没有沟通证据", "")
                .replace("没有通信证据", "")
                .replace("无法判断沟通", "")
                .replace("无法确认沟通", "")
                .replace("不能归因于沟通", "")
                .replace("不能归因于通信", "")
                .replace("不能归因于语音", "")
                .replace("不能归因于 call", "")
                .replace("不是沟通问题", "")
                .replace("并非沟通问题", "")
                .replace("不是指挥问题", "")
                .replace("不是通信问题", "");
        return COMMUNICATION_ATTRIBUTION.matcher(evidenceBounded).find();
    }

    private static boolean boundedNoError(final String text) {
        return containsAny(text, "当前可确认", "当前可观察证据", "现有证据", "已观察到的证据")
                && containsAny(text, "没有发现", "未发现", "没有足以", "不足以支持");
    }

    private static boolean unboundedNoError(final String text) {
        return containsAny(text, "本场没有问题", "这场没有问题", "本局没有问题", "完全没有问题",
                "不存在任何错误", "没有任何错误", "本场不存在明显失误", "整场无误", "全场无误",
                "没有任何执行问题", "完全没有执行错误");
    }

    private static boolean secondAttackCostAware(final String text) {
        return containsAny(text, "二次进攻", "再次进攻", "继续追击")
                && containsAny(text, "代价", "风险", "机会成本", "到达时间")
                && containsAny(text, "保留位置", "保持位置", "转移优势", "不要继续", "不必继续", "守住");
    }

    private static boolean shortKillValueAware(final String text) {
        return containsAny(text, "40", "约四十") && containsAny(text, "击杀", "消灭")
                && containsAny(text, "短击杀", "快速击杀", "1–2秒", "1-2秒", "立即确认")
                && containsAny(text, "值得", "可以考虑", "不必放弃", "保留", "优先确认")
                && !containsAny(text, "必须放弃短击杀", "一律放弃短击杀", "机械放弃短击杀");
    }

    private static boolean longChaseObjectivePressureAware(final String text) {
        return containsAny(text, "800", "八百") && containsAny(text, "追击", "长时间", "兑现时间")
                && containsAny(text, "目标压力", "占点优先", "回防优先", "基地优先", "不宜继续追击",
                "追击代价", "提高优先级");
    }

    private static boolean assaultTimingAware(final String text) {
        final boolean earlyWindow = containsAny(text, "25–40", "25-40", "25 至 40", "25到40")
                && containsAny(text, "不应机械回防", "不要机械回防", "不必立即回防", "不需要立即回防",
                "不应立即回防", "不应立刻回防", "不机械回防");
        final boolean lateWindow = containsAny(text, "70–80", "70-80", "70 至 80", "70到80")
                && containsAny(text, "提高基地优先级", "基地优先级提高", "回防优先级提高",
                "更应回防", "基地压力提高", "基地优先");
        return earlyWindow && lateWindow;
    }

    private record BehaviorSpec(String scenario, Predicate<String> predicate, String violationReason) {
    }

    private record CheckResult(String check, boolean passed, String reason) {
    }

    private record LiveResult(
            String caseId,
            boolean passed,
            String violationReason,
            String rawResponse,
            String finalAnalysis,
            List<CheckResult> checks
    ) {
        private static LiveResult failed(final String caseId, final String reason,
                                         final String raw, final String finalAnalysis,
                                         final List<CheckResult> checks) {
            return new LiveResult(caseId, false, reason, raw, finalAnalysis, checks);
        }
    }
}
