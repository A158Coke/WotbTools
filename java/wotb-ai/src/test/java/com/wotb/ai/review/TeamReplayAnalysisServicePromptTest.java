package com.wotb.ai.review;

import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.ai.gateway.AiChatRequest;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamReplayAnalysisServicePromptTest extends TeamReplayAnalysisServiceTestSupport {

    @Test
    void singleTeamRequestUsesConfiguredModelAndCompressedTeamContext() {
        final var service = startService();
        final AiReviewDonePayload result = analyzeTeam(service,
                teamResultWithRecon("arena-one", "Ally", 1001L, 1), AllowedLanguage.ZH);
        assertEquals("team review", result.analysis());
        final AiChatRequest req = teamRequests().getLast();
        assertEquals("test-model", req.model());
        assertEquals("SINGLE_TEAM_BATTLE", req.analysisMode());
        assertTrue(req.systemPrompt().contains("资深团队教练"));
        assertTrue(req.systemPrompt().contains("不可信数据"));
        assertTrue(teamLastBody().contains("teamDisplayLabel="),
                "header must carry teamDisplayLabel ()");
        assertFalse(teamLastBody().contains("teamLabel="),
                "old teamLabel= internal header must be replaced by teamDisplayLabel=");
        assertTrue(teamLastBody().contains("opponentDisplayLabel="),
                "header must carry opponentDisplayLabel");
        assertFalse(teamLastBody().contains("队伍-"),
                "user-facing prompt body must not contain 队伍- hash fallback");
        assertTrue(teamLastBody().contains("AUTHORITATIVE_TEAM_RESULT"));
        assertTrue(teamLastBody().contains("OBSERVED_EVENT_SUBSET_NOT_AUTHORITATIVE"));
        // 生产入口携带有效 reconstruction → recorder entity 必须已解析，不得再声明 UNMAPPED
        // （UNMAPPED/REENTRY limitation 的产生由 core 的 TeamPerspectiveResolverTest 覆盖）。
        assertFalse(teamLastBody().contains("RECORDER_ENTITY_UNMAPPED"),
                "valid reconstruction must resolve the recorder entity");
        assertFalse(teamLastBody().contains("ParticipantMappingEvent"));
        assertFalse(teamLastBody().contains("PositionEvent{"));
        assertFalse(teamLastBody().contains("winnerTeam=1"));
        assertFalse(teamLastBody().contains("winnerTeam=2"));
        assertFalse(teamLastBody().contains("Team 1"));
        assertFalse(teamLastBody().contains("Team 2"));
        assertFalse(teamLastBody().contains("队伍1"));
        assertFalse(teamLastBody().contains("队伍2"));
        assertNoRawTeamLabels(teamLastBody());
    }

    @Test
    void singleTeamRequestContainsResultLabel() {
        final var service = startService();
        final AiReviewDonePayload result = analyzeTeam(service,
                teamResultWithRecon("arena-result", "Ally", 1001L, 1), AllowedLanguage.ZH);
        assertEquals("team review", result.analysis());
        assertTrue(teamLastBody().contains("result=TEAM_WIN")
                        || teamLastBody().contains("result=TEAM_LOSS")
                        || teamLastBody().contains("result=DRAW_OR_UNKNOWN"),
                "Request body must contain result=TEAM_WIN/LOSS/DRAW_OR_UNKNOWN, not winnerTeam=");
        assertFalse(teamLastBody().contains("winnerTeam="));
    }

    @Test
    void teamPerspectiveInjectsCall1Prior() {
        gateway.preBattleCompletionText = PRIOR_JSON;
        final var service = startService();
        final AiReviewDonePayload result = analyzeTeam(service,
                teamResultWithRecon("arena-prior", "Ally", 1001L, 1), AllowedLanguage.ZH);
        assertEquals("team review", result.analysis());
        final String body = teamLastBody();
        assertTrue(body.contains("PRE-BATTLE STRATEGIC PRIOR"),
                "Team review prompt must contain the Call #1 strategic prior");
        assertTrue(body.contains("TEAM_A（你的队伍"),
                "Prior must be relabeled to the perspective team");
        assertTrue(body.contains("开局左路集结"),
                "Prior hypotheses must be rendered");
        assertTrue(body.contains("战略假设（复盘对照：预期 vs 实际，考虑一波流等特殊战局）"),
                "Prior hypotheses section must ask for expectation-vs-actual comparison");
    }

    @Test
    void teamPerspectivePriorFailureStillReturnsReview() {
        gateway.preBattleCompletionText = "not a json object";
        final var service = startService();
        final AiReviewDonePayload result = analyzeTeam(service,
                teamResultWithRecon("arena-prior-fail", "Ally", 1001L, 1), AllowedLanguage.ZH);
        assertEquals("team review", result.analysis());
        assertTrue(teamLastBody().contains("赛前战略基线不可用"),
                "Prior failure must degrade gracefully with an explicit unavailable marker");
    }

    @Test
    void singleTeamPerspectiveUsesSingleTeamContext() {
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("shared-arena", "Ally", 1001L, 1);
        final AiReviewDonePayload result = analyzeTeam(service, fixture, AllowedLanguage.ZH);
        assertEquals("team review", result.analysis());
        assertNotNull(result.teamReview());
        // 单文件 team single 路径：SINGLE_TEAM_CONTEXT，无 MULTI_TEAM_CONTEXT / PERSPECTIVE 分区
        assertTrue(teamLastBody().contains("SINGLE_TEAM_CONTEXT"),
                "Must use SINGLE_TEAM_CONTEXT");
        assertTrue(teamLastBody().contains("teamDisplayLabel="),
                "Single-team context must contain teamDisplayLabel");
        assertFalse(teamLastBody().contains("MULTI_TEAM_CONTEXT"),
                "Must NOT use MULTI_TEAM_CONTEXT");
        assertFalse(teamLastBody().contains("PERSPECTIVE 1"),
                "Single-team context must not contain PERSPECTIVE labels");
        assertFalse(teamLastBody().contains("PERSPECTIVE 2"),
                "Single-team context must not contain PERSPECTIVE labels");
    }

    @Test
    void teamAnalyzeGroupsExposesRenderedPreBattleSectionWhenPriorAvailable() {
        gateway.preBattleCompletionText = PRIOR_JSON;
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("shared-arena", "Ally", 1001L, 1);
        final AiReviewDonePayload result = analyzeTeam(service, fixture, AllowedLanguage.ZH);
        assertEquals("team review", result.analysis(),
                "summary compatibility text must be unaffected by preBattleSection");
        assertNotNull(result.teamReview());
        final String section = result.preBattleSection();
        assertNotNull(section, "Call #1 prior must be rendered when available");
        assertTrue(section.contains("赛前预测"), "section must be user-visible Chinese");
        assertTrue(section.contains("我方画像"), "perspective team must be rendered as 我方画像 without hash label");
        assertFalse(section.contains("队伍-"), "PreBattle user-visible section must not contain 队伍- hash fallback");
        assertTrue(section.contains("重坦正面推进"), "teamA strengths must be readable");
        assertTrue(section.contains("关键对阵"), "key matchups must be present");
        assertFalse(section.contains("PRE-BATTLE"), "machine section header must be removed");
    }

    @Test
    void teamAnalyzeGroupsNullSectionWhenPriorUnavailable() {
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("shared-arena", "Ally", 1001L, 1);
        final AiReviewDonePayload result = analyzeTeam(service, fixture, AllowedLanguage.ZH);
        assertEquals("team review", result.analysis());
        assertNotNull(result.teamReview());
        assertNull(result.preBattleSection(),
                "failed Call #1 must not block the review, section stays null");
    }

    @Test
    void teamCall2ForwardsThinkingOptionFromConfig() {
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("shared-arena", "Ally", 1001L, 1);
        analyzeTeam(service, fixture, AllowedLanguage.ZH);
        final AiChatRequest review = gateway.requests.stream()
                .filter(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("team Call #2 request must reach the gateway"));
        assertTrue(review.thinkingEnabled(),
                "team Call #2 must forward call2ThinkingEnabled from config");
        assertEquals("high", review.reasoningEffort(),
                "team Call #2 must forward reasoningEffort when thinking enabled");
    }

    @Test
    void duplicateTeamMemberLimitationRendersIntoTeamPrompt() {
        // 重复 accountId 的 context 无法由 analyzeTeam 的 TeamContextBuilder 产生，因此
        // 直接覆盖 production 使用的两段契约：RosterEvidence 检测 + Team Prompt 渲染。
        final SingleTeamBattleAnalysisContext context = duplicateMemberContext();
        final TeamRosterResolver.RosterEvidence evidence = TeamRosterResolver.RosterEvidence.from(context);
        assertTrue(evidence.limitations().contains("DUPLICATE_TEAM_MEMBER_ACCOUNT_IDS"),
                "RosterEvidence must detect duplicate member account ids: " + evidence.limitations());

        final String body = TeamAiPromptBuilder.single(context, evidence.limitations(), null,
                new ConservativeDeepSeekTokenEstimator(), 200_000).content();
        assertTrue(body.contains("unitLimitations=["),
                "Body must use the unitLimitations= prefix");
        assertTrue(unitLimitationsOf(body).contains("DUPLICATE_TEAM_MEMBER_ACCOUNT_IDS"),
                "unitLimitations must contain DUPLICATE_TEAM_MEMBER_ACCOUNT_IDS, got: "
                        + unitLimitationsOf(body));
        assertFalse(body.contains("mandatory="),
                "Body must not use old mandatory= prefix");
        assertNoRawTeamLabels(body);
    }

    @Test
    void singleTeamPerspectiveProducesOneRequest() {
        final var service = startService();
        final TeamFixture fixture = teamResultWithRecon("shared-arena", "Ally", 1001L, 1);
        analyzeTeam(service, fixture, AllowedLanguage.ZH);
        final List<AiChatRequest> teamRequests = teamRequests();
        assertEquals(1, teamRequests.size(),
                "Single team perspective must produce exactly 1 team request");

        final String first = teamRequests.get(0).userPrompt();
        // file= 恒为空（生产入口不再携带 fileName），改为断言「录像者所在队伍即视角队伍」。
        assertTrue(perspectiveBodySection(first).contains("Ally"),
                "Request must be the ally perspective");
        assertFalse(perspectiveBodySection(first).contains("Enemy"),
                "Ally perspective body must not contain the opposing team's members");
        assertTrue(first.contains("OPPOSING_TEAM_LINEUP_AUTHORITATIVE"),
                "Ally perspective must still describe the opposing lineup");
        assertTrue(first.contains("Enemy"),
                "The opposing team's players are allowed as OPPOSING_TEAM_LINEUP evidence");
    }
}
