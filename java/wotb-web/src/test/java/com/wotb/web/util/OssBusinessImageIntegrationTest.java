package com.wotb.web.util;

import com.sun.net.httpserver.HttpServer;
import com.wotb.web.creator.dto.RecommendationDtos;
import com.wotb.web.creator.service.CreatorAvatarService;
import com.wotb.web.creator.service.CreatorService;
import com.wotb.web.tournament.dto.BroadcastDtos;
import com.wotb.web.tournament.service.BroadcastCoverService;
import com.wotb.web.tournament.service.BroadcastService;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.convention.TestBean;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {"wotb.images.provider=oss", "keycloak.admin.client-secret=test",
        "spring.security.oauth2.resourceserver.jwt.issuer-uri=http://test-issuer"})
class OssBusinessImageIntegrationTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine");
    @DynamicPropertySource static void database(final DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    private record ObjectBytes(String type, byte[] bytes) {}
    private static final ConcurrentHashMap<String, ObjectBytes> objects = new ConcurrentHashMap<>();
    private static HttpServer server;
    @TestBean(name = "ossImageStorage", methodName = "loopbackStorage", enforceOverride = true)
    OssImageStorage storage;
    @Autowired CreatorService directory;
    @Autowired CreatorAvatarService avatars;
    @Autowired BroadcastService broadcasts;
    @Autowired BroadcastCoverService covers;
    @Autowired JdbcTemplate jdbc;

    static OssImageStorage loopbackStorage() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/private-images/", exchange -> {
            try (exchange) {
                final String path = exchange.getRequestURI().getPath();
                switch (exchange.getRequestMethod()) {
                    case "PUT" -> {
                        objects.put(path, new ObjectBytes(exchange.getRequestHeaders().getFirst("Content-Type"),
                                exchange.getRequestBody().readAllBytes()));
                        exchange.sendResponseHeaders(200, -1);
                    }
                    case "GET" -> {
                        final ObjectBytes image = objects.get(path);
                        if (image == null) { exchange.sendResponseHeaders(404, -1); return; }
                        exchange.getResponseHeaders().set("Content-Type", image.type());
                        exchange.sendResponseHeaders(200, image.bytes().length);
                        exchange.getResponseBody().write(image.bytes());
                    }
                    case "DELETE" -> { objects.remove(path); exchange.sendResponseHeaders(204, -1); }
                    default -> exchange.sendResponseHeaders(405, -1);
                }
            }
        });
        server.start();
        return new OssImageStorage(OssImageStorage.build("cn-hangzhou", "fixture", "fixture", "",
                "http://127.0.0.1:" + server.getAddress().getPort(), true, 8, 3_000), "private-images",
                "league-broadcasts/covers/", "creator-avatars/");
    }

    @AfterAll static void stop() { if (server != null) { server.stop(0); } }

    @Test void threeBusinessEntryPointsReadAndRetireTheirOwnObjects() throws Exception {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(1024, 32, BufferedImage.TYPE_INT_RGB), "png", bytes);
        final var image = new MockMultipartFile("image", "source.png", "image/png", bytes.toByteArray());
        for (String type : List.of("UP", "VIDEO")) {
            final long category = directory.addRecommendationCategory(new RecommendationDtos.CategoryRequest(type, "OSS smoke")).id();
            final String externalId = type.equals("UP") ? "8290493" : "BV1AbCdEfGh2";
            final var card = directory.createRecommendation(new RecommendationDtos.SaveRequest(type, externalId,
                    "OSS image", null, List.of(category), null, 3, "REPLACE", null), image);
            final String id = jdbc.queryForObject("select avatar_id from creator where id=?", String.class, card.id());
            final var stored = avatars.load(id);
            assertEquals("image/jpeg", stored.contentType());
            assertEquals(8, ImageIO.read(new ByteArrayInputStream(stored.bytes())).getHeight());
            directory.deleteRecommendation(type, card.id(), card.version());
            assertThrows(ApiException.class, () -> avatars.load(id));
            jdbc.update("update creator_avatar set unreferenced_at=now()-interval '25 hours' where id=?", id);
            avatars.cleanup();
            assertFalse(objects.containsKey("/private-images/creator-avatars/" + id));
        }

        final var season = broadcasts.createSeason(new BroadcastDtos.SeasonCreate("CN", 2026, "OSS", "OSS", null, null)).season();
        final var category = broadcasts.createCategory(season.id(), new BroadcastDtos.CategoryCreate(season.version(), "POINTS"));
        final long points = category.categories().getFirst().id();
        final var node = broadcasts.createNode(points, new BroadcastDtos.NodeCreate(category.season().version(), 1, null)).data();
        final var replay = new BroadcastDtos.ReplaySave(node.season().version(), "OSS replay", "https://example.org/video",
                LocalDate.of(2026, 1, 1), 1, 1, null, List.of("A", "B"), "POV", "REPLACE");
        final var saved = broadcasts.createReplay(node.nodes().getFirst().id(), new BroadcastDtos.TimedReplaySave(replay, null), image).data();
        final var entry = saved.nodes().getFirst().replays().getFirst();
        final String id = entry.coverId();
        assertArrayEquals(bytes.toByteArray(), covers.load(id).bytes());
        broadcasts.deleteReplay(entry.id(), saved.season().version(), true);
        assertThrows(ApiException.class, () -> covers.load(id));
        jdbc.update("update tournament_broadcast_cover set unreferenced_at=now()-interval '25 hours' where id=?", id);
        covers.cleanup();
        assertTrue(objects.isEmpty());
    }
}
