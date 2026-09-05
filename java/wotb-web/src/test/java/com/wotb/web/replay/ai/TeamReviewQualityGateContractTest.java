package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AI Review V2.1 Team Review Quality Gate — Prompt Contract。
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
        // Natural Coach Mode：自由组织的自然复盘，禁止固定章节模板
        assertFalse(ZH.contains("1. 核心结论：2-4 句"), "不得再强制核心结论章节");
        assertFalse(ZH.contains("2. 关键决策窗口：只输出"), "不得再强制关键决策窗口章节");
        assertFalse(ZH.contains("3. 可确认的团队问题：只写"), "不得再强制可确认问题章节");
        assertFalse(ZH.contains("4. 训练建议：只写"), "不得再强制训练建议章节");
        assertTrue(ZH.contains("自由组织的自然复盘"), "必须声明自由组织的自然复盘");
        assertTrue(ZH.contains("不是固定章节模板"), "必须声明不是固定章节模板");
        assertTrue(ZH.contains("## 团队复盘"), "主标题为 ## 团队复盘");
        assertTrue(ZH.contains("按关键性自由组织，不设硬性段数或固定篇幅"), "不设硬性段数或固定篇幅");
        assertTrue(ZH.contains("关键 tactical episode，必须展开到足以说明"), "关键 episode 必须完整解释");
        assertTrue(ZH.contains("不得为了“简洁”省略会改变战术判断的信息"), "不得因简洁省略关键战术信息");
        assertTrue(ZH.contains("多个 local 必须检查是否有传播"), "多个 local 必须检查传播");
        assertTrue(ZH.contains("primaryDiagnosis 只是整场摘要，不得压缩 v0.5 structured result 中的 episodes 或训练建议"), "primaryDiagnosis 只是摘要");
        assertTrue(ZH.contains("“重点复查”和“高贡献者”是可选 section"), "个人 section 可选");
        assertTrue(ZH.contains("主因可以只有一个，不要为了凑结构制造不存在的问题"), "主因可以只有一个且不得凑结构造问题");
        assertTrue(ZH.contains("但一个主因不等于正文只能讲一件事"), "主因不能压缩正文范围");
        assertTrue(ZH.contains("必须保留解释该主因所需的 Information、Objectives、local engagements、cross-local propagation"),
                "正文必须保留解释主因所需的战术链");
        assertTrue(ZH.contains("内部 attention 提示"), "Focus Window 是内部 attention primitive");
        assertTrue(ZH.contains("这局真正崩掉是在1分52秒后面那二十秒"), "自然语言引用窗口示例");
        assertTrue(ZH.contains("对方关键威胁（可选）"), "对方关键威胁保持可选");
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
        assertTrue(ZH.contains("具体视野收益保持内部 UNKNOWN"),
                "无专门 evidence 时具体视野收益保持内部 UNKNOWN（不强制写「无法确认」）");
        // 响应分析：拿到信息后是否及时响应
        assertTrue(ZH.contains("开局分散的质量取决于拿到信息后是否及时响应"),
                "必须分析信息获得后的响应（合流/收缩/转场）");
    }

    @Test
    void openingSpreadStrategicInterpretationContractInThreeLanguages() {
        // 追加修正：三语都必须携带「信息覆盖 ↔ 局部兵力集中度」trade-off 语义
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
    void v06InformationSupportabilityAndIndividualBindingContract() {
        assertTrue(ZH.contains("Known → Remaining uncertainty → New observation → 哪种 uncertainty 被移除/缩小 → Decision impact"),
                "Information 必须形成 Known -> uncertainty -> observation -> decision impact 链");
        assertTrue(ZH.contains("distance 只是 evidence，不是 supportability verdict"),
                "距离只能是 evidence，不是 supportability verdict");
        assertTrue(ZH.contains("综合 line of fire、terrain / obstruction、time-to-influence、mobility、target availability"),
                "支援能力必须综合几何之外的证据");
        assertTrue(ZH.contains("不要把时间接近的死亡事件自动串成因果 episode"),
                "相邻死亡不能自动构成因果 episode");
        assertTrue(ZH.contains("HP、damage、deaths 是 position/decision 因果链的下游结果或验证信号"),
                "HP/伤害/死亡必须作为下游验证");
        assertTrue(ZH.contains("Trigger → Decision target → Training goal"),
                "训练建议必须使用状态触发而非固定时刻");
        assertTrue(ZH.contains("结合 base ownership、current points、point growth、remaining time"),
                "Objectives 必须检查行动义务");
        assertTrue(ZH.contains("重点复查与高贡献者只能从已展开的 tactical episode 选择"),
                "个人 section 必须绑定正文 episode");
        assertTrue(ZH.contains("不能从 settlement leaderboard 重新选人"),
                "个人 section 不得重新从结算榜单选人");
        assertTrue(ZH.contains("没有证据就输出空数组"),
                "个人 section 没有 tactical evidence 时必须省略");
        assertTrue(ZH.contains("具体视野/掩体/LOS/装填/心理意图没有证据时不得写成事实"),
                "不得猜测敌方意图");
        assertTrue(ZH.contains("证据不足时明确无法确认直接传播"),
                "propagation 检查不强制制造传播");
    }

    @Test
    void v06ReasoningOrderIsExplicitAndOrdered() {
        final String[] anchors = {
                "Read authoritative facts",
                "Establish information state",
                "Identify remaining uncertainty",
                "Evaluate objective obligation",
                "Identify pivotal local engagements",
                "Determine effective local participation",
                "Trace tactical transition",
                "Trace propagation",
                "Use HP/damage/deaths as downstream validation",
                "Select training targets",
                "Select individual candidates only if episode-grounded",
                "Produce structured JSON"
        };
        int previous = -1;
        for (final String anchor : anchors) {
            final int current = ZH.indexOf(anchor);
            assertTrue(current > previous, "v0.6 推理顺序缺少或顺序错误: " + anchor);
            previous = current;
        }
    }

    @Test
    void v06LocalizedReasoningContractIsAvailableInThreeLanguages() {
        final String en = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.EN);
        assertTrue(en.contains("TEAM REVIEW V0.6 REASONING ORDER AND CAUSAL QUALITY CONTRACT"));
        assertTrue(en.contains("Distance is evidence, not a supportability verdict"));
        assertTrue(en.contains("State before -> Change -> Immediate local consequence -> Propagation"));
        assertTrue(en.contains("downstream validation"));
        assertFalse(en.contains("=== v0.4 信息链、支援能力与个人复查约束（强制） ==="));

        final String ru = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.RU);
        assertTrue(ru.contains("ПОРЯДОК РАССУЖДЕНИЯ КОМАНДНОГО РАЗБОРА V0.6"));
        assertTrue(ru.contains("Расстояние — evidence, а не verdict о возможности поддержки"));
        assertTrue(ru.contains("downstream validation"));
        assertFalse(ru.contains("=== v0.4 信息链、支援能力与个人复查约束（强制） ==="));
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
            assertFalse(localized.contains("=== 空间分离证据使用规则（强制） ==="),
                    lang + " 残留中文空间分离规则");
            assertFalse(localized.contains("=== 重新集中推断规则（强制：本场具体结论必须有证据） ==="),
                    lang + " 残留中文重新集中规则");
            assertFalse(localized.contains("=== 内部证据与用户正文的关系（强制） ==="),
                    lang + " 残留中文内部证据规则");
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

    // ---- Opening Spread 的 battle-specific inference 必须有证据 ----

    @Test
    void regroupingIsBattleSpecificConclusionNeedingEvidence() {
        // 「敌方主力确认后本方没有及时合流」是本场具体结论，不是一般战术解释
        assertTrue(ZH.contains("是本场具体结论，不是一般战术解释"),
                "必须把合流/重新集中标记为本场具体结论");
        assertTrue(ZH.contains("重新集中推断规则（强制：本场具体结论必须有证据）"),
                "必须携带重新集中推断规则");
        assertTrue(ZH.contains("对方主力方向已经比较明确后，本方仍保持分散，重新集中的速度不够"),
                "满足证据时的 supported inference 措辞");
        assertTrue(ZH.contains("当时已有足够的敌方已知信息支持"),
                "证据门 1：敌方已知信息支持主力方向确认");
        assertTrue(ZH.contains("本方仍存在多个显著分离的集群"),
                "证据门 2：本方仍多个显著分离集群");
        assertTrue(ZH.contains("两个己方集群没有明显靠近或形成支援"),
                "证据门 3：后续未靠近/未支援");
        assertTrue(ZH.contains("首次关键交火/减员发生在其中一个集群"),
                "证据门 4：首次关键交火发生在其中一个集群");
        assertFalse(ZH.contains("分路是以局部兵力密度换取空间/信息覆盖」「敌方主力确认后本方没有及时合流」"),
                "「合流」不得再列在允许的一般战术解释里");
    }

    @Test
    void enemyUnknownWordingIsStrict() {
        // known=4 / unknown=3：只能说「至少观察到 4 辆，其余 3 辆位置不明确」
        assertTrue(ZH.contains("至少已经观察到 4 辆敌车"), "必须给出 unknown 措辞（至少观察到 X 辆）");
        assertTrue(ZH.contains("其余 3 辆的位置还不明确"), "必须给出 unknown 措辞（其余未知）");
        assertTrue(ZH.contains("禁止说「对方 7 辆主力已经集中在这一侧」"),
                "禁止把已知+未知合计说成全部集中");
        assertTrue(ZH.contains("不得回填到更早的判断窗口"), "anti-future-leak：后面信息不得回填");
    }

    @Test
    void regroupingContractLocalizedInThreeLanguages() {
        for (final AllowedLanguage lang : java.util.List.of(AllowedLanguage.EN, AllowedLanguage.RU)) {
            final String localized = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, lang);
            assertTrue(localized.contains("anti-future-leak"), lang + " 必须携带 anti-future-leak");
        }
        final String en = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.EN);
        assertTrue(en.contains("REGROUPING INFERENCE RULE"), "EN 必须携带重新集中规则");
        assertTrue(en.contains("at least 4 enemy vehicles were observed"),
                "EN 必须给出 unknown 措辞");
        assertFalse(en.contains("对方 7 辆主力已经集中在这一侧"), "EN 不得携带中文禁止句");
        final String ru = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.RU);
        assertTrue(ru.contains("ПРАВИЛО ВЫВОДА О ПЕРЕГРУППИРОВКЕ"), "RU 必须携带重新集中规则");
    }

    // ---- 对方关键威胁 optional contract 统一 ----

    @Test
    void opposingThreatIsOptionalOnlyWhenMaterial() {
        // A. optional threat：必须显式「可选」+「只在确实有价值时」
        assertTrue(ZH.contains("对方关键威胁（可选）"), "输出结构必须标记对方关键威胁为可选");
        assertTrue(ZH.contains("对方关键威胁是【可选】内容"), "团队规则必须统一为可选语义");
        assertTrue(ZH.contains("只有对核心复盘确有价值时才指出 1-3 辆对方关键威胁"),
                "必须只在确实有价值时输出");
        assertTrue(ZH.contains("没有明显关键威胁或对核心复盘没有帮助时直接省略"),
                "无 material threat 时必须允许完全省略");
        assertTrue(ZH.contains("不得为了结构完整强行选一个"),
                "不得为了结构完整强行选威胁");
    }

    @Test
    void noMandatoryOpponentThreatContradiction() {
        // B. 不得存在 mandatory contradiction
        assertFalse(ZH.contains("分析对方阵容并指出对方主要威胁车辆"),
                "不得保留无条件 mandatory 威胁规则");
        assertFalse(ZH.contains("必须分析对方"), "不得强制分析对方");
    }

    @Test
    void noForcedOpponentDataDisclaimer() {
        // C. no forced missing-data disclaimer：改为 selective UNKNOWN
        assertFalse(ZH.contains("对方数据缺失时明确说明"),
                "不得强制输出缺失数据 disclaimer");
        assertTrue(ZH.contains("对方数据不足时不得猜测"), "不得猜测");
        assertTrue(ZH.contains("缺失本身保持内部 UNKNOWN"), "缺失保持内部 UNKNOWN");
        assertTrue(ZH.contains("按全局选择性 UNKNOWN 规则自然说明"),
                "缺失说明必须引用全局选择性 UNKNOWN 条件");
    }

    @Test
    void opposingThreatOptionalContractLocalizedInThreeLanguages() {
        // D. EN/RU parity：同样不得强制威胁段 / 强制缺失 disclaimer
        for (final AllowedLanguage lang : java.util.List.of(AllowedLanguage.EN, AllowedLanguage.RU)) {
            final String localized = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, lang);
            assertFalse(localized.contains("Analyze the opposing lineup and point out the opposing team's main threat vehicles"),
                    lang + " 不得强制 Analyze the opposing lineup");
            assertFalse(localized.contains("say so explicitly instead of guessing"),
                    lang + " 不得强制 say so explicitly");
            assertFalse(localized.contains("Проанализируйте состав противника и укажите основные угрозы"),
                    lang + " 不得强制 RU 分析阵容");
            assertFalse(localized.contains("прямо скажите об этом"),
                    lang + " 不得强制 RU 缺失说明");
        }
        final String en = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.EN);
        assertTrue(en.contains("Opposing threats are optional content"), "EN 必须标记为可选");
        assertTrue(en.contains("only point out 1-3 enemy vehicles when they genuinely help"),
                "EN 必须只在确有价值时输出");
        assertTrue(en.contains("selective-UNKNOWN"), "EN 必须引用全局选择性 UNKNOWN");
        final String ru = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.RU);
        assertTrue(ru.contains("опциональное содержание"), "RU 必须标记为可选");
        assertTrue(ru.contains("селективного UNKNOWN"), "RU 必须引用全局选择性 UNKNOWN");
    }
}
