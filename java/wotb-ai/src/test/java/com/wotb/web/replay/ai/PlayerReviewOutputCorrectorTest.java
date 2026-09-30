package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 锁定迁移前 {@code AiReplayReviewService} 对随机战输出应用的确定性纠正链：
 * 免责句、null 段透传、「簇」兜底与权威昵称保护。这些行为一旦静默丢失，
 * AI 复盘输出质量会回退（见 {@code docs/ai-lessons/tank-name-hallucination-01.md}）。
 */
class PlayerReviewOutputCorrectorTest {

    @Test
    void appendsTrilingualDisclaimerFooterToAnalysisOnly() {
        assertEquals("正文\n\nAI复盘仅供参考",
                PlayerReviewOutputCorrector.apply("正文", null, null, AllowedLanguage.ZH).analysis());
        assertEquals("body\n\nThis AI review is for reference only",
                PlayerReviewOutputCorrector.apply("body", null, null, AllowedLanguage.EN).analysis());
        assertEquals("текст\n\nРазбор ИИ приведён только для справки",
                PlayerReviewOutputCorrector.apply("текст", null, null, AllowedLanguage.RU).analysis());
        // 免责句只追加在正文；preBattleSection 原样透传。
        assertEquals("赛前", PlayerReviewOutputCorrector
                .apply("正文", "赛前", null, AllowedLanguage.ZH).preBattleSection());
    }

    @Test
    void keepsNullSectionsNull() {
        final PlayerReviewOutputCorrector.Corrected corrected =
                PlayerReviewOutputCorrector.apply(null, null, null, AllowedLanguage.ZH);
        assertNull(corrected.analysis());
        assertNull(corrected.preBattleSection());
    }

    @Test
    void replacesInternalClusterTermWhileProtectingAuthoritativeNickname() {
        final Battle battle = new Battle();
        battle.players = List.of(player(1001L, "星簇", 1));

        final PlayerReviewOutputCorrector.Corrected corrected = PlayerReviewOutputCorrector.apply(
                "星簇与敌军成簇推进", null, battle, AllowedLanguage.ZH);

        assertTrue(corrected.analysis().startsWith("星簇与敌军集群"),
                "内部术语「簇」必须兜底替换，而权威昵称「星簇」必须原样保留：" + corrected.analysis());
    }

    private static PlayerResult player(final long accountId, final String nickname, final int team) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.nickname = nickname;
        p.team = team;
        p.tankId = 1L;
        p.tankName = "TestTank";
        return p;
    }
}
