package com.wotb.ai.http;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** AI-owned ApiError remains aligned with contracts/http/openapi.yaml. */
class ApiErrorResponseSerializationTest {
    private static final JsonMapper MAPPER = JsonMapper.builder().build();
    private static final Set<String> API_ERROR_KEYS = Set.of(
            "id", "errorCode", "errorMsg", "status", "retryable", "details", "timestamp");

    @Test
    void serializesExactlyTheOpenApiApiErrorShape() throws Exception {
        final ApiErrorResponse response = new ApiErrorResponse("error-1", "INVALID_ARGUMENT", null,
                400, false, Map.of("field", "vehicleId"), Instant.parse("2026-10-25T10:15:30Z"));
        final JsonNode json = MAPPER.readTree(MAPPER.writeValueAsString(response));

        assertTrue(json.isObject());
        assertEquals(API_ERROR_KEYS, json.properties().stream().map(Map.Entry::getKey).collect(Collectors.toSet()));
        assertEquals("error-1", json.get("id").asString());
        assertEquals("INVALID_ARGUMENT", json.get("errorCode").asString());
        assertTrue(json.get("errorMsg").isNull());
        assertEquals(400, json.get("status").asInt());
        assertFalse(json.get("retryable").asBoolean());
        assertEquals("vehicleId", json.get("details").get("field").asString());
        assertEquals("2026-10-25T10:15:30Z", json.get("timestamp").asString());
    }
}
