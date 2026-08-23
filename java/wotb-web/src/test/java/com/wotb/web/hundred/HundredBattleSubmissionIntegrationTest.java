package com.wotb.web.hundred;

import com.wotb.web.hof.dto.ReplayDownload;
import com.wotb.web.hundred.dto.HundredReplayEvidenceDto;
import com.wotb.web.hundred.entity.HundredBattleReplayEvidence;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.repository.HundredBattleReplayEvidenceRepository;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import com.wotb.web.hundred.service.HundredReplayEvidenceService;
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

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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
    HundredBattleReplayEvidenceRepository evidenceRepository;

    @Autowired
    HundredBattleSubmissionService service;

    @Autowired
    HundredReplayEvidenceService evidenceService;

    @BeforeEach
    void clean() {
        // evidence 行有 FK RESTRICT → 先清 evidence 再清 submission
        evidenceRepository.deleteAll();
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
    void approveReplacesCurrentWithSingleCurrentRow() throws Exception {
        final HundredBattleSubmission current = insertRow("CURRENT", 4000, 150);
        final HundredBattleSubmission pending = insertRow("PENDING", 4200, 150);
        pending.setProofScreenshot("data:image/png;base64,AAAA");
        repository.saveAndFlush(pending);
        attachCompleteEvidence(pending.getId());

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
    void approveRollbackKeepsOldCurrentAndPendingUnchanged() throws Exception {
        final HundredBattleSubmission current = insertRow("CURRENT", 4000, 150);
        final HundredBattleSubmission pending = insertRow("PENDING", 4200, 150);
        pending.setProofScreenshot("data:image/png;base64,AAAA");
        repository.saveAndFlush(pending);
        // 通过 APPROVE 前置 evidence 校验（否则会先被 HUNDRED_INCOMPLETE_REVIEW_EVIDENCE 拦截，
        // 测不到 approved_by 溢出导致的 rollback 场景）：附 5 完整 evidence + 物理文件
        attachCompleteEvidence(pending.getId());

        assertThrows(DataIntegrityViolationException.class,
                () -> service.approve("x".repeat(200), pending.getId(), 4200, 150));

        final HundredBattleSubmission oldRow = repository.findById(current.getId()).orElseThrow();
        final HundredBattleSubmission pendingRow = repository.findById(pending.getId()).orElseThrow();
        assertEquals("CURRENT", oldRow.getStatus(), "事务回滚后旧行必须仍是 CURRENT");
        assertEquals("PENDING", pendingRow.getStatus(), "事务回滚后 PENDING 不得留下半完成状态");
        assertEquals(1, currentCount(), "rollback 后 CURRENT 数量不变");
        assertTrue(pendingRow.getApprovedAverageDamage() == null, "PENDING 不得残留 approved 值");
    }

    /**
     * Evidence 全生命周期（真实 PG + 真实文件系统，storage 目录 data/replays-it）：
     * storeAll 落盘 5 文件 → attach 恰好 5 行（slot 1..5）→ admin list/download 可读 →
     * discard 终态清理：行删除 + 物理文件删除（无其他引用）。
     * createSubmission 的解析/校验部分由单元测试（mock ReplayParser）覆盖。
     */
    @Test
    void evidencePersistenceRoundTripWithRealStorage() throws Exception {
        final HundredBattleSubmission s = insertRow("PENDING", 4200, 150);
        final Path storageDir = Path.of("data/replays-it");

        final List<HundredReplayEvidenceService.PendingReplay> replays = new ArrayList<>();
        for (int i = 1; i <= 5; i++) {
            final byte[] data = ("evidence-replay-" + i + "-" + UUID.randomUUID()).getBytes();
            replays.add(new HundredReplayEvidenceService.PendingReplay(
                    i, "battle-" + i + ".wotbreplay", sha256(data), data.length, "arena-" + i, data));
        }
        evidenceService.storeAll(replays);
        evidenceService.attach(s.getId(), replays);

        // 恰好 5 行 + slot 顺序 + 物理文件存在（DB 引用 H ⇒ 物理 H 存在）
        final List<HundredBattleReplayEvidence> rows =
                evidenceRepository.findBySubmissionIdOrderBySlotAsc(s.getId());
        assertEquals(5, rows.size());
        assertEquals(List.of(1, 2, 3, 4, 5),
                rows.stream().map(HundredBattleReplayEvidence::getSlot).toList());
        for (final HundredBattleReplayEvidence row : rows) {
            assertTrue(Files.exists(storageDir.resolve(row.getSha256() + ".wotbreplay")),
                    "evidence 物理文件必须存在: " + row.getSha256());
        }

        // admin list 元数据 + 下载原始字节
        final List<HundredReplayEvidenceDto> dtos = evidenceService.adminListEvidence(s.getId());
        assertEquals(5, dtos.size());
        assertEquals("battle-3.wotbreplay", dtos.get(2).originalFilename());
        final ReplayDownload download = evidenceService.downloadEvidence(s.getId(), rows.get(2).getId());
        assertArrayEquals(replays.get(2).data(), download.data(), "下载必须是用户原始字节");

        // 终态清理：行删除 + 物理文件删除（本表与 HoF 均无引用）
        final String firstHash = rows.get(0).getSha256();
        evidenceService.discardForSubmission(s.getId());
        assertTrue(evidenceRepository.findBySubmissionId(s.getId()).isEmpty());
        assertFalse(Files.exists(storageDir.resolve(firstHash + ".wotbreplay")),
                "无引用后物理文件应被清理");
    }

    /** 给 PENDING 附 exactly 5 行 evidence + 物理文件（通过 APPROVE 前置校验用）。 */
    private void attachCompleteEvidence(final long submissionId) throws Exception {
        final List<HundredReplayEvidenceService.PendingReplay> replays = new ArrayList<>();
        for (int i = 1; i <= 5; i++) {
            final byte[] data = ("evidence-" + submissionId + "-" + i + "-" + UUID.randomUUID()).getBytes();
            replays.add(new HundredReplayEvidenceService.PendingReplay(
                    i, "battle-" + i + ".wotbreplay", sha256(data), data.length, "arena-" + i, data));
        }
        evidenceService.storeAll(replays);
        evidenceService.attach(submissionId, replays);
    }

    private static String sha256(final byte[] data) {
        try {
            final MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(data));
        } catch (final NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * Blocker：legacy PENDING（无 replay evidence）无法 APPROVE——backend authoritative 拒绝，
     * status 保持 PENDING、不产生 CURRENT、evidence 无残留。
     */
    @Test
    void approveRejectsLegacyPendingWithoutEvidence() {
        final HundredBattleSubmission s = insertRow("PENDING", 4200, 150);
        s.setProofScreenshot("data:image/png;base64,AAAA");
        repository.saveAndFlush(s);

        final IllegalStateException ex = assertThrows(IllegalStateException.class,
                () -> service.approve("admin-sub", s.getId(), 4200, 150));
        assertEquals("HUNDRED_INCOMPLETE_REVIEW_EVIDENCE", ex.getMessage());
        assertEquals("PENDING", repository.findById(s.getId()).orElseThrow().getStatus());
        assertEquals(0, currentCount(), "approve 失败不得产生 CURRENT");
        assertTrue(evidenceRepository.findBySubmissionId(s.getId()).isEmpty());
    }

    /**
     * Blocker：完整审核证据（screenshot + exactly 5 evidence + 5 物理文件）才允许 APPROVE；
     * 成功后按 terminal lifecycle 清理 evidence 行与物理文件。
     */
    @Test
    void approveWithCompleteEvidenceSucceedsAndCleansEvidence() throws Exception {
        final HundredBattleSubmission s = insertRow("PENDING", 4200, 150);
        s.setProofScreenshot("data:image/png;base64,AAAA");
        repository.saveAndFlush(s);
        final Path storageDir = Path.of("data/replays-it");

        final List<HundredReplayEvidenceService.PendingReplay> replays = new ArrayList<>();
        for (int i = 1; i <= 5; i++) {
            final byte[] data = ("approve-evidence-" + i + "-" + UUID.randomUUID()).getBytes();
            replays.add(new HundredReplayEvidenceService.PendingReplay(
                    i, "battle-" + i + ".wotbreplay", sha256(data), data.length, "arena-" + i, data));
        }
        evidenceService.storeAll(replays);
        evidenceService.attach(s.getId(), replays);
        assertEquals(5, evidenceRepository.findBySubmissionId(s.getId()).size());

        service.approve("admin-sub", s.getId(), 4200, 150);

        assertEquals("CURRENT", repository.findById(s.getId()).orElseThrow().getStatus());
        // 终态：evidence 行同事务删除 + commit 后物理文件清理
        assertTrue(evidenceRepository.findBySubmissionId(s.getId()).isEmpty());
        for (final HundredReplayEvidenceService.PendingReplay r : replays) {
            assertFalse(Files.exists(storageDir.resolve(r.sha256() + ".wotbreplay")),
                    "approve 后物理文件应清理: " + r.sha256());
        }
    }
}
