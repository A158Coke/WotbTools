package com.wotb.web.battledata;

import com.github.dockerjava.api.model.ExposedPort;
import com.github.dockerjava.api.model.PortBinding;
import com.github.dockerjava.api.model.Ports;
import com.wotb.web.battledata.repository.BattleDataRepository;
import com.wotb.web.battledata.service.BattleDataService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import org.testcontainers.postgresql.PostgreSQLContainer;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Real migrations and PostgreSQL arbitration, including rollback after parent insertion. */
@Testcontainers
class BattleDataPersistenceTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("test-only")
            .withCreateContainerCmdModifier(command -> command.getHostConfig().withPortBindings(
                    new PortBinding(Ports.Binding.bindIp("127.0.0.1"), new ExposedPort(5432))));
    private JdbcTemplate jdbc;
    private BattleDataService service;

    @BeforeAll static void migrate() {
        final var flyway = Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .connectRetries(5).load();
        flyway.migrate();
        flyway.validate();
        assertEquals("47", flyway.info().current().getVersion().toString());
    }

    @BeforeEach void setup() {
        final var dataSource = new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("TRUNCATE battle_data_battle RESTART IDENTITY CASCADE");
        service = new BattleDataService(new BattleDataRepository(jdbc), new DataSourceTransactionManager(dataSource),
                new SimpleMeterRegistry(), true, 60, 3000, 4096);
    }

    @Test void firstWriteWinsDuplicateDoesNotOverwriteDrawOrDuplicateModels() {
        assertTrue(ingest(payload("18446744073709551615", 1, 0, 123)));
        assertFalse(ingest(payload("18446744073709551615", 7, 2, 456)));
        counts(1, 14);
        assertEquals(0, jdbc.queryForObject("SELECT winner_team FROM battle_data_battle", Integer.class));
        assertEquals(14, jdbc.queryForObject("SELECT count(*) FROM battle_data_vehicle WHERE vehicle_id=123", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT arena_bonus_type FROM battle_data_battle", Integer.class));
    }

    @Test void invalidCannotReserveArenaAndSafeErrorsContainNoInput() {
        final String valid = payload("42", 7, 1, 321);
        final List<String> invalid = List.of(
                valid.replace("\"schemaVersion\":1", "\"schemaVersion\":2"),
                valid.replace("\"schemaVersion\":1", "\"schemaVersion\":\"1\""),
                valid.replace("\"schemaVersion\":1", "\"schemaVersion\":null"),
                valid.replace("\"schemaVersion\":1,", ""),
                valid.replace("\"arenaBonusType\":7", "\"arenaBonusType\":2"),
                valid.replace("\"arenaId\":\"42\"", "\"arenaId\":42"),
                valid.replace("\"42\"", "\"042\""),
                valid.replace("\"42\"", "\"18446744073709551616\""),
                valid.replace("\"mapId\":43", "\"mapId\":2147483648"),
                valid.replace("\"mapId\":43", "\"mapId\":43.5"),
                valid.replace("\"mapId\":43", "\"mapId\":43.00000000000000000001"),
                valid.replace("\"schemaVersion\":1", "\"schemaVersion\":1.00000000000000000001"),
                valid.replace("\"mapId\":43", "\"mapId\":false"),
                valid.replace("\"mapKey\":\"rift\"", "\"mapKey\":\"Rift\""),
                valid.replace("\"clientVersion\":\"11.18.0_china_apple\"", "\"clientVersion\":\"secret nickname\""),
                valid.replace("\"winnerTeam\":1", "\"winnerTeam\":3"),
                valid.replace("\"team\":2", "\"team\":1"),
                valid.replace("\"SOUTH\"", "\"NORTH\""),
                valid.replace("\"SOUTH\"", "\"WEST\""),
                valid.replace("321,321,321,321,321,321,321", "321,321"),
                valid.replace("321", "0"),
                valid.replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"accountId\":\"sensitive\""),
                valid.replace("\"team\":1", "\"nickname\":\"sensitive\",\"team\":1"),
                valid.replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"schemaVersion\":1"),
                valid + " {}", "{\"sensitive\":", "null", "[]");
        for (final String body : invalid) {
            final ApiException error = assertThrows(ApiException.class, () -> ingest(body));
            assertEquals(ApiErrorCode.INVALID_REQUEST, error.errorCode());
            assertEquals("INVALID_REQUEST", error.getMessage());
            assertNull(error.getCause());
            counts(0, 0);
        }
        assertTrue(ingest(valid));
        counts(1, 14);
    }

    @Test void concurrentDifferentObservationsKeepExactlyOneCompleteWinner() throws Exception {
        final int clients = 12;
        final var barrier = new CyclicBarrier(clients);
        try (final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            final List<java.util.concurrent.Future<Boolean>> outcomes = new ArrayList<>();
            for (int i = 0; i < clients; i++) {
                final int vehicle = i + 1;
                outcomes.add(executor.submit(() -> {
                    barrier.await(10, TimeUnit.SECONDS);
                    return ingest(payload("123456", 1, vehicle % 3, vehicle));
                }));
            }
            int created = 0;
            for (final var outcome : outcomes) {
                if (outcome.get(20, TimeUnit.SECONDS)) { created++; }
            }
            assertEquals(1, created);
        }
        counts(1, 14);
        assertEquals(1, jdbc.queryForObject("SELECT count(DISTINCT vehicle_id) FROM battle_data_vehicle", Integer.class));
        final int vehicle = jdbc.queryForObject("SELECT vehicle_id FROM battle_data_vehicle LIMIT 1", Integer.class);
        assertEquals(vehicle % 3, jdbc.queryForObject("SELECT winner_team FROM battle_data_battle", Integer.class));
    }

    @Test void childFailureRollsBackParentAndAllowsNextValidObservation() {
        jdbc.execute("ALTER TABLE battle_data_vehicle ADD CONSTRAINT injected_failure CHECK (vehicle_id <> 999)");
        try {
            final ApiException failure = assertThrows(ApiException.class, () -> ingest(payload("99", 1, 1, 999)));
            assertEquals(ApiErrorCode.INTERNAL_ERROR, failure.errorCode());
            assertNull(failure.getCause());
            counts(0, 0);
        } finally {
            jdbc.execute("ALTER TABLE battle_data_vehicle DROP CONSTRAINT injected_failure");
        }
        assertTrue(ingest(payload("99", 1, 2, 123)));
        counts(1, 14);
    }

    @Test void horizontalAndReversedRosterOrderAreValid() {
        final String valid = payload("55", 7, 2, 123).replace("\"NORTH\"", "\"EAST\"").replace("\"SOUTH\"", "\"WEST\"")
                .replace("\"team\":1", "\"team\":9").replace("\"team\":2", "\"team\":1").replace("\"team\":9", "\"team\":2");
        assertTrue(ingest(valid));
        assertEquals("WEST", jdbc.queryForObject("SELECT team1_spawn FROM battle_data_battle", String.class));
        counts(1, 14);
    }

    private boolean ingest(final String body) {
        return service.ingest(body.getBytes(StandardCharsets.UTF_8));
    }

    private void counts(final int battles, final int vehicles) {
        assertEquals(battles, jdbc.queryForObject("SELECT count(*) FROM battle_data_battle", Integer.class));
        assertEquals(vehicles, jdbc.queryForObject("SELECT count(*) FROM battle_data_vehicle", Integer.class));
    }

    static String payload(final String arena, final int mode, final int winner, final int vehicle) {
        final String roster = String.join(",", java.util.Collections.nCopies(7, Integer.toString(vehicle)));
        return """
                {"schemaVersion":1,"arenaId":"%s","arenaBonusType":%d,"mapId":43,"mapKey":"rift",
                 "clientVersion":"11.18.0_china_apple","winnerTeam":%d,"teams":[
                  {"team":1,"spawn":"NORTH","vehicles":[%s]},
                  {"team":2,"spawn":"SOUTH","vehicles":[%s]}]}
                """.formatted(arena, mode, winner, roster, roster);
    }
}
