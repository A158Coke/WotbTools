package com.wotb.web.replay.controller;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import com.wotb.core.stats.Rating;
import com.wotb.web.replay.mapper.Mapper;
import com.wotb.web.replay.service.ReplayService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

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
                "aggregate", Mapper.aggregateColumns(),
                "rating", Mapper.ratingColumns()));
        when(service.ratingConfig()).thenReturn(Rating.config());
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
        assertTrue(stream(response.get("player")).anyMatch(column -> "potential_damage".equals(key(column))));
        assertTrue(stream(response.get("player")).anyMatch(column -> "rank".equals(key(column))));
        assertTrue(stream(response.get("aggregate"))
                .anyMatch(column -> "potential_damage_avg".equals(key(column))));
        assertTrue(stream(response.get("rating")).anyMatch(column -> "kast".equals(key(column))));
        assertTrue(stream(response.get("rating")).anyMatch(column -> "impact".equals(key(column))));
        assertTrue(stream(response.get("rating")).anyMatch(column -> "assist_avg".equals(key(column))));
        assertTrue(stream(response.get("rating"))
                .anyMatch(column -> "multi_damage_rate".equals(key(column))));
        assertFalse(stream(response.get("rating")).anyMatch(column -> "influence".equals(key(column))));
        assertFalse(stream(response.get("rating")).anyMatch(column -> "average_hp".equals(key(column))));
        assertFalse(stream(response.get("rating")).anyMatch(column -> "account_id".equals(key(column))));
    }

    @Test
    void ratingConfigEndpointReturnsConfiguredValues() throws Exception {
        final String json = mvc.perform(get("/api/rating"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        final JsonNode response = objectMapper.readTree(json);

        assertTrue(response.get("scale").asInt() > 0);
        assertTrue(response.get("killValue").asDouble() > 0);
        assertTrue(response.get("classFactor").isObject());
        assertFalse(response.get("classFactor").isEmpty());
        response.get("classFactor").properties().forEach(
                e -> assertTrue(e.getKey().matches("[A-Z_]+"), "non-English class factor key: " + e.getKey()));
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
