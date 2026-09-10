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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V22 ownership 迁移验证（真实 PostgreSQL 执行）。
 *
 * <p>V22 把百场/三环的 canonical owner 从 Keycloak 身份改为 {@code (wotb_server, wotb_account_id)}，
 * 并且**不做任何自动消解**：冲突必须 fail fast 交给管理员有意处理。本测试锁死这两条契约：</p>
 *
 * <ul>
 *   <li>干净数据 → 迁移成功：区服从 user_profile 回填、旧 Keycloak 列删除、唯一性与查询索引改界，
 *       且**没有任何业务行的 status / evidence / 截图被改动**；</li>
 *   <li>百场 ownership 冲突 → 迁移失败并给出可操作诊断；</li>
 *   <li>三环 ownership 冲突（含「同账号同车同时存在 CURRENT 与 PENDING」的跨状态形态）→ 迁移失败；</li>
 *   <li>历史行区服无法从 user_profile 解析 → 迁移失败，**不猜区服**（尤其不默认 CN）。</li>
 * </ul>
 *
 * <p>失败后 schema 停留在 V21，因此诊断文本只能用 V21 列；该约束由
 * {@link HofOwnershipMigrationDiagnosticsTest} 在无数据库环境下持续校验。</p>
 */
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
            // 列改界：旧 Keycloak 列消失，账号列成为 canonical owner，区服列存在
            assertFalse(columnExists(s, "hundred_battle_submission", "user_keycloak_id"));
            assertFalse(columnExists(s, "hundred_battle_submission", "game_account_id_snapshot"));
            assertTrue(columnExists(s, "hundred_battle_submission", "wotb_account_id"));
            assertTrue(columnExists(s, "hundred_battle_submission", "wotb_server"));
            assertFalse(columnExists(s, "mark3_submission", "user_keycloak_id"));
            assertTrue(columnExists(s, "mark3_submission", "wotb_server"));

            // 区服从「旧 Keycloak 身份当前仍绑定同一账号」的 profile 回填
            assertEquals("CN", scalar(s,
                    "select wotb_server from hundred_battle_submission where id = 1"));
            assertEquals("ASIA", scalar(s,
                    "select wotb_server from hundred_battle_submission where id = 7"));
            assertEquals("CN", scalar(s,
                    "select wotb_server from mark3_submission where id = 11"));

            // 新索引覆盖 (区服, 账号, 车辆)；旧索引消失
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

            // 关键：迁移不得改变任何业务状态
            assertEquals("CURRENT", scalar(s, "select status from hundred_battle_submission where id = 1"));
            assertEquals("PENDING", scalar(s, "select status from hundred_battle_submission where id = 3"));
            assertEquals("CURRENT", scalar(s, "select status from hundred_battle_submission where id = 5"));
            assertEquals("DELETED", scalar(s, "select status from hundred_battle_submission where id = 6"));
            assertEquals("CURRENT", scalar(s, "select status from mark3_submission where id = 11"));
            assertEquals("PENDING", scalar(s, "select status from mark3_submission where id = 13"));
            assertNull(scalar(s, "select deleted_by from hundred_battle_submission where id = 6"),
                    "DELETED 行只应保留迁移前的原始审计字段");
            // 迁移不得删除任何 evidence、不得清空任何截图
            assertEquals(2, count(s, "select count(*) from hundred_battle_replay_evidence"));
            assertEquals(2, count(s, "select count(*) from mark3_replay_evidence"));
            assertEquals(5, count(s,
                    "select count(*) from hundred_battle_submission where proof_screenshot is not null"));
            assertEquals(3, count(s,
                    "select count(*) from mark3_submission where proof_screenshot_first is not null"));
        }
    }

    /**
     * 现网路径下两个 Keycloak 身份无法同时绑定同一账号（{@code user_profile} 有
     * {@code UNIQUE (wotb_server, wotb_account_id)}），因此「两行都能解析出区服、且构成重复」
     * 只可能来自历史/异常数据。为了真实覆盖 V22 的重复检查（而不是只覆盖区服不可解析检查），
     * 本用例显式放开该唯一约束来构造这种数据。
     */
    @Test
    void failsFastWhenHundredHasDuplicateActiveRowsForTheSameAccount() throws Exception {
        try (Connection c = connection(); Statement s = c.createStatement()) {
            seedProfiles(s);
            s.executeUpdate("alter table user_profile drop constraint uk_user_profile_wotb_account");
            insertProfile(s, "kc-x", 100, "CN");
            // 旧 (user_keycloak_id, vehicle_id) 唯一性允许：同 (区服, 账号, 车辆, 状态)，但来自两个 Keycloak 身份
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
            // 同 (区服, 账号, 车辆) 两条 CURRENT（不同 Keycloak 身份）
            insertMark3(s, 11, "kc-c", 3003, 900, "CURRENT", "2026-01-01T00:00:00Z");
            insertMark3(s, 12, "kc-x", 3003, 900, "CURRENT", "2026-01-02T00:00:00Z");
            // 以及「同账号同车同时存在 CURRENT 与 PENDING」的跨状态形态：
            // 三环新唯一索引是单个组合 partial index，覆盖两个状态，因此这同样是冲突
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
            // kc-a 绑定的是账号 100，而这条记录属于账号 777 —— 说明提交后身份已改绑，
            // 无法从任何 profile 推导它当时的区服。
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

    // ── 种子 ──────────────────────────────────────────────────────────────

    private static void seedProfiles(final Statement s) throws Exception {
        insertProfile(s, "kc-a", 100, "CN");
        insertProfile(s, "kc-b", 700, "CN");
        insertProfile(s, "kc-c", 900, "ASIA");
        insertProfile(s, "kc-d", 950, "CN");
    }

    /** 干净数据：每 (区服, 账号, 车辆) 在新唯一性下最多一条 active。 */
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

    /** 迁移失败后数据库必须原样停留在 V21：行数、状态、evidence 全不变。 */
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

    // ── 基础设施 ──────────────────────────────────────────────────────────

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

    /**
     * 诊断里提到本次新增的 bulk-delete 端点是允许的，但必须同时说明它在迁移失败时不可用，
     * 否则会误导运维去找一个起不来的版本上的端点。
     */
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
}
