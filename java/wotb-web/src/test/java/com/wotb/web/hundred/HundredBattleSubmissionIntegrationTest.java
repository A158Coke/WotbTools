package com.wotb.web.hundred;

import com.wotb.web.hundred.dto.HundredReplayEvidenceDto;
import com.wotb.web.hundred.entity.HundredAdminLog;
import com.wotb.web.hundred.entity.HundredBattleReplayEvidence;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.repository.HundredAdminLogRepository;
import com.wotb.web.hundred.repository.HundredBattleReplayEvidenceRepository;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import com.wotb.web.hundred.service.HundredModerationService;
import com.wotb.web.hundred.service.HundredReplayEvidenceService;
import com.wotb.web.replayfile.ReplayDownload;
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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
class HundredBattleSubmissionIntegrationTest {

    private static final long WOTB_ACCOUNT_ID = 111L;
    private static final String WOTB_SERVER = "CN";
    private static final String OTHER_SERVER = "EU";

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
    HundredAdminLogRepository auditRepository;

    @Autowired
    HundredBattleReplayEvidenceRepository evidenceRepository;

    @Autowired
    HundredBattleSubmissionService service;

    @Autowired
    HundredModerationService moderationService;

    @Autowired
    HundredReplayEvidenceService evidenceService;

    @BeforeEach
    void clean() {
        evidenceRepository.deleteAll();
        repository.deleteAll();
        auditRepository.deleteAll();
        repository.flush();
    }

    private HundredBattleSubmission insertRow(final String status, final int damage, final int battles) {
        return insertRow(WOTB_SERVER, status, damage, battles);
    }

    private HundredBattleSubmission insertRow(final String server,
                                              final String status,
                                              final int damage,
                                              final int battles) {
        final HundredBattleSubmission s = new HundredBattleSubmission();
        s.setVehicleId(385L);
        s.setVehicleName("Progetto 65");
        s.setWotbServer(server);
        s.setWotbAccountId(WOTB_ACCOUNT_ID);
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
        return currentCount(WOTB_SERVER);
    }

    private long currentCount(final String server) {
        return repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                server, WOTB_ACCOUNT_ID, List.of("CURRENT")).size();
    }

    @Test
    void approveReplacesCurrentWithSingleCurrentRow() throws Exception {
        final HundredBattleSubmission current = insertRow("CURRENT", 4000, 150);
        final HundredBattleSubmission pending = insertRow("PENDING", 4200, 150);
        pending.setProofScreenshot("data:image/png;base64,AAAA");
        repository.saveAndFlush(pending);
        attachCompleteEvidence(pending.getId());

        moderationService.approve("admin-sub", pending.getId());

        final HundredBattleSubmission oldRow = repository.findById(current.getId()).orElseThrow();
        final HundredBattleSubmission newRow = repository.findById(pending.getId()).orElseThrow();
        assertEquals("SUPERSEDED", oldRow.getStatus());
        assertEquals("CURRENT", newRow.getStatus());
        assertEquals(1, currentCount(), "(区服, 账号)+vehicle 必须恰好一个 CURRENT（V22 partial unique index 语义）");
        assertEquals(pending.getId(), repository
                .findByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
                        WOTB_SERVER, WOTB_ACCOUNT_ID, 385L, "CURRENT")
                .orElseThrow().getId());
    }

    @Test
    void sameAccountOnAnotherServerKeepsItsOwnCurrentRow() throws Exception {
        final HundredBattleSubmission cnCurrent = insertRow(WOTB_SERVER, "CURRENT", 4000, 150);
        final HundredBattleSubmission euPending = insertRow(OTHER_SERVER, "PENDING", 4200, 150);
        euPending.setProofScreenshot("data:image/png;base64,AAAA");
        repository.saveAndFlush(euPending);
        attachCompleteEvidence(euPending.getId());

        moderationService.approve("admin-sub", euPending.getId());

        assertEquals("CURRENT", repository.findById(cnCurrent.getId()).orElseThrow().getStatus(),
                "(CN, 111) 的 CURRENT 不得被 (EU, 111) 的 approve 影响");
        assertEquals("CURRENT", repository.findById(euPending.getId()).orElseThrow().getStatus());
        assertEquals(1, currentCount(WOTB_SERVER), "(CN, 111) 恰好一个 CURRENT");
        assertEquals(1, currentCount(OTHER_SERVER), "(EU, 111) 恰好一个 CURRENT");
        assertEquals(2, repository.count(), "跨服同号必须是两条互不覆盖的记录");
    }

    @Test
    void approveRollbackKeepsOldCurrentAndPendingUnchanged() throws Exception {
        final HundredBattleSubmission current = insertRow("CURRENT", 4000, 150);
        final HundredBattleSubmission pending = insertRow("PENDING", 4200, 150);
        pending.setProofScreenshot("data:image/png;base64,AAAA");
        repository.saveAndFlush(pending);
        attachCompleteEvidence(pending.getId());

        assertThrows(DataIntegrityViolationException.class,
                () -> moderationService.approve("x".repeat(200), pending.getId()));

        final HundredBattleSubmission oldRow = repository.findById(current.getId()).orElseThrow();
        final HundredBattleSubmission pendingRow = repository.findById(pending.getId()).orElseThrow();
        assertEquals("CURRENT", oldRow.getStatus(), "事务回滚后旧行必须仍是 CURRENT");
        assertEquals("PENDING", pendingRow.getStatus(), "事务回滚后 PENDING 不得留下半完成状态");
        assertEquals(1, currentCount(), "rollback 后 CURRENT 数量不变");
        assertTrue(pendingRow.getApprovedAverageDamage() == null, "PENDING 不得残留 approved 值");
        assertEquals("data:image/png;base64,AAAA", pendingRow.getProofScreenshot());
        assertEquals(5, evidenceRepository.findBySubmissionIdOrderBySlotAsc(pending.getId()).size());
    }

    @Test
    void evidencePersistenceRoundTripAndRejectCleanup() throws Exception {
        final HundredBattleSubmission s = insertRow("PENDING", 4200, 150);
        s.setProofScreenshot("data:image/png;base64,AAAA");
        repository.saveAndFlush(s);
        final Path storageDir = Path.of("data/replays-it");

        final List<HundredReplayEvidenceService.PendingReplay> replays = new ArrayList<>();
        for (int i = 1; i <= 5; i++) {
            final byte[] data = ("evidence-replay-" + i + "-" + UUID.randomUUID()).getBytes();
            replays.add(new HundredReplayEvidenceService.PendingReplay(
                    i, "battle-" + i + ".wotbreplay", sha256(data), data.length, "arena-" + i, data));
        }
        evidenceService.storeAll(replays);
        evidenceService.attach(s.getId(), replays);

        final List<HundredBattleReplayEvidence> rows =
                evidenceRepository.findBySubmissionIdOrderBySlotAsc(s.getId());
        assertEquals(5, rows.size());
        assertEquals(List.of(1, 2, 3, 4, 5),
                rows.stream().map(HundredBattleReplayEvidence::getSlot).toList());
        for (final HundredBattleReplayEvidence row : rows) {
            assertTrue(Files.exists(storageDir.resolve(row.getSha256() + ".wotbreplay")),
                    "evidence 物理文件必须存在: " + row.getSha256());
        }

        final List<HundredReplayEvidenceDto> dtos = evidenceService.adminListEvidence(s.getId());
        assertEquals(5, dtos.size());
        assertEquals("battle-3.wotbreplay", dtos.get(2).originalFilename());
        final ReplayDownload download = evidenceService.downloadEvidence(s.getId(), rows.get(2).getId());
        assertArrayEquals(replays.get(2).data(), download.data(), "下载必须是用户原始字节");

        moderationService.reject("admin-sub", s.getId(), "SCREENSHOT_MISMATCH", null);

        final HundredBattleSubmission rejected = repository.findById(s.getId()).orElseThrow();
        assertEquals("REJECTED", rejected.getStatus());
        assertNull(rejected.getProofScreenshot());
        assertTrue(evidenceRepository.findBySubmissionIdOrderBySlotAsc(s.getId()).isEmpty());
        for (final HundredBattleReplayEvidence row : rows) {
            assertFalse(Files.exists(storageDir.resolve(row.getSha256() + ".wotbreplay")),
                    "reject 后无引用物理证据应清理: " + row.getSha256());
        }
    }

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

    @Test
    void approveRejectsLegacyPendingWithoutEvidence() {
        final HundredBattleSubmission s = insertRow("PENDING", 4200, 150);
        s.setProofScreenshot("data:image/png;base64,AAAA");
        repository.saveAndFlush(s);

        final IllegalStateException ex = assertThrows(IllegalStateException.class,
                () -> moderationService.approve("admin-sub", s.getId()));
        assertEquals("HUNDRED_INCOMPLETE_REVIEW_EVIDENCE", ex.getMessage());
        assertEquals("PENDING", repository.findById(s.getId()).orElseThrow().getStatus());
        assertEquals(0, currentCount(), "approve 失败不得产生 CURRENT");
        assertTrue(evidenceRepository.findBySubmissionIdOrderBySlotAsc(s.getId()).isEmpty());
    }

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
        assertEquals(5, evidenceRepository.findBySubmissionIdOrderBySlotAsc(s.getId()).size());

        moderationService.approve("admin-sub", s.getId());

        final HundredBattleSubmission approved = repository.findById(s.getId()).orElseThrow();
        assertEquals("CURRENT", approved.getStatus());
        assertNull(approved.getProofScreenshot());
        assertTrue(evidenceRepository.findBySubmissionIdOrderBySlotAsc(s.getId()).isEmpty());
        for (final HundredReplayEvidenceService.PendingReplay r : replays) {
            assertFalse(Files.exists(storageDir.resolve(r.sha256() + ".wotbreplay")),
                    "approve 后无引用物理证据应清理: " + r.sha256());
        }
    }

    @Test
    void hardDeleteIsStatusIndependentAndRemovesRowEvidenceButKeepsAudit() throws Exception {
        final Path storageDir = Path.of("data/replays-it");
        for (final String status : List.of("SUPERSEDED", "DELETED")) {
            final HundredBattleSubmission s = insertRow(status, 4200, 150);
            s.setProofScreenshot("data:image/png;base64,AAAA");
            repository.saveAndFlush(s);
            attachCompleteEvidence(s.getId());
            assertEquals(5, evidenceRepository.findBySubmissionIdOrderBySlotAsc(s.getId()).size());
            final List<String> beforeHashes = evidenceRepository
                    .findBySubmissionIdOrderBySlotAsc(s.getId()).stream()
                    .map(HundredBattleReplayEvidence::getSha256).distinct().toList();

            moderationService.deleteSubmission("admin-sub", "admin-user", s.getId(), "ADMIN_CORRECTION", "cleanup");

            // 业务行与证据行物理消失（FK RESTRICT 满足：先删证据行再删 submission 行）
            assertTrue(repository.findById(s.getId()).isEmpty(),
                    status + " submission 行必须物理删除");
            assertTrue(evidenceRepository.findBySubmissionIdOrderBySlotAsc(s.getId()).isEmpty(),
                    status + " 回放证据元数据必须物理删除");
            // 删除前取到的 5 个 hash：无引用物理文件必须实际消失（空循环会掩盖文件泄漏）
            assertEquals(5, beforeHashes.size(), status + " 删除前必须有 5 个证据 hash");
            for (final String hash : beforeHashes) {
                assertFalse(Files.exists(storageDir.resolve(hash + ".wotbreplay")),
                        status + " 无引用物理证据应清理: " + hash);
            }
            // 审计快照独立存活，记录删除前原始状态
            final List<HundredAdminLog> logs =
                    auditRepository.findBySubmissionIdOrderByIdAsc(s.getId());
            assertEquals(1, logs.size(), status + " 必须留下恰好一条审计快照");
            final HundredAdminLog log = logs.get(0);
            assertEquals(status, log.getOriginalStatus());
            assertEquals(WOTB_SERVER, log.getWotbServer());
            assertEquals(WOTB_ACCOUNT_ID, log.getWotbAccountId());
            assertEquals("ADMIN_CORRECTION", log.getDeleteReason());
            assertEquals("cleanup", log.getDeleteReasonText());
            assertEquals("admin-sub", log.getAdminKeycloakUserId());
            assertEquals("admin-user", log.getAdminUsername());
        }
    }

    @Test
    void hardDeleteOfCurrentDoesNotRestoreOrTouchSupersededHistory() {
        final HundredBattleSubmission superseded = insertRow("CURRENT", 4000, 150);
        superseded.setStatus("SUPERSEDED");
        repository.saveAndFlush(superseded);
        final HundredBattleSubmission current = insertRow("CURRENT", 4100, 150);

        moderationService.deleteSubmission("admin-sub", null, current.getId(), "CHEATING_FORGERY", null);

        assertTrue(repository.findById(current.getId()).isEmpty(), "CURRENT 行必须物理删除");
        final HundredBattleSubmission oldRow = repository.findById(superseded.getId()).orElseThrow();
        assertEquals("SUPERSEDED", oldRow.getStatus(), "删除 CURRENT 不得复活或改写 SUPERSEDED 历史");
    }

    @Test
    void hardDeleteMissingRowReturnsNotFoundAndWritesNoAudit() {
        assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> moderationService.deleteSubmission("admin-sub", null, 999999L, "ADMIN_CORRECTION", null));
        assertTrue(auditRepository.findAll().isEmpty(), "不存在的 id 不得留下假审计");
    }

    @Test
    void hardDeleteFailureWithMissingReasonRollsBackEverything() {
        final HundredBattleSubmission s = insertRow("CURRENT", 4000, 150);
        assertThrows(IllegalArgumentException.class,
                () -> moderationService.deleteSubmission("admin-sub", null, s.getId(), null, null));
        assertTrue(repository.findById(s.getId()).isPresent(), "reason 校验失败不得删除行");
        assertTrue(auditRepository.findAll().isEmpty(), "reason 校验失败不得留下审计");
    }

    @Test
    void hardDeleteKeepsSharedReplayFileUntilLastReferenceIsDeleted() throws Exception {
        final Path storageDir = Path.of("data/replays-it");
        // 两条 submission 共享同一内容寻址回放（同 sha256）
        final byte[] data = ("shared-replay-" + UUID.randomUUID()).getBytes();
        final String hash = sha256(data);
        final HundredReplayEvidenceService.PendingReplay replay =
                new HundredReplayEvidenceService.PendingReplay(1, "shared.wotbreplay", hash, data.length, "arena-1", data);
        evidenceService.storeAll(List.of(replay));
        final HundredBattleSubmission s1 = insertRow("PENDING", 4200, 150);
        // uk_hundred_battle_pending_account_vehicle：同 (server, account, vehicle) 不允许第二条 active PENDING，
        // 共享引用改用跨服另一账号身份
        final HundredBattleSubmission s2 = insertRow(OTHER_SERVER, "PENDING", 4300, 150);
        evidenceService.attach(s1.getId(), List.of(replay));
        evidenceService.attach(s2.getId(), List.of(replay));
        final Path file = storageDir.resolve(hash + ".wotbreplay");
        assertTrue(Files.exists(file), "共享物理文件必须存在");

        moderationService.deleteSubmission("admin-sub", null, s1.getId(), "ADMIN_CORRECTION", null);
        assertTrue(repository.findById(s1.getId()).isEmpty());
        assertTrue(evidenceRepository.findBySubmissionIdOrderBySlotAsc(s1.getId()).isEmpty());
        assertTrue(Files.exists(file), "共享 hash 仍被另一 submission 引用，物理文件必须保留");

        moderationService.deleteSubmission("admin-sub", null, s2.getId(), "ADMIN_CORRECTION", null);
        assertTrue(repository.findById(s2.getId()).isEmpty());
        assertFalse(Files.exists(file), "最后一个引用删除后无引用物理文件应清理: " + hash);
    }

    @Test
    void hardDeleteRejectsOversizedReasonTextWithoutSideEffects() {
        final HundredBattleSubmission s = insertRow("CURRENT", 4000, 150);
        final HundredBattleReplayEvidence evidence = new HundredBattleReplayEvidence();
        evidence.setSubmissionId(s.getId());
        evidence.setSlot(1);
        evidence.setOriginalFilename("a.wotbreplay");
        evidence.setSha256("0".repeat(64));
        evidence.setFileSize(1L);
        evidence.setArenaId("arena-1");
        evidenceRepository.save(evidence);
        evidenceRepository.flush();

        assertThrows(IllegalArgumentException.class,
                () -> moderationService.deleteSubmission("admin-sub", null, s.getId(),
                        "ADMIN_CORRECTION", "x".repeat(501)));

        assertTrue(repository.findById(s.getId()).isPresent(), "超长说明不得删除行");
        assertEquals(1, evidenceRepository.findBySubmissionIdOrderBySlotAsc(s.getId()).size(),
                "超长说明不得删除证据行");
        assertTrue(auditRepository.findAll().isEmpty(), "超长说明不得留下审计");
    }

}
