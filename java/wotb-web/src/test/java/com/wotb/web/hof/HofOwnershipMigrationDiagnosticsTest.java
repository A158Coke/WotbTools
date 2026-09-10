package com.wotb.web.hof;

import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V22 迁移诊断文本的可执行性契约（纯静态校验，不需要数据库）。
 *
 * <p>V22 在 PostgreSQL 上按单事务运行：preflight 失败 → 整个迁移回滚 → schema 停留在 <b>V21</b>。
 * 因此「给运维看」的检查命令必须能在 V21 schema 上直接执行：</p>
 *
 * <ul>
 *   <li>百场/三环表在 V21 只有 {@code user_keycloak_id} 与 {@code game_account_id_snapshot}，
 *       <b>没有</b> {@code wotb_account_id} / {@code wotb_server}；</li>
 *   <li>候选区服只能从 {@code user_profile} 反推（{@code p.keycloak_user_id = s.user_keycloak_id
 *       and p.wotb_account_id = s.game_account_id_snapshot}）；</li>
 *   <li>本次变更新增的 bulk-delete 端点属于新版本，迁移失败时新版本起不来，不能作为处置路径。</li>
 * </ul>
 *
 * <p>本测试与 {@link HofOwnershipMigrationTest} 互补：后者在真实 PostgreSQL 上验证迁移行为，
 * 本测试在无数据库环境下也始终执行，防止诊断文本在后续改动中退化为引用 V22 才有的列。</p>
 */
class HofOwnershipMigrationDiagnosticsTest {

    private static final String V22_SCRIPT = "/db/migration/V22__hof_ownership_by_wotb_account.sql";

    @Test
    void hundredAndMark3HintsAreExecutableOnTheRolledBackV21Schema() throws Exception {
        final List<String> hints = hintSections(script());
        assertEquals(2, hints.size(), "百场与三环各应有一份面向运维的 hint");

        assertHundredHint(hints.get(0));
        assertMark3Hint(hints.get(1));
    }

    private static void assertHundredHint(final String hint) {
        assertCommonV21Compatibility("hundred", hint);
        // 百场新唯一索引是两个独立 partial index：冲突按 区服 + 账号 + 车辆 + 状态 分组
        assertTrue(hint.contains("group by 1, 2, 3, 4 having count(*) > 1"),
                "百场必须以 候选区服 + game_account_id_snapshot + vehicle_id + status 分组: " + hint);
        assertTrue(hint.contains("and p.wotb_account_id = s.game_account_id_snapshot"),
                "百场候选区服必须以 V21 列做 LEFT JOIN: " + hint);
    }

    private static void assertMark3Hint(final String hint) {
        assertCommonV21Compatibility("mark3", hint);
        // 三环新唯一索引是单个组合 index，跨 PENDING/CURRENT：冲突按 区服 + 账号 + 车辆 分组
        assertTrue(hint.contains("group by 1, 2, 3 having count(*) > 1"),
                "三环必须以 候选区服 + game_account_id_snapshot + vehicle_id 跨状态分组: " + hint);
        assertTrue(hint.contains("spanning PENDING and CURRENT"),
                "三环诊断必须说明 CURRENT 与 PENDING 并存也是冲突: " + hint);
    }

    private static void assertCommonV21Compatibility(final String domain, final String hint) {
        // 必须说明回滚后 schema 仍是 V21
        assertTrue(hint.contains("The schema is still V21 after this failure"),
                domain + " 诊断必须说明迁移失败后 schema 仍是 V21: " + hint);

        // 检查 SQL 只能使用 V21 列，并通过 LEFT JOIN user_profile 反推候选区服
        assertTrue(hint.contains("left join user_profile p on p.keycloak_user_id = s.user_keycloak_id"),
                domain + " 候选区服必须通过 LEFT JOIN user_profile 反推: " + hint);
        assertTrue(hint.contains("select s.id, s.user_keycloak_id, s.game_account_id_snapshot, s.status,"),
                domain + " 未解析行检查必须使用 V21 列名: " + hint);
        assertTrue(hint.contains("p.wotb_server as candidate_server"),
                domain + " 候选区服必须显式取 user_profile.wotb_server: " + hint);

        // 回滚后百场/三环表没有 wotb_* 列：只有 user_profile 侧允许出现这两个名字
        assertFalse(hint.contains("s.wotb_account_id"),
                domain + " 诊断不得引用回滚后不存在的 wotb_account_id 列: " + hint);
        assertFalse(hint.replace("p.wotb_account_id", "").contains("wotb_account_id"),
                domain + " 除 user_profile 侧外，诊断不得引用 V22 才有的 wotb_account_id: " + hint);
        assertFalse(hint.contains("s.wotb_server"),
                domain + " 诊断不得引用回滚后不存在的 wotb_server 列: " + hint);
        assertFalse(hint.replace("p.wotb_server", "").contains("wotb_server"),
                domain + " 除 user_profile 侧外，诊断不得引用 V22 才有的 wotb_server: " + hint);

        // 新版本起不来时不能把本次新增的 bulk-delete 当作可用处置路径。
        // 诊断里提到它是允许的（并且有价值），但必须同时显式说明它在迁移失败时不可用。
        if (hint.contains("bulk-delete")) {
            assertTrue(hint.contains("NOT available"),
                    domain + " 提到 bulk-delete 时必须同时说明其在迁移失败时不可用: " + hint);
        }
    }

    /** V22 脚本原文（classpath）。 */
    private static String script() throws Exception {
        try (InputStream in = HofOwnershipMigrationDiagnosticsTest.class.getResourceAsStream(V22_SCRIPT)) {
            assertNotNull(in, "V22 迁移脚本必须在 classpath 上: " + V22_SCRIPT);
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    /** 取出脚本里所有 {@code hint = '<...>'} 文本块——这是唯一面向运维的处置指引。 */
    private static List<String> hintSections(final String script) {
        final String marker = "hint = " + (char) 39;
        final String terminator = String.valueOf((char) 39) + ";";
        final List<String> hints = new ArrayList<>();
        int from = 0;
        while (true) {
            final int start = script.indexOf(marker, from);
            if (start < 0) {
                return hints;
            }
            final int end = script.indexOf(terminator, start);
            hints.add(end < 0 ? script.substring(start) : script.substring(start, end));
            from = end < 0 ? script.length() : end + 2;
        }
    }
}
