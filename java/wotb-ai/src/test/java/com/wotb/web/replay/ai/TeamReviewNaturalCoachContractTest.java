package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Natural Coach Mode 提示词契约。
 * <p>验证：主正文为自由组织的自然复盘（无固定章节模板）；必须有唯一「最重要结论」；
 * Focus Window 是内部 attention 提示而非用户模板；v0.5 结构化输出契约；
 * 教练不是司法鉴定员；ZH/EN/RU 三语一致。</p>
 */
class TeamReviewNaturalCoachContractTest {

    private static final String ZH = AiPromptLibrary.zh("team/single");

    @Test
    void noFixedSectionTemplate() {
        assertTrue(ZH.contains("自由组织的自然复盘"), "必须声明自由组织的自然复盘");
        assertTrue(ZH.contains("不是固定章节模板"), "必须声明不是固定章节模板");
        assertTrue(ZH.contains("## 团队复盘"), "主标题为 ## 团队复盘");
        assertTrue(ZH.contains("按关键性自由组织，不设硬性段数或固定篇幅"), "不设硬性段数或固定篇幅");
        assertTrue(ZH.contains("复杂局允许充分展开"), "复杂局允许充分展开");
        assertTrue(ZH.contains("主因可以只有一个，不要为了凑结构制造不存在的问题"), "主因可以只有一个且不得凑结构造问题");
        assertTrue(ZH.contains("但一个主因不等于正文只能讲一件事"), "主因不能压缩正文范围");
        assertTrue(ZH.contains("必须保留解释该主因所需的 Information、Objectives、local engagements、cross-local propagation"),
                "正文必须保留解释主因所需的战术链");
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
    void primaryDiagnosisAllowsNoConfirmedError() {
        assertTrue(ZH.contains("必须选出且只选出一个 PRIMARY DIAGNOSIS"), "必须选出一个主判断");
        assertTrue(ZH.contains("表示本场最重要的结论，不等于必须找出错误"), "主判断不是强制错误");
        assertTrue(ZH.contains("当前可确认/可观察证据中，没有发现足以作为主要问题的明显执行失误"),
                "无错误结论必须限定在当前可确认/可观察证据");
        assertTrue(ZH.contains("不表示证明本场不存在任何错误"),
                "无确认错误不得表述成证明全场无错误");
        assertFalse(ZH.contains("本场没有发现足以作为主要问题的明显执行失误"),
                "不得保留没有证据边界的旧式无错误措辞");
        assertTrue(ZH.contains("NO_SIGNIFICANT_CONFIRMED_ERROR"), "允许无明显确认错误");
        assertTrue(ZH.contains("不得为了填满字段制造轮转、沟通、地图意识或协调问题"),
                "禁止为字段制造问题");
        assertTrue(ZH.contains("不要把无法观察的赛前计划、语音 call、"), "禁止猜测 call/计划");
        assertTrue(ZH.contains("只有证据支持时才指出团队执行问题"), "问题必须有证据");
    }

    @Test
    void v05StructuredOutputContract() {
        assertTrue(ZH.contains("=== Team AI Review v0.5 结构化结果（最终输出契约） ==="), "必须有 v0.5 输出契约段");
        assertTrue(ZH.contains("\"summary\": {\"verdict\": \"...\", \"primaryDiagnosis\": \"...\"}"),
                "v0.5 必须使用 summary 结构");
        assertTrue(ZH.contains("episodes"), "v0.5 必须有 episodes");
        assertTrue(ZH.contains("trainingSuggestions"), "v0.5 必须有 trainingSuggestions");
        assertTrue(ZH.contains("reviewFocus"), "v0.5 必须有 reviewFocus");
        assertTrue(ZH.contains("highContributors"), "v0.5 必须有 highContributors");
        assertFalse(ZH.contains("\"primaryDiagnosis\": {"), "不得恢复旧 envelope 的嵌套 primaryDiagnosis");
        assertFalse(ZH.contains("=== GROUNDING FACTS 与结构化输出（强制） ==="), "不得保留旧 GROUNDING envelope");
    }

    @Test
    void v06CausalReasoningContractIsTrilingual() {
        assertTrue(ZH.contains("Known"), "必须区分 Known");
        assertTrue(ZH.contains("Remaining uncertainty"), "必须区分 Remaining uncertainty");
        assertTrue(ZH.contains("Decision impact"), "必须要求 Decision impact");
        assertTrue(ZH.contains("effective local participation"), "必须要求 effective local participation");
        assertTrue(ZH.contains("State before"), "必须要求 state before");
        assertTrue(ZH.contains("Immediate local consequence"), "必须要求 immediate local consequence");
        assertTrue(ZH.contains("Propagation"), "必须要求 propagation");
        assertTrue(ZH.contains("downstream validation"), "HP 必须是 downstream validation");
        assertTrue(ZH.contains("Trigger → Decision target → Training goal"), "建议必须绑定状态触发器");
        for (final AllowedLanguage lang : java.util.List.of(AllowedLanguage.EN, AllowedLanguage.RU)) {
            final String localized = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, lang);
            assertFalse(localized.contains("=== 团队复盘 v0.6 推理顺序与因果质量约束（强制） ==="),
                    lang + " 残留中文 v0.6 reasoning contract");
            assertTrue(localized.contains("Remaining uncertainty"), lang + " 必须携带 uncertainty contract");
            assertTrue(localized.contains("Effective local participation")
                            || localized.contains("effective local participation"),
                    lang + " 必须携带 local participation contract");
            assertTrue(localized.contains("downstream validation"), lang + " 必须携带 HP validation contract");
        }
        final String en = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.EN);
        assertTrue(en.contains("State before -> Change -> Immediate local consequence -> Propagation"),
                "EN 必须携带 episode 因果链");
        assertTrue(en.contains("Trigger -> Decision target -> Training goal"), "EN 必须携带建议因果链");
        final String ru = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.RU);
        assertTrue(ru.contains("State before -> Change -> Immediate local consequence -> Propagation"),
                "RU 必须携带 episode 因果链");
        assertTrue(ru.contains("Trigger -> Decision target -> Training goal"), "RU 必须携带建议因果链");
    }

    @Test
    void naturalToneAndLength() {
        assertTrue(ZH.contains("1200–2200"), "普通 7v7 软目标 1200–2200 字");
        assertTrue(ZH.contains("2500–3500"), "复杂局允许 2500–3500 字");
        assertTrue(ZH.contains("这是软目标，不是硬 minimum 或 maximum"), "长度只是软目标");
        assertTrue(ZH.contains("不得为了“简洁”删掉会改变战术判断的信息"), "不得因简洁删除关键判断信息");
        assertFalse(ZH.contains("400–1200"), "不得保留过窄的旧默认长度");
    }

    @Test
    void selectiveCompleteReasoningContract() {
        assertTrue(ZH.contains("关键 tactical episode，必须展开到足以说明"), "关键 episode 必须完整解释");
        assertTrue(ZH.contains("信息状态、基地/点数、局部交战或 cross-local propagation"),
                "信息/目标/局部/传播不得因简洁省略");
        assertTrue(ZH.contains("如果基地/点数状态改变了行动义务，Objectives 必须说明谁需要主动、谁可以等待"),
                "目标状态改变义务时必须解释行动影响");
        assertTrue(ZH.contains("多个 local 必须检查是否有传播"), "多个 local 必须检查传播");
        assertTrue(ZH.contains("primaryDiagnosis 只是整场摘要，不得压缩 v0.5 structured result 中的 episodes 或训练建议"),
                "primaryDiagnosis 只是摘要");
        assertTrue(ZH.contains("“重点复查”和“高贡献者”是可选 section"), "个人 section 可选");
        assertTrue(ZH.contains("没有明确 structural evidence"), "个人判断需要 structural evidence");
    }

    @Test
    void informationAndIndividualSectionsStayCausallyBound() {
        assertTrue(ZH.contains("Known → Remaining uncertainty → New observation"),
                "信息必须写清已知、剩余未知和新观察");
        assertTrue(ZH.contains("Decision impact"),
                "信息必须落到决策影响");
        assertTrue(ZH.contains("必须有实际 role/action 与 decision/execution 依据"),
                "重点复查必须绑定正文 episode");
        assertTrue(ZH.contains("不能从 settlement leaderboard 重新选人"),
                "个人 section 不得从结算榜单重新选人");
        assertTrue(ZH.contains("没有证据就输出空数组"), "没有个人 tactical evidence 时允许省略");
    }

    @Test
    void localizedContractInThreeLanguages() {
        for (final AllowedLanguage lang : java.util.List.of(AllowedLanguage.EN, AllowedLanguage.RU)) {
            final String localized = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, lang);
            assertFalse(localized.contains("=== 团队复盘输出结构（强制） ==="), lang + " 残留中文输出结构");
            assertFalse(localized.contains("=== 主判断（Primary Diagnosis，强制） ==="), lang + " 残留中文主判断");
            assertFalse(localized.contains("=== GROUNDING FACTS 与结构化输出（强制） ==="), lang + " 残留中文旧 GROUNDING");
        }
        final String en = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.EN);
        assertTrue(en.contains("FREE-FORM natural review"), "EN 必须声明 free-form natural review");
        assertTrue(en.contains("not a fixed-section template"), "EN 必须声明非固定章节模板");
        assertTrue(en.contains("PRIMARY DIAGNOSIS (mandatory)"), "EN 必须有主判断契约");
        assertTrue(en.contains("Team AI Review v0.5 structured result"), "EN 必须有 v0.5 structured result 契约");
        final String ru = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.RU);
        assertTrue(ru.contains("ОСНОВНОЙ ДИАГНОЗ (PRIMARY DIAGNOSIS, обязательно)"), "RU 必须有主判断契约");
        assertTrue(ru.contains("Team AI Review v0.5"), "RU 必须有 v0.5 structured result 契约");
    }
}
