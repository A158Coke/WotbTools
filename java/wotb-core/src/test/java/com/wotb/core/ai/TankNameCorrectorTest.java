package com.wotb.core.ai;

import com.wotb.core.ai.TankNameCorrector.Replacement;
import com.wotb.core.ai.TankNameCorrector.Result;
import com.wotb.core.ai.TankNameCorrector.RosterEntry;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link TankNameCorrector} 单测：覆盖生产反馈案例（Kranvagn 被写成「埃米尔1951」）
 * 与 R1/R2/R3 各规则及边界。零容忍口径：提及玩家处的车名必须等于 roster 权威名。
 */
class TankNameCorrectorTest {

    private static final List<RosterEntry> ROSTER = List.of(
            new RosterEntry("Awesomeman954", "Kranvagn"),
            new RosterEntry("A158布丁", "Maus"),
            new RosterEntry("B158", "Emil II"),
            new RosterEntry("Ace", "E 100"),
            new RosterEntry("AceKiller", "AMX 50 B"));

    private static Result correct(final String text) {
        return TankNameCorrector.correct(text, ROSTER);
    }

    private static List<String> reasons(final Result result) {
        return result.replacements().stream().map(Replacement::reason).toList();
    }

    @Test
    void productionCase_kranvagnWrittenAsEmil1951_isCorrected() {
        final Result result = correct("1分07秒：CHRD的埃米尔1951（Awesomeman954）!紧接着阵亡");
        assertEquals("1分07秒：CHRD的Kranvagn（Awesomeman954）!紧接着阵亡", result.text());
        assertEquals(List.of("CORRECTED"), reasons(result));
        assertEquals("埃米尔1951", result.replacements().getFirst().original());
        assertEquals("Kranvagn", result.replacements().getFirst().replacement());
    }

    @Test
    void anchoredCorrection_propagatesToStandaloneAfterAnchor() {
        final Result result = correct("埃米尔1951（Awesomeman954）阵亡。此前埃米尔1951一直在后排。");
        assertEquals("Kranvagn（Awesomeman954）阵亡。此前Kranvagn一直在后排。", result.text());
        assertFalse(result.text().contains("埃米尔1951"));
        assertFalse(result.text().contains("EMIL 1951"));
        assertEquals(2, result.replacements().size());
        assertTrue(reasons(result).contains("CORRECTED"));
        assertTrue(reasons(result).contains("PROPAGATED"));
    }

    @Test
    void anchoredCorrection_propagatesToStandaloneBeforeAnchor() {
        final Result result = correct("埃米尔1951先掉血，随后埃米尔1951（Awesomeman954）阵亡。");
        assertEquals("Kranvagn先掉血，随后Kranvagn（Awesomeman954）阵亡。", result.text());
        assertEquals(2, result.replacements().size());
        assertTrue(reasons(result).contains("CORRECTED"));
        assertTrue(reasons(result).contains("PROPAGATED"));
    }

    @Test
    void propagation_coversAliasAndEnglishForms() {
        final Result result = correct("EMIL 1951（Awesomeman954）阵亡，埃米尔1951 前压。");
        assertEquals("Kranvagn（Awesomeman954）阵亡，Kranvagn 前压。", result.text());
        assertEquals(2, result.replacements().size());
        assertTrue(reasons(result).contains("PROPAGATED"));
    }

    @Test
    void noAnchor_standaloneNameFailClosed() {
        final Result result = correct("埃米尔1951前压");
        // 无昵称锚点：只归一化为权威英文名 + DETECTED，禁止凭 roster 猜成 Kranvagn
        assertEquals("EMIL 1951前压", result.text());
        assertFalse(result.text().contains("Kranvagn"));
        assertTrue(reasons(result).contains("NORMALIZED"));
        assertTrue(reasons(result).contains("DETECTED"));
    }

    @Test
    void sourceCanonicalInRoster_standaloneNotGloballyRewritten() {
        final List<RosterEntry> roster = List.of(
                new RosterEntry("Awesomeman954", "Kranvagn"),
                new RosterEntry("OtherPlayer", "EMIL 1951"));
        final Result result = TankNameCorrector.correct(
                "埃米尔1951（Awesomeman954）阵亡。此前EMIL 1951一直在后排。", roster);
        // 锚点处按 R1 局部纠正为 Kranvagn；standalone EMIL 1951 可能是真车（roster 有 EMIL 1951），不得全局改
        assertEquals("Kranvagn（Awesomeman954）阵亡。此前EMIL 1951一直在后排。", result.text());
        assertEquals(List.of("CORRECTED"), reasons(result));
    }

    @Test
    void conflictingAnchors_standaloneNotGloballyRewritten() {
        final List<RosterEntry> roster = List.of(
                new RosterEntry("Awesomeman954", "Kranvagn"),
                new RosterEntry("B158", "E 100"));
        // 第三个锚点指向与第二个相同的 E 100：冲突源已封禁，不得因后到同目标锚点重新入传播表
        final Result result = TankNameCorrector.correct(
                "埃米尔1951（Awesomeman954）阵亡。埃米尔1951（B158）仍在。埃米尔1951（B158）对炮。此前埃米尔1951一直处于后排。", roster);
        // 各锚点分别局部纠正；standalone 因映射冲突 fail closed（EMIL 1951 + DETECTED），不猜
        assertTrue(result.text().contains("Kranvagn（Awesomeman954）"));
        assertTrue(result.text().contains("E 100（B158）"));
        assertTrue(result.text().contains("EMIL 1951一直处于后排"));
        assertFalse(result.text().contains("Kranvagn一直处于后排"));
        assertFalse(result.text().contains("E 100一直处于后排"));
        assertTrue(reasons(result).contains("DETECTED"));
    }

    @Test
    void correctNamesNeverModified_standaloneAndAnchored() {
        final Result result = correct("Kranvagn 前压，Awesomeman954（Kranvagn）顶线。");
        assertEquals("Kranvagn 前压，Awesomeman954（Kranvagn）顶线。", result.text());
        assertTrue(result.replacements().isEmpty());
    }

    @Test
    void correctTankName_isKeptUntouched() {
        final Result result = correct("1分07秒：CHRD的Kranvagn（Awesomeman954）!紧接着阵亡");
        assertEquals("1分07秒：CHRD的Kranvagn（Awesomeman954）!紧接着阵亡", result.text());
        assertTrue(result.replacements().isEmpty());
    }

    @Test
    void nicknameFirstParenOrder_correctNameKept() {
        final Result result = correct("1分07秒 本队 Awesomeman954（Kranvagn）阵亡");
        assertEquals("1分07秒 本队 Awesomeman954（Kranvagn）阵亡", result.text());
        assertTrue(result.replacements().isEmpty());
    }

    @Test
    void nicknameFirstParenOrder_wrongNameCorrected() {
        final Result result = correct("Awesomeman954（EMIL 1951）阵亡");
        assertEquals("Awesomeman954（Kranvagn）阵亡", result.text());
        assertEquals(List.of("CORRECTED"), reasons(result));
    }

    @Test
    void aliasNearNickname_sameTank_normalizedToCanonical() {
        final Result result = correct("KRV（Awesomeman954）前压");
        assertEquals("Kranvagn（Awesomeman954）前压", result.text());
        assertEquals(List.of("NORMALIZED"), reasons(result));
    }

    @Test
    void aliasStandalone_normalized() {
        final Result result = correct("克朗瓦根 前压，KRV 抗线");
        assertEquals("Kranvagn 前压，Kranvagn 抗线", result.text());
        assertEquals(List.of("NORMALIZED", "NORMALIZED"), reasons(result));
    }

    @Test
    void lowercaseTankName_normalized() {
        final Result result = correct("kranvagn 前压");
        assertEquals("Kranvagn 前压", result.text());
        assertEquals(List.of("NORMALIZED"), reasons(result));
    }

    @Test
    void standaloneWrongTank_detectedButNotRewritten() {
        final Result result = correct("埃米尔1951 前压");
        // 别名归一化为权威英文名，但 EMIL 1951 不在 roster → DETECTED 不改写
        assertEquals("EMIL 1951 前压", result.text());
        assertEquals(List.of("NORMALIZED", "DETECTED"), reasons(result));
    }

    @Test
    void standaloneNonAliasWrongTank_detected() {
        final Result result = correct("IS-7 前压");
        assertEquals("IS-7 前压", result.text());
        assertEquals(List.of("DETECTED"), reasons(result));
    }

    @Test
    void possessiveForm_corrected() {
        final Result result = correct("Awesomeman954 的埃米尔1951 阵亡");
        assertEquals("Awesomeman954 的Kranvagn 阵亡", result.text());
        assertEquals(List.of("CORRECTED"), reasons(result));
    }

    @Test
    void possessiveForm_correctNameKept() {
        final Result result = correct("Awesomeman954 的 Kranvagn 前压");
        assertEquals("Awesomeman954 的 Kranvagn 前压", result.text());
        assertTrue(result.replacements().isEmpty());
    }

    @Test
    void emilIiPrefixOverlap_longestMatchWins() {
        // "Emil II" 以 "Emil I" 为前缀：重叠时必须命中更长的 Emil II（B158 的 roster 车）
        final Result result = correct("Emil II 前压");
        assertEquals("Emil II 前压", result.text());
        assertTrue(result.replacements().isEmpty());
    }

    @Test
    void nicknameSubstring_longestNicknameWins() {
        final Result result = correct("AceKiller（AMX 50 B）前压");
        assertEquals("AceKiller（AMX 50 B）前压", result.text());
        assertTrue(result.replacements().isEmpty());
    }

    @Test
    void nicknameContainingTankName_notTreatedAsTankMention() {
        final Result result = correct("KranvagnPlayer 前压");
        // 昵称里含 Kranvagn 子串：ASCII 边界检查 + 重叠保留更长者，均不触发纠正
        assertEquals("KranvagnPlayer 前压", result.text());
        assertTrue(result.replacements().isEmpty());
    }

    @Test
    void englishText_corrected() {
        final Result result = correct("At 1m7s, CHRD's EMIL 1951 (Awesomeman954) died.");
        assertEquals("At 1m7s, CHRD's Kranvagn (Awesomeman954) died.", result.text());
        assertEquals(List.of("CORRECTED"), reasons(result));
    }

    @Test
    void parenWithMultipleNicknames_noCorrection() {
        final Result result = correct("埃米尔1951（Ace 与 AceKiller）对炮");
        // 括号内两个昵称 → 归属不明，不按括号纠正；埃米尔1951 走别名归一化 + DETECTED
        assertEquals("EMIL 1951（Ace 与 AceKiller）对炮", result.text());
        assertTrue(reasons(result).contains("DETECTED"));
    }

    @Test
    void nullOrBlankInput_returnsEmptySafely() {
        assertEquals("", TankNameCorrector.correct(null, ROSTER).text());
        assertEquals("  ", TankNameCorrector.correct("  ", ROSTER).text());
        final String body = "CHRD的埃米尔1951（Awesomeman954）";
        assertEquals(body, TankNameCorrector.correct(body, List.of()).text());
        assertEquals(body, TankNameCorrector.correct(body, List.of(new RosterEntry("X", "未知坦克"))).text());
    }

    @Test
    void allCorrectionsDeterministic_sameInputSameOutput() {
        final String input = "1分07秒：CHRD的埃米尔1951（Awesomeman954）!紧接着 KRV 顶上来";
        assertEquals(correct(input).text(), correct(input).text());
    }
}
