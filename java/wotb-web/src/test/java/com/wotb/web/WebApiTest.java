package com.wotb.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wotb.web.boost.dto.BoosterApplicationSummaryDto;
import com.wotb.web.boost.entity.BoosterApplication;
import com.wotb.web.boost.repository.BoosterApplicationRepository;
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
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import java.util.zip.ZipInputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
    }


    @Autowired
    WebApplicationContext ctx;

    @Autowired
    BoosterApplicationRepository boosterApplicationRepository;

    private final ObjectMapper om = new ObjectMapper();

    private MockMvc mvc() {
        return MockMvcBuilders.webAppContextSetup(ctx).build();
    }

    private static List<Path> replays() throws Exception {
        final Path dir = Path.of(System.getProperty("user.dir"), "..", "..", "common", "data").normalize();
        Assumptions.assumeTrue(Files.isDirectory(dir), "common/data 样本目录不存在, 跳过真实回放 API 回归");
        try (Stream<Path> s = Files.list(dir)) {
            final List<Path> files = s.filter(p -> p.toString().toLowerCase().endsWith(".wotbreplay")).sorted().toList();
            Assumptions.assumeTrue(!files.isEmpty(), "common/data 中没有 .wotbreplay, 跳过真实回放 API 回归");
            return files;
        }
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
        assertFalse(n.get("aggregate").isEmpty());
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
