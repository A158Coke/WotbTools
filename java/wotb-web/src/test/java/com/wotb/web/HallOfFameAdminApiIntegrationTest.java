package com.wotb.web;

import com.wotb.web.hof.entity.HallOfFameRecord;
import java.nio.file.Files;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.annotation.DirtiesContext;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.JsonNode;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc 进程内 REST API 测试 (不绑定端口)。
 */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class HallOfFameAdminApiIntegrationTest extends WebApiIntegrationTestSupport {

    // ── 名人堂安全矩阵（真实 SecurityConfig + MockMvc jwt roles）────────────────
    @Test
    void hofAnonymousPublicOkUploadDownloadAdminDenied() throws Exception {
        mvc().perform(get("/api/hof")).andExpect(status().isOk());
        mvc().perform(multipart("/api/hof/upload").file(hofFile(replays().getFirst())))
                .andExpect(status().isUnauthorized());
        mvc().perform(get("/api/hof/1/replay")).andExpect(status().isUnauthorized());
        mvc().perform(get("/api/admin/hof")).andExpect(status().isUnauthorized());
    }

    @Test
    void hofAdminRoleGatesAreExact() throws Exception {
        // HoF-admin：可访问 /api/admin/hof/**，不可访问其他 admin 域
        mvc().perform(get("/api/admin/hof").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_HoF-admin"))))
                .andExpect(status().isOk());
        mvc().perform(get("/api/admin/users/probe").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_HoF-admin"))))
                .andExpect(status().isForbidden());
        // wotbtools-user：无 HoF admin 权限
        mvc().perform(get("/api/admin/hof").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().isForbidden());
        // wotbtools-admin：super admin 拥有 HoF 权限
        mvc().perform(get("/api/admin/hof").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isOk());
        // 普通已登录用户（无角色）：upload/download 允许（authenticated）
        final MockMultipartFile corrupt = new MockMultipartFile("file", "bad.wotbreplay",
                "application/octet-stream", new byte[]{0, 1, 2, 3});
        mvc().perform(multipart("/api/hof/upload").file(corrupt).with(jwt()))
                .andExpect(status().isBadRequest());
        // authenticated：security 放行后落到业务（记录不存在 → 404），证明已登录可访问下载端点
        mvc().perform(get("/api/hof/999999/replay").with(jwt()))
                .andExpect(status().isNotFound());
    }

    // ── admin hard delete / audit / 文件引用清理（真实 PostgreSQL + 文件系统）────────
    @Test
    void hofAdminDeleteRemovesRecordAuditAndLastFile() throws Exception {
        loginAs(ADMIN_SUB, "admin-user");
        final byte[] bytes = "admin-delete-replay".getBytes();
        final String hash = storeReplayBytes(bytes);
        final HallOfFameRecord r = hofRecord("adm-del-1", 111L, "Player1", 6481L, "FV4005",
                "RANDOM", 1, 5000);
        r.setReplayHash(hash);
        hallOfFameRecordRepository.saveAndFlush(r);
        final long id = r.getId();
        try {
            mvc().perform(delete("/api/admin/hof/" + id).with(hofAdminJwt("ROLE_HoF-admin")))
                    .andExpect(status().isOk());
            assertTrue(hallOfFameRecordRepository.findById(id).isEmpty(), "记录必须已 hard delete");
            assertFalse(Files.exists(REPLAY_DIR.resolve(hash + ".wotbreplay")),
                    "最后引用删除后物理文件必须移除");
            // audit 存在且为完整快照
            final String auditJson = mvc().perform(get("/api/admin/hof/audit").with(jwt().authorities(
                            new SimpleGrantedAuthority("ROLE_HoF-admin"))))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            final JsonNode audit = om.readTree(auditJson);
            assertTrue(audit.get("totalItems").asInt() >= 1);
            final JsonNode first = audit.get("items").get(0);
            assertEquals("DELETE_ENTRY", first.get("action").asText());
            assertEquals(id, first.get("recordId").asLong());
            assertEquals("Player1", first.get("nickname").asText());
            assertEquals(5000, first.get("damageDealt").asInt());
            assertEquals("RANDOM", first.get("battleType").asText());
            assertEquals(1, first.get("arenaBonusType").asInt());
            assertEquals(hash, first.get("replayHash").asText());
            assertEquals(ADMIN_SUB, first.get("adminKeycloakUserId").asText());
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    @Test
    void hofAdminDeleteSharedHashRetainsFile() throws Exception {
        loginAs(ADMIN_SUB, "admin-user");
        final byte[] bytes = "shared-hash-replay".getBytes();
        final String hash = storeReplayBytes(bytes);
        final HallOfFameRecord a = hofRecord("adm-shared-a", 111L, "PlayerA", 6481L, "FV4005",
                "RANDOM", 1, 5000);
        a.setReplayHash(hash);
        final HallOfFameRecord b = hofRecord("adm-shared-b", 222L, "PlayerB", 6481L, "FV4005",
                "RATING", 7, 6000);
        b.setReplayHash(hash);
        hallOfFameRecordRepository.saveAll(List.of(a, b));
        final long idA = a.getId();
        try {
            mvc().perform(delete("/api/admin/hof/" + idA).with(hofAdminJwt("ROLE_wotbtools-admin")))
                    .andExpect(status().isOk());
            assertTrue(hallOfFameRecordRepository.findById(idA).isEmpty());
            assertTrue(hallOfFameRecordRepository.findById(b.getId()).isPresent(),
                    "共享 hash 的另一条记录必须保留");
            assertTrue(Files.exists(REPLAY_DIR.resolve(hash + ".wotbreplay")),
                    "仍有引用时物理文件必须保留");
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    @Test
    void hofAdminDeleteMissingRecordReturns404() throws Exception {
        mvc().perform(delete("/api/admin/hof/999999").with(hofAdminJwt("ROLE_HoF-admin")))
                .andExpect(status().isNotFound());
    }

    @Test
    void hofAdminDeleteNullHashRecordWorks() throws Exception {
        loginAs(ADMIN_SUB, "admin-user");
        final HallOfFameRecord r = hofRecord("adm-null-hash", 111L, "NoReplay", 6481L, "FV4005",
                "RANDOM", 1, 3000);
        hallOfFameRecordRepository.saveAndFlush(r);
        final long id = r.getId();
        try {
            mvc().perform(delete("/api/admin/hof/" + id).with(hofAdminJwt("ROLE_HoF-admin")))
                    .andExpect(status().isOk());
            assertTrue(hallOfFameRecordRepository.findById(id).isEmpty());
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    @Test
    void hofAdminDeleteFileMissingStillDeletesRecord() throws Exception {
        loginAs(ADMIN_SUB, "admin-user");
        final String hash = "99".repeat(32); // 无对应物理文件
        final HallOfFameRecord r = hofRecord("adm-missing-file", 111L, "PlayerX", 6481L, "FV4005",
                "RANDOM", 1, 4000);
        r.setReplayHash(hash);
        hallOfFameRecordRepository.saveAndFlush(r);
        final long id = r.getId();
        try {
            mvc().perform(delete("/api/admin/hof/" + id).with(hofAdminJwt("ROLE_HoF-admin")))
                    .andExpect(status().isOk());
            assertTrue(hallOfFameRecordRepository.findById(id).isEmpty(),
                    "文件缺失不得阻止 DB hard delete");
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    @Test
    void hofAdminListHidesBattleInternalKeysAndKeepsBusinessFilters() throws Exception {
        loginAs(ADMIN_SUB, "admin-user");
        final HallOfFameRecord r = hofRecord("adm-list-1", 111L, "CokeAdmin", 6481L, "FV4005",
                "RATING", 7, 7000);
        r.setReplayUploadedBy("up-sub-1");
        hallOfFameRecordRepository.saveAndFlush(r);
        try {
            // uploadedBy 搜索定位本测试记录（避免其他测试残留数据干扰第一条）
            final String filtered = mvc().perform(get("/api/admin/hof").param("uploadedBy", "up-sub-1")
                            .param("arenaId", "not-used-as-a-business-filter")
                            .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_HoF-admin"))))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            final JsonNode n = om.readTree(filtered);
            assertEquals(1, n.get("totalItems").asInt());
            final JsonNode item = n.get("items").get(0);
            // 管理页面仍保留必要的治理字段，但不暴露内部战斗唯一键/原始战斗模式码。
            assertTrue(item.has("replayHash"));
            assertTrue(item.has("replayUploadedBy"));
            assertTrue(item.has("accountId"));
            assertFalse(item.has("arenaId"));
            assertFalse(item.has("arenaBonusType"));
        } finally {
            SecurityContextHolder.clearContext();
            hallOfFameRecordRepository.delete(r);
            hallOfFameRecordRepository.flush();
        }
    }

    @Test
    void hofVehicleOptionsArePublicAndSharedWithAdmin() throws Exception {
        final HallOfFameRecord r = hofRecord("adm-vehicle-options", 111L, "CokeAdmin", 385L, "Progetto 65",
                "RANDOM", 1, 7000);
        hallOfFameRecordRepository.saveAndFlush(r);
        try {
            final JsonNode options = om.readTree(mvc().perform(get("/api/hof/vehicle-options"))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
            final JsonNode adminOptions = om.readTree(mvc().perform(get("/api/admin/hof/vehicle-options")
                            .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_HoF-admin"))))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
            assertEquals(options, adminOptions, "公开与管理员端点必须复用同一车辆选项实现");
            JsonNode option = null;
            for (final JsonNode candidate : options) {
                if (candidate.get("tankId").asLong() == 385L) {
                    option = candidate;
                    break;
                }
            }
            assertTrue(option != null, "当前名人堂存在的车辆必须出现在可选列表");
            assertEquals("Progetto 65", option.get("tankName").asText());
            assertEquals("EUROPE", option.get("nation").asText());
            assertEquals("MEDIUM_TANK", option.get("type").asText());
            assertEquals(10, option.get("tier").asInt());
        } finally {
            hallOfFameRecordRepository.delete(r);
            hallOfFameRecordRepository.flush();
        }
    }
}
