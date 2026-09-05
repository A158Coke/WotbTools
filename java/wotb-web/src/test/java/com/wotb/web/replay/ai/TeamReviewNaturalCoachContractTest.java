package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Natural Coach Mode 提示词契约。
 * <p>验证：主正文为自由组织的自然复盘（无固定章节模板）；必须有唯一「最重要结论」；
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
    void groundingMachineFieldsContractTrilingual() {
        // structured claims 必须支持机器可校验字段（语言无关）
        assertTrue(ZH.contains("机器字段（三语通用，language-neutral）"),
                "必须声明机器字段三语通用");
        assertTrue(ZH.contains("timeSec"), "必须有 timeSec 机器字段");
        assertTrue(ZH.contains("region"), "必须有 region 机器字段");
        assertTrue(ZH.contains("count"), "必须有 count 机器字段");
        assertTrue(ZH.contains("subject"), "必须有 subject 机器字段");
        assertTrue(ZH.contains("value"), "必须有 value 机器字段");
        assertTrue(ZH.contains("claimType"), "必须有 claimType 机器字段");
        assertTrue(ZH.contains("countSemantics 用机器字段声明"),
                "countSemantics 必须用机器字段声明（不依赖自然语言标记）");
        assertTrue(ZH.contains("EXACT=恰好 count 辆"), "必须给出 EXACT 机器语义");
        assertTrue(ZH.contains("AT_LEAST=至少 count 辆"), "必须给出 AT_LEAST 机器语义");
        assertTrue(ZH.contains("SUBSET=其中 count 辆"), "必须给出 SUBSET 机器语义");
        assertTrue(ZH.contains("DEATH：subject"), "必须给出 DEATH required fields（fail-close schema）");
        assertTrue(ZH.contains("POSITION_REGION：timeSec + region"), "必须给出 POSITION_REGION required fields");
        assertTrue(ZH.contains("ENEMY_POSITION：subject + timeSec + region + knowledge"),
                "必须给出 ENEMY_POSITION required fields（knowledge）");
        assertTrue(ZH.contains("TACTICAL：纯战术观点，不要求 factual machine 字段"),
                "TACTICAL 必须声明不要求机器字段");
        assertTrue(ZH.contains("claims 是同一批 factual assertions 的 machine projection，不是可选装饰"),
                "claims 不得设计成可选装饰（coverage 契约）");
        assertTrue(ZH.contains("数字字段必须是 JSON number，不能用字符串"),
                "机器字段类型必须正确（fail-close）");
        assertTrue(ZH.contains("claimType 不得为 LOS / SPOTTING / VISION"),
                "必须禁止 LOS/spotting 事实 claim（V6m）");
        assertTrue(ZH.contains("subjectAccountId"), "必须声明 subjectAccountId 稳定身份字段（B1）");
        assertTrue(ZH.contains("evidence binding（强制）"), "必须声明 evidence binding 契约（B1）");
        assertTrue(ZH.contains("至少一个 evidenceIds 必须完整支撑该 claim"),
                "必须声明至少一个引用证据完整支撑（B1）");
        for (final AllowedLanguage lang : java.util.List.of(AllowedLanguage.EN, AllowedLanguage.RU)) {
            final String localized = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, lang);
            assertTrue(localized.contains("language-neutral"), lang + " 必须携带 language-neutral 机器字段说明");
            assertFalse(localized.contains("机器字段（三语通用，language-neutral）"),
                    lang + " 残留中文机器字段规则");
        }
        final String en = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.EN);
        assertTrue(en.contains("MACHINE PROJECTION of the same factual assertions"),
                "EN 必须声明 claims 是 machine projection（非可选装饰）");
        assertTrue(en.contains("POSITION_REGION: timeSec + region (1-9) + count"),
                "EN 必须声明 POSITION_REGION required fields");
        assertTrue(en.contains("countSemantics as a machine field"), "EN 必须声明 countSemantics 机器字段");
        assertTrue(en.contains("claimType must not be"), "EN 必须禁止 LOS/spotting 事实 claim");
        final String ru = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.RU);
        assertTrue(ru.contains("МАШИННАЯ ПРОЕКЦИЯ тех же фактических утверждений"),
                "RU 必须声明 claims 是 machine projection");
        assertTrue(ru.contains("POSITION_REGION: timeSec + region (1-9) + count"),
                "RU 必须声明 POSITION_REGION required fields");
        assertTrue(ru.contains("claimType не может быть"), "RU 必须禁止 LOS/spotting 事实 claim");
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
        assertTrue(ZH.contains("primaryDiagnosis 只是整场摘要，不得压缩 reviewMarkdown"),
                "primaryDiagnosis 只是摘要");
        assertTrue(ZH.contains("“重点复查”和“高贡献者”是可选 section"), "个人 section 可选");
        assertTrue(ZH.contains("没有明确 structural evidence"), "个人判断需要 structural evidence");
    }

    @Test
    void informationAndIndividualSectionsStayCausallyBound() {
        assertTrue(ZH.contains("Observed：当时确认了什么 → Remaining uncertainty：什么仍未知"),
                "信息必须写清观察与剩余未知");
        assertTrue(ZH.contains("Decision impact：这如何改变可选部署、风险或行动义务"),
                "信息必须落到决策影响");
        assertTrue(ZH.contains("重点复查至少绑定 time/window、where/local、实际发生的 role 和 decision/execution question"),
                "重点复查必须绑定正文 episode");
        assertTrue(ZH.contains("不能重新从 settlement leaderboard 选人"),
                "个人 section 不得从结算榜单重新选人");
        assertTrue(ZH.contains("省略优于猜测"), "没有个人 tactical evidence 时允许省略");
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
