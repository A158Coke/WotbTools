package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AI Review V2.1 Team Review Quality Gate — Prompt Contract（docs/current-plan.md §13-A）。
 * <p>新 Team Prompt 必须：不再强制 10 个固定章节；不再规定「开局散开就是图控/拿视野」；
 * 明确 FACT / SUPPORTED INFERENCE / UNKNOWN 契约；明确禁止 unsupported terrain/LOS/visibility
 * 推断与 magic-number coaching；不再强制「做得好的行为」；训练建议必须对应可确认问题；
 * 车辆角色只能来自后端。ZH / EN / RU 契约一致。</p>
 */
class TeamReviewQualityGateContractTest {

    private static final String ZH = AiPromptLibrary.zh("team/single");

    @Test
    void noLongerForcesTenFixedChapters() {
        assertFalse(ZH.contains("10) 3-5 条可执行训练建议"),
                "旧的 10 章结构不得保留");
        assertFalse(ZH.contains("8) 做得好的团队行为"),
                "旧的强制章节不得保留");
        assertFalse(ZH.contains("2) 对方阵容逐车分析"),
                "旧的逐车作文章节不得保留");
        // 新结构
        assertTrue(ZH.contains("1. 核心结论：2-4 句"), "必须携带新输出结构（核心结论）");
        assertTrue(ZH.contains("2. 关键决策窗口"), "必须携带新输出结构（关键决策窗口）");
        assertTrue(ZH.contains("3. 可确认的团队问题"), "必须携带新输出结构（可确认问题）");
        assertTrue(ZH.contains("4. 训练建议"), "必须携带新输出结构（训练建议）");
        assertTrue(ZH.contains("5. 对方关键威胁（可选）"), "必须携带新输出结构（对方关键威胁可选）");
    }

    @Test
    void openingSpreadIsTradeOffNotMapControl() {
        // 旧规则「开局散开…是图控/拿视野，不是脱节」必须删除
        assertFalse(ZH.contains("是图控/拿视野，不是脱节"),
                "不得再断言开局散开=图控/拿视野");
        assertFalse(ZH.contains("OPENING_MAP_CONTROL"),
                "不得再暴露 OPENING_MAP_CONTROL 标签");
        // 新规则：开局分散 = 信息覆盖 ↔ 局部兵力集中度的战术交换（中性 signal）
        assertTrue(ZH.contains("开局分散（OPENING_SPREAD"),
                "必须携带 OPENING_SPREAD 中性 signal");
        assertTrue(ZH.contains("地图信息覆盖 ↔ 局部兵力集中度"),
                "必须定义信息覆盖 vs 局部兵力集中度的 trade-off");
        assertTrue(ZH.contains("不得把「可能获得更多地图信息」说成「已经点亮了谁/提供了具体侦察收益」"),
                "允许 trade-off 分析但禁止具体点亮/侦察归因");
        assertTrue(ZH.contains("不能仅凭分散判为脱节"),
                "不能仅凭分散判脱节");
        assertTrue(ZH.contains("也不能仅凭分散判为图控/拿视野"),
                "不能仅凭分散判图控/拿视野");
        assertTrue(ZH.contains("只有专门且经过验证的 visibility/spotting evidence 才允许写「点亮了」「提供了视野」「侦察到了」等具体归因"),
                "具体视野归因必须有专门 evidence");
        assertTrue(ZH.contains("视野类收益统一视为 UNKNOWN"),
                "无专门 evidence 时视野收益 UNKNOWN");
        // 响应分析：拿到信息后是否及时响应
        assertTrue(ZH.contains("开局分散的质量取决于拿到信息后是否及时响应"),
                "必须分析信息获得后的响应（合流/收缩/转场）");
    }

    @Test
    void openingSpreadStrategicInterpretationContractInThreeLanguages() {
        // 追加修正 §13-B：三语都必须携带「信息覆盖 ↔ 局部兵力集中度」trade-off 语义
        for (final AllowedLanguage lang : java.util.List.of(AllowedLanguage.EN, AllowedLanguage.RU)) {
            final String localized = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, lang);
            assertFalse(localized.contains("OPENING_MAP_CONTROL"),
                    lang + " 不得暴露 OPENING_MAP_CONTROL");
        }
        final String en = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.EN);
        assertTrue(en.contains("information/spatial coverage ↔ local force concentration")
                        || en.contains("information/spatial coverage"),
                "EN 必须携带信息覆盖 vs 局部兵力 trade-off");
        assertTrue(en.contains("OPENING_SPREAD"), "EN 必须携带 OPENING_SPREAD");
        assertTrue(en.contains("do not call it map control / vision gathering"),
                "EN 不得把开局分散当图控/拿视野");
        final String ru = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.RU);
        assertTrue(ru.contains("покрытие информацией/пространством ↔ концентрация локальных сил")
                        || ru.contains("покрытие информацией"),
                "RU 必须携带信息覆盖 vs 局部兵力 trade-off");
        assertTrue(ru.contains("OPENING_SPREAD"), "RU 必须携带 OPENING_SPREAD");
    }

    @Test
    void evidenceContractDistinguishesFactInferenceUnknown() {
        assertTrue(ZH.contains("证据契约（强制）：FACT / SUPPORTED INFERENCE / UNKNOWN / FORBIDDEN"),
                "必须携带证据契约");
        assertTrue(ZH.contains("1. FACT（事实）：只能来自权威结算、权威阵容、已验证的 canonical timeline 与后端确定性证据"),
                "FACT 只能来自权威来源");
        assertTrue(ZH.contains("2. SUPPORTED INFERENCE（有支撑的推断）"), "必须定义 SUPPORTED INFERENCE");
        assertTrue(ZH.contains("3. UNKNOWN（未知）是正常答案，不是失败答案"), "UNKNOWN 是正常答案");
        assertTrue(ZH.contains("4. RECOMMENDATION（建议）：必须从可确认问题反推"), "建议必须从可确认问题反推");
        assertTrue(ZH.contains("不把相关性写成确定因果"), "禁止相关性→确定因果");
    }

    @Test
    void bansUnsupportedTerrainLosVisibilityClaims() {
        assertTrue(ZH.contains("5. 没有对应后端证据时，禁止输出以下断言或其同义改写"),
                "必须列出禁止断言清单");
        assertTrue(ZH.contains("没有掩体"), "禁止「没有掩体」");
        assertTrue(ZH.contains("没有掩体切割"), "禁止「没有掩体切割」");
        assertTrue(ZH.contains("卖头"), "禁止「卖头」");
        assertTrue(ZH.contains("hull-down"), "禁止 hull-down");
        assertTrue(ZH.contains("对方有无遮挡射界"), "禁止「无遮挡射界」");
        // 5a 允许一般战术解释（分散可以扩大地图信息覆盖），但禁止具体视野归因
        assertTrue(ZH.contains("允许一般战术解释"), "允许 general tactical interpretation");
        assertTrue(ZH.contains("分散可以扩大地图信息覆盖"), "允许「分散扩大信息覆盖」");
        assertTrue(ZH.contains("A 点亮了 B"), "禁止「A 点亮了 B」");
        assertTrue(ZH.contains("A 提供了具体视野"), "禁止「A 提供了具体视野」");
        assertTrue(ZH.contains("A 获得了侦察收益"), "禁止「A 获得了侦察收益」");
        assertTrue(ZH.contains("位置感很好"), "禁止「位置感很好」");
        assertTrue(ZH.contains("必然被逐个击破"), "禁止必然性因果");
    }

    @Test
    void bansMagicNumberCoachingAndUniversalRules() {
        assertTrue(ZH.contains("禁止创造「15米」「25米」「三分之一血」「连续两炮」「5秒」等精确阈值"),
                "禁止自创精确阈值");
        assertTrue(ZH.contains("低血量成员应减少继续承担")
                        || ZH.contains("低血量成员应减少继续承担"),
                "必须提供非伪精确表达示例");
        assertTrue(ZH.contains("禁止「2v4/3v5 就必须立刻离开当前掩体向地图另一端转移」"),
                "禁止残局万能规则");
        assertTrue(ZH.contains("残局决策取决于地图、位置"),
                "残局决策依赖多因素");
    }

    @Test
    void noForcedPositiveAndNoPaddedCounts() {
        assertTrue(ZH.contains("没有足够强的 positive 证据时不得硬写「做得好的团队行为」"),
                "不得强制「做得好的团队行为」");
        assertTrue(ZH.contains("没有 3 个问题不要凑 3 个"), "不得凑数量");
        assertTrue(ZH.contains("每一条必须明确对应前面的一个「可确认问题」"), "训练建议必须对应可确认问题");
        assertTrue(ZH.contains("禁止通用教练式空话"), "禁止 generic coaching filler");
    }

    @Test
    void tankRoleComesFromBackendOnly() {
        assertTrue(ZH.contains("h. 车辆角色类：禁止自创「薄皮输出型」「前排坦克」「肉盾」「狙击车」等角色标签"),
                "禁止自创车辆角色");
        assertTrue(ZH.contains("角色只能来自后端提供的"), "角色只能来自后端");
    }

    @Test
    void localizedContractConsistentAcrossLanguages() {
        for (final AllowedLanguage lang : java.util.List.of(AllowedLanguage.EN, AllowedLanguage.RU)) {
            final String localized = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, lang);
            // 中文证据契约规则段必须被替换，不残留
            assertFalse(localized.contains("证据契约（强制）：FACT / SUPPORTED INFERENCE"),
                    lang + " 残留中文证据契约");
            assertFalse(localized.contains("团队复盘输出结构（强制）"),
                    lang + " 残留中文输出结构");
            assertFalse(localized.contains("=== 单走行为判定规则（强制） ==="),
                    lang + " 残留中文单走规则");
        }
        final String en = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.EN);
        assertTrue(en.contains("EVIDENCE CONTRACT (mandatory): FACT / SUPPORTED INFERENCE / UNKNOWN / FORBIDDEN"),
                "EN 必须携带证据契约");
        assertTrue(en.contains("UNKNOWN is a normal answer"), "EN 必须携带 UNKNOWN 语义");
        assertTrue(en.contains("never invent precise numbers"), "EN 必须禁止精确数字");
        assertTrue(en.contains("Vehicle roles: never invent role labels"), "EN 必须禁止自创角色");
        assertFalse(en.contains("是图控/拿视野，不是脱节"), "EN 不得携带旧规则");

        final String ru = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.RU);
        assertTrue(ru.contains("КОНТРАКТ ДОКАЗАТЕЛЬСТВ"), "RU 必须携带证据契约");
        assertTrue(ru.contains("нормальный ответ, а не провал"), "RU 必须携带 UNKNOWN 语义");
        assertFalse(ru.contains("是图控/拿视野，不是脱节"), "RU 不得携带旧规则");
    }
}