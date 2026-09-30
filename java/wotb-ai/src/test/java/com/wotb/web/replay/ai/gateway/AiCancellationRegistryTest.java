package com.wotb.web.replay.ai.gateway;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AiCancellationRegistryTest {

    private static final String VALID_ID = "00000000-0000-0000-0000-0000000000c1";

    private final AiCancellationRegistry registry = new AiCancellationRegistry();

    @Test
    void rejectsNonUuidCorrelationIds() {
        assertNull(registry.register(null));
        assertNull(registry.register(""));
        assertNull(registry.register("abc"));
        assertNull(registry.register("550e8400-e29b-41d4-a716-44665544000")); // 长度不足
        assertNull(registry.register("550e8400-e29b-41d4-a716-4466554400000")); // 长度超长
        assertNull(registry.register("550e8400-e29b-41d4-a716-44665544000g")); // 非法字符
    }

    @Test
    void rejectsDuplicateActiveCorrelationId() {
        assertNotNull(registry.register(VALID_ID));
        assertNull(registry.register(VALID_ID), "重复 id 必须拒绝，不复用 token");
    }

    @Test
    void cancelOnlyAffectsOwnRequest() {
        final String other = "00000000-0000-0000-0000-0000000000c2";
        final AiCancellationToken token = registry.register(VALID_ID);
        final AiCancellationToken otherToken = registry.register(other);
        assertNotNull(token);
        assertNotNull(otherToken);

        assertTrue(registry.cancel(VALID_ID));
        assertTrue(token.isCancelled());
        assertFalse(otherToken.isCancelled(), "取消一个请求不得影响另一个请求");
    }

    @Test
    void unregisterIsCompareAndRemove() {
        final AiCancellationToken token = registry.register(VALID_ID);
        assertNotNull(token);

        // 错误 token：映射保留，请求仍可取消
        registry.unregister(VALID_ID, new AiCancellationToken());
        assertTrue(registry.cancel(VALID_ID));

        // 正确 token：原子删除后 cancel 返回 false
        registry.unregister(VALID_ID, token);
        assertFalse(registry.cancel(VALID_ID));
        assertFalse(registry.cancel(VALID_ID));
    }

    @Test
    void isValidCorrelationIdEnforcesCanonicalUuid() {
        assertTrue(AiCancellationRegistry.isValidCorrelationId(VALID_ID));
        assertTrue(AiCancellationRegistry.isValidCorrelationId("550e8400-e29b-41d4-a716-446655440000"));
        assertFalse(AiCancellationRegistry.isValidCorrelationId(null));
        assertFalse(AiCancellationRegistry.isValidCorrelationId("corr-abc"));
        assertFalse(AiCancellationRegistry.isValidCorrelationId("550e8400e29b41d4a716446655440000"));
    }
}
