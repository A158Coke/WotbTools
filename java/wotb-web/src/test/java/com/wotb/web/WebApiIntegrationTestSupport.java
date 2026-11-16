package com.wotb.web;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.hof.dto.ReplayFileMeta;
import com.wotb.web.hof.entity.HallOfFameRecord;
import com.wotb.web.hof.repository.HallOfFameRecordRepository;
import com.wotb.web.hof.service.HallOfFameAdminService;
import com.wotb.web.hof.service.HallOfFameService;
import com.wotb.web.hof.service.RecordOutcome;
import com.wotb.web.replayfile.HallOfFameReplayStorage;
import com.wotb.web.replayfile.ReplayHashLock;
import com.wotb.web.testsupport.ReplayFactsJson;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.IntFunction;
import java.util.stream.Stream;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.Assumptions;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

abstract class WebApiIntegrationTestSupport {

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
    static final Path REPLAY_DIR = Path.of(
            System.getProperty("java.io.tmpdir"), "wotb-it-replays-" + UUID.randomUUID());

    @Autowired
    WebApplicationContext ctx;

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

    final ObjectMapper om = JsonMapper.builder().build();

    MockMvc mvc() {
        // 必须挂 springSecurity()：with(jwt()) 依赖 Security filter 填充 SecurityContext，
        // 否则需登录端点（hof upload/download）的 requireUserId 会拿到空上下文直接 401。
        return MockMvcBuilders.webAppContextSetup(ctx).apply(springSecurity()).build();
    }

    static List<Path> replays() throws Exception {
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

    static MockMultipartFile file(final Path p) throws Exception {
        return new MockMultipartFile("files", p.getFileName().toString(),
                "application/octet-stream", Files.readAllBytes(p));
    }

    /** CW 训练房夹具（arenaBonusType=2），HoF 必须以 UNSUPPORTED_BATTLE_TYPE 拒绝。 */
    static Path trainingRoomFixture() throws Exception {
        final Path p = Path.of(System.getProperty("user.dir"), "..", "..",
                "common", "fixtures", "replays", "cw-training-15-14-example.wotbreplay").normalize();
        Assumptions.assumeTrue(Files.isRegularFile(p), "训练房夹具缺失，跳过");
        return p;
    }

    /**
     * HoF/标准导出场景使用的随机战 fixture（random-battle-example，arenaBonusType=1）。
     * 不依赖 replays() 排序——fixtures/replays 现含 CW 训练房（arenaBonusType=2），
     * HoF 上传会以 UNSUPPORTED_BATTLE_TYPE 拒绝，必须显式选随机战样本。
     */
    static Path standardRandomFixture() throws Exception {
        for (final Path p : replays()) {
            if (p.getFileName().toString().contains("random-battle-example")) {
                return p;
            }
        }
        return replays().getFirst();
    }



    static MockMultipartFile hofFile(final Path p) throws Exception {
        return new MockMultipartFile("file", p.getFileName().toString(),
                "application/octet-stream", Files.readAllBytes(p));
    }

    /** 浏览器随回放一并提交的 facts：与夹具同源的冻结客户端投影（服务器没有 parser）。 */
    static String facts(final Path replay) {
        final String name = replay.getFileName().toString();
        return ReplayFactsJson.fixture(name.substring(0, name.length() - ".wotbreplay".length()));
    }

    String hofUpload(final Path p) throws Exception {
        return mvc().perform(multipart("/api/hof/upload")
                        .file(hofFile(p))
                        .param("facts", facts(p))
                        .with(jwt()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    /**
     * 本类测试共享同一个数据库且不按方法清理：先删掉该夹具回放（按 replay hash）已有的单场记录，
     * 否则方法执行顺序会把「首次上传」变成重复上传（重复上传返回 already_recorded）。
     */
    void clearHofRecordsOf(final Path replay) throws Exception {
        final String hash = HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(replay)));
        final List<HallOfFameRecord> rows = hallOfFameRecordRepository.findAll().stream()
                .filter(r -> hash.equals(r.getReplayHash()))
                .toList();
        hallOfFameRecordRepository.deleteAll(rows);
        hallOfFameRecordRepository.flush();
    }





    static Battle raceBattle(final String arena) {
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

    static ReplayFileMeta raceMeta(final String sha, final String name) {
        return new ReplayFileMeta(sha, name, 1L, "racer-user");
    }

    Map<RecordOutcome, Integer> concurrentRecordRecorder(
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



    static HallOfFameRecord hofRecord(final String arena, final long account, final String nick,
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





    static final String ADMIN_SUB = "admin-sub";

    static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor hofAdminJwt(
            final String role) {
        return jwt().jwt(j -> j.subject(ADMIN_SUB).claim("preferred_username", "admin-user"))
                .authorities(new SimpleGrantedAuthority(role));
    }

    void loginAs(final String sub, final String username) {
        final Jwt jwt = Jwt.withTokenValue("t").header("alg", "none").subject(sub)
                .claim("preferred_username", username).build();
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(jwt, null));
    }

    String storeReplayBytes(final byte[] bytes) throws Exception {
        final byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(bytes);
        final String hex = java.util.HexFormat.of().formatHex(digest);
        hallOfFameReplayStorage.store(bytes, hex);
        return hex;
    }



    public static final class SqlCaptureInspector implements StatementInspector {
        static final ThreadLocal<List<String>> SQL = new ThreadLocal<>();

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

    static Stream<JsonNode> stream(final JsonNode n) {
        final List<JsonNode> nodes = new java.util.ArrayList<>();
        n.forEach(nodes::add);
        return nodes.stream();
    }

}
