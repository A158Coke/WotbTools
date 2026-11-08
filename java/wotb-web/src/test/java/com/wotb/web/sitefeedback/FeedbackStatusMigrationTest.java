package com.wotb.web.sitefeedback;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V49 迁移验证（真实 PostgreSQL 执行）：先建立 V46/V48 旧 schema 并写入历史行，再执行 V49。
 *
 * <p>锁定的契约：历史行初始化为 PENDING、id 与时间戳不变、新写入默认 PENDING、
 * NOT NULL 默认值与两态 CHECK 约束真实生效；不验证 Flyway 版本记录（由集成测试的启动迁移覆盖）。</p>
 */
@Testcontainers(disabledWithoutDocker = true)
class FeedbackStatusMigrationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("test-only");

    private JdbcTemplate jdbc;

    @BeforeEach void setup() throws Exception {
        final var ds = new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        jdbc = new JdbcTemplate(ds);
        jdbc.execute("DROP TABLE IF EXISTS site_feedback");
        jdbc.execute("DROP TABLE IF EXISTS ai_review_feedback");
        try (final var connection = ds.getConnection()) {
            ScriptUtils.executeSqlScript(connection, new ClassPathResource("db/migration/V46__create_ai_review_feedback.sql"));
            ScriptUtils.executeSqlScript(connection, new ClassPathResource("db/migration/V48__create_site_feedback.sql"));
        }
        jdbc.update("""
                INSERT INTO site_feedback (id, reason_codes, feedback_text, page_view, created_at)
                VALUES (11, CAST('["BUG"]' AS jsonb), 'legacy site', 'hof', TIMESTAMPTZ '2026-01-01T00:00:00Z')
                """);
        jdbc.update("""
                INSERT INTO ai_review_feedback (id, reason_codes, feedback_text, ai_response_text, model, created_at)
                VALUES (21, CAST('["FACT_ERROR"]' AS jsonb), 'legacy ai', 'legacy reply', NULL,
                        TIMESTAMPTZ '2026-01-02T00:00:00Z')
                """);
        jdbc.execute("SELECT setval('site_feedback_id_seq', 100)");
        jdbc.execute("SELECT setval('ai_review_feedback_id_seq', 200)");
        try (final var connection = ds.getConnection()) {
            ScriptUtils.executeSqlScript(connection, new ClassPathResource("db/migration/V49__add_feedback_status.sql"));
        }
    }

    @Test void initializesHistoricalRowsToPendingWithoutChangingIdentityOrTimestamps() {
        assertEquals("PENDING", status("site_feedback", 11));
        assertEquals("PENDING", status("ai_review_feedback", 21));
        assertTrue(jdbc.queryForObject(
                "SELECT created_at = TIMESTAMPTZ '2026-01-01T00:00:00Z' FROM site_feedback WHERE id = 11",
                Boolean.class));
        assertTrue(jdbc.queryForObject(
                "SELECT created_at = TIMESTAMPTZ '2026-01-02T00:00:00Z' FROM ai_review_feedback WHERE id = 21",
                Boolean.class));
        assertEquals(1, count("site_feedback"));
        assertEquals(1, count("ai_review_feedback"));

        assertStatusColumn("site_feedback");
        assertStatusColumn("ai_review_feedback");

        jdbc.update("INSERT INTO site_feedback (reason_codes) VALUES (CAST('[]' AS jsonb))");
        jdbc.update("INSERT INTO ai_review_feedback (reason_codes, ai_response_text) VALUES (CAST('[]' AS jsonb), 'reply')");
        assertEquals("PENDING", status("site_feedback", 101));
        assertEquals("PENDING", status("ai_review_feedback", 201));
    }

    @Test void enforcesTwoStateCheckAndAllowsReopening() {
        jdbc.update("UPDATE site_feedback SET status = 'FIXED' WHERE id = 11");
        jdbc.update("UPDATE ai_review_feedback SET status = 'FIXED' WHERE id = 21");
        assertEquals("FIXED", status("site_feedback", 11));
        assertEquals("FIXED", status("ai_review_feedback", 21));

        jdbc.update("UPDATE site_feedback SET status = 'PENDING' WHERE id = 11");
        assertEquals("PENDING", status("site_feedback", 11));

        assertThrows(DataAccessException.class,
                () -> jdbc.update("UPDATE site_feedback SET status = 'INVALID' WHERE id = 11"));
        assertThrows(DataAccessException.class,
                () -> jdbc.update("UPDATE ai_review_feedback SET status = 'INVALID' WHERE id = 21"));
        assertThrows(DataAccessException.class,
                () -> jdbc.update("UPDATE site_feedback SET status = NULL WHERE id = 11"));

        assertEquals("PENDING", status("site_feedback", 11));
        assertEquals("FIXED", status("ai_review_feedback", 21));
    }

    private void assertStatusColumn(final String table) {
        assertEquals("NO", jdbc.queryForObject(
                "SELECT is_nullable FROM information_schema.columns WHERE table_name = ? AND column_name = 'status'",
                String.class, table), table);
        assertEquals(16, jdbc.queryForObject(
                "SELECT character_maximum_length FROM information_schema.columns "
                        + "WHERE table_name = ? AND column_name = 'status'",
                Integer.class, table), table);
        final String defaultValue = jdbc.queryForObject(
                "SELECT column_default FROM information_schema.columns WHERE table_name = ? AND column_name = 'status'",
                String.class, table);
        assertNotNull(defaultValue, table);
        assertTrue(defaultValue.contains("PENDING"), defaultValue);
        assertEquals(1L, jdbc.queryForObject(
                "SELECT count(*) FROM pg_constraint WHERE conname = ?", Long.class, table + "_status_check"), table);
    }

    private String status(final String table, final long id) {
        return jdbc.queryForObject("SELECT status FROM " + table + " WHERE id = ?", String.class, id);
    }

    private int count(final String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }
}
