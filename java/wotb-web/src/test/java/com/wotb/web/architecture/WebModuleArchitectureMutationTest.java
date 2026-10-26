package com.wotb.web.architecture;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;
import org.springframework.modulith.core.Violations;

import java.util.Map;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 独立夹具执行真实 Modulith 引擎，验证边界规则没有空转。 */
class WebModuleArchitectureMutationTest {

    @Test
    void explicitlyAllowedNamedInterfaceIsAccepted() {
        final ApplicationModules modules = fixture("valid", Map.of(
                "consumer", "consumer.Consumer", "provider", "provider.api.PublicApi"));

        assertDoesNotThrow(() -> {
            modules.verify();
        });
    }

    @Test
    void internalTypeAccessIsRejected() {
        final ApplicationModules modules = fixture("hidden", Map.of(
                "consumer", "consumer.Consumer", "provider", "provider.internal.HiddenType"));

        final Violations failure = assertThrows(Violations.class, modules::verify);
        assertTrue(failure.getMessage().contains("non-exposed type"), failure::getMessage);
        assertTrue(failure.getMessage().contains("provider.internal.HiddenType"), failure::getMessage);
    }

    @Test
    void exposedButUnapprovedDependencyIsRejected() {
        final ApplicationModules modules = fixture("forbidden", Map.of(
                "consumer", "consumer.Consumer", "provider", "provider.api.PublicApi"));
        final var provider = modules.getModuleByName("provider").orElseThrow();
        assertTrue(provider.isExposed(provider.getType(
                "com.wotb.modulithfixture.forbidden.provider.api.PublicApi").orElseThrow()));

        final Violations failure = assertThrows(Violations.class, modules::verify);
        assertTrue(failure.getMessage().contains("Allowed targets:"), failure::getMessage);
        assertTrue(failure.getMessage().contains("provider"), failure::getMessage);
    }

    @Test
    void moduleCycleIsRejected() {
        final ApplicationModules modules = fixture("cycle", Map.of(
                "first", "first.First", "second", "second.Second"));

        final Violations failure = assertThrows(Violations.class, modules::verify);
        assertTrue(failure.getMessage().contains("Cycle detected"), failure::getMessage);
        assertTrue(failure.getMessage().contains("first"), failure::getMessage);
        assertTrue(failure.getMessage().contains("second"), failure::getMessage);
    }

    private static ApplicationModules fixture(final String scenario, final Map<String, String> types) {
        final String root = "com.wotb.modulithfixture." + scenario;
        // 生产图默认排除测试目录；此处必须显式导入测试夹具。
        final ApplicationModules modules = ApplicationModules.of(root, location -> true);
        assertEquals(types.keySet(), modules.stream()
                .map(module -> module.getIdentifier().toString()).collect(Collectors.toSet()));
        types.forEach((name, type) -> assertTrue(
                modules.getModuleByName(name).orElseThrow().contains(root + "." + type),
                () -> "夹具未被导入: " + root + "." + type));
        return modules;
    }
}
