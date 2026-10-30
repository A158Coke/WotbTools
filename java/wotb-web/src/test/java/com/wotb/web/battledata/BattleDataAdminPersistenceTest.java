package com.wotb.web.battledata;

import com.github.dockerjava.api.model.ExposedPort;
import com.github.dockerjava.api.model.PortBinding;
import com.github.dockerjava.api.model.Ports;
import com.wotb.web.battledata.dto.BattleDataAdminDtos;
import com.wotb.web.battledata.repository.BattleDataAdminRepository;
import com.wotb.web.battledata.service.BattleDataAdminService;
import com.wotb.web.util.apierror.ApiException;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
class BattleDataAdminPersistenceTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("test-only")
            .withCreateContainerCmdModifier(command -> command.getHostConfig().withPortBindings(
                    new PortBinding(Ports.Binding.bindIp("127.0.0.1"), new ExposedPort(5432))));
    private JdbcTemplate jdbc;
    private BattleDataAdminService service;

    @BeforeAll static void migrate() {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()).load().migrate();
    }

    @BeforeEach void setup() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        jdbc.execute("TRUNCATE battle_data_battle RESTART IDENTITY CASCADE");
        service = new BattleDataAdminService(new BattleDataAdminRepository(jdbc));
    }

    private void insert(final int id, final int mode, final int winner, final String map, final String version, final String received) {
        jdbc.update("""
                INSERT INTO battle_data_battle (arena_id,schema_version,arena_bonus_type,map_id,map_key,client_version,
                    winner_team,team1_spawn,team2_spawn,received_at)
                VALUES (?,1,?,1,?,?,?,'NORTH','SOUTH',?::timestamptz)
                """, Integer.toString(id), mode, map, version, winner, received);
    }

    private void insertSpawn(final int id, final int mode, final int winner, final String map, final String team1,
            final String team2, final String received) {
        jdbc.update("""
                INSERT INTO battle_data_battle (arena_id,schema_version,arena_bonus_type,map_id,map_key,client_version,
                    winner_team,team1_spawn,team2_spawn,received_at)
                VALUES (?,1,?,1,?,'11.18',?,?,?,?::timestamptz)
                """, Integer.toString(id), mode, map, winner, team1, team2, received);
    }

    private static BattleDataAdminDtos.SpawnStat stat(final String map, final Integer mode, final String side,
            final long battles, final long wins, final long draws, final long losses) {
        return new BattleDataAdminDtos.SpawnStat(map, mode, side, battles, wins, draws, losses);
    }

    @Test void spawnStatsCountEverySideByModeAndCombinedInsideTheInterval() {
        final String t = "2026-10-02T12:00:00Z";
        insertSpawn(1, 1, 1, "rift", "NORTH", "SOUTH", t);                      // Random: NORTH win / SOUTH loss
        insertSpawn(2, 7, 2, "rift", "NORTH", "SOUTH", t);                      // Rating: SOUTH win / NORTH loss
        insertSpawn(3, 7, 1, "rift", "SOUTH", "NORTH", t);                      // team number is not the side
        insertSpawn(4, 1, 0, "rift", "SOUTH", "NORTH", t);                      // draw on both sides
        insertSpawn(5, 1, 1, "karieri", "WEST", "EAST", t);
        insertSpawn(6, 1, 1, "rift", "NORTH", "SOUTH", "2026-10-01T23:59:59Z"); // before from
        insertSpawn(7, 7, 2, "rift", "NORTH", "SOUTH", "2026-10-03T00:00:00Z"); // exactly to: excluded
        final var stats = service.summary("2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z").spawnStats();
        assertEquals(List.of(
                stat("karieri", null, "EAST", 1, 0, 0, 1), stat("karieri", 1, "EAST", 1, 0, 0, 1),
                stat("karieri", null, "WEST", 1, 1, 0, 0), stat("karieri", 1, "WEST", 1, 1, 0, 0),
                stat("rift", null, "NORTH", 4, 1, 1, 2), stat("rift", 1, "NORTH", 2, 1, 1, 0), stat("rift", 7, "NORTH", 2, 0, 0, 2),
                stat("rift", null, "SOUTH", 4, 2, 1, 1), stat("rift", 1, "SOUTH", 2, 0, 1, 1), stat("rift", 7, "SOUTH", 2, 2, 0, 0)), stats);
        stats.forEach(row -> assertEquals(row.battles(), row.wins() + row.draws() + row.losses()));
        for (final String map : List.of("rift", "karieri")) {
            final var rows = stats.stream().filter(row -> row.mapKey().equals(map)).toList();
            for (final Integer mode : java.util.Arrays.asList(null, 1, 7)) {
                final var sides = rows.stream().filter(row -> java.util.Objects.equals(row.arenaBonusType(), mode)).toList();
                if (sides.isEmpty()) continue;
                assertEquals(2, sides.size());
                assertEquals(sides.get(0).battles(), sides.get(1).battles());
                assertEquals(sides.get(0).draws(), sides.get(1).draws());
                assertEquals(sides.get(0).wins(), sides.get(1).losses());
            }
            for (final String side : rows.stream().map(BattleDataAdminDtos.SpawnStat::side).distinct().toList()) {
                final var bySide = rows.stream().filter(row -> row.side().equals(side)).toList();
                final var combined = bySide.stream().filter(row -> row.arenaBonusType() == null).findFirst().orElseThrow();
                final var modes = bySide.stream().filter(row -> row.arenaBonusType() != null).toList();
                assertEquals(combined.battles(), modes.stream().mapToLong(BattleDataAdminDtos.SpawnStat::battles).sum());
                assertEquals(combined.wins(), modes.stream().mapToLong(BattleDataAdminDtos.SpawnStat::wins).sum());
                assertEquals(combined.draws(), modes.stream().mapToLong(BattleDataAdminDtos.SpawnStat::draws).sum());
                assertEquals(combined.losses(), modes.stream().mapToLong(BattleDataAdminDtos.SpawnStat::losses).sum());
            }
        }
    }

    @Test void summaryAndUtcBoundariesMatchIndependentFixture() {
        // Exactly from is inclusive; exactly to is exclusive; the rows immediately outside stay outside.
        insert(1, 1, 1, "rift", "11.18", "2026-10-01T23:59:59.999999Z");
        insert(2, 7, 0, "malinovka", "11.19", "2026-10-02T00:00:00Z");
        insert(3, 1, 2, "rift", "11.18", "2026-10-02T12:00:00Z");
        insert(4, 7, 1, "neptune", "11.19", "2026-10-02T23:59:59.999999Z");
        insert(5, 1, 2, "rift", "11.18", "2026-10-03T00:00:00Z");
        final var summary = service.summary("2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z");
        assertEquals(5, summary.totalBattles());
        assertEquals(3, summary.windowBattles());
        assertEquals(3, summary.distinctMaps());
        assertEquals(2, summary.distinctClientVersions());
        assertEquals(Instant.parse("2026-10-03T00:00:00Z"), summary.latestReceivedAt());
        assertEquals(List.of(new BattleDataAdminDtos.NumericCount(1, 1), new BattleDataAdminDtos.NumericCount(7, 2)), summary.modes());
        assertEquals(List.of(new BattleDataAdminDtos.NumericCount(0, 1), new BattleDataAdminDtos.NumericCount(1, 1),
                new BattleDataAdminDtos.NumericCount(2, 1)), summary.winnerTeams());
        assertEquals(List.of(new BattleDataAdminDtos.NumericCount(1, 3)), summary.schemaVersions());
        assertEquals(List.of(new BattleDataAdminDtos.DailyCount(java.time.LocalDate.of(2026, 10, 2), 3)), summary.daily());
        assertEquals(List.of(new BattleDataAdminDtos.NamedCount("malinovka", 1, Instant.parse("2026-10-02T00:00:00Z")),
                new BattleDataAdminDtos.NamedCount("neptune", 1, Instant.parse("2026-10-02T23:59:59.999999Z")),
                new BattleDataAdminDtos.NamedCount("rift", 1, Instant.parse("2026-10-02T12:00:00Z"))), summary.maps());
        assertEquals(List.of(new BattleDataAdminDtos.NamedCount("11.19", 2, Instant.parse("2026-10-02T23:59:59.999999Z")),
                new BattleDataAdminDtos.NamedCount("11.18", 1, Instant.parse("2026-10-02T12:00:00Z"))), summary.clientVersions());
    }

    @Test void emptyDatasetIsNotAnError() {
        final var summary = service.summary(null, null);
        assertEquals(0, summary.totalBattles());
        assertEquals(0, summary.windowBattles());
        assertNull(summary.latestReceivedAt());
        assertTrue(summary.modes().isEmpty());
        assertTrue(summary.winnerTeams().isEmpty());
        assertTrue(summary.schemaVersions().isEmpty());
        assertTrue(summary.daily().isEmpty());
        assertTrue(summary.maps().isEmpty());
        assertTrue(summary.clientVersions().isEmpty());
        assertTrue(summary.spawnStats().isEmpty());
        assertTrue(service.list(new BattleDataAdminDtos.Filter(null, null, null, null, null, null, null), null, 25).items().isEmpty());
    }

    @Test void keysetHandlesTiesAndRejectsChangedFilters() {
        for (int i = 1; i <= 7; i++) {
            insert(i, 1, 1, "rift", "11.18", "2026-10-01T00:00:00.123456Z");
        }
        final var filter = new BattleDataAdminDtos.Filter(null, null, null, null, null, null, null);
        final var ids = new HashSet<String>();
        final var ordered = new java.util.ArrayList<String>();
        String cursor = null;
        do {
            final var page = service.list(filter, cursor, 2);
            page.items().forEach(b -> {
                assertTrue(ids.add(b.id()));
                ordered.add(b.id());
            });
            cursor = page.nextCursor();
            if (cursor != null) {
                final String next = cursor;
                assertThrows(ApiException.class, () -> service.list(new BattleDataAdminDtos.Filter(null, null, null, "rift", null, null, null), next, 2));
            }
        } while (cursor != null);
        assertEquals(7, ids.size());
        assertEquals(List.of("7", "6", "5", "4", "3", "2", "1"), ordered);
        assertThrows(ApiException.class, () -> service.list(filter, "invalid", 2));
    }

    @Test void cursorAndDetailPreserveIdsAboveJavascriptSafeInteger() {
        jdbc.update("""
                INSERT INTO battle_data_battle (id,arena_id,schema_version,arena_bonus_type,map_id,map_key,client_version,
                    winner_team,team1_spawn,team2_spawn,received_at) OVERRIDING SYSTEM VALUE
                VALUES (9007199254740993,'9007199254740993',1,1,1,'rift','11.18',1,'NORTH','SOUTH','2026-10-02T00:00:00Z')
                """);
        insert(1, 1, 0, "rift", "11.18", "2026-10-01T00:00:00Z");
        final var filter = new BattleDataAdminDtos.Filter(null, null, null, null, null, null, null);
        final var first = service.list(filter, null, 1);
        assertEquals("9007199254740993", first.items().getFirst().id());
        assertNotNull(first.nextCursor());
        final var second = service.list(filter, first.nextCursor(), 1);
        assertEquals("1", second.items().getFirst().id());
        assertEquals("9007199254740993", service.detail("9007199254740993").battle().id());
        assertThrows(ApiException.class, () -> service.detail("9223372036854775808"));
    }

    @Test void filtersAndRecentCountersReflectStoredObservations() {
        final var now = Instant.now();
        insert(1, 1, 1, "rift", "11.18", now.minusSeconds(3600).toString());
        insert(2, 7, 0, "malinovka", "11.19", now.minusSeconds(3 * 86400).toString());
        insert(3, 1, 2, "rift", "11.19", now.minusSeconds(12 * 86400).toString());
        final var summary = service.summary(null, null);
        assertEquals(3, summary.totalBattles());
        assertEquals(1, summary.last24Hours());
        assertEquals(2, summary.last7Days());
        assertEquals(3, summary.last30Days());
        assertEquals(2, summary.distinctClientVersions());
        assertNotNull(summary.latestReceivedAt());
        final var f = new BattleDataAdminDtos.Filter(now.minusSeconds(86400), null, "1", "rift", 1, "11.18", 1);
        assertEquals("1", service.list(f, null, 25).items().getFirst().arenaId());
        assertTrue(service.list(new BattleDataAdminDtos.Filter(null, null, "999", null, null, null, null), null, 25).items().isEmpty());
        assertThrows(ApiException.class, () -> service.list(f, null, 101));
        assertThrows(ApiException.class, () -> service.list(f, null, 0));
        assertThrows(ApiException.class, () -> service.list(new BattleDataAdminDtos.Filter(null, null, "0", null, null, null, null), null, 25));
        assertThrows(ApiException.class, () -> service.list(new BattleDataAdminDtos.Filter(null, null, "18446744073709551616", null, null, null, null), null, 25));
        assertThrows(ApiException.class, () -> service.list(new BattleDataAdminDtos.Filter(null, null, null, "Rift", null, null, null), null, 25));
        assertThrows(ApiException.class, () -> service.list(new BattleDataAdminDtos.Filter(null, null, null, null, 2, null, null), null, 25));
        assertThrows(ApiException.class, () -> service.list(new BattleDataAdminDtos.Filter(null, null, null, null, null, "bad version", null), null, 25));
        assertThrows(ApiException.class, () -> service.list(new BattleDataAdminDtos.Filter(null, null, null, null, null, null, 3), null, 25));
        assertThrows(ApiException.class, () -> service.summary("bad", null));
        assertThrows(ApiException.class, () -> service.summary(now.toString(), now.minusSeconds(1).toString()));
    }

    @Test void detailReturnsActualOrderedRowsAndRejectsInvalidIds() {
        insert(1, 1, 0, "rift", "11.18", "2026-10-01T00:00:00Z");
        jdbc.update("INSERT INTO battle_data_vehicle (battle_id,team,slot,vehicle_id) VALUES (1,2,1,9),(1,1,0,8)");
        assertEquals(List.of(new BattleDataAdminDtos.Vehicle(1, 0, 8), new BattleDataAdminDtos.Vehicle(2, 1, 9)), service.detail("1").vehicles());
        assertThrows(ApiException.class, () -> service.detail("2"));
        assertThrows(ApiException.class, () -> service.detail("0"));
        assertThrows(ApiException.class, () -> service.detail("abc"));
    }
}
