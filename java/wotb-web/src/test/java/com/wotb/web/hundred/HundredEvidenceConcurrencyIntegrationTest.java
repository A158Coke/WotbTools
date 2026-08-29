package com.wotb.web.hundred;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import com.wotb.web.hof.entity.HallOfFameRecord;
import com.wotb.web.hof.repository.HallOfFameRecordRepository;
import com.wotb.web.hof.service.HallOfFameAdminService;
import com.wotb.web.hof.service.HallOfFameService;
import com.wotb.web.hundred.dto.HundredCreateResult;
import com.wotb.web.hundred.entity.HundredBattleReplayEvidence;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.repository.HundredBattleReplayEvidenceRepository;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import com.wotb.web.hundred.service.HundredReplayEvidenceService;
import com.wotb.web.replayfile.HallOfFameReplayStorage;
import com.wotb.web.replayfile.ReplayDownload;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.multipart.MultipartFile;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;

/**
 * 百场 evidence 跨域引用计数与锁协议的真实 PostgreSQL + filesystem 并发回归（PR #101 review blockers）。
 * 不靠 Mockito 证明 PostgreSQL transaction semantics：所有用例走真实 PG（Testcontainers）+ 真实
 * 内容寻址存储（data/replays-concurrency-it）+ 真实 ReplayHashLock（session 级 advisory lock）。
 * ReplayParser 静态 mock 只用于绕过「真实可解析回放 fixture 不足 5 份」的限制——解析发生在锁协议
 * 之前，不属于本次验证范围；锁 → store → DB tx → commit 全部真实执行。
 *
 * <p>覆盖：</p>
 * <ul>
 *   <li>A：HoF admin delete 不得删除仍被 Hundred evidence 引用的物理文件（对称引用计数）</li>
 *   <li>B：Hundred 终态清理不得删除仍被 HoF record 引用的物理文件</li>
 *   <li>C：HoF delete ∥ Hundred create（同 hash）→ 物理 H 必须存在且可下载（锁协议）</li>
 *   <li>D：两个 Hundred create 并发撞 PENDING unique index → 恰好一个 PENDING、败者稳定
 *       HUNDRED_PENDING_EXISTS、无 aborted transaction / advisory lock 失败、无 partial evidence</li>
 * </ul>
 */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
class HundredEvidenceConcurrencyIntegrationTest {

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
        registry.add("wotb.hof.replay-dir", () -> REPLAY_DIR.toString());
    }

    private static final Path REPLAY_DIR = Path.of("data/replays-concurrency-it");
    private static final long VEHICLE = 385L; // Progetto 65 (Tier X)
    private static final long GAME_ID = 111L;
    private static final String USER = "kc-user";

    @Autowired
    HundredBattleSubmissionService submissionService;

    @Autowired
    HundredReplayEvidenceService evidenceService;

    @Autowired
    HallOfFameAdminService hofAdminService;

    @Autowired
    HallOfFameService hofService;

    @Autowired
    HundredBattleSubmissionRepository submissionRepository;

    @Autowired
    HundredBattleReplayEvidenceRepository evidenceRepository;

    @Autowired
    HallOfFameRecordRepository hofRecordRepository;

    @Autowired
    UserProfileRepository userProfileRepository;

    @Autowired
    HallOfFameReplayStorage storage;

    @BeforeEach
    void clean() {
        evidenceRepository.deleteAll();
        submissionRepository.deleteAll();
        hofRecordRepository.deleteAll();
        userProfileRepository.deleteAll();
        submissionRepository.flush();
        clearStorageDir();
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private static void clearStorageDir() {
        for (final Path p : new Path[]{REPLAY_DIR, REPLAY_DIR.resolve(".tmp")}) {
            if (!Files.exists(p)) {
                continue;
            }
            try (var s = Files.list(p)) {
                s.forEach(f -> {
                    try {
                        Files.deleteIfExists(f);
                    } catch (final IOException e) {
                        throw new UncheckedIOException(e);
                    }
                });
            } catch (final IOException e) {
                throw new UncheckedIOException(e);
            }
        }
    }

    private static void loginAdmin() {
        final Jwt jwt = Jwt.withTokenValue("t").header("alg", "none")
                .subject("admin-sub").claim("preferred_username", "admin-user").build();
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(jwt, null));
    }

    private void profile() {
        final UserProfile p = new UserProfile();
        p.setKeycloakUserId(USER);
        p.setUsername("user-" + UUID.randomUUID());
        p.setWotbAccountId(GAME_ID);
        p.setWotbNickname("PlayerOne");
        p.setWotbServer("CN");
        p.setWotbAccountSource("MANUAL");
        p.setUpdatedAt(OffsetDateTime.now());
        userProfileRepository.saveAndFlush(p);
    }

    private HallOfFameRecord hofRecord(final String arenaId, final String hash) {
        final HallOfFameRecord r = new HallOfFameRecord();
        r.setArenaId(arenaId);
        r.setTankId(VEHICLE);
        r.setTankName("Progetto 65");
        r.setAccountId(GAME_ID);
        r.setNickname("PlayerOne");
        r.setBattleType("RANDOM");
        r.setArenaBonusType(1);
        r.setDamageDealt(3200);
        r.setReplayHash(hash);
        r.setReplayFileName("orig.wotbreplay");
        r.setReplaySize((long) hash.length());
        return hofRecordRepository.saveAndFlush(r);
    }

    private HundredBattleSubmission pendingRow() {
        final HundredBattleSubmission s = new HundredBattleSubmission();
        s.setUserKeycloakId(USER);
        s.setVehicleId(VEHICLE);
        s.setVehicleName("Progetto 65");
        s.setGameAccountIdSnapshot(GAME_ID);
        s.setNicknameSnapshot("PlayerOne");
        s.setClaimedAverageDamage(4200);
        s.setClaimedBattleCount(136);
        s.setStatus("PENDING");
        s.setSubmittedAt(OffsetDateTime.now());
        return submissionRepository.saveAndFlush(s);
    }

    private HundredBattleReplayEvidence evidenceRow(final long submissionId, final int slot, final String hash) {
        final HundredBattleReplayEvidence e = new HundredBattleReplayEvidence();
        e.setSubmissionId(submissionId);
        e.setSlot(slot);
        e.setOriginalFilename("b" + slot + ".wotbreplay");
        e.setSha256(hash);
        e.setFileSize(10);
        e.setArenaId("arena-" + slot);
        return evidenceRepository.saveAndFlush(e);
    }

    private static Battle battle(final String arenaId) {
        final Battle b = new Battle();
        b.arenaId = arenaId;
        b.arenaBonusType = 1;
        final PlayerResult p = new PlayerResult();
        p.accountId = GAME_ID;
        p.nickname = "PlayerOne";
        p.tankId = VEHICLE;
        p.damageDealt = 3200;
        b.players = new ArrayList<>(List.of(p));
        return b;
    }

    /**
     * 真实走 createSubmission 全流程（真实锁 + 真实 store + 真实 DB 事务 + commit）；
     * 仅 ReplayParser 静态 mock（thread-local，解析在锁协议之前，非本次验证范围）。
     */
    private HundredCreateResult createWithReplays(final String userId, final List<byte[]> contents) {
        final List<MultipartFile> files = new ArrayList<>();
        for (int i = 0; i < contents.size(); i++) {
            files.add(new MockMultipartFile("replays", "b" + (i + 1) + ".wotbreplay",
                    "application/octet-stream", contents.get(i)));
        }
        try (final MockedStatic<ReplayParser> mocked = org.mockito.Mockito.mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenAnswer(inv ->
                    battle(new String((byte[]) inv.getArgument(0))));
            return submissionService.createSubmission(userId, VEHICLE, 4200, 136,
                    "data:image/png;base64,AAAA", files);
        }
    }

    private static String sha256(final byte[] data) {
        try {
            final MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(data));
        } catch (final NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    // ── Test A：HoF delete 不得删除 Hundred evidence 引用的文件 ────────────

    @Test
    void hofDeleteRetainsFileWhenHundredEvidenceStillReferences() throws Exception {
        profile();
        loginAdmin();
        final byte[] content = "shared-A".getBytes(StandardCharsets.UTF_8);
        final String hash = sha256(content);
        storage.store(content, hash);
        final HallOfFameRecord rec = hofRecord("arena-hof-A", hash);
        final HundredBattleSubmission sub = pendingRow();
        final HundredBattleReplayEvidence evidence = evidenceRow(sub.getId(), 1, hash);

        hofAdminService.deleteEntry(rec.getId());

        // HoF record 已删；Hundred evidence 行 + 物理文件保留；Hundred 下载正常
        assertTrue(hofRecordRepository.findById(rec.getId()).isEmpty());
        assertNotNull(evidenceRepository.findBySubmissionIdAndId(sub.getId(), evidence.getId()).orElse(null));
        final Path phys = REPLAY_DIR.resolve(hash + ".wotbreplay");
        assertTrue(Files.exists(phys), "Hundred 仍引用时物理文件必须保留");
        final ReplayDownload dl = evidenceService.downloadEvidence(sub.getId(), evidence.getId());
        assertArrayEquals(content, dl.data());

        // 终结 Hundred submission → 两域均无引用 → 物理文件最终删除
        evidenceService.discardForSubmission(sub.getId());
        assertFalse(Files.exists(phys), "两域均无引用后物理文件应删除");
        SecurityContextHolder.clearContext();
    }

    // ── Test B：Hundred cleanup 不得删除 HoF 引用的文件 ────────────────────

    @Test
    void hundredCleanupRetainsFileWhenHofRecordStillReferences() throws Exception {
        profile();
        loginAdmin();
        final byte[] content = "shared-B".getBytes(StandardCharsets.UTF_8);
        final String hash = sha256(content);
        storage.store(content, hash);
        final HallOfFameRecord rec = hofRecord("arena-hof-B", hash);
        final HundredBattleSubmission sub = pendingRow();
        evidenceRow(sub.getId(), 1, hash);

        evidenceService.discardForSubmission(sub.getId());

        // Hundred evidence 已清；HoF record + 物理文件保留；HoF 下载正常
        assertTrue(evidenceRepository.findBySubmissionId(sub.getId()).isEmpty());
        assertNotNull(hofRecordRepository.findById(rec.getId()).orElse(null));
        final Path phys = REPLAY_DIR.resolve(hash + ".wotbreplay");
        assertTrue(Files.exists(phys), "HoF 仍引用时物理文件必须保留");
        final ReplayDownload dl = hofService.downloadReplay(rec.getId());
        assertArrayEquals(content, dl.data());

        // 删除 HoF record → 两域均无引用 → 物理文件最终删除
        hofAdminService.deleteEntry(rec.getId());
        assertFalse(Files.exists(phys), "两域均无引用后物理文件应删除");
        SecurityContextHolder.clearContext();
    }

    // ── Test C：HoF delete ∥ Hundred create（同 hash）并发 ─────────────────

    @Test
    void hofDeleteConcurrentWithHundredCreateSameHashKeepsFile() throws Exception {
        profile();
        for (int i = 0; i < 5; i++) {
            evidenceRepository.deleteAll();
            submissionRepository.deleteAll();
            hofRecordRepository.deleteAll();
            submissionRepository.flush();
            clearStorageDir();

            final byte[] hContent = ("shared-C-" + i + "-" + UUID.randomUUID()).getBytes(StandardCharsets.UTF_8);
            final String hash = sha256(hContent);
            storage.store(hContent, hash);
            final HallOfFameRecord rec = hofRecord("arena-hof-C-" + i, hash);

            final List<byte[]> contents = new ArrayList<>();
            contents.add(hContent); // replay1 的 bytes 与 HoF record 同 hash
            contents.add(("r2-" + i).getBytes(StandardCharsets.UTF_8));
            contents.add(("r3-" + i).getBytes(StandardCharsets.UTF_8));
            contents.add(("r4-" + i).getBytes(StandardCharsets.UTF_8));
            contents.add(("r5-" + i).getBytes(StandardCharsets.UTF_8));

            final AtomicReference<Throwable> createError = new AtomicReference<>();
            final CountDownLatch start = new CountDownLatch(1);
            final Thread create = new Thread(() -> {
                try {
                    start.await();
                    createWithReplays(USER, contents);
                } catch (final Throwable t) {
                    createError.set(t);
                }
            }, "hundred-create-" + i);
            final Thread del = new Thread(() -> {
                try {
                    start.await();
                    loginAdmin();
                    hofAdminService.deleteEntry(rec.getId());
                } catch (final Throwable t) {
                    // 记录删除失败会 404——接受（并发下记录可能已被删）；真正需要验证的是文件不变量
                } finally {
                    SecurityContextHolder.clearContext();
                }
            }, "hof-delete-" + i);
            create.start();
            del.start();
            start.countDown();
            create.join(30000);
            del.join(30000);
            assertFalse(create.isAlive(), "create 线程应结束");
            assertFalse(del.isAlive(), "delete 线程应结束");
            assertNull(createError.get(), "Hundred create 必须成功: " + createError.get());

            // Hundred submission 成功 → evidence 行存在 → 物理 H 必须存在且可下载（不变量「DB 引用 H ⇒ H 存在」）
            final HundredBattleSubmission sub = submissionRepository
                    .findByUserKeycloakIdAndVehicleIdAndStatus(USER, VEHICLE, "PENDING").orElseThrow();
            final List<HundredBattleReplayEvidence> rows = evidenceRepository.findBySubmissionIdOrderBySlotAsc(sub.getId());
            assertEquals(5, rows.size());
            final HundredBattleReplayEvidence hRow = rows.stream()
                    .filter(r -> r.getSha256().equals(hash)).findFirst().orElseThrow();
            final Path phys = REPLAY_DIR.resolve(hash + ".wotbreplay");
            assertTrue(Files.exists(phys), "物理 H 必须存在: " + hash);
            assertArrayEquals(hContent, evidenceService.downloadEvidence(sub.getId(), hRow.getId()).data());
        }
    }

    // ── Test D：两个 Hundred create 并发撞 PENDING unique index ───────────

    @Test
    void concurrentCreatesYieldExactlyOnePendingAndCleanLoser() throws Exception {
        profile();
        final List<byte[]> contents = List.of(
                "d1".getBytes(StandardCharsets.UTF_8), "d2".getBytes(StandardCharsets.UTF_8),
                "d3".getBytes(StandardCharsets.UTF_8), "d4".getBytes(StandardCharsets.UTF_8),
                "d5".getBytes(StandardCharsets.UTF_8));
        for (int i = 0; i < 5; i++) {
            evidenceRepository.deleteAll();
            submissionRepository.deleteAll();
            submissionRepository.flush();
            clearStorageDir();

            final AtomicReference<Throwable> e1 = new AtomicReference<>();
            final AtomicReference<Throwable> e2 = new AtomicReference<>();
            final CountDownLatch start = new CountDownLatch(1);
            final Thread t1 = new Thread(() -> {
                try {
                    start.await();
                    createWithReplays(USER, contents);
                } catch (final Throwable t) {
                    e1.set(t);
                }
            }, "create-1-" + i);
            final Thread t2 = new Thread(() -> {
                try {
                    start.await();
                    createWithReplays(USER, contents);
                } catch (final Throwable t) {
                    e2.set(t);
                }
            }, "create-2-" + i);
            t1.start();
            t2.start();
            start.countDown();
            t1.join(30000);
            t2.join(30000);
            assertFalse(t1.isAlive(), "t1 应结束");
            assertFalse(t2.isAlive(), "t2 应结束");

            // 恰好一个 winner；败者稳定 HUNDRED_PENDING_EXISTS，且无 aborted transaction / lock 失败
            final boolean t1Won = e1.get() == null;
            final boolean t2Won = e2.get() == null;
            assertTrue(t1Won != t2Won, "必须恰好一个成功（t1Won=" + t1Won + " t2Won=" + t2Won
                    + " e1=" + e1.get() + " e2=" + e2.get() + ")");
            final Throwable loser = t1Won ? e2.get() : e1.get();
            assertTrue(loser instanceof IllegalStateException, "败者错误类型: " + loser);
            assertTrue(loser.getMessage().contains("HUNDRED_PENDING_EXISTS"), "败者错误码: " + loser);

            // 恰好一个 PENDING + 恰好 5 行 evidence（winner 的，无 partial）
            final List<HundredBattleSubmission> pendings =
                    submissionRepository.findByUserKeycloakIdAndStatusInOrderBySubmittedAtDesc(USER, List.of("PENDING"));
            assertEquals(1, pendings.size(), "必须恰好一个 PENDING");
            final List<HundredBattleReplayEvidence> rows =
                    evidenceRepository.findBySubmissionId(pendings.get(0).getId());
            assertEquals(5, rows.size(), "winner 必须恰好 5 行 evidence");
            for (final HundredBattleReplayEvidence row : rows) {
                assertTrue(Files.exists(REPLAY_DIR.resolve(row.getSha256() + ".wotbreplay")),
                        "winner 的物理文件必须存在: " + row.getSha256());
            }
        }
    }
}
