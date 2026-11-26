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

class HofOwnershipMigrationDiagnosticsTest {

    private static final String V22_SCRIPT = "/db/migration/V22__hof_ownership_by_wotb_account.sql";

    @Test
    void hundredAndMark3HintsAreExecutableOnTheRolledBackV21Schema() throws Exception {
        final List<String> hints = hintSections(script());
        assertEquals(2, hints.size(), "百场与三环各应有一份面向运维的 hint");

        assertHintFragmentsAreProperlyEscaped(hints);
        assertHundredHint(hints.get(0));
        assertMark3Hint(hints.get(1));
    }

    private static void assertHundredHint(final String hint) {
        assertCommonV21Compatibility("hundred", hint);
        assertTrue(hint.contains("group by 1, 2, 3, 4 having count(*) > 1"),
                "百场必须以 候选区服 + game_account_id_snapshot + vehicle_id + status 分组: " + hint);
        assertTrue(hint.contains("and p.wotb_account_id = s.game_account_id_snapshot"),
                "百场候选区服必须以 V21 列做 LEFT JOIN: " + hint);
    }

    private static void assertMark3Hint(final String hint) {
        assertCommonV21Compatibility("mark3", hint);
        assertTrue(hint.contains("group by 1, 2, 3 having count(*) > 1"),
                "三环必须以 候选区服 + game_account_id_snapshot + vehicle_id 跨状态分组: " + hint);
        assertTrue(hint.contains("spanning PENDING and CURRENT"),
                "三环诊断必须说明 CURRENT 与 PENDING 并存也是冲突: " + hint);
    }

    private static void assertHintFragmentsAreProperlyEscaped(final List<String> hints) {
        final char quote = (char) 39;
        for (final String hint : hints) {
            for (final String line : hint.split("\n")) {
                final int first = line.indexOf(quote);
                final int last = line.lastIndexOf(quote);
                if (first < 0 || last <= first) {
                    continue;
                }
                final String body = line.substring(first + 1, last);
                for (int i = 0; i < body.length(); i++) {
                    if (body.charAt(i) == quote) {
                        assertTrue(i + 1 < body.length() && body.charAt(i + 1) == quote,
                                "hint 片段内的单引号必须转义为两个单引号: " + line);
                        i++;
                    }
                }
            }
        }
    }

    private static void assertCommonV21Compatibility(final String domain, final String hint) {
        assertTrue(hint.contains("The schema is still V21 after this failure"),
                domain + " 诊断必须说明迁移失败后 schema 仍是 V21: " + hint);

        assertTrue(hint.contains("left join user_profile p on p.keycloak_user_id = s.user_keycloak_id"),
                domain + " 候选区服必须通过 LEFT JOIN user_profile 反推: " + hint);
        assertTrue(hint.contains("select s.id, s.user_keycloak_id, s.game_account_id_snapshot, s.status,"),
                domain + " 未解析行检查必须使用 V21 列名: " + hint);
        assertTrue(hint.contains("p.wotb_server as candidate_server"),
                domain + " 候选区服必须显式取 user_profile.wotb_server: " + hint);

        assertFalse(hint.contains("s.wotb_account_id"),
                domain + " 诊断不得引用回滚后不存在的 wotb_account_id 列: " + hint);
        assertFalse(hint.replace("p.wotb_account_id", "").contains("wotb_account_id"),
                domain + " 除 user_profile 侧外，诊断不得引用 V22 才有的 wotb_account_id: " + hint);
        assertFalse(hint.contains("s.wotb_server"),
                domain + " 诊断不得引用回滚后不存在的 wotb_server 列: " + hint);
        assertFalse(hint.replace("p.wotb_server", "").contains("wotb_server"),
                domain + " 除 user_profile 侧外，诊断不得引用 V22 才有的 wotb_server: " + hint);

        if (hint.contains("bulk-delete")) {
            assertTrue(hint.contains("NOT available"),
                    domain + " 提到 bulk-delete 时必须同时说明其在迁移失败时不可用: " + hint);
        }
    }

    private static String script() throws Exception {
        try (InputStream in = HofOwnershipMigrationDiagnosticsTest.class.getResourceAsStream(V22_SCRIPT)) {
            assertNotNull(in, "V22 迁移脚本必须在 classpath 上: " + V22_SCRIPT);
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

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
