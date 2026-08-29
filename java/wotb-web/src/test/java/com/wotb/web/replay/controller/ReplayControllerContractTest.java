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
        assertTrue(stream(response.get("player")).anyMatch(column -> "alpha_damage".equals(key(column))));
        assertTrue(stream(response.get("player")).anyMatch(column -> "rank".equals(key(column))));
        assertTrue(stream(response.get("player")).noneMatch(column -> key(column).startsWith("potential_damage")),
                "Potential Damage 已全局移除，列元数据不得再暴露");
        assertTrue(stream(response.get("aggregate")).noneMatch(column -> key(column).startsWith("potential_damage")));
        // 单场/汇总列已直接包含表现派生列（contribution/kast/impact 等）；不再有任何独立 performance 概念
        assertTrue(stream(response.get("player")).anyMatch(column -> "contribution".equals(key(column))));
        assertTrue(stream(response.get("player")).anyMatch(column -> "kast".equals(key(column))));
        assertTrue(stream(response.get("player")).anyMatch(column -> "impact".equals(key(column))));
        assertTrue(stream(response.get("aggregate")).anyMatch(column -> "contribution".equals(key(column))));
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
