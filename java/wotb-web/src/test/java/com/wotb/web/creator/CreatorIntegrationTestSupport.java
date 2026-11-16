package com.wotb.web.creator;

import com.wotb.web.creator.dto.RecommendationDtos;
import com.wotb.web.creator.repository.CreatorRepository;
import com.wotb.web.creator.service.CreatorService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.postgresql.PostgreSQLContainer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

abstract class CreatorIntegrationTestSupport {

    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("test-only");

    @DynamicPropertySource
    static void properties(final DynamicPropertyRegistry registry) {
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
        registry.add("wotb.broadcast.cos.bucket", () -> "");
        registry.add("wotb.tournament.recognition-signing-key", () -> "integration-only-32-byte-signing-secret");
    }

    @Autowired CreatorService service;
    @Autowired CreatorRepository creators;
    @Autowired JdbcTemplate jdbc;
    @Autowired WebApplicationContext web;
    @Autowired PlatformTransactionManager transactions;
    long nextUid;

    @BeforeAll
    static void migrationSeedsOnlyOnce(@Autowired final JdbcTemplate jdbc) {
        assertEquals(List.of("单车高伤回放类", "单车实况类", "直播类", "联赛类", "高手/大神类", "娱乐类"),
                jdbc.queryForList("select name from creator_category order by id", String.class));
        assertEquals(List.of("普通", "高手", "职业级", "殿堂级"),
                jdbc.queryForList("select name from creator_level order by id", String.class));
        jdbc.update("delete from creator_category where id=6");
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()).load().migrate();
        assertEquals(5, jdbc.queryForObject("select count(*) from creator_category", Integer.class));
    }

    @BeforeEach
    void reset() {
        jdbc.execute("truncate creator, creator_avatar, creator_category, creator_level restart identity cascade");
        jdbc.update("insert into creator_category(name) values ('A'),('B'),('C')");
        jdbc.update("insert into creator_level(name) values ('Basic'),('Expert')");
        nextUid = 1000;
    }

    static MockMultipartFile jsonPayload(final String value) {
        return new MockMultipartFile("payload", "", "application/json", value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    static RecommendationDtos.SaveRequest video(final String bv, final List<Long> categories, final Long version) {
        return new RecommendationDtos.SaveRequest("VIDEO", bv, "Video", null, categories, null, 3, "KEEP", version);
    }

    RecommendationDtos.Detail create(final int stars, final List<Long> ids, final Long levelId) {
        return service.createRecommendation(save(Long.toString(++nextUid), stars, ids, levelId, null), null);
    }
    static RecommendationDtos.SaveRequest save(final String uid, final int stars, final List<Long> ids, final Long levelId,
                                              final Long expectedVersion) {
        return new RecommendationDtos.SaveRequest("UP", uid, "Creator", null, ids, levelId, stars, "KEEP", expectedVersion);
    }
    RecommendationDtos.Card card(final long id) {
        return service.recommendations("UP", null).stream().filter(creator -> creator.id() == id).findFirst().orElseThrow();
    }
    static void assertCode(final ApiErrorCode code, final Runnable operation) {
        assertEquals(code, assertThrows(ApiException.class, operation::run).errorCode());
    }
    static String outcome(final Runnable operation) {
        try { operation.run(); return "SUCCESS"; }
        catch (final ApiException e) { return e.errorCode().name(); }
    }
    static <T> List<T> race(final Callable<T> first, final Callable<T> second) throws Exception {
        final CountDownLatch start = new CountDownLatch(1);
        try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            final var a = executor.submit(() -> { assertTrue(start.await(10, TimeUnit.SECONDS)); return first.call(); });
            final var b = executor.submit(() -> { assertTrue(start.await(10, TimeUnit.SECONDS)); return second.call(); });
            start.countDown();
            return List.of(a.get(20, TimeUnit.SECONDS), b.get(20, TimeUnit.SECONDS));
        }
    }

}
