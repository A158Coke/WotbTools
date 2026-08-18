package com.wotb.web.hundred;

import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.OffsetDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 百场 APPROVE 的 CURRENT replacement 真实 PostgreSQL 集成测试。
 * 必须经过 V18 partial unique index（user_keycloak_id, vehicle_id) where status='CURRENT'：
 * 旧 CURRENT 先显式 flush 为 SUPERSEDED，再提升 PENDING 为 CURRENT；单事务内后半段失败整体回滚。
 */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
class HundredBattleSubmissionIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("wotb");

    @DynamicPropertySource
    static void configure(final DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri",
                () -> "http://test-issuer");
        registry.add("keycloak.admin.server-url", () -> "http://test-keycloak");
        registry.add("keycloak.admin.realm", () -> "test");
        registry.add("keycloak.admin.client-id", () -> "test");
        registry.add("keycloak.admin.client-secret", () -> "test");
        registry.add("wotb.hof.replay-dir", () -> "data/replays-it");
    }

    @Autowired
    HundredBattleSubmissionRepository repository;

    @Autowired
    HundredBattleSubmissionService service;

    @BeforeEach
    void clean() {
        repository.deleteAll();
        repository.flush();
    }

    private HundredBattleSubmission insertRow(final String status, final int damage, final int battles) {
        final HundredBattleSubmission s = new HundredBattleSubmission();
        s.setUserKeycloakId("kc-user");
        s.setVehicleId(385L); // Progetto 65 (Tier X)
        s.setVehicleName("Progetto 65");
        s.setGameAccountIdSnapshot(111L);
        s.setNicknameSnapshot("PlayerOne");
        s.setClaimedAverageDamage(damage);
        s.setClaimedBattleCount(battles);
        s.setStatus(status);
        s.setSubmittedAt(OffsetDateTime.now());
        if ("CURRENT".equals(status)) {
            s.setApprovedAverageDamage(damage);
            s.setApprovedBattleCount(battles);
            s.setApprovedAt(OffsetDateTime.now());
            s.setApprovedBy("admin-sub");
        }
        return repository.saveAndFlush(s);
    }

    private long currentCount() {
        return repository.findByUserKeycloakIdAndStatusInOrderBySubmittedAtDesc("kc-user", List.of("CURRENT")).size();
    }

    /** 场景 A：existing CURRENT(4000) + PENDING(4200) → approve(4200) 成功 → 恰好一个 CURRENT、旧行 SUPERSEDED。 */
    @Test
    void approveReplacesCurrentWithSingleCurrentRow() {
        final HundredBattleSubmission current = insertRow("CURRENT", 4000, 150);
        final HundredBattleSubmission pending = insertRow("PENDING", 4200, 150);

        service.approve("admin-sub", pending.getId(), 4200, 150);

        final HundredBattleSubmission oldRow = repository.findById(current.getId()).orElseThrow();
        final HundredBattleSubmission newRow = repository.findById(pending.getId()).orElseThrow();
        assertEquals("SUPERSEDED", oldRow.getStatus());
        assertEquals("CURRENT", newRow.getStatus());
        assertEquals(1, currentCount(), "user+vehicle 必须恰好一个 CURRENT（V18 partial unique index 语义）");
        assertEquals(pending.getId(), repository
                .findByUserKeycloakIdAndVehicleIdAndStatus("kc-user", 385L, "CURRENT").orElseThrow().getId());
    }

    /**
     * 场景 B：提升 PENDING 为 CURRENT 之后制造事务失败（approved_by 超长 varchar(64) →
     * saveAndFlush(submission) 抛 DataIntegrityViolationException）→ 整个事务 rollback：
     * 旧行仍 CURRENT、PENDING 无半完成状态、CURRENT 数量不变。
     */
    @Test
    void approveRollbackKeepsOldCurrentAndPendingUnchanged() {
        final HundredBattleSubmission current = insertRow("CURRENT", 4000, 150);
        final HundredBattleSubmission pending = insertRow("PENDING", 4200, 150);

        assertThrows(DataIntegrityViolationException.class,
                () -> service.approve("x".repeat(200), pending.getId(), 4200, 150));

        final HundredBattleSubmission oldRow = repository.findById(current.getId()).orElseThrow();
        final HundredBattleSubmission pendingRow = repository.findById(pending.getId()).orElseThrow();
        assertEquals("CURRENT", oldRow.getStatus(), "事务回滚后旧行必须仍是 CURRENT");
        assertEquals("PENDING", pendingRow.getStatus(), "事务回滚后 PENDING 不得留下半完成状态");
        assertEquals(1, currentCount(), "rollback 后 CURRENT 数量不变");
        assertTrue(pendingRow.getApprovedAverageDamage() == null, "PENDING 不得残留 approved 值");
    }
}
