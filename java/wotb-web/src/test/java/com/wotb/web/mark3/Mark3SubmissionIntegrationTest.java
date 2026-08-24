package com.wotb.web.mark3;

import com.wotb.web.mark3.entity.Mark3Submission;
import com.wotb.web.mark3.repository.Mark3ReplayEvidenceRepository;
import com.wotb.web.mark3.repository.Mark3SubmissionRepository;
import com.wotb.web.mark3.service.Mark3ReplayEvidenceService;
import com.wotb.web.mark3.service.Mark3SubmissionService;
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

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V21 的真实 PostgreSQL + 文件系统回归。验证 active partial unique index 不是仅靠 service 预检，
 * 并覆盖通过时 claimed → approved 冻结与 `${wotb.hof.replay-dir}/mark3` 证据清理。
 */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
class Mark3SubmissionIntegrationTest {

    private static final Path REPLAY_ROOT = Path.of("data/replays-mark3-it");
    private static final long VEHICLE = 385L;
    private static final String USER = "mark3-kc-user";

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
        registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri", () -> "http://test-issuer");
        registry.add("keycloak.admin.server-url", () -> "http://test-keycloak");
        registry.add("keycloak.admin.realm", () -> "test");
        registry.add("keycloak.admin.client-id", () -> "test");
        registry.add("keycloak.admin.client-secret", () -> "test");
        registry.add("wotb.hof.replay-dir", () -> REPLAY_ROOT.toString());
    }

    @Autowired
    Mark3SubmissionRepository submissionRepository;

    @Autowired
    Mark3ReplayEvidenceRepository evidenceRepository;

    @Autowired
    Mark3SubmissionService submissionService;

    @Autowired
    Mark3ReplayEvidenceService evidenceService;

    @BeforeEach
    void clean() throws Exception {
        evidenceRepository.deleteAll();
        submissionRepository.deleteAll();
        submissionRepository.flush();
        final Path mark3Dir = REPLAY_ROOT.resolve("mark3");
        if (Files.exists(mark3Dir)) {
            try (var files = Files.walk(mark3Dir)) {
                for (final Path file : files.sorted(Comparator.reverseOrder()).toList()) {
                    Files.deleteIfExists(file);
                }
            }
        }
    }

    @Test
    void currentBlocksPendingAtDatabaseLevelAndDeletedAllowsRetry() {
        final Mark3Submission current = insert("CURRENT");

        assertThrows(DataIntegrityViolationException.class, () -> insert("PENDING"));

        submissionService.deleteCurrent("admin", current.getId(), "DATA_ERROR", null);
        final Mark3Submission retry = insert("PENDING");
        assertEquals("PENDING", retry.getStatus());
    }

    @Test
    void approveFreezesClaimsAndCleansDedicatedEvidence() throws Exception {
        final Mark3Submission pending = insert("PENDING");
        final List<Mark3ReplayEvidenceService.PendingReplay> replays = evidence(pending.getId());
        evidenceService.storeAll(replays);
        evidenceService.attach(pending.getId(), replays);

        submissionService.approve("admin", pending.getId());

        final Mark3Submission current = submissionRepository.findById(pending.getId()).orElseThrow();
        assertEquals("CURRENT", current.getStatus());
        assertEquals(123, current.getApprovedBattleCount());
        assertEquals(3_456, current.getApprovedAverageDamage());
        assertEquals(0, current.getApprovedWinRate().compareTo(new BigDecimal("55.25")));
        assertNull(current.getProofScreenshotFirst());
        assertNull(current.getProofScreenshotSecond());
        assertTrue(evidenceRepository.findBySubmissionIdOrderBySlotAsc(pending.getId()).isEmpty());
        for (final Mark3ReplayEvidenceService.PendingReplay replay : replays) {
            assertFalse(Files.exists(REPLAY_ROOT.resolve("mark3").resolve(replay.sha256() + ".wotbreplay")));
            assertFalse(Files.exists(REPLAY_ROOT.resolve(replay.sha256() + ".wotbreplay")));
        }
    }

    private Mark3Submission insert(final String status) {
        final Mark3Submission submission = new Mark3Submission();
        submission.setUserKeycloakId(USER);
        submission.setVehicleId(VEHICLE);
        submission.setVehicleName("Progetto 65");
        submission.setGameAccountIdSnapshot(111L);
        submission.setNicknameSnapshot("PlayerOne");
        submission.setClaimedBattleCount(123);
        submission.setClaimedAverageDamage(3_456);
        submission.setClaimedWinRate(new BigDecimal("55.25"));
        submission.setProofScreenshotFirst("data:image/png;base64,AAAA");
        submission.setProofScreenshotSecond("data:image/jpeg;base64,BBBB");
        submission.setStatus(status);
        submission.setSubmittedAt(OffsetDateTime.now());
        if ("CURRENT".equals(status)) {
            submission.setApprovedBattleCount(123);
            submission.setApprovedAverageDamage(3_456);
            submission.setApprovedWinRate(new BigDecimal("55.25"));
            submission.setApprovedAt(OffsetDateTime.now());
            submission.setApprovedBy("admin");
        }
        return submissionRepository.saveAndFlush(submission);
    }

    private static List<Mark3ReplayEvidenceService.PendingReplay> evidence(final long submissionId) {
        final List<Mark3ReplayEvidenceService.PendingReplay> rows = new ArrayList<>();
        for (int slot = 1; slot <= 5; slot++) {
            final byte[] data = ("mark3-" + submissionId + "-" + slot + "-" + UUID.randomUUID()).getBytes();
            rows.add(new Mark3ReplayEvidenceService.PendingReplay(
                    slot, "battle-" + slot + ".wotbreplay", sha256(data), data.length,
                    "arena-" + slot, data));
        }
        return rows;
    }

    private static String sha256(final byte[] data) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (final NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
