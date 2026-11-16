package com.wotb.web;

import com.wotb.web.hof.entity.HallOfFameRecord;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.JsonNode;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc 进程内 REST API 测试 (不绑定端口)。
 */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PublicSearchIntegrationTest extends WebApiIntegrationTestSupport {

    // ── 名人堂公开查询 / 过滤器 / 排名（真实 PostgreSQL）────────────────────────
    @Test
    void publicSearchOrdersRatingBeforeRandomOnEqualDamageWithRanks() throws Exception {
        final List<HallOfFameRecord> rows = List.of(
                hofRecord("rank-rating", 333L, "RankRatingCoke", 424240L, "FV4005", "RATING", 7, 9000),
                hofRecord("rank-random", 444L, "RankRandomCoke", 424240L, "FV4005", "RANDOM", 1, 9000),
                hofRecord("rank-random-8k", 555L, "RankAnother", 424240L, "FV4005", "RANDOM", 1, 8000));
        hallOfFameRecordRepository.saveAll(rows);
        try {
            // tankId 唯一过滤本测试数据，避免其他测试残留记录干扰排序/rank 断言
            final String json = mvc().perform(get("/api/hof").param("tankId", "424240"))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            final JsonNode n = om.readTree(json);
            assertEquals(3, n.get("totalItems").asInt());
            assertEquals("RankRatingCoke", n.get("items").get(0).get("nickname").asText());
            assertEquals(1, n.get("items").get(0).get("rank").asInt());
            assertEquals("RATING", n.get("items").get(0).get("battleType").asText());
            assertEquals("RankRandomCoke", n.get("items").get(1).get("nickname").asText());
            assertEquals(2, n.get("items").get(1).get("rank").asInt());
            assertEquals("RANDOM", n.get("items").get(1).get("battleType").asText());
            assertEquals("RankAnother", n.get("items").get(2).get("nickname").asText());
            assertEquals(3, n.get("items").get(2).get("rank").asInt());
            // 公开边界：不暴露 accountId / arenaId / replayHash / uploadedBy
            assertFalse(n.get("items").get(0).has("accountId"));
            assertFalse(n.get("items").get(0).has("arenaId"));
            assertFalse(n.get("items").get(0).has("replayHash"));
            assertFalse(n.get("items").get(0).has("uploadedBy"));
        } finally {
            hallOfFameRecordRepository.deleteAll(rows);
            hallOfFameRecordRepository.flush();
        }
    }

    @Test
    void publicSearchBattleTypeTankNicknameFiltersCombine() throws Exception {
        final List<HallOfFameRecord> rows = List.of(
                hofRecord("flt-rating-1", 333L, "FltCokeRating", 424242L, "FV4005", "RATING", 7, 9000),
                hofRecord("flt-random-1", 444L, "FltCokeRandom", 424242L, "FV4005", "RANDOM", 1, 9000),
                hofRecord("flt-random-2", 555L, "FltOther", 424243L, "T49", "RANDOM", 1, 8000));
        hallOfFameRecordRepository.saveAll(rows);
        try {
            // battleType=RATING（tankId 限定本测试数据，避免其他测试残留记录干扰计数）
            String json = mvc().perform(get("/api/hof")
                            .param("battleType", "RATING").param("tankId", "424242"))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            assertEquals(1, om.readTree(json).get("totalItems").asInt());
            // tankId filter
            json = mvc().perform(get("/api/hof").param("tankId", "424243"))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            assertEquals(1, om.readTree(json).get("totalItems").asInt());
            // nickname search（模糊）
            json = mvc().perform(get("/api/hof").param("nickname", "FltCoke").param("tankId", "424242"))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            assertEquals(2, om.readTree(json).get("totalItems").asInt());
            // 组合：Rating + tank + nickname
            json = mvc().perform(get("/api/hof")
                            .param("battleType", "RATING").param("tankId", "424242").param("nickname", "FltCoke"))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            final JsonNode n = om.readTree(json);
            assertEquals(1, n.get("totalItems").asInt());
            assertEquals("FltCokeRating", n.get("items").get(0).get("nickname").asText());
        } finally {
            hallOfFameRecordRepository.deleteAll(rows);
            hallOfFameRecordRepository.flush();
        }
    }

    @Test
    void publicSearchRejectsUnknownBattleTypeFilter() throws Exception {
        mvc().perform(get("/api/hof").param("battleType", "TRAINING"))
                .andExpect(status().isBadRequest());
    }
}
