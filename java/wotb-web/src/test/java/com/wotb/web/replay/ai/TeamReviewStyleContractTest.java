package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PR #103 review §9：Team 输出风格契约（prompt 主体，不需要 runtime regex sanitizer）。
 * <p>验证 Team prompt 明确：internal evidence ≠ user-facing output；中文默认 600–1200 字
 * （简单局更短、复杂局约 1500 上限）；UNKNOWN selective；不单独建立「数据完整性/证据限制」章节；
 * Focus 五项只是 internal reasoning frame、正文不机械输出；数字只保留支撑核心判断的。</p>
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
        assertTrue(ZH.contains("600–1200"), "必须给出中文默认长度 600–1200 字");
        assertTrue(ZH.contains("400–700"), "简单一边倒 400–700 字");
        assertTrue(ZH.contains("1500"), "复杂比赛最多约 1500 字");
        assertTrue(ZH.contains("禁止为了达到字数填充"), "禁止凑字数");
        assertTrue(ZH.contains("能一句说完，不写三句"), "简洁原则");
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
    void focusFiveItemsAreInternalFrameNotMechanicalOutput() {
        assertTrue(ZH.contains("组织思考"), "Focus 五项必须标注为内部思考框架");
        assertTrue(ZH.contains("禁止机械输出「发生了什么：/为什么重要：/能够确认的问题：/无法确认：/更好的处理：」小标题"),
                "正文不得机械输出五项小标题");
        assertTrue(ZH.contains("自然 1-3 段"), "窗口正文用自然段落");
        assertTrue(ZH.contains("backend 给 3 个不强制全写"), "backend 给 3 个窗口不强制全写");
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
}
