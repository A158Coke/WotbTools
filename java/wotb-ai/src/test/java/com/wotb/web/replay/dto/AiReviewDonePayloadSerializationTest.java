package com.wotb.web.replay.dto;

import com.wotb.core.replay.evidence.TeamAiReviewResult;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AI Review SSE {@code done} transport 形状契约（contracts/http/openapi.yaml
 * {@code #/components/schemas/AiReviewDonePayload}）：
 * <p>required = [analysis, preBattleSection, capability, teamReview, teamPlayers]，且
 * 个人复盘时 {@code teamReview} 为 JSON null、{@code teamPlayers} 为数组。ai-service 未设置
 * {@code spring.jackson.default-property-inclusion}，因此 null 字段必须仍然出现在 payload 中
 * （Jackson 默认 ALWAYS）——这把「5 个 key 齐备」锁成确定性断言。</p>
 */
class AiReviewDonePayloadSerializationTest {

    private static final Set<String> DONE_KEYS = Set.of(
            "analysis", "preBattleSection", "capability", "teamReview", "teamPlayers");

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    @Test
    void playerPerspectivePayloadKeepsAllFiveKeysWithNullTeamReview() {
        final AiReviewDonePayload player = new AiReviewDonePayload(
                "个人复盘正文",
                "## 赛前预测",
                AiReviewDonePayload.Capability.AVAILABLE_WITH_LIMITED_TIMELINE,
                null,
                List.of());

        final JsonNode node = MAPPER.readTree(MAPPER.writeValueAsString(player));

        assertTrue(node.isObject(), "done payload must serialize as a JSON object");
        assertEquals(DONE_KEYS, keys(node), "done payload must carry exactly the wire contract keys");
        assertEquals("个人复盘正文", node.get("analysis").asString());
        assertEquals("## 赛前预测", node.get("preBattleSection").asString());
        assertEquals("AVAILABLE_WITH_LIMITED_TIMELINE", node.get("capability").asString());
        assertTrue(node.get("teamReview").isNull(), "个人复盘的 teamReview 必须是 JSON null");
        assertTrue(node.get("teamPlayers").isArray(), "teamPlayers 必须是数组");
        assertEquals(0, node.get("teamPlayers").size(), "个人复盘的 teamPlayers 必须是空数组");
    }

    @Test
    void teamPerspectivePayloadCarriesStructuredResultAndPlayerIdentities() {
        final TeamAiReviewResult review = new TeamAiReviewResult(
                new TeamAiReviewResult.Summary("verdict", "primaryDiagnosis"),
                List.of(new TeamAiReviewResult.Episode("E1", 10, 20, "title", "analysis", List.of("P1"))),
                List.of(new TeamAiReviewResult.TrainingSuggestion("t", "c", "E1")),
                List.of(new TeamAiReviewResult.ReviewFocus("P1", "E1", "reason")),
                List.of(new TeamAiReviewResult.HighContributor("P1", "E1", "reason")));
        final AiReviewDonePayload team = new AiReviewDonePayload(
                "verdict", null, AiReviewDonePayload.Capability.AVAILABLE, review,
                List.of(new AiReviewDonePayload.TeamPlayer("P1", "Ally", "Kranvagn")));

        final JsonNode node = MAPPER.readTree(MAPPER.writeValueAsString(team));

        assertEquals(DONE_KEYS, keys(node));
        assertTrue(node.get("preBattleSection").isNull(), "Call #1 不可用时 preBattleSection 为 null（key 仍在）");
        assertTrue(node.get("teamReview").isObject());
        assertEquals("verdict", node.get("teamReview").get("summary").get("verdict").asString());
        assertEquals(1, node.get("teamPlayers").size());
        assertEquals("P1", node.get("teamPlayers").get(0).get("playerKey").asString());
        assertEquals("Ally", node.get("teamPlayers").get(0).get("displayName").asString());
        assertEquals("Kranvagn", node.get("teamPlayers").get(0).get("tankName").asString());
    }

    @Test
    void capabilityEnumKeepsRetiredUnavailableValue() {
        // N12：wire 保留 UNAVAILABLE（时间线不可用走 error 路径），不得删除枚举值。
        assertEquals(Set.of("AVAILABLE", "AVAILABLE_WITH_LIMITED_TIMELINE", "UNAVAILABLE"),
                Arrays.stream(AiReviewDonePayload.Capability.values())
                        .map(Enum::name).collect(Collectors.toSet()));
    }

    private static Set<String> keys(final JsonNode node) {
        return node.properties().stream().map(entry -> entry.getKey()).collect(Collectors.toSet());
    }
}
