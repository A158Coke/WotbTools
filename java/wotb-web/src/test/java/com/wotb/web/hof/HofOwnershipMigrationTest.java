package com.wotb.web.hof;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers(disabledWithoutDocker = true)
class HofOwnershipMigrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("wotb");

    @BeforeEach
    void migrateToV21() {
        clean();
        migrateTo("21");
    }

    @Test
    void migratesCleanDataToServerScopedOwnershipWithoutTouchingBusinessState() throws Exception {
        try (Connection c = connection(); Statement s = c.createStatement()) {
            seedProfiles(s);
            seedCleanHundred(s);
            seedCleanMark3(s);
        }

        migrateToLatest();

        try (Connection c = connection(); Statement s = c.createStatement()) {
            assertFalse(columnExists(s, "hundred_battle_submission", "user_keycloak_id"));
            assertFalse(columnExists(s, "hundred_battle_submission", "game_account_id_snapshot"));
            assertTrue(columnExists(s, "hundred_battle_submission", "wotb_account_id"));
            assertTrue(columnExists(s, "hundred_battle_submission", "wotb_server"));
            assertFalse(columnExists(s, "mark3_submission", "user_keycloak_id"));
            assertTrue(columnExists(s, "mark3_submission", "wotb_server"));

            assertEquals("CN", scalar(s,
                    "select wotb_server from hundred_battle_submission where id = 1"));
            assertEquals("ASIA", scalar(s,
                    "select wotb_server from hundred_battle_submission where id = 7"));
            assertEquals("CN", scalar(s,
                    "select wotb_server from mark3_submission where id = 11"));

            assertTrue(indexExists(s, "uk_hundred_battle_pending_account_vehicle"));
            assertTrue(indexExists(s, "uk_hundred_battle_current_account_vehicle"));
            assertTrue(indexExists(s, "idx_hundred_battle_submission_account"));
            assertTrue(indexExists(s, "uk_mark3_submission_active_account_vehicle"));
            assertTrue(indexExists(s, "idx_mark3_submission_account"));
            assertFalse(indexExists(s, "uk_hundred_battle_pending_user_vehicle"));
            assertFalse(indexExists(s, "uk_hundred_battle_current_user_vehicle"));
            assertFalse(indexExists(s, "uk_mark3_submission_active_user_vehicle"));
            assertTrue(indexDefinition(s, "uk_hundred_battle_current_account_vehicle").contains("wotb_server"),
                    "唯一索引必须包含区服维度，否则跨服同号会互相顶掉");
            assertTrue(indexDefinition(s, "uk_mark3_submission_active_account_vehicle").contains("wotb_server"));

            assertEquals("CURRENT", scalar(s, "select status from hundred_battle_submission where id = 1"));
            assertEquals("PENDING", scalar(s, "select status from hundred_battle_submission where id = 3"));
            assertEquals("CURRENT", scalar(s, "select status from hundred_battle_submission where id = 5"));
            assertEquals("DELETED", scalar(s, "select status from hundred_battle_submission where id = 6"));
            assertEquals("CURRENT", scalar(s, "select status from mark3_submission where id = 11"));
            assertEquals("PENDING", scalar(s, "select status from mark3_submission where id = 13"));
            assertNull(scalar(s, "select deleted_by from hundred_battle_submission where id = 6"),
                    "DELETED 行只应保留迁移前的原始审计字段");
            assertEquals(2, count(s, "select count(*) from hundred_battle_replay_evidence"));
            assertEquals(2, count(s, "select count(*) from mark3_replay_evidence"));
            assertEquals(5, count(s,
                    "select count(*) from hundred_battle_submission where proof_screenshot is not null"));
            assertEquals(3, count(s,
                    "select count(*) from mark3_submission where proof_screenshot_first is not null"));
        }
    }

    @Test
    void failsFastWhenHundredHasDuplicateActiveRowsForTheSameAccount() throws Exception {
        try (Connection c = connection(); Statement s = c.createStatement()) {
            seedProfiles(s);
            s.executeUpdate("alter table user_profile drop constraint uk_user_profile_wotb_account");
            insertProfile(s, "kc-x", 100, "CN");
            insertHundred(s, 1, "kc-a", 1001, 100, "CURRENT", "2026-01-01T00:00:00Z");
            insertHundred(s, 2, "kc-x", 1001, 100, "CURRENT", "2026-01-02T00:00:00Z");
            s.executeUpdate(evidenceSql("hundred_battle_replay_evidence", 1));
        }

        final FlywayException failure = assertThrows(FlywayException.class, this::migrateToLatest);
        final String message = fullMessage(failure);
        assertTrue(message.contains("V22 preflight failed"), message);
        assertTrue(message.contains("DUPLICATE ACTIVE ROWS"), message);
        assertTrue(message.contains("vehicle_id=1001"), message);
        assertNoMisleadingBulkDeleteGuidance(message);

        assertV21StateUntouched(2, 1);
    }

    @Test
    void failsFastWhenMark3HasDuplicateActiveRowsForTheSameAccount() throws Exception {
        try (Connection c = connection(); Statement s = c.createStatement()) {
            seedProfiles(s);
            s.executeUpdate("alter table user_profile drop constraint uk_user_profile_wotb_account");
            insertProfile(s, "kc-x", 900, "ASIA");
            insertProfile(s, "kc-y", 950, "CN");
            insertMark3(s, 11, "kc-c", 3003, 900, "CURRENT", "2026-01-01T00:00:00Z");
            insertMark3(s, 12, "kc-x", 3003, 900, "CURRENT", "2026-01-02T00:00:00Z");
            insertMark3(s, 13, "kc-d", 4004, 950, "CURRENT", "2026-01-03T00:00:00Z");
            insertMark3(s, 14, "kc-y", 4004, 950, "PENDING", "2026-01-04T00:00:00Z");
            s.executeUpdate(evidenceSql("mark3_replay_evidence", 11));
        }

        final FlywayException failure = assertThrows(FlywayException.class, this::migrateToLatest);
        final String message = fullMessage(failure);
        assertTrue(message.contains("V22 preflight failed"), message);
        assertTrue(message.contains("DUPLICATE ACTIVE ROWS"), message);
        assertTrue(message.contains("vehicle_id=3003"), message);
        assertTrue(message.contains("vehicle_id=4004"),
                "跨状态（CURRENT + PENDING）冲突必须一并报出: " + message);
        assertNoMisleadingBulkDeleteGuidance(message);

        try (Connection c = connection(); Statement s = c.createStatement()) {
            assertEquals(4, count(s, "select count(*) from mark3_submission"),
                    "迁移失败不得删除任何业务行");
            assertEquals("CURRENT", scalar(s, "select status from mark3_submission where id = 11"));
            assertEquals("CURRENT", scalar(s, "select status from mark3_submission where id = 12"));
            assertEquals("CURRENT", scalar(s, "select status from mark3_submission where id = 13"));
            assertEquals("PENDING", scalar(s, "select status from mark3_submission where id = 14"));
            assertEquals(1, count(s, "select count(*) from mark3_replay_evidence"),
                    "迁移失败不得删除 evidence");
            assertFalse(columnExists(s, "mark3_submission", "wotb_server"),
                    "迁移失败必须整体回滚，schema 停留在 V21");
        }
    }

    @Test
    void failsFastWhenHistoricalServerCannotBeDerivedInsteadOfGuessing() throws Exception {
        try (Connection c = connection(); Statement s = c.createStatement()) {
            seedProfiles(s);
            insertHundred(s, 1, "kc-a", 1001, 777, "CURRENT", "2026-01-01T00:00:00Z");
        }

        final FlywayException failure = assertThrows(FlywayException.class, this::migrateToLatest);
        final String message = fullMessage(failure);
        assertTrue(message.contains("UNRESOLVED SERVER"), message);
        assertNoMisleadingBulkDeleteGuidance(message);

        try (Connection c = connection(); Statement s = c.createStatement()) {
            assertEquals(1, count(s, "select count(*) from hundred_battle_submission"));
            assertFalse(columnExists(s, "hundred_battle_submission", "wotb_server"));
        }
    }


    private static void seedProfiles(final Statement s) throws Exception {
        insertProfile(s, "kc-a", 100, "CN");
        insertProfile(s, "kc-b", 700, "CN");
        insertProfile(s, "kc-c", 900, "ASIA");
        insertProfile(s, "kc-d", 950, "CN");
    }

    private static void seedCleanHundred(final Statement s) throws Exception {
        insertHundred(s, 1, "kc-a", 1001, 100, "CURRENT", "2026-01-01T00:00:00Z");
        insertHundred(s, 3, "kc-a", 1001, 100, "PENDING", "2026-01-03T00:00:00Z");
        insertHundred(s, 5, "kc-b", 2002, 700, "CURRENT", "2026-01-05T00:00:00Z");
        insertHundred(s, 6, "kc-b", 2002, 700, "DELETED", "2026-01-06T00:00:00Z");
        insertHundred(s, 7, "kc-c", 3003, 900, "CURRENT", "2026-01-07T00:00:00Z");
        s.executeUpdate(evidenceSql("hundred_battle_replay_evidence", 1));
        s.executeUpdate(evidenceSql("hundred_battle_replay_evidence", 3));
    }

    private static void seedCleanMark3(final Statement s) throws Exception {
        insertMark3(s, 11, "kc-a", 1001, 100, "CURRENT", "2026-01-01T00:00:00Z");
        insertMark3(s, 12, "kc-b", 2002, 700, "CURRENT", "2026-01-02T00:00:00Z");
        insertMark3(s, 13, "kc-c", 3003, 900, "PENDING", "2026-01-03T00:00:00Z");
        s.executeUpdate(evidenceSql("mark3_replay_evidence", 11));
        s.executeUpdate(evidenceSql("mark3_replay_evidence", 13));
    }

    private static void insertProfile(final Statement s, final String keycloakUserId,
                                      final long accountId, final String server) throws Exception {
        s.executeUpdate("insert into user_profile "
                + "(keycloak_user_id, username, wotb_account_id, wotb_nickname, wotb_server, updated_at) values ('"
                + keycloakUserId + "', '" + keycloakUserId + "', " + accountId + ", 'Player" + accountId
                + "', '" + server + "', now())");
    }

    private static void insertHundred(final Statement s, final long id, final String keycloakUserId,
                                      final long vehicleId, final long accountId, final String status,
                                      final String submittedAt) throws Exception {
        s.executeUpdate("insert into hundred_battle_submission "
                + "(id, user_keycloak_id, vehicle_id, vehicle_name, game_account_id_snapshot, nickname_snapshot, "
                + "claimed_average_damage, claimed_battle_count, status, proof_screenshot, submitted_at) values ("
                + id + ", '" + keycloakUserId + "', " + vehicleId + ", 'FV4005', " + accountId + ", 'Snap', "
                + "3000, 120, '" + status + "', 'data:image/png;base64,AAAA', '" + submittedAt + "')");
    }

    private static void insertMark3(final Statement s, final long id, final String keycloakUserId,
                                    final long vehicleId, final long accountId, final String status,
                                    final String submittedAt) throws Exception {
        s.executeUpdate("insert into mark3_submission "
                + "(id, user_keycloak_id, vehicle_id, vehicle_name, game_account_id_snapshot, nickname_snapshot, "
                + "claimed_battle_count, claimed_average_damage, claimed_win_rate, status, "
                + "proof_screenshot_first, submitted_at) values ("
                + id + ", '" + keycloakUserId + "', " + vehicleId + ", 'FV4005', " + accountId + ", 'Snap', "
                + "60, 3000, 65.50, '" + status + "', 'data:image/png;base64,AAAA', '" + submittedAt + "')");
    }

    private static String evidenceSql(final String table, final long submissionId) {
        return "insert into " + table
                + " (submission_id, slot, original_filename, sha256, file_size, arena_id) values ("
                + submissionId + ", 1, 'a.wotbreplay', '" + "1".repeat(64) + "', 10, 'arena-" + submissionId + "')";
    }

    private void assertV21StateUntouched(final int expectedRows, final int expectedEvidence) throws Exception {
        try (Connection c = connection(); Statement s = c.createStatement()) {
            assertEquals(expectedRows, count(s, "select count(*) from hundred_battle_submission"),
                    "迁移失败不得删除任何业务行");
            assertEquals("CURRENT", scalar(s, "select status from hundred_battle_submission where id = 1"));
            assertEquals("CURRENT", scalar(s, "select status from hundred_battle_submission where id = 2"));
            assertEquals(expectedEvidence, count(s, "select count(*) from hundred_battle_replay_evidence"),
                    "迁移失败不得删除 evidence");
            assertFalse(columnExists(s, "hundred_battle_submission", "wotb_server"),
                    "迁移失败必须整体回滚，schema 停留在 V21");
            assertFalse(columnExists(s, "hundred_battle_submission", "wotb_account_id"),
                    "迁移失败必须整体回滚，账号列不得被改名");
        }
    }

    @Test
    void migratesEmptyBusinessDatabaseFromScratchWithoutKeycloakCoupling() throws Exception {
        final String scratchDatabase = "wotb_schema_from_scratch";
        try (Connection c = connection(); Statement s = c.createStatement()) {
            s.execute("drop database if exists " + scratchDatabase);
            s.execute("create database " + scratchDatabase);
        }
        final String scratchUrl = POSTGRES.getJdbcUrl().replaceFirst("/[^/?]+(\\?|$)", "/" + scratchDatabase + "$1");

        final org.flywaydb.core.api.output.MigrateResult result = Flyway.configure()
                .dataSource(scratchUrl, POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load().migrate();
        assertTrue(result.migrationsExecuted > 0, "空库必须执行 Flyway 迁移");

        try (Connection c = DriverManager.getConnection(scratchUrl, POSTGRES.getUsername(), POSTGRES.getPassword());
             Statement s = c.createStatement()) {
            for (final String table : new String[]{
                    "hall_of_fame_record", "hall_of_fame_admin_log", "user_profile",
                    "hundred_battle_submission", "mark3_submission"}) {
                assertTrue(tableExists(s, table), "空库迁移后缺少表: " + table);
            }

            assertTrue(columnExists(s, "hall_of_fame_record", "id"), "hall_of_fame_record.id 必须存在");
            s.executeUpdate("insert into hall_of_fame_record"
                    + " (id, arena_id, tank_id, tank_name, account_id, nickname, damage_dealt, map_name,"
                    + " battle_type, arena_bonus_type, replay_uploaded_by) overriding system value values"
                    + " (355, 'arena-355', 6481, 'FV4005', 111, 'LegacyPlayer', 5000, 'rockfield',"
                    + " 'RANDOM', 1, '3f1a4b2c-0000-4000-8000-000000000001')");
            assertEquals(1, count(s, "select count(*) from hall_of_fame_record where id = 355"),
                    "显式 id 必须原样保留");
            s.execute("delete from hall_of_fame_record where id = 355");

            assertTrue(constraintExists(s, "hall_of_fame_record", "uk_hall_of_fame_record_arena_player"),
                    "hall_of_fame_record 必须保留 (arena_id, account_id) 唯一键");
            assertTrue(constraintColumns(s, "uk_hall_of_fame_record_arena_player")
                            .containsAll(List.of("arena_id", "account_id")),
                    "唯一键必须覆盖 arena_id 与 account_id");

            assertEquals("character varying", scalar(s,
                    "select data_type from information_schema.columns"
                            + " where table_name = 'hall_of_fame_record' and column_name = 'replay_uploaded_by'"),
                    "replay_uploaded_by 必须保持字面 varchar，用于承载历史 Keycloak UUID");
            assertTrue(isNullable(s, "hall_of_fame_record", "replay_uploaded_by"),
                    "replay_uploaded_by 必须保持可空（历史行可以没有上传者）");
            final List<String> outbound = foreignKeysFrom(s, "hall_of_fame_record");
            assertTrue(outbound.isEmpty(),
                    "hall_of_fame_record 不允许与 Keycloak/用户表存在外键耦合: " + outbound);
        }
    }


    private Connection connection() throws Exception {
        return DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    private Flyway flyway() {
        return Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .cleanDisabled(false)
                .load();
    }

    private void clean() {
        flyway().clean();
    }

    private void migrateTo(final String version) {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion(version))
                .load().migrate();
    }

    private void migrateToLatest() {
        flyway().migrate();
    }

    private static void assertNoMisleadingBulkDeleteGuidance(final String text) {
        if (text.contains("bulk-delete")) {
            assertTrue(text.contains("NOT available"),
                    "提到 bulk-delete 时必须说明其在迁移失败时不可用: " + text);
        }
    }

    private static String fullMessage(final Throwable throwable) {
        final StringBuilder message = new StringBuilder();
        for (Throwable current = throwable; current != null; current = current.getCause()) {
            message.append(current.getMessage()).append(" | ");
        }
        return message.toString();
    }

    private static Object scalar(final Statement s, final String sql) throws Exception {
        try (ResultSet rs = s.executeQuery(sql)) {
            return rs.next() ? rs.getObject(1) : null;
        }
    }

    private static int count(final Statement s, final String sql) throws Exception {
        try (ResultSet rs = s.executeQuery(sql)) {
            return rs.next() ? rs.getInt(1) : -1;
        }
    }

    private static boolean columnExists(final Statement s, final String table, final String column)
            throws Exception {
        try (ResultSet rs = s.executeQuery("select 1 from information_schema.columns where table_name = '"
                + table + "' and column_name = '" + column + "'")) {
            return rs.next();
        }
    }

    private static boolean indexExists(final Statement s, final String index) throws Exception {
        try (ResultSet rs = s.executeQuery("select 1 from pg_indexes where indexname = '" + index + "'")) {
            return rs.next();
        }
    }

    private static String indexDefinition(final Statement s, final String index) throws Exception {
        try (ResultSet rs = s.executeQuery(
                "select indexdef from pg_indexes where indexname = '" + index + "'")) {
            return rs.next() ? rs.getString(1) : "";
        }
    }

    private static boolean tableExists(final Statement s, final String table) throws Exception {
        try (ResultSet rs = s.executeQuery("select to_regclass('public." + table + "') is not null")) {
            return rs.next() && rs.getBoolean(1);
        }
    }

    private static boolean constraintExists(final Statement s, final String table, final String constraint)
            throws Exception {
        try (ResultSet rs = s.executeQuery("select 1 from pg_constraint where conname = '" + constraint
                + "' and conrelid = 'public." + table + "'::regclass")) {
            return rs.next();
        }
    }

    private static List<String> constraintColumns(final Statement s, final String constraint) throws Exception {
        try (ResultSet rs = s.executeQuery("select attname from pg_attribute where attrelid = ("
                + "select conrelid from pg_constraint where conname = '" + constraint + "')"
                + " and attnum = any((select conkey from pg_constraint where conname = '" + constraint + "')"
                + "::smallint[])")) {
            final List<String> columns = new ArrayList<>();
            while (rs.next()) {
                columns.add(rs.getString(1));
            }
            return columns;
        }
    }

    private static boolean isNullable(final Statement s, final String table, final String column)
            throws Exception {
        return "YES".equals(scalar(s, "select is_nullable from information_schema.columns"
                + " where table_name = '" + table + "' and column_name = '" + column + "'"));
    }

    private static List<String> foreignKeysFrom(final Statement s, final String table) throws Exception {
        try (ResultSet rs = s.executeQuery(
                "select kcu.column_name || ' -> ' || ccu.table_name || '.' || ccu.column_name"
                        + " from information_schema.table_constraints tc"
                        + " join information_schema.key_column_usage kcu"
                        + "   on kcu.constraint_name = tc.constraint_name"
                        + " join information_schema.constraint_column_usage ccu"
                        + "   on ccu.constraint_name = tc.constraint_name"
                        + " where tc.constraint_type = 'FOREIGN KEY' and tc.table_name = '" + table + "'"
                        + " order by 1")) {
            final List<String> foreignKeys = new ArrayList<>();
            while (rs.next()) {
                foreignKeys.add(rs.getString(1));
            }
            return foreignKeys;
        }
    }
}
