package com.wotb.web;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.boost.dto.BoosterApplicationSummaryDto;
import com.wotb.web.boost.entity.BoosterApplication;
import com.wotb.web.boost.repository.BoosterApplicationRepository;
import com.wotb.web.hof.dto.ReplayFileMeta;
import com.wotb.web.hof.entity.HallOfFameRecord;
import com.wotb.web.hof.repository.HallOfFameRecordRepository;
import com.wotb.web.hof.service.HallOfFameAdminService;
import com.wotb.web.hof.service.HallOfFameService;
import com.wotb.web.hof.service.ReplayHashLock;
import com.wotb.web.hof.service.RecordOutcome;
import com.wotb.web.hof.storage.HallOfFameReplayStorage;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.IntFunction;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Stream;
import java.util.zip.ZipInputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;

/**
 * MockMvc 进程内 REST API 测试 (不绑定端口)。
 */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
public class WebApiTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("wotb")
            .withUsername("wotb")
            .withPassword("wotb");

    @DynamicPropertySource
    static void configure(final DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri",
                () -> "http://test-issuer");
        registry.add("keycloak.admin.server-url", () -> "http://test-keycloak");
        registry.add("keycloak.admin.realm", () -> "test");
        registry.add("keycloak.admin.client-id", () -> "test");
        registry.add("keycloak.admin.client-secret", () -> "test");
        registry.add("spring.jpa.properties.hibernate.session_factory.statement_inspector",
                () -> SqlCaptureInspector.class.getName());
        registry.add("wotb.hof.replay-dir", () -> REPLAY_DIR.toString());
        registry.add("wotb.hof.replay-min-free-bytes", () -> "0");
    }

    /** 集成测试专用回放存储目录（每次 JVM 唯一，避免串扰）。 */
    private static final Path REPLAY_DIR = Path.of(
            System.getProperty("java.io.tmpdir"), "wotb-it-replays-" + UUID.randomUUID());


    @Autowired
    WebApplicationContext ctx;

    @Autowired
    BoosterApplicationRepository boosterApplicationRepository;

    @Autowired
    HallOfFameRecordRepository hallOfFameRecordRepository;

    @Autowired
    HallOfFameService hallOfFameService;

    @Autowired
    HallOfFameAdminService hallOfFameAdminService;

    @Autowired
    HallOfFameReplayStorage hallOfFameReplayStorage;

    @Autowired
    ReplayHashLock replayHashLock;

    private final ObjectMapper om = JsonMapper.builder().build();

    private MockMvc mvc() {
        // 必须挂 springSecurity()：with(jwt()) 依赖 Security filter 填充 SecurityContext，
        // 否则需登录端点（hof upload/download）的 requireUserId 会拿到空上下文直接 401。
        return MockMvcBuilders.webAppContextSetup(ctx).apply(springSecurity()).build();
    }

    private static List<Path> replays() throws Exception {
        final List<Path> result = new ArrayList<>();
        final Path committed = Path.of(
                System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays")
                .normalize();
        if (Files.isDirectory(committed)) {
            try (Stream<Path> s = Files.list(committed)) {
                s.filter(p -> p.toString().toLowerCase().endsWith(".wotbreplay"))
                        .sorted()
                        .forEach(result::add);
            }
        }
        final Path local = Path.of(
                System.getProperty("user.dir"), "..", "..", "common", "data")
                .normalize();
        if (Files.isDirectory(local)) {
            try (Stream<Path> s = Files.list(local)) {
                s.filter(p -> p.toString().toLowerCase().endsWith(".wotbreplay"))
                        .sorted()
                        .forEach(result::add);
            }
        }
        Assumptions.assumeTrue(!result.isEmpty(),
                "无真实回放夹具（common/fixtures/replays 或 common/data）");
        return result;
    }

    private static MockMultipartFile file(final Path p) throws Exception {
        return new MockMultipartFile("files", p.getFileName().toString(),
                "application/octet-stream", Files.readAllBytes(p));
    }

    /**
     * HoF/标准导出场景使用的随机战 fixture（random-battle-example，arenaBonusType=1）。
     * 不依赖 replays() 排序——fixtures/replays 现含 CW 训练房（arenaBonusType=2），
     * HoF 上传会以 UNSUPPORTED_BATTLE_TYPE 拒绝，必须显式选随机战样本。
     */
    private static Path standardRandomFixture() throws Exception {
        for (final Path p : replays()) {
            if (p.getFileName().toString().contains("random-battle-example")) {
                return p;
            }
        }
        return replays().getFirst();
    }

    @Test
    void previewMultipleWithDuplicate() throws Exception {
        final List<Path> files = replays();
        var req = multipart("/api/preview");
        for (final Path p : files) {
            req = req.file(file(p));
        }
        req = req.file(new MockMultipartFile("files", "dup.wotbreplay",
                "application/octet-stream", Files.readAllBytes(files.getFirst())));

        final String json = mvc().perform(req.contentType(MediaType.MULTIPART_FORM_DATA))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        final JsonNode n = om.readTree(json);
        // 唯一战斗数按 arenaId 去重：提交夹具（fixtures/replays）与本地可选样本（common/data）
        // 可能含同 arenaId 副本（如 cw-training-15-14-example 与本地 data/20260725_1535 同场）
        final Set<String> uniqueArenas = new HashSet<>();
        for (final Path p : files) {
            uniqueArenas.add(ReplayParser.parse(Files.readAllBytes(p)).arenaId);
        }
        assertEquals(uniqueArenas.size(), n.get("battles").size());
        assertEquals(files.size() - uniqueArenas.size() + 1, n.get("duplicates").size(),
                "重复数 = 跨目录同场副本 + 手工 dup 1 份");
        // aggregate 仅在 >1 场唯一战斗时由后端输出（ReplayService），单一夹具下为空
        if (files.size() > 1) {
            assertFalse(n.get("aggregate").isEmpty());
        }
        final JsonNode b0 = n.get("battles").get(0);
        assertEquals(14, b0.get("players").size());
        assertTrue(b0.get("players").get(0).get("cells").has("damage_dealt"));
        assertFalse(b0.get("players").get(0).get("cells").has("potential_damage"),
                "Potential Damage 已全局移除，API cells 不得再暴露");
        assertFalse(b0.get("players").get(0).get("cells").has("potential_damage_supplement"));
    }

    @Test
    void previewEmbedsMetricsInBattleAndAggregateFromSameProcessing() throws Exception {
        final List<Path> files = replays();
        var req = multipart("/api/preview");
        for (final Path p : files) {
            req = req.file(file(p));
        }

        final String json = mvc().perform(req.contentType(MediaType.MULTIPART_FORM_DATA))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        final JsonNode n = om.readTree(json);
        // 单场玩家表直接内嵌 Contribution/KAST/Impact（复用同一 authoritative facts）
        final JsonNode battleCells = n.get("battles").get(0).get("players").get(0).get("cells");
        assertTrue(battleCells.has("kast"));
        assertTrue(battleCells.has("contribution"));
        assertTrue(battleCells.has("impact"));
        assertFalse(battleCells.has("rating"), "不得再输出 Rating 综合评分");
        // impact 统一为数值契约，前端负责格式化 %（不再是带 % 的字符串）
        assertTrue(battleCells.get("impact").isNumber(), "impact 必须为数值（前端格式化 %）");
        // 汇总列定义同样内嵌跨场表现派生列
        final JsonNode aggCols = n.get("aggregateColumns");
        assertTrue(aggCols.isArray());
        boolean hasContribution = false;
        for (final JsonNode c : aggCols) {
            if ("contribution".equals(c.get("key").asText())) {
                hasContribution = true;
            }
        }
        assertTrue(hasContribution, "汇总表列定义必须包含 contribution");
        // 不再有独立 performance 数组 / performanceColumns
        assertFalse(n.has("performance"));
        assertFalse(n.has("performanceColumns"));
    }

    @Test
    void exportReturnsXlsx() throws Exception {
        final var req = multipart("/api/export").file(file(replays().getFirst()));
        final byte[] body = mvc().perform(req.contentType(MediaType.MULTIPART_FORM_DATA))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();
        assertTrue(body.length > 3000);
        assertEquals('P', body[0]);
        assertEquals('K', body[1]);
    }

    @Test
    void exportEachReturnsZipWithOneXlsxPerReplay() throws Exception {
        final List<Path> files = replays();
        var req = multipart("/api/export").param("mode", "each");
        for (final Path p : files) {
            req = req.file(file(p));
        }

        final byte[] body = mvc().perform(req.contentType(MediaType.MULTIPART_FORM_DATA))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();
        assertEquals('P', body[0]);
        assertEquals('K', body[1]);

        final Set<String> names = new HashSet<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(body))) {
            java.util.zip.ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                names.add(entry.getName());
            }
        }
        assertEquals(files.size(), names.size());
        assertTrue(names.stream().allMatch(n -> n.endsWith(".xlsx")));
    }

    @Test
    void boosterApplicationSummaryQueriesDoNotSelectImageColumns() {
        final BoosterApplication application = new BoosterApplication();
        application.setKeycloakUserId("summary-query-user");
        application.setUserProfileId(100L);
        application.setWotbAccountId(200L);
        application.setWotbNickname("SummaryPlayer");
        application.setWotbServer("CN");
        application.setOverallStatsImage("data:image/png;base64,overall");
        application.setVehicleStatsImage("data:image/png;base64,vehicle");
        application.setRequestedLevel("ELITE");
        application.setQq("123456");
        application.setAvailabilityTier("MONTH_20");
        application.setDailyTimeWindow("20:00-23:00");
        application.setStatus("NEW");
        boosterApplicationRepository.saveAndFlush(application);

        try {
            SqlCaptureInspector.beginCapture();
            final BoosterApplicationSummaryDto allSummary = boosterApplicationRepository
                    .findAllSummaries(PageRequest.of(0, 20))
                    .getContent()
                    .stream()
                    .filter(summary -> application.getId().equals(summary.id()))
                    .findFirst()
                    .orElseThrow();
            assertEquals(application.getId(), allSummary.id());
            assertProjectionSelectExcludesImages();

            SqlCaptureInspector.clear();
            assertTrue(boosterApplicationRepository
                    .findSummariesByStatus("NEW", PageRequest.of(0, 20))
                    .stream()
                    .anyMatch(summary -> application.getId().equals(summary.id())));
            assertProjectionSelectExcludesImages();

            SqlCaptureInspector.clear();
            assertEquals(1, boosterApplicationRepository
                    .findSummariesByKeycloakUserId("summary-query-user")
                    .size());
            assertProjectionSelectExcludesImages();
        } finally {
            SqlCaptureInspector.endCapture();
            boosterApplicationRepository.deleteById(application.getId());
            boosterApplicationRepository.flush();
        }
    }

    private static MockMultipartFile hofFile(final Path p) throws Exception {
        return new MockMultipartFile("file", p.getFileName().toString(),
                "application/octet-stream", Files.readAllBytes(p));
    }

    private String hofUpload(final Path p) throws Exception {
        return mvc().perform(multipart("/api/hof/upload")
                        .file(hofFile(p))
                        .with(jwt()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    @Test
    void hofUploadPersistsReplayAndAllowsByteIdenticalDownload() throws Exception {
        // HoF 只接受随机战（arenaBonusType=1）；fixtures 含 CW 训练房，必须显式选随机战样本
        final Path replay = standardRandomFixture();
        final String json = hofUpload(replay);
        final JsonNode n = om.readTree(json);
        assertEquals("ok", n.get("status").asText());

        final HallOfFameRecord record = hallOfFameRecordRepository.findAll().stream()
                .filter(r -> r.getReplayHash() != null)
                .findFirst()
                .orElseThrow();
        assertTrue(record.getReplayHash().matches("[0-9a-f]{64}"));
        assertTrue(Files.exists(REPLAY_DIR.resolve(record.getReplayHash() + ".wotbreplay")),
                "content-addressed file must exist on disk");

        final byte[] original = Files.readAllBytes(replay);
        final var res = mvc().perform(get("/api/hof/" + record.getId() + "/replay")
                        .with(jwt()))
                .andExpect(status().isOk())
                .andReturn().getResponse();
        assertTrue(java.util.Arrays.equals(original, res.getContentAsByteArray()),
                "download must be byte-for-byte identical to upload");
        assertTrue(res.getHeader("Content-Disposition").startsWith("attachment"));
    }

    @Test
    void hofUploadIdempotentForSameFile() throws Exception {
        final Path replay = standardRandomFixture();
        hofUpload(replay);
        final long filesAfterFirst = Files.list(REPLAY_DIR)
                .filter(p -> p.getFileName().toString().endsWith(".wotbreplay")).count();

        final String json2 = hofUpload(replay);
        assertEquals("ok", om.readTree(json2).get("status").asText());
        final long filesAfterSecond = Files.list(REPLAY_DIR)
                .filter(p -> p.getFileName().toString().endsWith(".wotbreplay")).count();
        assertEquals(filesAfterFirst, filesAfterSecond, "同文件二次上传不得新增磁盘文件");
    }

    @Test
    void hofUploadRequiresLogin() throws Exception {
        mvc().perform(multipart("/api/hof/upload")
                        .file(hofFile(replays().getFirst())))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void hofDownloadRequiresLogin() throws Exception {
        mvc().perform(get("/api/hof/1/replay"))
                .andExpect(status().isUnauthorized());
    }

    /**
     * Blocker 契约（真实训练房夹具 + 真实 parser + 真实 PG/storage）：
     * arenaBonusType=2 → HTTP 400 UNSUPPORTED_BATTLE_TYPE；hall_of_fame DB 零新增/零修改；
     * replay storage 不产生任何 .wotbreplay 文件。
     */
    @Test
    void hofUploadRejectsTrainingRoomReplay() throws Exception {
        final Path training = Path.of(System.getProperty("user.dir"), "..", "..",
                "common", "fixtures", "hall-of-fame", "training-room-example.wotbreplay").normalize();
        Assumptions.assumeTrue(Files.isRegularFile(training), "训练房夹具缺失，跳过");

        final long rowsBefore = hallOfFameRecordRepository.count();
        final long filesBefore = Files.isDirectory(REPLAY_DIR)
                ? Files.list(REPLAY_DIR).filter(p -> p.getFileName().toString().endsWith(".wotbreplay")).count()
                : 0L;

        final String json = mvc().perform(multipart("/api/hof/upload")
                        .file(hofFile(training))
                        .with(jwt()))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();
        final JsonNode n = om.readTree(json);
        assertEquals("UNSUPPORTED_BATTLE_TYPE", n.get("error").asText(), "errorCode 必须为 UNSUPPORTED_BATTLE_TYPE");

        assertEquals(rowsBefore, hallOfFameRecordRepository.count(), "训练房不得新增 hall_of_fame 记录");
        final long filesAfter = Files.isDirectory(REPLAY_DIR)
                ? Files.list(REPLAY_DIR).filter(p -> p.getFileName().toString().endsWith(".wotbreplay")).count()
                : 0L;
        assertEquals(filesBefore, filesAfter, "训练房不得在 replay storage 产生文件");
    }

    @Test
    void hofUploadRejectsCorruptFile() throws Exception {
        final MockMultipartFile bad = new MockMultipartFile("file", "bad.wotbreplay",
                "application/octet-stream", new byte[]{0, 1, 2, 3});
        final String json = mvc().perform(multipart("/api/hof/upload")
                        .file(bad).with(jwt()))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();
        assertTrue(json.contains("INVALID_REPLAY_FILE"));
    }

    @Test
    void hofDownloadOldRecordWithoutFileReturns404() throws Exception {
        final HallOfFameRecord record = new HallOfFameRecord();
        record.setArenaId("no-replay-arena");
        record.setAccountId(4242L);
        record.setNickname("NoReplay");
        record.setTankId(6481L);
        record.setTankName("FV4005");
        record.setBattleType("RANDOM");
        record.setArenaBonusType(1);
        record.setDamageDealt(100);
        hallOfFameRecordRepository.saveAndFlush(record);
        try {
            mvc().perform(get("/api/hof/" + record.getId() + "/replay").with(jwt()))
                    .andExpect(status().isNotFound());
        } finally {
            hallOfFameRecordRepository.delete(record);
            hallOfFameRecordRepository.flush();
        }
    }

    // ── 排行榜 replay metadata DB 并发原子性（真实 PostgreSQL/Testcontainers）────────

    private static Battle raceBattle(final String arena) {
        final Battle b = new Battle();
        b.arenaId = arena;
        b.mapName = "rockfield";
        b.recorder = "Racer";
        b.arenaBonusType = 1;
        final List<PlayerResult> players = new ArrayList<>();
        final PlayerResult rec = new PlayerResult();
        rec.accountId = 111L;
        rec.nickname = "Racer";
        rec.tankId = 6481L;
        rec.damageDealt = 3200;
        players.add(rec);
        b.players = players;
        return b;
    }

    private static ReplayFileMeta raceMeta(final String sha, final String name) {
        return new ReplayFileMeta(sha, name, 1L, "racer-user");
    }

    private Map<RecordOutcome, Integer> concurrentRecordRecorder(
            final Battle battle, final int threads, final IntFunction<ReplayFileMeta> metaSupplier)
            throws Exception {
        final ExecutorService pool = Executors.newFixedThreadPool(threads);
        final CountDownLatch start = new CountDownLatch(1);
        final List<Future<RecordOutcome>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < threads; i++) {
                final int idx = i;
                futures.add(pool.submit(() -> {
                    start.await();
                    return hallOfFameService.recordRecorder(
                            battle, Tankopedia.load(), metaSupplier.apply(idx));
                }));
            }
            start.countDown();
            final Map<RecordOutcome, Integer> counts = new EnumMap<>(RecordOutcome.class);
            for (final Future<RecordOutcome> f : futures) {
                counts.merge(f.get(30, TimeUnit.SECONDS), 1, Integer::sum);
            }
            return counts;
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void concurrentAttachDifferentHashesHasSingleWinnerAndNoOverwrite() throws Exception {
        final String arena = "ra-diff-" + UUID.randomUUID().toString().substring(0, 8);
        final HallOfFameRecord row = new HallOfFameRecord();
        row.setArenaId(arena);
        row.setAccountId(111L);
        row.setNickname("Racer");
        row.setTankId(6481L);
        row.setTankName("FV4005");
        row.setBattleType("RANDOM");
        row.setArenaBonusType(1);
        row.setDamageDealt(100);
        hallOfFameRecordRepository.saveAndFlush(row);

        final String hashA = "a".repeat(64);
        final String hashB = "b".repeat(64);
        final Map<RecordOutcome, Integer> counts = concurrentRecordRecorder(
                raceBattle(arena), 2,
                i -> i == 0 ? raceMeta(hashA, "a.wotbreplay") : raceMeta(hashB, "b.wotbreplay"));

        assertEquals(1, counts.getOrDefault(RecordOutcome.ATTACHED, 0), "只有一个 attach winner");
        assertEquals(1, counts.getOrDefault(RecordOutcome.SKIPPED_HASH_CONFLICT, 0), "loser 必须 SKIPPED_HASH_CONFLICT");
        assertEquals(0, counts.getOrDefault(RecordOutcome.IDEMPOTENT, 0));
        final HallOfFameRecord winner = hallOfFameRecordRepository
                .findByArenaIdAndAccountId(arena, 111L).orElseThrow();
        // DB 最终 hash 是 winner 的（不被 loser 覆盖）
        assertTrue(hashA.equals(winner.getReplayHash()) || hashB.equals(winner.getReplayHash()),
                "DB hash 必须为两个 hash 之一且未被覆盖");
    }

    @Test
    void concurrentAttachSameHashIsAttachedPlusIdempotent() throws Exception {
        final String arena = "ra-same-" + UUID.randomUUID().toString().substring(0, 8);
        final HallOfFameRecord row = new HallOfFameRecord();
        row.setArenaId(arena);
        row.setAccountId(111L);
        row.setNickname("Racer");
        row.setTankId(6481L);
        row.setTankName("FV4005");
        row.setBattleType("RANDOM");
        row.setArenaBonusType(1);
        row.setDamageDealt(100);
        hallOfFameRecordRepository.saveAndFlush(row);

        final String hash = "c".repeat(64);
        final Map<RecordOutcome, Integer> counts = concurrentRecordRecorder(
                raceBattle(arena), 2, i -> raceMeta(hash, "same.wotbreplay"));

        assertEquals(1, counts.getOrDefault(RecordOutcome.ATTACHED, 0));
        assertEquals(1, counts.getOrDefault(RecordOutcome.IDEMPOTENT, 0));
        final HallOfFameRecord winner = hallOfFameRecordRepository
                .findByArenaIdAndAccountId(arena, 111L).orElseThrow();
        assertEquals(hash, winner.getReplayHash());
    }

    @Test
    void concurrentInsertDifferentHashesCreatesOneRowAndLoserConflict() throws Exception {
        final String arena = "ri-diff-" + UUID.randomUUID().toString().substring(0, 8);
        final String hashA = "d".repeat(64);
        final String hashB = "e".repeat(64);
        final Map<RecordOutcome, Integer> counts = concurrentRecordRecorder(
                raceBattle(arena), 2,
                i -> i == 0 ? raceMeta(hashA, "d.wotbreplay") : raceMeta(hashB, "e.wotbreplay"));

        assertEquals(1, counts.getOrDefault(RecordOutcome.SAVED, 0), "只有一个 SAVED");
        assertEquals(1, counts.getOrDefault(RecordOutcome.SKIPPED_HASH_CONFLICT, 0),
                "loser 必须在 re-read winner 后 SKIPPED_HASH_CONFLICT，不得无条件 IDEMPOTENT");
        // 数据库只有一条 (arena_id, account_id)
        assertEquals(1, hallOfFameRecordRepository.findAll().stream()
                .filter(r -> arena.equals(r.getArenaId())).count());
    }

    @Test
    void concurrentInsertSameHashCreatesOneRowAndLoserIdempotent() throws Exception {
        final String arena = "ri-same-" + UUID.randomUUID().toString().substring(0, 8);
        final String hash = "f".repeat(64);
        final Map<RecordOutcome, Integer> counts = concurrentRecordRecorder(
                raceBattle(arena), 2, i -> raceMeta(hash, "same.wotbreplay"));

        assertEquals(1, counts.getOrDefault(RecordOutcome.SAVED, 0));
        assertEquals(1, counts.getOrDefault(RecordOutcome.IDEMPOTENT, 0));
        assertEquals(1, hallOfFameRecordRepository.findAll().stream()
                .filter(r -> arena.equals(r.getArenaId())).count());
        final HallOfFameRecord winner = hallOfFameRecordRepository
                .findByArenaIdAndAccountId(arena, 111L).orElseThrow();
        assertEquals(hash, winner.getReplayHash());
    }

    // ── 名人堂公开查询 / 过滤器 / 排名（真实 PostgreSQL）────────────────────────

    private static HallOfFameRecord hofRecord(final String arena, final long account, final String nick,
                                              final long tankId, final String tankName,
                                              final String battleType, final int arenaBonusType,
                                              final int damage) {
        final HallOfFameRecord r = new HallOfFameRecord();
        r.setArenaId(arena);
        r.setAccountId(account);
        r.setNickname(nick);
        r.setTankId(tankId);
        r.setTankName(tankName);
        r.setBattleType(battleType);
        r.setArenaBonusType(arenaBonusType);
        r.setDamageDealt(damage);
        r.setMapName("rockfield");
        return r;
    }

    @Test
    void publicSearchOrdersRatingBeforeRandomOnEqualDamageWithRanks() throws Exception {
        final List<HallOfFameRecord> rows = List.of(
                hofRecord("rank-rating", 333L, "RankRatingCoke", 424240L, "FV4005", "RATING", 7, 9000),
                hofRecord("rank-random", 444L, "RankRandomCoke", 424240L, "FV4005", "RANDOM", 1, 9000),
                hofRecord("rank-random-8k", 555L, "RankAnother", 424240L, "FV4005", "RANDOM", 1, 8000));
        hallOfFameRecordRepository.saveAll(rows);
        try {
            // tankId 唯一过滤本测试数据，避免其他测试残留记录干扰排序/rank 断言
            final String json = mvc().perform(get("/api/hof").param("tankId", "424240"))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            final JsonNode n = om.readTree(json);
            assertEquals(3, n.get("totalItems").asInt());
            assertEquals("RankRatingCoke", n.get("items").get(0).get("nickname").asText());
            assertEquals(1, n.get("items").get(0).get("rank").asInt());
            assertEquals("RATING", n.get("items").get(0).get("battleType").asText());
            assertEquals("RankRandomCoke", n.get("items").get(1).get("nickname").asText());
            assertEquals(2, n.get("items").get(1).get("rank").asInt());
            assertEquals("RANDOM", n.get("items").get(1).get("battleType").asText());
            assertEquals("RankAnother", n.get("items").get(2).get("nickname").asText());
            assertEquals(3, n.get("items").get(2).get("rank").asInt());
            // 公开边界：不暴露 accountId / arenaId / replayHash / uploadedBy
            assertFalse(n.get("items").get(0).has("accountId"));
            assertFalse(n.get("items").get(0).has("arenaId"));
            assertFalse(n.get("items").get(0).has("replayHash"));
            assertFalse(n.get("items").get(0).has("uploadedBy"));
        } finally {
            hallOfFameRecordRepository.deleteAll(rows);
            hallOfFameRecordRepository.flush();
        }
    }

    @Test
    void publicSearchBattleTypeTankNicknameFiltersCombine() throws Exception {
        final List<HallOfFameRecord> rows = List.of(
                hofRecord("flt-rating-1", 333L, "FltCokeRating", 424242L, "FV4005", "RATING", 7, 9000),
                hofRecord("flt-random-1", 444L, "FltCokeRandom", 424242L, "FV4005", "RANDOM", 1, 9000),
                hofRecord("flt-random-2", 555L, "FltOther", 424243L, "T49", "RANDOM", 1, 8000));
        hallOfFameRecordRepository.saveAll(rows);
        try {
            // battleType=RATING（tankId 限定本测试数据，避免其他测试残留记录干扰计数）
            String json = mvc().perform(get("/api/hof")
                            .param("battleType", "RATING").param("tankId", "424242"))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            assertEquals(1, om.readTree(json).get("totalItems").asInt());
            // tankId filter
            json = mvc().perform(get("/api/hof").param("tankId", "424243"))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            assertEquals(1, om.readTree(json).get("totalItems").asInt());
            // nickname search（模糊）
            json = mvc().perform(get("/api/hof").param("nickname", "FltCoke").param("tankId", "424242"))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            assertEquals(2, om.readTree(json).get("totalItems").asInt());
            // 组合：Rating + tank + nickname
            json = mvc().perform(get("/api/hof")
                            .param("battleType", "RATING").param("tankId", "424242").param("nickname", "FltCoke"))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            final JsonNode n = om.readTree(json);
            assertEquals(1, n.get("totalItems").asInt());
            assertEquals("FltCokeRating", n.get("items").get(0).get("nickname").asText());
        } finally {
            hallOfFameRecordRepository.deleteAll(rows);
            hallOfFameRecordRepository.flush();
        }
    }

    @Test
    void publicSearchRejectsUnknownBattleTypeFilter() throws Exception {
        mvc().perform(get("/api/hof").param("battleType", "TRAINING"))
                .andExpect(status().isBadRequest());
    }

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
        mvc().perform(get("/api/admin/boost/probe").with(jwt().authorities(
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

    private static final String ADMIN_SUB = "admin-sub";

    private static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor hofAdminJwt(
            final String role) {
        return jwt().jwt(j -> j.subject(ADMIN_SUB).claim("preferred_username", "admin-user"))
                .authorities(new SimpleGrantedAuthority(role));
    }

    private void loginAs(final String sub, final String username) {
        final Jwt jwt = Jwt.withTokenValue("t").header("alg", "none").subject(sub)
                .claim("preferred_username", username).build();
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(jwt, null));
    }

    private String storeReplayBytes(final byte[] bytes) throws Exception {
        final byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(bytes);
        final String hex = java.util.HexFormat.of().formatHex(digest);
        hallOfFameReplayStorage.store(bytes, hex);
        return hex;
    }

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

    /**
     * delete(H) + upload(H) 并发不变量（真实 PostgreSQL + 文件系统 + 同一 advisory lock）：
     * 最终绝不允许「DB 引用 H 且 H.wotbreplay 缺失」。允许 A（新记录引用 H 且文件存在）
     * 或 B（无记录引用 H 且文件可删）。多轮执行覆盖两种 lock 顺序。
     */
    @Test
    void concurrentDeleteAndUploadSameHashMaintainsFileInvariant() throws Exception {
        loginAs(ADMIN_SUB, "admin-user");
        final byte[] bytes = "race-replay-bytes".getBytes();
        final String hash = storeReplayBytes(bytes);
        try {
            for (int round = 0; round < 5; round++) {
                final String victimArena = "race-del-" + round + "-" + UUID.randomUUID().toString().substring(0, 8);
                final HallOfFameRecord victim = hofRecord(victimArena, 111L, "Victim", 6481L, "FV4005",
                        "RANDOM", 1, 7000);
                victim.setReplayHash(hash);
                hallOfFameRecordRepository.saveAndFlush(victim);

                final ExecutorService pool = Executors.newFixedThreadPool(2);
                final CountDownLatch start = new CountDownLatch(1);
                try {
                    final Future<?> del = pool.submit(() -> {
                        loginAs(ADMIN_SUB, "admin-user"); // SecurityContext 是 ThreadLocal
                        start.await();
                        hallOfFameAdminService.deleteEntry(victim.getId());
                        return null;
                    });
                    final Future<?> up = pool.submit(() -> {
                        start.await();
                        // 模拟 upload 临界区：storage.store + recordRecorder（同一 hash advisory lock）
                        final Battle b = raceBattle(victimArena + "-new");
                        return replayHashLock.runWithLockResult(hash, () -> {
                            hallOfFameReplayStorage.store(bytes, hash);
                            return hallOfFameService.recordRecorder(b, Tankopedia.load(),
                                    new ReplayFileMeta(hash, "up.wotbreplay", bytes.length, "up-user"));
                        });
                    });
                    start.countDown();
                    del.get(30, TimeUnit.SECONDS);
                    up.get(30, TimeUnit.SECONDS);
                } finally {
                    pool.shutdownNow();
                }

                final long refs = hallOfFameRecordRepository.countByReplayHash(hash);
                final boolean fileExists = Files.exists(REPLAY_DIR.resolve(hash + ".wotbreplay"));
                assertTrue(refs == 0 || fileExists,
                        "round=" + round + " 禁止 dangling reference: refs=" + refs + " fileExists=" + fileExists);
                // 清理本轮记录（round 是循环变量，lambda 需副本）
                final int roundId = round;
                final List<HallOfFameRecord> roundRows = hallOfFameRecordRepository.findAll().stream()
                        .filter(x -> x.getArenaId().startsWith("race-del-" + roundId + "-")).toList();
                hallOfFameRecordRepository.deleteAll(roundRows);
                hallOfFameRecordRepository.flush();
            }
        } finally {
            SecurityContextHolder.clearContext();
        }
    }


    private static void assertProjectionSelectExcludesImages() {
        final List<String> selects = SqlCaptureInspector.statements().stream()
                .map(String::toLowerCase)
                .filter(sql -> sql.stripLeading().startsWith("select"))
                .filter(sql -> sql.contains("booster_application"))
                .toList();
        assertTrue(selects.stream().anyMatch(sql -> sql.contains("wotb_nickname")),
                () -> "Booster application projection SELECT was not captured: " + selects);
        selects.forEach(select -> {
            assertFalse(select.contains("overall_stats_image"), select);
            assertFalse(select.contains("vehicle_stats_image"), select);
        });
    }

    public static final class SqlCaptureInspector implements StatementInspector {
        private static final ThreadLocal<List<String>> SQL = new ThreadLocal<>();

        @Override
        public String inspect(final String sql) {
            final List<String> statements = SQL.get();
            if (statements != null) {
                statements.add(sql);
            }
            return sql;
        }

        static void beginCapture() {
            SQL.set(new ArrayList<>());
        }

        static void clear() {
            final List<String> statements = SQL.get();
            if (statements != null) {
                statements.clear();
            }
        }

        static void endCapture() {
            SQL.remove();
        }

        static List<String> statements() {
            final List<String> statements = SQL.get();
            return statements == null ? List.of() : List.copyOf(statements);
        }
    }

    private static Stream<JsonNode> stream(final JsonNode n) {
        final List<JsonNode> nodes = new java.util.ArrayList<>();
        n.forEach(nodes::add);
        return nodes.stream();
    }
}
