package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PR #103 review §9：Team 输出风格契约（prompt 主体，不需要 runtime regex sanitizer）。
 * <p>验证 Team prompt 明确：internal evidence ≠ user-facing output；中文默认 400–1200 字
 * （简单局更短、复杂局约 1500 上限）；UNKNOWN selective；不单独建立「数据完整性/证据限制」章节；
 * Focus Window 只是内部 attention 提示、正文不机械输出；数字只保留支撑核心判断的。</p>
 */
class TeamReviewStyleContractTest {

    private static final String ZH = AiPromptLibrary.zh("team/single");

    @Test
    void internalEvidenceIsNotUserOutputTemplate() {
        assertTrue(ZH.contains("【后台推理材料】"),
                "必须声明 AUTHORITATIVE_*/OBSERVED_*/FACT/UNKNOWN 等是内部推理材料: " + ZH);
        assertTrue(ZH.contains("不是用户输出模板"), "必须声明不是用户输出模板");
        assertTrue(ZH.contains("正文默认不得主动复述这些标签"), "正文不得主动复述证据标签");
        assertTrue(ZH.contains("根据 canonical timeline"), "必须禁止「根据 canonical timeline」审计腔");
        assertTrue(ZH.contains("综上所述"), "必须禁止「综上所述」审计腔");
        assertTrue(ZH.contains("像懂 WoT Blitz 的真人队友/教练"), "必须要求真人教练语气");
        assertFalse(ZH.contains("根据权威结算，"),
                "不得把「根据权威结算」当成正文句式（只允许出现在禁用清单里）");
    }

    @Test
    void lengthGuidanceIsExplicit() {
        assertTrue(ZH.contains("400–1200"), "必须给出中文默认长度 400–1200 字");
        assertTrue(ZH.contains("300–700"), "简单一边倒 300–700 字");
        assertTrue(ZH.contains("1500"), "复杂比赛最多约 1500 字");
        assertTrue(ZH.contains("禁止为了达到字数填充"), "禁止凑字数");
        assertTrue(ZH.contains("能一句说完，不写三句"), "简洁原则");
        assertTrue(ZH.contains("简单局可以只写 2-3 段"), "简单局 2-3 段");
        assertTrue(ZH.contains("复杂局可以写 5 段左右"), "复杂局约 5 段");
    }

    @Test
    void unknownIsSelectiveNotBlanket() {
        assertFalse(ZH.contains("无法从输入确定时必须写明“无法从当前回放数据确定”"),
                "blanket UNKNOWN 输出要求必须删除");
        assertTrue(ZH.contains("其他未知静默，不要逐条列出"), "UNKNOWN 必须 selective");
        assertTrue(ZH.contains("不说明就会把相关性误写成确定因果"), "选择性披露条件 a");
        assertTrue(ZH.contains("这个未知直接影响核心结论"), "选择性披露条件 b");
        assertTrue(ZH.contains("这个未知直接影响训练建议"), "选择性披露条件 c");
        assertTrue(ZH.contains("用户自然会关心这个关键原因"), "选择性披露条件 d");
    }

    @Test
    void focusWindowIsInternalAttentionPrimitiveNotSectionTemplate() {
        // Natural Coach Mode：Focus Window 只是「这里最值得集中分析」的 attention 提示，
        // 不是用户看到的标题结构；不要求逐窗口输出小标题
        assertTrue(ZH.contains("内部 attention 提示"), "Focus Window 必须标注为内部 attention 提示");
        assertTrue(ZH.contains("不要求逐窗口输出标题"), "不得强制逐窗口输出标题");
        assertTrue(ZH.contains("这局真正崩掉是在1分52秒后面那二十秒"), "自然语言直接引用窗口示例");
        assertFalse(ZH.contains("发生了什么：/为什么重要：/能够确认的问题：/无法确认：/更好的处理："),
                "旧的五项机械小标题框架不得保留");
        assertFalse(ZH.contains("每个窗口在内部按"), "旧窗口内部框架不得保留");
    }

    @Test
    void noSeparateEvidenceLimitationSection() {
        assertFalse(ZH.contains("6. 证据限制"), "输出结构不得有第 6 节「证据限制」");
        assertFalse(ZH.contains("6. 数据完整性"), "输出结构不得有第 6 节「数据完整性」");
        assertTrue(ZH.contains("不单独建立「数据完整性/证据限制」章节"), "必须明示不单独建证据限制章节");
        assertTrue(ZH.contains("不重复结算结果"), "不重复结算");
        assertTrue(ZH.contains("禁止逐车分析对方全部阵容"), "不逐车作文");
    }

    @Test
    void numbersFilteringKeepsOnlyJudgmentNumbers() {
        assertTrue(ZH.contains("只保留支撑核心判断的数字"), "输出只保留支撑核心判断的数字");
        assertTrue(ZH.contains("总伤害/总承伤/总助攻/总格挡/双方逐车数据由 UI/后端展示"),
                "总量数据由 UI/后端展示，正文不重复罗列");
        assertTrue(ZH.contains("禁止把复盘写成时间线流水账"), "禁止时间线流水账");
    }

    /**
     * PR #103 最终收尾 BLOCKER B：局部规则不得重新把 UNKNOWN 定义成「必须告诉用户」——
     * 任何「证据不足」都必须收敛到内部 UNKNOWN + 默认静默，只有符合全局选择性条件才自然说明。
     */
    @Test
    void localRulesCannotReimposeMandatoryUnknownDisclosure() {
        // 1) Opening Spread：不得再强制写「无法确认其实际视野收益」
        assertFalse(ZH.contains("UNKNOWN（写「无法确认其实际视野收益」）"),
                "Opening Spread 不得强制写「无法确认其实际视野收益」");
        assertFalse(ZH.contains("视野类收益统一视为 UNKNOWN（写"),
                "Opening Spread 不得出现 UNKNOWN（写…）强制句式");
        // 2) Solo candidate：不得再强制「信号不足或矛盾时明确写…」
        assertFalse(ZH.contains("信号不足或矛盾时明确写「无法从当前回放数据确定」"),
                "Solo 规则不得强制写「无法从当前回放数据确定」");
        // 3) points/capture 8e：不得再强制「信号不足或矛盾时写…」
        assertFalse(ZH.contains("信号不足或矛盾时写「无法从当前回放数据确定」"),
                "点数规则不得强制写「无法从当前回放数据确定」");
        // 4) 统一原则：证据不足 → 内部 UNKNOWN；只有符合全局选择性条件才自然说明
        assertTrue(ZH.contains("保持内部 UNKNOWN"),
                "证据不足必须收敛到内部 UNKNOWN 语义");
        assertTrue(ZH.contains("仅当符合全局选择性 UNKNOWN 条件时才自然说明"),
                "任何自然说明必须显式引用全局选择性 UNKNOWN 条件");
        // 5) EN / RU 同步：不得残留强制披露句式，必须携带选择性条件引用
        for (final AllowedLanguage lang : java.util.List.of(AllowedLanguage.EN, AllowedLanguage.RU)) {
            final String localized = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, lang);
            assertFalse(localized.contains("explicitly write \"cannot be determined from the current replay data\""),
                    lang + " 不得残留强制写 cannot-be-determined");
            assertFalse(localized.contains("vision benefit of an opening spread is UNKNOWN (write"),
                    lang + " 不得残留 UNKNOWN (write…) 强制句式");
            assertFalse(localized.contains("пишите «невозможно определить по данным реплея»"),
                    lang + " 不得残留 RU 强制写 невозможно-определить");
        }
        final String en = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.EN);
        assertTrue(en.contains("selective-UNKNOWN"), "EN 必须携带全局选择性 UNKNOWN 条件");
        assertTrue(en.contains("stays internal UNKNOWN"), "EN 必须表达内部 UNKNOWN");
        final String ru = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.RU);
        assertTrue(ru.contains("селективного UNKNOWN"), "RU 必须携带全局选择性 UNKNOWN 条件");
        assertTrue(ru.contains("внутренним UNKNOWN"), "RU 必须表达内部 UNKNOWN");
    }
}
