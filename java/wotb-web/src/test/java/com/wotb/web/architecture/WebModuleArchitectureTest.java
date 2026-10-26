package com.wotb.web.architecture;

import com.wotb.web.WotbWebApplication;
import com.wotb.web.hundred.archfixture.UserProfileServiceCollaborationFixture;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

import java.util.Map;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WebModuleArchitectureTest {

    @Test
    void productionModulesRespectExplicitBoundaries() {
        final ApplicationModules modules = ApplicationModules.of(WotbWebApplication.class);
        final Map<String, String> representativeTypes = Map.ofEntries(
                Map.entry("admin", "admin.controller.AdminUserController"),
                Map.entry("creator", "creator.controller.RecommendationController"),
                Map.entry("hof", "hof.controller.HallOfFameController"),
                Map.entry("hundred", "hundred.controller.HundredBattleController"),
                Map.entry("mark3", "mark3.controller.Mark3Controller"),
                Map.entry("observability", "observability.controller.ObservabilityController"),
                Map.entry("replay", "replay.service.ReplayCapacityLimiter"),
                Map.entry("tournament", "tournament.controller.TournamentController"),
                Map.entry("user", "user.service.UserProfileService"),
                Map.entry("config", "config.KeycloakAdminUserService"),
                Map.entry("exceptionhandler", "exceptionhandler.GlobalExceptionHandler"),
                Map.entry("replayfile", "replayfile.ReplayUploadValidator"),
                Map.entry("util", "util.JwtUtil"));
        assertEquals(representativeTypes.keySet(),
                modules.stream().map(module -> module.getIdentifier().toString()).collect(Collectors.toSet()));
        representativeTypes.forEach((name, type) -> {
            final var module = modules.getModuleByName(name).orElseThrow();
            assertFalse(module.isOpen(), () -> "模块必须封闭: " + name);
            assertEquals("com.wotb.web." + name, module.getBasePackage().getName());
            assertTrue(module.contains("com.wotb.web." + type), () -> "模块缺少生产类型: " + type);
        });
        assertFalse(modules.getModuleByType(WebArchitectureTest.class).isPresent(), "不得导入架构测试");
        assertFalse(modules.getModuleByType(UserProfileServiceCollaborationFixture.class).isPresent(),
                "不得导入业务包下的测试夹具");
        modules.verify();
    }
}
