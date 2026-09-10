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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V22 ownership 迁移验证（真实旧 schema 启动）。
 *
 * <p>覆盖三件事：</p>
 * <ol>
 *   <li>账号列重命名 + Keycloak 列删除 + 唯一性/查询索引改以 WotB 账号为界；</li>
 *   <li>冲突自愈的确定性：同一 WotB 账号 + 同一车辆存在多条 active 记录时，
 *       保留 submitted_at 最新的一条，其余转终态（百场 CURRENT→SUPERSEDED、PENDING→DELETED；
 *       三环 active→DELETED）；无冲突的行必须原样保留；</li>
 *   <li>转终态的行同事务删除其 replay evidence，未转终态的行证据保留。</li>
 * </ol>
 */
@Testcontainers(disabledWithoutDocker = true)
class HofOwnershipMigrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("wotb");

    @Test
    void migrateOwnershipToWotbAccountAndSelfHealDuplicates() throws Exception {
        final String url = POSTGRES.getJdbcUrl();
        final String user = POSTGRES.getUsername();
        final String pass = POSTGRES.getPassword();

        // Phase 1: 只执行到 V21（迁移前 schema：ownership 仍是 (user_keycloak_id, vehicle_id)）
        Flyway.configure()
                .dataSource(url, user, pass)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("21"))
                .load().migrate();

        try (Connection c = DriverManager.getConnection(url, user, pass);
             Statement s = c.createStatement()) {
            seedHundred(s);
            seedMark3(s);
        }

        // Phase 2: 迁移到最新（V22）
        Flyway.configure()
                .dataSource(url, user, pass)
                .locations("classpath:db/migration")
                .load().migrate();

        // Phase 3: schema 形状
        try (Connection c = DriverManager.getConnection(url, user, pass);
             Statement s = c.createStatement()) {
            assertFalse(columnExists(s, "hundred_battle_submission", "user_keycloak_id"),
                    "百场 user_keycloak_id 必须被删除");
            assertTrue(columnExists(s, "hundred_battle_submission", "wotb_account_id"),
                    "百场 game_account_id_snapshot 必须重命名为 wotb_account_id");
            assertFalse(columnExists(s, "hundred_battle_submission", "game_account_id_snapshot"),
                    "旧列名不得残留");
            assertFalse(columnExists(s, "mark3_submission", "user_keycloak_id"),
                    "三环 user_keycloak_id 必须被删除");
            assertTrue(columnExists(s, "mark3_submission", "wotb_account_id"),
                    "三环 game_account_id_snapshot 必须重命名为 wotb_account_id");

            assertTrue(indexExists(s, "uk_hundred_battle_pending_account_vehicle"));
            assertTrue(indexExists(s, "uk_hundred_battle_current_account_vehicle"));
            assertTrue(indexExists(s, "idx_hundred_battle_submission_account"));
            assertFalse(indexExists(s, "uk_hundred_battle_pending_user_vehicle"));
            assertFalse(indexExists(s, "uk_hundred_battle_current_user_vehicle"));
            assertFalse(indexExists(s, "idx_hundred_battle_submission_user"));

            assertTrue(indexExists(s, "uk_mark3_submission_active_account_vehicle"));
            assertTrue(indexExists(s, "idx_mark3_submission_account"));
            assertFalse(indexExists(s, "uk_mark3_submission_active_user_vehicle"));
            assertFalse(indexExists(s, "idx_mark3_submission_user"));
        }

        // Phase 4: 冲突自愈结果 + 无冲突行不受影响 + 证据清理
        try (Connection c = DriverManager.getConnection(url, user, pass);
             Statement s = c.createStatement()) {
            // 百场：账号 500 + 车辆 1001 的 active 冲突以「保留最新」消解
            assertRow(s, "hundred_battle_submission", 1,
                    "SUPERSEDED", 500);
            assertRow(s, "hundred_battle_submission", 2,
                    "CURRENT", 500);
            assertRow(s, "hundred_battle_submission", 3,
                    "DELETED", 500);
            assertRow(s, "hundred_battle_submission", 4,
                    "PENDING", 500);
            // 被自愈的 PENDING 必须带上可审计的删除轨迹
            assertEquals("V22_OWNERSHIP_MIGRATION",
                    scalar(s, "select deleted_by from hundred_battle_submission where id = 3"));
            assertEquals("ADMIN_CORRECTION",
                    scalar(s, "select delete_reason from hundred_battle_submission where id = 3"));
            assertNull(
                    scalar(s, "select proof_screenshot from hundred_battle_submission where id = 3"));

            // 无冲突行原样保留
            assertRow(s, "hundred_battle_submission", 5, "CURRENT", 700);
            assertRow(s, "hundred_battle_submission", 6, "DELETED", 700);

            // 三环：新唯一索引跨 PENDING/CURRENT 两个状态，因此必须跨状态去重且 CURRENT 优先
            assertRow(s, "mark3_submission", 12, "CURRENT", 900);   // 最新的 CURRENT 保留
            assertRow(s, "mark3_submission", 11, "DELETED", 900);   // 更旧的 CURRENT → DELETED
            assertRow(s, "mark3_submission", 14, "DELETED", 900);   // 与 CURRENT 并存的 PENDING → DELETED
            // 没有 CURRENT 时只保留最新的 PENDING
            assertRow(s, "mark3_submission", 17, "PENDING", 960);
            assertRow(s, "mark3_submission", 16, "DELETED", 960);
            // 无冲突行原样保留
            assertRow(s, "mark3_submission", 15, "CURRENT", 950);

            // 证据清理：被转终态的 submission 证据行删除，未转终态的保留
            assertEquals(0, count(s,
                    "select count(*) from hundred_battle_replay_evidence where submission_id = 3"),
                    "被自愈的 PENDING 证据必须删除");
            assertEquals(1, count(s,
                    "select count(*) from hundred_battle_replay_evidence where submission_id = 2"),
                    "仍为 CURRENT 的 submission 证据必须保留");
            assertEquals(0, count(s,
                    "select count(*) from mark3_replay_evidence where submission_id = 11"),
                    "被自愈的三环 CURRENT 证据必须删除");
            assertEquals(0, count(s,
                    "select count(*) from mark3_replay_evidence where submission_id = 14"),
                    "被自愈的并存 PENDING 证据必须删除");
            assertEquals(0, count(s,
                    "select count(*) from mark3_replay_evidence where submission_id = 16"),
                    "被自愈的旧 PENDING 证据必须删除");
            assertEquals(1, count(s,
                    "select count(*) from mark3_replay_evidence where submission_id = 12"),
                    "仍为 CURRENT 的三环证据必须保留");

            // 唯一性真的被 DB 强制：再次写入同账号同车 CURRENT 必须失败
            assertTrue(insertFails(s,
                            "insert into hundred_battle_submission (wotb_account_id, vehicle_id, vehicle_name, "
                                    + "nickname_snapshot, claimed_average_damage, claimed_battle_count, status) "
                                    + "values (500, 1001, 'FV4005', 'Dup', 1, 1, 'CURRENT')"),
                    "V22 后 (账号, 车辆) 的 CURRENT 唯一性必须由 DB 强制");
        }
    }

    /** 百场种子：id 1/2 是 CURRENT 冲突，3/4 是 PENDING 冲突，5/6 无冲突。 */
    private static void seedHundred(final Statement s) throws Exception {
        insertHundred(s, 1, "kc-a", 1001, 500, "CURRENT", "2026-01-01T00:00:00Z");
        insertHundred(s, 2, "kc-b", 1001, 500, "CURRENT", "2026-01-02T00:00:00Z");
        insertHundred(s, 3, "kc-a", 1001, 500, "PENDING", "2026-01-03T00:00:00Z");
        insertHundred(s, 4, "kc-b", 1001, 500, "PENDING", "2026-01-04T00:00:00Z");
        insertHundred(s, 5, "kc-c", 2002, 700, "CURRENT", "2026-01-05T00:00:00Z");
        insertHundred(s, 6, "kc-c", 2002, 700, "DELETED", "2026-01-06T00:00:00Z");

        s.executeUpdate("insert into hundred_battle_replay_evidence "
                + "(submission_id, slot, original_filename, sha256, file_size, arena_id) values "
                + "(3, 1, 'a.wotbreplay', '" + "1".repeat(64) + "', 10, 'arena-a')");
        s.executeUpdate("insert into hundred_battle_replay_evidence "
                + "(submission_id, slot, original_filename, sha256, file_size, arena_id) values "
                + "(2, 1, 'b.wotbreplay', '" + "2".repeat(64) + "', 10, 'arena-b')");
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

    /**
     * 三环种子。
     *
     * <p>V21 的 active 唯一索引是 (user_keycloak_id, vehicle_id) where status in (PENDING, CURRENT)
     * —— 一个组合索引，比 V18 百场的两个独立 partial index 更严。因此旧 schema 下唯一能并存、
     * 也正是 V22 需要自愈的冲突形态是「同 WotB 账号 + 同车 + 同状态 + 不同 Keycloak 身份」。</p>
     *
     * <p>id 11/12 是 CURRENT 冲突（账号 900 + 车辆 3003，两个不同 Keycloak 身份），
     * id 14 是唯一一条 PENDING，id 15 是完全无关的记录。</p>
     */
    private static void seedMark3(final Statement s) throws Exception {
        insertMark3(s, 11, "kc-a", 3003, 900, "CURRENT", "2026-01-01T00:00:00Z");
        insertMark3(s, 12, "kc-b", 3003, 900, "CURRENT", "2026-01-02T00:00:00Z");
        insertMark3(s, 14, "kc-c", 3003, 900, "PENDING", "2026-01-04T00:00:00Z");
        insertMark3(s, 15, "kc-c", 4004, 950, "CURRENT", "2026-01-05T00:00:00Z");
        // 没有 CURRENT 时只保留最新 PENDING（账号 960 + 车辆 5005）
        insertMark3(s, 16, "kc-d", 5005, 960, "PENDING", "2026-01-06T00:00:00Z");
        insertMark3(s, 17, "kc-e", 5005, 960, "PENDING", "2026-01-07T00:00:00Z");

        s.executeUpdate("insert into mark3_replay_evidence "
                + "(submission_id, slot, original_filename, sha256, file_size, arena_id) values "
                + "(11, 1, 'c.wotbreplay', '" + "3".repeat(64) + "', 10, 'arena-c')");
        s.executeUpdate("insert into mark3_replay_evidence "
                + "(submission_id, slot, original_filename, sha256, file_size, arena_id) values "
                + "(12, 1, 'd.wotbreplay', '" + "4".repeat(64) + "', 10, 'arena-d')");
        s.executeUpdate("insert into mark3_replay_evidence "
                + "(submission_id, slot, original_filename, sha256, file_size, arena_id) values "
                + "(14, 1, 'e.wotbreplay', '" + "5".repeat(64) + "', 10, 'arena-e')");
        s.executeUpdate("insert into mark3_replay_evidence "
                + "(submission_id, slot, original_filename, sha256, file_size, arena_id) values "
                + "(16, 1, 'f.wotbreplay', '" + "6".repeat(64) + "', 10, 'arena-f')");
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

    private static void assertRow(final Statement s, final String table, final long id,
                                  final String expectedStatus, final long expectedAccount) throws Exception {
        try (ResultSet rs = s.executeQuery(
                "select status, wotb_account_id from " + table + " where id = " + id)) {
            assertTrue(rs.next(), table + " id=" + id + " 必须存在（迁移不得删除业务行）");
            assertEquals(expectedStatus, rs.getString(1), table + " id=" + id + " 状态");
            assertEquals(expectedAccount, rs.getLong(2), table + " id=" + id + " owner 账号");
            assertFalse(rs.next(), table + " id=" + id + " 必须唯一");
        }
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

    private static boolean insertFails(final Statement s, final String sql) {
        try {
            s.executeUpdate(sql);
            return false;
        } catch (final Exception e) {
            return true;
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
}
