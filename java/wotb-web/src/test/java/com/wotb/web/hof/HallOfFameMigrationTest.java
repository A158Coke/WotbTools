package com.wotb.web.hof;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers(disabledWithoutDocker = true)
class HallOfFameMigrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("wotb");

    @Test
    void migrateFromLegacySchemaPreservesRowsAndBackfillsBattleType() throws Exception {
        final String url = POSTGRES.getJdbcUrl();
        final String user = POSTGRES.getUsername();
        final String pass = POSTGRES.getPassword();
        final String legacyHash = "a".repeat(64);

        Flyway.configure()
                .dataSource(url, user, pass)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("15"))
                .load().migrate();

        try (Connection c = DriverManager.getConnection(url, user, pass);
             Statement s = c.createStatement()) {
            s.executeUpdate("insert into leaderboard_record " +
                    "(arena_id, tank_id, tank_name, account_id, nickname, damage_dealt, map_name, created_at, " +
                    "replay_hash, replay_file_name, replay_size, replay_uploaded_by) values " +
                    "('legacy-arena-1', 6481, 'FV4005', 111, 'LegacyPlayer', 5000, 'rockfield', now(), '" +
                    legacyHash + "', 'battle.wotbreplay', 12345, 'legacy-uploader')");
            s.executeUpdate("insert into leaderboard_record " +
                    "(arena_id, tank_id, tank_name, account_id, nickname, damage_dealt, map_name, created_at) values " +
                    "('legacy-arena-2', 6481, 'FV4005', 222, 'OldPlayer', 3000, 'rockfield', now())");
        }

        Flyway.configure()
                .dataSource(url, user, pass)
                .locations("classpath:db/migration")
                .load().migrate();

        try (Connection c = DriverManager.getConnection(url, user, pass);
             Statement s = c.createStatement()) {
            assertFalse(tableExists(s, "leaderboard_record"));
            assertTrue(tableExists(s, "hall_of_fame_record"));

            try (ResultSet rs = s.executeQuery(
                    "select count(*), sum(case when battle_type='RANDOM' and arena_bonus_type=1 then 1 else 0 end) " +
                            "from hall_of_fame_record")) {
                assertTrue(rs.next());
                assertEquals(2, rs.getInt(1), "历史行必须保留");
                assertEquals(2, rs.getInt(2), "全部历史行必须 backfill RANDOM/1");
            }
            try (ResultSet rs = s.executeQuery(
                    "select replay_hash, replay_file_name, replay_size, replay_uploaded_by " +
                            "from hall_of_fame_record where arena_id='legacy-arena-1'")) {
                assertTrue(rs.next());
                assertEquals(legacyHash, rs.getString(1));
                assertEquals("battle.wotbreplay", rs.getString(2));
                assertEquals(12345L, rs.getLong(3));
                assertEquals("legacy-uploader", rs.getString(4));
            }
            assertTrue(constraintExists(s, "uk_hall_of_fame_record_arena_player"));
            assertFalse(constraintExists(s, "uk_leaderboard_record_arena_player"));
            assertTrue(constraintExists(s, "ck_hall_of_fame_record_battle_type"));
            assertTrue(indexExists(s, "idx_hall_of_fame_record_damage_dealt"));
            assertFalse(indexExists(s, "idx_leaderboard_record_damage_dealt"));
            assertTrue(indexExists(s, "idx_hall_of_fame_record_replay_hash"));
            assertTrue(tableExists(s, "hall_of_fame_admin_log"));
        }
    }

    private static boolean tableExists(final Statement s, final String table) throws Exception {
        try (ResultSet rs = s.executeQuery(
                "select 1 from information_schema.tables where table_name = '" + table + "'")) {
            return rs.next();
        }
    }

    private static boolean constraintExists(final Statement s, final String constraint) throws Exception {
        try (ResultSet rs = s.executeQuery(
                "select 1 from information_schema.table_constraints where constraint_name = '" + constraint + "'")) {
            return rs.next();
        }
    }

    private static boolean indexExists(final Statement s, final String index) throws Exception {
        try (ResultSet rs = s.executeQuery(
                "select 1 from pg_indexes where indexname = '" + index + "'")) {
            return rs.next();
        }
    }
}
