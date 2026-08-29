package com.wotb.web.replay.ai;

import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Source;
import com.wotb.core.replay.evidence.TeamFactualConsistencyValidator;
import com.wotb.core.replay.evidence.TeamGroundingFacts;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.processing.BatchAnalyzer;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayPerspectiveGroup;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import com.wotb.web.config.AiModelProperties;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiChatResponse;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import com.wotb.web.replay.ai.gateway.AiResponseFormat;
import com.wotb.web.replay.ai.gateway.SpringAiChatGateway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * 真实 DeepSeek 细粒度复现探针：手动复刻 Team Call #2 retry loop，打印每一轮的
 * parse 结果 + validator conflict 明细（checkId / reasonCode / message / claimType /
 * subject / evidenceIds），用于 DISCOVER 报告（HARD vs metadata 分类）。
 * <p>必须设置环境变量 AI_API_KEY（临时 key，不在仓库出现）。</p>
 */
class TeamReviewDetailedReproProbeTest {

    @Test
    void detailedRepro() throws Exception {
        final String apiKey = System.getenv("AI_API_KEY");
        Assumptions.assumeTrue(apiKey != null && !apiKey.isBlank(), "AI_API_KEY env missing");
        String path = System.getProperty("probe.replay");
        if (path == null) {
            path = "../../common/data/probe-neptune1.wotbreplay";
        }
        final Path file = Path.of(path);
        Assumptions.assumeTrue(Files.exists(file), "sample missing: " + file);
        final byte[] bytes = Files.readAllBytes(file);
        final ReplayProcessingResult result = new DefaultReplayProcessingFacade()
                .process(new Source(file.getFileName().toString(), bytes), ReplayProcessingOptions.full());
        Assumptions.assumeTrue(result.battle() != null && result.battle().players != null, "no battle parsed");
        final List<ReplayPerspectiveGroup> groups = new BatchAnalyzer().analyze(List.of(result)).groups();
        Assumptions.assumeTrue(!groups.isEmpty(), "no team group");
        final SingleTeamBattleAnalysisContext ctx = TeamContextBuilder.buildSingleTeamContext(groups.get(0));
        final BattleTimelineResult tl = BattleTimelineBuilder.build(
                ctx.battle(), ctx.reconstruction(), TimelinePerspective.team(ctx.perspectiveTeam()));
        Assumptions.assumeTrue(tl.usable() && tl.timeline() != null, "timeline unusable");
        final BattleTimeline timeline = tl.timeline();
        final TeamGroundingFacts.GroundingFacts facts =
                TeamGroundingFacts.build(ctx.battle(), timeline, ctx.perspectiveTeam());
        System.out.println("===== 细粒度复现: " + file.getFileName() + " map=" + ctx.battle().mapName
                + " facts=" + facts.facts().size());
        // 打印 GROUNDING FACTS 全部（含证据编号），供比对 conflict
        System.out.println("----- GROUNDING FACTS -----");
        System.out.println(TeamGroundingFacts.renderGroundingSection(facts));

        final AiModelProperties props = new AiModelProperties(
                apiKey, "https://api.deepseek.com", "deepseek-v4-flash",
                10, 120, 200, 1, 1000, 8000, 2.0,
                1_000_000, 940_000, 32768, 16384, false, "max", false, 4096);
        final SpringAiChatGateway gateway = SpringAiChatGateway.fromProperties(props, null);
        final AiReplayAnalysisConfig config = new AiReplayAnalysisConfig(
                new ConservativeDeepSeekTokenEstimator(), "deepseek-v4-flash",
                940_000, 1_000_000, 32768, 16384, false, "max", 200, 4096);
        final String systemPrompt = TeamPromptLocalizer.localizeTeamSystemPrompt(
                TeamPromptLocalizer.SINGLE_TEAM_PROMPT, AllowedLanguage.ZH);
        final TeamAiPromptBuilder.PromptInput input = TeamAiPromptBuilder.single(
                ctx, List.of(), null, new ConservativeDeepSeekTokenEstimator(), 940_000, timeline);
        final String groundingSection = TeamGroundingFacts.renderGroundingSection(facts);
        String baseUser = input.content()
                + (groundingSection.isEmpty() ? "" : "\n" + groundingSection);

        for (int attempt = 1; attempt <= 3; attempt++) {
            System.out.println("\n===== ATTEMPT " + attempt + " =====");
            if (attempt > 1) {
                baseUser = input.content()
                        + (groundingSection.isEmpty() ? "" : "\n" + groundingSection)
                        + "\n\n=== 事实一致性校验反馈 ===\n上一轮输出未通过事实一致性校验。请修改后重新输出完整的 JSON envelope；不要改变你的主判断，只修正与 GROUNDING FACTS 冲突的表述。";
            }
            final AiChatRequest request = new AiChatRequest(
                    systemPrompt, baseUser, config.model(), null,
                    Math.min(config.maxOutputTokens(), config.teamReviewMaxOutputTokens()),
                    false, null, null, "SINGLE_TEAM_BATTLE",
                    (int) Math.min(Math.max(1L, 200), Integer.MAX_VALUE),
                    AiResponseFormat.JSON_OBJECT);
            final long t0 = System.nanoTime();
            final AiChatResponse response = gateway.stream(request, delta -> { });
            final long ms = (System.nanoTime() - t0) / 1_000_000;
            System.out.println("attempt=" + attempt + " promptTokens=" + response.inputTokens()
                    + " completionTokens=" + response.outputTokens() + " durationMs=" + ms);
            final TeamReviewEnvelopeParser.ParseResult parse =
                    TeamReviewEnvelopeParser.parseDetailed(response.completionText());
            if (parse.failed()) {
                System.out.println("PARSE FAIL: " + parse.failureReason());
                // 打印 raw 前 600 字符（不含 key；只打印 envelope 结构）
                final String raw = response.completionText();
                System.out.println("raw head: " + raw.substring(0, Math.min(600, raw.length())).replace("\n", "\\n"));
                // 定位 claims 数组并打印 claimType 字段
                final int claimsIdx = raw.indexOf("\"claims\"");
                if (claimsIdx >= 0) {
                    System.out.println("claims section: " + raw.substring(claimsIdx, Math.min(raw.length(), claimsIdx + 2500)).replace("\n", "\\n"));
                }
                continue;
            }
            final com.wotb.core.replay.evidence.TeamReviewEnvelope envelope = parse.envelope();
            System.out.println("PARSE PASS: claims=" + envelope.claims().size()
                    + " diagnosis.title=" + envelope.primaryDiagnosis().title());
            final List<TeamFactualConsistencyValidator.FactConflict> conflicts =
                    TeamFactualConsistencyValidator.validate(envelope, facts);
            System.out.println("VALIDATION: conflicts=" + conflicts.size());
            for (final TeamFactualConsistencyValidator.FactConflict c : conflicts) {
                System.out.println("  [" + c.checkId() + "] reasonCode=" + c.reasonCode() + " msg=" + c.message());
            }
            if (conflicts.isEmpty()) {
                System.out.println("PASS on attempt " + attempt);
                break;
            }
            // 打印 claims 明细（机器字段），判断 conflict 来源
            System.out.println("----- CLAIMS -----");
            for (final com.wotb.core.replay.evidence.TeamReviewEnvelope.Claim c : envelope.claims()) {
                System.out.println("  type=" + c.claimType() + " subject=" + c.subject()
                        + " timeSec=" + c.timeSec() + " region=" + c.region() + " count=" + c.count()
                        + " value=" + c.value() + " side=" + c.side() + " sem=" + c.countSemantics()
                        + " knowledge=" + c.knowledge() + " accId=" + c.subjectAccountId()
                        + " evIds=" + c.evidenceIds() + " text=" + truncate(c.text(), 80));
            }
        }
    }

    private static String truncate(final String s, final int max) {
        if (s == null) return "null";
        return s.length() <= max ? s : s.substring(0, max) + "...";
    }
}
