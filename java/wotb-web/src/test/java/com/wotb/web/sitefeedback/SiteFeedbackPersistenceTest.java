package com.wotb.web.sitefeedback;

import com.github.dockerjava.api.model.ExposedPort;
import com.github.dockerjava.api.model.PortBinding;
import com.github.dockerjava.api.model.Ports;
import com.wotb.web.sitefeedback.dto.SiteFeedbackReason;
import com.wotb.web.sitefeedback.repository.SiteFeedbackRepository;
import com.wotb.web.sitefeedback.service.SiteFeedbackService;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

@Testcontainers
class SiteFeedbackPersistenceTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("test-only")
            .withCreateContainerCmdModifier(command -> command.getHostConfig().withPortBindings(
                    new PortBinding(Ports.Binding.bindIp("127.0.0.1"), new ExposedPort(5432))));
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private SiteFeedbackService service;
    private JdbcTemplate jdbc;

    @BeforeEach void setup() throws Exception {
        final var ds = new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(ds);
        jdbc.execute("DROP TABLE IF EXISTS site_feedback");
        try (final var connection = ds.getConnection()) {
            ScriptUtils.executeSqlScript(connection, new ClassPathResource("db/migration/V48__create_site_feedback.sql"));
        }
        service = new SiteFeedbackService(new SiteFeedbackRepository(jdbc));
    }

    @Test void independentSubmissionsFilterPageAndDelete() {
        final String body = """
                {"reasonCodes":["BUG"],"feedbackText":"  内容  ","pageView":"hof"}
                """;
        final var first = service.create(JSON.readTree(body));
        final var second = service.create(JSON.readTree(body));
        assertNotEquals(first.id(), second.id());
        assertNotNull(first.createdAt());
        final var stored = service.get(first.id());
        assertEquals("  内容  ", stored.feedbackText());
        assertEquals("hof", stored.pageView());
        assertEquals(List.of(SiteFeedbackReason.BUG), stored.reasonCodes());
        assertEquals(2, service.list(0, 1, "BUG").totalItems());
        assertEquals(second.id(), service.list(0, 1, "BUG").items().getFirst().id());
        assertEquals(first.id(), service.list(1, 1, "BUG").items().getFirst().id());
        assertEquals(0, service.list(0, 25, "OTHER").totalItems());
        service.delete(first.id());
        assertThrows(ApiException.class, () -> service.get(first.id()));
    }

    @Test void acceptsOptionalFieldsAndStoresBlankTextAsNull() {
        final var record = service.get(service.create(JSON.readTree("""
                {"reasonCodes":["OTHER"],"feedbackText":"  ","pageView":null}
                """)).id());
        assertNull(record.feedbackText());
        assertNull(record.pageView());
        assertNotNull(service.create(JSON.readTree("""
                {"reasonCodes":[],"feedbackText":"text"}
                """)));
        assertNotNull(service.create(JSON.readTree(
                "{\"reasonCodes\":[],\"feedbackText\":\"" + "😀".repeat(4000) + "\"}")));
    }

    @Test void rejectsInvalidRequests() {
        for (final String body : List.of(
                "{\"reasonCodes\":[],\"feedbackText\":\"  \"}",
                "{\"reasonCodes\":[\"INVALID\"]}",
                "{\"reasonCodes\":[\"FACT_ERROR\"]}",
                "{\"reasonCodes\":[\"OTHER\",\"OTHER\"]}",
                "{\"reasonCodes\":[\"OTHER\"],\"aiResponseText\":\"reply\"}",
                "{\"reasonCodes\":[\"OTHER\"],\"pageView\":\"Bad View\"}",
                "{\"reasonCodes\":[\"OTHER\"],\"pageView\":\"" + "a".repeat(65) + "\"}",
                "{\"reasonCodes\":[\"OTHER\"],\"feedbackText\":\"bad\\u0000text\"}",
                "{\"reasonCodes\":[\"OTHER\"],\"feedbackText\":\"" + "a".repeat(4001) + "\"}")) {
            assertThrows(ApiException.class, () -> service.create(JSON.readTree(body)), body);
        }
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM site_feedback", Integer.class));
    }

    @Test void rejectsMalformedDuplicateAndOversizedTransport() {
        for (final String body : List.of("{", "{\"reasonCodes\":[],\"reasonCodes\":[\"OTHER\"]}")) {
            assertThrows(ApiException.class, () -> service.createFromStream(new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8))));
        }
        assertThrows(ApiException.class, () -> service.createFromStream(new ByteArrayInputStream(new byte[64 * 1024 + 1])));
    }
}
