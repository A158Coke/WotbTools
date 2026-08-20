package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Natural Coach Mode 提示词契约（docs/current-plan.md §6–§8/§16/§17/§18）。
 * <p>验证：主正文为自由组织的自然复盘（无固定章节模板）；必须有唯一 PRIMARY DIAGNOSIS；
 * Focus Window 是内部 attention 提示而非用户模板；GROUNDING FACTS 结构化输出契约；
 * 教练不是司法鉴定员；ZH/EN/RU 三语一致。</p>
 */
class TeamReviewNaturalCoachContractTest {

    private static final String ZH = AiPromptLibrary.zh("team/single");

    @Test
    void noFixedSectionTemplate() {
        assertTrue(ZH.contains("自由组织的自然复盘"), "必须声明自由组织的自然复盘");
        assertTrue(ZH.contains("不是固定章节模板"), "必须声明不是固定章节模板");
        assertTrue(ZH.contains("## 团队复盘"), "主标题为 ## 团队复盘");
        assertTrue(ZH.contains("3-5 个自然段"), "默认 3-5 个自然段");
        assertTrue(ZH.contains("简单局可以只写 2-3 段"), "简单局 2-3 段");
        assertTrue(ZH.contains("复杂局可以写 5 段左右"), "复杂局约 5 段");
        assertTrue(ZH.contains("先判断整场最值得讲的 1-2 件事"), "先判断最值得讲的 1-2 件事");
        assertTrue(ZH.contains("如果实际上只有一个决定性问题，就只讲一个"), "只有一个问题就只讲一个");
        assertTrue(ZH.contains("不要为了结构完整找第二、第三个问题或建议"), "不凑问题/建议数量");
        // 旧固定章节不得作为强制结构存在
        assertFalse(ZH.contains("1. 核心结论：2-4 句"), "不得再强制核心结论章节");
        assertFalse(ZH.contains("2. 关键决策窗口：只输出"), "不得再强制关键决策窗口章节");
        assertFalse(ZH.contains("3. 可确认的团队问题：只写"), "不得再强制可确认问题章节");
        assertFalse(ZH.contains("4. 训练建议：只写"), "不得再强制训练建议章节");
        assertTrue(ZH.contains("训练建议（如给出）每一条必须明确对应前面的一个「可确认问题」或主判断"),
                "建议必须对应问题/主判断");
    }

    @Test
    void focusWindowIsInternalAttentionPrimitive() {
        assertTrue(ZH.contains("内部 attention 提示"), "Focus Window 必须标注为内部 attention 提示");
        assertTrue(ZH.contains("不要求逐窗口输出标题"), "不得强制逐窗口输出标题");
        assertTrue(ZH.contains("这局真正崩掉是在1分52秒后面那二十秒"), "自然语言引用窗口示例");
    }

    @Test
    void primaryDiagnosisMustBeChosen() {
        assertTrue(ZH.contains("必须选出且只选出一个 PRIMARY DIAGNOSIS"), "必须选出一个主判断");
        assertTrue(ZH.contains("禁止回答「无法判断主要问题」"), "禁止无法判断");
        assertTrue(ZH.contains("选择你认为最符合全部已知证据、同时最有训练价值的那一个"),
                "多个解释时选最符合证据且有训练价值的");
        assertTrue(ZH.contains("不得用「不确定」替代结论"), "不得用不确定替代结论");
        assertTrue(ZH.contains("无法证明最细节的因果链"), "无法证明细节 ≠ 无法上层判断");
        assertTrue(ZH.contains("第一轮交换节奏出了问题"), "上层战术判断示例");
        assertTrue(ZH.contains("你是在做战术复盘，不是在做司法鉴定"), "教练不是司法鉴定员");
        assertTrue(ZH.contains("战术判断不要求数学证明"), "战术判断不要求数学证明");
        assertTrue(ZH.contains("用户需要的是方向和训练重点"), "用户需要方向和训练重点");
    }

    @Test
    void groundingFactsStructuredOutputContract() {
        assertTrue(ZH.contains("=== GROUNDING FACTS 与结构化输出（强制） ==="), "必须有 GROUNDING 契约段");
        assertTrue(ZH.contains("GROUNDING FACTS 是后端确定性事实清单"), "GROUNDING FACTS 是确定性事实");
        assertTrue(ZH.contains("这些事实绝对不能修改"), "事实不可修改");
        assertTrue(ZH.contains("primaryDiagnosis"), "envelope 必须有 primaryDiagnosis");
        assertTrue(ZH.contains("reviewMarkdown"), "envelope 必须有 reviewMarkdown");
        assertTrue(ZH.contains("supportingEvidenceIds"), "envelope 必须有 supportingEvidenceIds");
        assertTrue(ZH.contains("claims"), "envelope 必须有 claims");
        assertTrue(ZH.contains("不得在其中出现"), "正文不得出现内部标识");
        assertTrue(ZH.contains("绝不进入 reviewMarkdown 正文"), "证据编号绝不进正文");
        assertTrue(ZH.contains("LAST_KNOWN 只是「最后一次被观测到的位置」"), "LAST_KNOWN 语义");
        assertTrue(ZH.contains("「敌方此时就在这里/正在某区」"), "禁止 LAST_KNOWN 写成当前");
    }

    @Test
    void naturalToneAndLength() {
        assertTrue(ZH.contains("400–1200"), "默认长度 400–1200 字");
        assertTrue(ZH.contains("300–700"), "简单局 300–700 字");
        assertTrue(ZH.contains("不是硬 minimum，禁止为了达到字数填充"), "禁止凑字数");
        assertTrue(ZH.contains("能一句说完，不写三句"), "简洁原则");
    }

    @Test
    void localizedContractInThreeLanguages() {
        for (final AllowedLanguage lang : java.util.List.of(AllowedLanguage.EN, AllowedLanguage.RU)) {
            final String localized = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, lang);
            assertFalse(localized.contains("=== 团队复盘输出结构（强制） ==="), lang + " 残留中文输出结构");
            assertFalse(localized.contains("=== 主判断（Primary Diagnosis，强制） ==="), lang + " 残留中文主判断");
            assertFalse(localized.contains("=== GROUNDING FACTS 与结构化输出（强制） ==="), lang + " 残留中文 GROUNDING");
        }
        final String en = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.EN);
        assertTrue(en.contains("FREE-FORM natural review"), "EN 必须声明 free-form natural review");
        assertTrue(en.contains("not a fixed-section template"), "EN 必须声明非固定章节模板");
        assertTrue(en.contains("PRIMARY DIAGNOSIS (mandatory)"), "EN 必须有主判断契约");
        assertTrue(en.contains("GROUNDING FACTS AND STRUCTURED OUTPUT (mandatory)"), "EN 必须有 GROUNDING 契约");
        assertTrue(en.contains("reviewMarkdown"), "EN 必须有 reviewMarkdown");
        final String ru = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.RU);
        assertTrue(ru.contains("ОСНОВНОЙ ДИАГНОЗ (PRIMARY DIAGNOSIS, обязательно)"), "RU 必须有主判断契约");
        assertTrue(ru.contains("GROUNDING FACTS И СТРУКТУРИРОВАННЫЙ ВЫВОД (обязательно)"), "RU 必须有 GROUNDING 契约");
    }
}
