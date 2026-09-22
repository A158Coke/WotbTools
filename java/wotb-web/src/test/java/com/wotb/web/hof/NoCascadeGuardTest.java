package com.wotb.web.hof;

import org.flywaydb.core.Flyway;
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
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * IAM 与 HoF 生命周期解耦的**结构**守护（真实 PostgreSQL schema）。
 *
 * <p>本任务的关键不变量「删除 Keycloak 用户 ≠ 删除 HoF 业务记录」必须由 schema 本身保证，
 * 而不是只靠服务层自觉。本测试在迁移到最新后直接检查外键与级联规则：</p>
 *
 * <ol>
 *   <li>没有任何外键指向 {@code user_profile}（删资料不会牵连任何业务表）；</li>
 *   <li>{@code ON DELETE CASCADE} 只允许出现在**域内组合关系**上，且必须逐个显式评审：
 *       replay processing 权威状态域内的 {@code fk_replay_processing_source_job} /
 *       {@code fk_replay_processing_operation_job}
 *       （删除一个 job 投影必须一并删除它的 source 投影与 operationId 索引；两者都不指向
 *       IAM 身份、也不指向 HoF 业务表），不得出现在 HoF 或 IAM 路径上；</li>
 *   <li>百场/三环的 replay evidence 外键不是 CASCADE（业务行永不被级联删除）。</li>
 * </ol>
 */
@Testcontainers(disabledWithoutDocker = true)
class NoCascadeGuardTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("wotb");

    @Test
    void schemaNeverCascadesFromIamIdentityIntoHallOfFameRows() throws Exception {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load().migrate();

        try (Connection c = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             Statement s = c.createStatement()) {

            // 1) 没有任何 FK 指向 user_profile
            assertEquals(0, count(s,
                    "select count(*) from information_schema.constraint_column_usage ccu "
                            + "join information_schema.table_constraints tc "
                            + "  on tc.constraint_name = ccu.constraint_name and tc.constraint_schema = ccu.constraint_schema "
                            + "where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'user_profile'"),
                    "不许有任何外键指向 user_profile：删除用户资料不得牵连业务表");

            // 2) HoF 三张主表没有任何外键
            assertEquals(0, count(s,
                    "select count(*) from information_schema.table_constraints "
                            + "where constraint_type = 'FOREIGN KEY' "
                            + "and table_name in ('hall_of_fame_record','hundred_battle_submission','mark3_submission')"),
                    "HoF 主表不得有外键，其生命周期与 IAM 完全无关");

            // 3) ON DELETE CASCADE 必须只属于已显式评审的域内组合关系
            //    （按约束名排序以获得确定性断言，与 information_schema 返回顺序无关）
            final List<String> cascades = strings(s,
                    "select tc.constraint_name from information_schema.referential_constraints rc "
                            + "join information_schema.table_constraints tc "
                            + "  on tc.constraint_name = rc.constraint_name and tc.constraint_schema = rc.constraint_schema "
                            + "where rc.delete_rule = 'CASCADE' "
                            + "order by tc.constraint_name");
            assertEquals(List.of(
                            "fk_replay_processing_operation_job",
                            "fk_replay_processing_source_job"),
                    cascades,
                    "出现新的级联删除关系时必须显式评审：IAM / HoF 路径禁止级联删除");

            // 4) replay evidence 外键不得级联删除业务行
            assertEquals(0, count(s,
                    "select count(*) from information_schema.referential_constraints rc "
                            + "join information_schema.table_constraints tc "
                            + "  on tc.constraint_name = rc.constraint_name and tc.constraint_schema = rc.constraint_schema "
                            + "where tc.table_name in ('hundred_battle_replay_evidence','mark3_replay_evidence') "
                            + "and rc.delete_rule = 'CASCADE'"),
                    "evidence 外键必须保持 RESTRICT / NO ACTION");
            assertTrue(count(s,
                    "select count(*) from information_schema.referential_constraints rc "
                            + "join information_schema.table_constraints tc "
                            + "  on tc.constraint_name = rc.constraint_name and tc.constraint_schema = rc.constraint_schema "
                            + "where tc.table_name in ('hundred_battle_replay_evidence','mark3_replay_evidence')") >= 2,
                    "两个 evidence 表都应保留指向各自 submission 的外键");
        }
    }

    private static int count(final Statement s, final String sql) throws Exception {
        try (ResultSet rs = s.executeQuery(sql)) {
            return rs.next() ? rs.getInt(1) : -1;
        }
    }

    private static List<String> strings(final Statement s, final String sql) throws Exception {
        final List<String> values = new ArrayList<>();
        try (ResultSet rs = s.executeQuery(sql)) {
            while (rs.next()) {
                values.add(rs.getString(1));
            }
        }
        return values;
    }
}
