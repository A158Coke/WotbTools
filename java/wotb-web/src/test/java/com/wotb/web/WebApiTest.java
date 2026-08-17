package com.wotb.web;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import com.wotb.web.boost.dto.BoosterApplicationSummaryDto;
import com.wotb.web.boost.entity.BoosterApplication;
import com.wotb.web.boost.repository.BoosterApplicationRepository;
import com.wotb.web.leaderboard.entity.LeaderboardRecord;
import com.wotb.web.leaderboard.repository.LeaderboardRecordRepository;
import org.hibernate.resource.jdbc.spi.StatementInspector;
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
import java.util.UUID;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import java.util.zip.ZipInputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
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
        registry.add("wotb.leaderboard.replay-dir", () -> REPLAY_DIR.toString());
        registry.add("wotb.leaderboard.replay-min-free-bytes", () -> "0");
    }

    /** 集成测试专用回放存储目录（每次 JVM 唯一，避免串扰）。 */
    private static final Path REPLAY_DIR = Path.of(
            System.getProperty("java.io.tmpdir"), "wotb-it-replays-" + UUID.randomUUID());


    @Autowired
    WebApplicationContext ctx;

    @Autowired
    BoosterApplicationRepository boosterApplicationRepository;

    @Autowired
    LeaderboardRecordRepository leaderboardRecordRepository;

    private final ObjectMapper om = JsonMapper.builder().build();

    private MockMvc mvc() {
        // 必须挂 springSecurity()：with(jwt()) 依赖 Security filter 填充 SecurityContext，
        // 否则需登录端点（leaderboard upload/download）的 requireUserId 会拿到空上下文直接 401。
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

    @Test
    void ratingEndpointReturnsRealtimeLeaderboard() throws Exception {
        final List<Path> files = replays();
        var req = multipart("/api/rating");
        for (final Path p : files) {
            req = req.file(file(p));
        }
        req = req.file(new MockMultipartFile("files", "dup.wotbreplay",
                "application/octet-stream", Files.readAllBytes(files.getFirst())));

        final String json = mvc().perform(req.contentType(MediaType.MULTIPART_FORM_DATA))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        final JsonNode n = om.readTree(json);
        assertEquals(1, n.get("duplicates").size());
        assertTrue(n.get("rows").size() >= 14);
        final JsonNode cells = n.get("rows").get(0).get("cells");
        assertTrue(cells.has("rating"));
        assertTrue(cells.has("kast"));
        assertTrue(cells.has("contribution"));
        assertTrue(cells.has("impact"));
        assertTrue(cells.get("impact").asText().endsWith("%"));
        assertFalse(cells.has("influence"));
        assertTrue(cells.has("damage_avg"));
        assertTrue(cells.has("potential_damage_avg"));
        assertTrue(cells.has("potential_damage_supplement_avg"));
        assertTrue(cells.has("kills"));
        assertFalse(cells.has("average_hp"));
        assertFalse(cells.has("account_id"));
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
        assertEquals(files.size(), n.get("battles").size());
        assertEquals(1, n.get("duplicates").size());
        // aggregate 仅在 >1 场唯一战斗时由后端输出（ReplayService），单一夹具下为空
        if (files.size() > 1) {
            assertFalse(n.get("aggregate").isEmpty());
        }
        final JsonNode b0 = n.get("battles").get(0);
        assertEquals(14, b0.get("players").size());
        assertTrue(b0.get("players").get(0).get("cells").has("damage_dealt"));
        assertTrue(b0.get("players").get(0).get("cells").has("potential_damage"));
        assertTrue(b0.get("players").get(0).get("cells").has("potential_damage_supplement"));
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

    private static MockMultipartFile leaderboardFile(final Path p) throws Exception {
        return new MockMultipartFile("file", p.getFileName().toString(),
                "application/octet-stream", Files.readAllBytes(p));
    }

    private String leaderboardUpload(final Path p) throws Exception {
        return mvc().perform(multipart("/api/leaderboard/upload")
                        .file(leaderboardFile(p))
                        .with(jwt()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    @Test
    void leaderboardUploadPersistsReplayAndAllowsByteIdenticalDownload() throws Exception {
        final Path replay = replays().getFirst();
        final String json = leaderboardUpload(replay);
        final JsonNode n = om.readTree(json);
        assertEquals("ok", n.get("status").asText());

        final LeaderboardRecord record = leaderboardRecordRepository.findAll().stream()
                .filter(r -> r.getReplayHash() != null)
                .findFirst()
                .orElseThrow();
        assertTrue(record.getReplayHash().matches("[0-9a-f]{64}"));
        assertTrue(Files.exists(REPLAY_DIR.resolve(record.getReplayHash() + ".wotbreplay")),
                "content-addressed file must exist on disk");

        final byte[] original = Files.readAllBytes(replay);
        final var res = mvc().perform(get("/api/leaderboard/" + record.getId() + "/replay")
                        .with(jwt()))
                .andExpect(status().isOk())
                .andReturn().getResponse();
        assertTrue(java.util.Arrays.equals(original, res.getContentAsByteArray()),
                "download must be byte-for-byte identical to upload");
        assertTrue(res.getHeader("Content-Disposition").startsWith("attachment"));
    }

    @Test
    void leaderboardUploadIdempotentForSameFile() throws Exception {
        final Path replay = replays().getFirst();
        leaderboardUpload(replay);
        final long filesAfterFirst = Files.list(REPLAY_DIR)
                .filter(p -> p.getFileName().toString().endsWith(".wotbreplay")).count();

        final String json2 = leaderboardUpload(replay);
        assertEquals("ok", om.readTree(json2).get("status").asText());
        final long filesAfterSecond = Files.list(REPLAY_DIR)
                .filter(p -> p.getFileName().toString().endsWith(".wotbreplay")).count();
        assertEquals(filesAfterFirst, filesAfterSecond, "同文件二次上传不得新增磁盘文件");
    }

    @Test
    void leaderboardUploadRequiresLogin() throws Exception {
        mvc().perform(multipart("/api/leaderboard/upload")
                        .file(leaderboardFile(replays().getFirst())))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void leaderboardDownloadRequiresLogin() throws Exception {
        mvc().perform(get("/api/leaderboard/1/replay"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void leaderboardUploadRejectsCorruptFile() throws Exception {
        final MockMultipartFile bad = new MockMultipartFile("file", "bad.wotbreplay",
                "application/octet-stream", new byte[]{0, 1, 2, 3});
        final String json = mvc().perform(multipart("/api/leaderboard/upload")
                        .file(bad).with(jwt()))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();
        assertTrue(json.contains("INVALID_REPLAY_FILE"));
    }

    @Test
    void leaderboardDownloadOldRecordWithoutFileReturns404() throws Exception {
        final LeaderboardRecord record = new LeaderboardRecord();
        record.setArenaId("no-replay-arena");
        record.setAccountId(4242L);
        record.setNickname("NoReplay");
        record.setTankId(6481L);
        record.setTankName("FV4005");
        record.setDamageDealt(100);
        leaderboardRecordRepository.saveAndFlush(record);
        try {
            mvc().perform(get("/api/leaderboard/" + record.getId() + "/replay").with(jwt()))
                    .andExpect(status().isNotFound());
        } finally {
            leaderboardRecordRepository.delete(record);
            leaderboardRecordRepository.flush();
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