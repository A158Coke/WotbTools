package com.wotb.web.replay.controller;

import com.wotb.web.replay.mapper.Mapper;
import com.wotb.web.replay.service.ReplayService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ReplayControllerContractTest {

    private final ObjectMapper objectMapper = JsonMapper.builder().build();
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        final ReplayService service = mock(ReplayService.class);
        when(service.columns()).thenReturn(java.util.Map.of(
                "player", Mapper.playerColumns(),
                "aggregate", Mapper.aggregateColumns()));
        mvc = MockMvcBuilders.standaloneSetup(new ReplayController(service)).build();
    }

    @Test
    void columnsEndpointReturnsStableEnglishKeys() throws Exception {
        final String json = mvc.perform(get("/api/columns"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        final JsonNode response = objectMapper.readTree(json);

        assertTrue(response.get("player").size() > 10);
        assertTrue(stream(response.get("player")).anyMatch(column -> "rank".equals(key(column))));
        assertTrue(stream(response.get("player")).anyMatch(column -> "tank_name".equals(key(column))));
        assertTrue(stream(response.get("player")).noneMatch(column -> key(column).startsWith("potential_damage")),
                "Potential Damage 已全局移除，列元数据不得再暴露");
        assertTrue(stream(response.get("aggregate")).noneMatch(column -> key(column).startsWith("potential_damage")));
        assertTrue(stream(response.get("aggregate")).anyMatch(column -> "multi_damage_rate".equals(key(column))));
        // B6：contribution/kast/impact/alpha_damage 与身份列（account_id/tank_id）已退役，
        // 身份改由响应行的结构化 accountId/vehicleId 承载 → 任何列 universe 都不得再出现。
        for (final String retired : List.of("alpha_damage", "contribution", "kast", "impact",
                "traded_deaths", "account_id", "tank_id", "victory_points_seized")) {
            assertTrue(stream(response.get("player")).noneMatch(column -> retired.equals(key(column))),
                    "单场列 universe 不得再暴露已退役列：" + retired);
            assertTrue(stream(response.get("aggregate")).noneMatch(column -> retired.equals(key(column))),
                    "汇总列 universe 不得再暴露已退役列：" + retired);
        }
        // 重命名后的列 key 必须一致出现（三层同步：Java 列定义 / API / Excel）
        assertTrue(stream(response.get("aggregate")).anyMatch(column -> "survival_time_avg".equals(key(column))));
        assertFalse(stream(response.get("aggregate")).anyMatch(column -> "survival_avg".equals(key(column))));
        assertFalse(response.has("performance"));
    }

    private static Stream<JsonNode> stream(final JsonNode node) {
        final List<JsonNode> nodes = new ArrayList<>();
        node.forEach(nodes::add);
        return nodes.stream();
    }

    private static String key(final JsonNode column) {
        return column.get("key").asText();
    }
}
