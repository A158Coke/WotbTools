package com.wotb.web.replay.ai;

/**
 * 团队 Prompt 规则与多语言常量：TEAM 专用分析/赛前基线/九宫格规则、中英俄措辞，
 * localizeTeamSystemPrompt 与 single/multi 两个 system prompt。
 * <p>从 {@link TeamReplayAnalysisService} 拆出，纯常量/纯函数工具类。</p>
 */
final class TeamPromptLocalizer {

    private TeamPromptLocalizer() {
    }

    static final String TEAM_ANALYSIS_RULE = """

            === 团队复盘规则（强制，仅训练房/联赛团队复盘） ===
            分析主体是 teamLabel 标识的整支队伍（主要军团），不是任何个人。
            对手称为「对方队伍」或「对方主要军团」。
            录像者只用于确定 perspective（分析视角），不得围绕录像者个人组织团队复盘，也不得把他的个人表现当作队伍结论。
            禁止把整支队伍称为「你」，本文不使用第二人称。
            必须逐车分析对方阵容并指出对方主要威胁车辆；对方数据缺失时明确说明，不得猜测。""";

    /** Team 专用：EN 团队规则（替换 TEAM_ANALYSIS_RULE）。 */
    static final String TEAM_ANALYSIS_RULE_EN = """

            === TEAM REVIEW RULES (mandatory, training room / clan battle team review only) ===
            The subject of the review is the entire team identified by teamLabel, not any individual player.
            Refer to the opponents as "the opposing team"/"the enemy team".
            The recorder is used only to determine the perspective; do not organize the team review around the
            recorder as an individual, and do not present his personal performance as team conclusions.
            Never address the whole team as "you"; do not use the second person in this review.
            Analyze the opposing lineup tank by tank and point out the opposing team's main threat vehicles;
            when opposing data is missing, say so explicitly instead of guessing."""; 

    /** Team 专用：RU 团队规则（替换 TEAM_ANALYSIS_RULE）。 */
    static final String TEAM_ANALYSIS_RULE_RU = """

            === ПРАВИЛА КОМАНДНОГО РАЗБОРА (обязательно, только командный разбор тренировочного боя или клановой игры) ===
            Объект разбора — вся команда, обозначенная teamLabel, а не отдельный игрок.
            Противников называйте «команда противника»/«вражеская команда».
            Рекордер используется только для определения перспективы; не стройте командный разбор вокруг рекордера
            как личности и не выдавайте его личные действия за выводы о команде.
            Не обращайтесь ко всей команде как к «вы»; в этом разборе не используйте второе лицо.
            Разбирайте состав противника по машинам и указывайте основные угрозы команды противника;
            при отсутствии данных о противнике прямо скажите об этом, не угадывая."""; 

    /** Team 专用：Call #1 赛前战略基线的使用规则（强制；EN/RU 本地化时替换）。 */
    static final String TEAM_PRIOR_RULE = """

            === 赛前战略基线（Call #1）使用规则（强制） ===
            输入可能包含 PRE-BATTLE STRATEGIC PRIOR：仅基于地图、双方阵容、双方总血量与坦克战术属性的
            赛前先验判断（含分阶段预期打法），未读取任何战斗结果。
            其中 TEAM_A=你的队伍（teamLabel）、TEAM_B=对方队伍；没有该段时不得编造基线。
            复盘必须对照基线：先识别本场实际战局类型（常规推进 / 一波流 / 蹲坑僵持 / 其他特殊战局），
            再逐条对照"预期打法 vs 实际执行"的差异与原因；实际战局偏离预期不等于失误，
            一波流等特殊战局可能让任何阶段计划失效，必须基于实际事件判断，不得仅因胜负倒推。""";

    static final String TEAM_PRIOR_RULE_EN = """

            === PRE-BATTLE STRATEGIC PRIOR (Call #1) USAGE RULE (mandatory) ===
            The input may include a PRE-BATTLE STRATEGIC PRIOR: a pre-battle judgment based only on the map,
            both lineups, total HP and tank tactical attributes (including staged expected play), with no battle results read.
            In it, TEAM_A = your team (teamLabel) and TEAM_B = the opposing team; if the section is absent, never fabricate a baseline.
            The review must be checked against this baseline: first identify the actual battle pattern
            (normal push / one-lane rush / camped stalemate / other special pattern), then compare
            "expected play vs actual execution" item by item with reasons. Deviation from the expectation
            is not automatically a mistake; special patterns such as a one-lane rush can invalidate any
            staged plan, so judge from actual events, never reason backwards from the result alone.""";

    static final String TEAM_PRIOR_RULE_RU = """

            === ПРАВИЛО ПРЕДБОЕВОЙ БАЗЫ (Call #1) (обязательно) ===
            Во входе может быть PRE-BATTLE STRATEGIC PRIOR — предбоевое суждение только по карте, составам,
            суммарному HP и тактическим атрибутам машин (включая поэтапный ожидаемый план), без чтения результатов боя.
            В нём TEAM_A = ваша команда (teamLabel), TEAM_B = команда противника; если секции нет, базу выдумывать нельзя.
            Разбор сверяйте с базой: сначала определите фактический паттерн боя (обычное продвижение /
            рывок одной линией / окопное противостояние / другой особый паттерн), затем по пунктам сравните
            «ожидаемый план vs фактическое исполнение» с причинами. Отклонение от ожиданий — не автоматически
            ошибка; особые паттерны (например, рывок одной линией) могут обесценить любой поэтапный план,
            судите по фактическим событиям, а не только по счёту.""";

    /** Team 专用：九宫格 region 与真实距离的关系规则（强制；EN/RU 本地化时替换）。 */
    static final String TEAM_REGION_RULE = """

            === 九宫格 region 与距离规则（强制） ===
            九宫格 region（1-9）只用于描述方位，region 相邻或编号差不代表实际距离；
            脱节/距离/掩护判断必须使用后端提供的 canonical 距离（米，
            如 deathProximityMeters 阵亡时刻与主力质心距离），禁止用 region 编号差推断距离。""";

    static final String TEAM_REGION_RULE_EN = """

            === NINE-GRID REGION VS DISTANCE RULE (mandatory) ===
            Nine-grid regions (1-9) describe direction only; adjacent regions or a region-number
            difference do NOT imply actual distance. Detachment/distance/cover judgments must use
            the backend-provided canonical distance in meters (e.g. deathProximityMeters, the
            distance to the main-body centroid at death); never infer distance from region numbers.""";

    static final String TEAM_REGION_RULE_RU = """

            === ПРАВИЛО ОБЛАСТЕЙ СЕТКИ И РАССТОЯНИЙ (обязательно) ===
            Области сетки 1–9 описывают только направление; соседство областей или разница номеров
            НЕ означает реальное расстояние. Оценки отрыва/дистанции/прикрытия должны использовать
            предоставленное бэкендом каноническое расстояние в метрах (например, deathProximityMeters —
            дистанция до центра масс своей группы в момент гибели); запрещено делать вывод о дистанции
            по номерам областей.""";

    /** 数据不足时的输出措辞（中文强制句，EN/RU 本地化时替换）。 */
    static final String ZH_CANNOT_DETERMINE_RULE =
            "无法从输入确定时必须写明“无法从当前回放数据确定”。";
    static final String EN_CANNOT_DETERMINE_RULE =
            "When the current replay data is insufficient, explicitly state that it cannot be "
                    + "determined from the available replay data.";
    static final String RU_CANNOT_DETERMINE_RULE =
            "Если данных реплея недостаточно, прямо укажите, что это невозможно определить "
                    + "по имеющимся данным реплея.";

    /** Team 专用：单走行为判定规则（ZH；与 prompts/team/single.zh.md 内文本逐字一致）。 */
    static final String SOLO_INTENT_RULE = """

            === 单走行为判定规则（强制） ===
            1. 开局散开（首次接敌前或开局 45 秒内、未接火未承伤未阵亡）是图控/拿视野，不是脱节，不得判为失误。
            2. 单走成员是否判「拖延」取决于队友是否因他获利（转场/占点/另一侧推进/视野时间）：后端只提供时序关联，禁止声称「A 的行为导致 B 获利」的因果。
            3. 判「脱节」需要无拖延收益且被白吃/丢点（无接应、承伤高或阵亡、远离目标点）。
            4. 后端给出 OPENING_MAP_CONTROL / SOLO_DELAY / SOLO_DETACHED 候选时，先说明信号依据再下结论；信号不足或矛盾时明确写「无法从当前回放数据确定」，禁止硬下标签。
            5. 只基于可观测行为（位置、移动、交火、占点）判定战术行为模式，不得把行为模式说成玩家心理意图。""";

    static final String SOLO_INTENT_RULE_EN = """

            === SOLO-PLAY JUDGMENT RULES (mandatory) ===
            1. An opening spread (before first contact or within the first 45 seconds, no damage dealt/received, no destruction) is map control / vision gathering, not detachment; never call it a mistake.
            2. Whether a solo member's play is "delay" depends on whether teammates profited from it (rotation / capture / advance on another flank / vision time): the backend provides temporal correlation only; never claim causation ("A's play caused B's profit").
            3. "Detachment" requires no delay benefit and being caught out / losing ground (no support, high damage taken or destruction, away from objectives).
            4. When the backend provides OPENING_MAP_CONTROL / SOLO_DELAY / SOLO_DETACHED candidates, state the signal basis before concluding; when signals are insufficient or contradictory, explicitly write "cannot be determined from the current replay data" and never force a label.
            5. Judge tactical behavior patterns only from observable behavior (position, movement, engagements, capture points); never describe a behavior pattern as the player's mental intent.""";

    static final String SOLO_INTENT_RULE_RU = """

            === ПРАВИЛА ОЦЕНКИ ДЕЙСТВИЙ В ОДИНОЧКУ (обязательно) ===
            1. Рассредоточение на старте (до первого контакта или в первые 45 секунд, без нанесённого/полученного урона, без уничтожения) — это контроль карты / сбор разведданных, а не отрыв; не считайте это ошибкой.
            2. Является ли действие игрока «задержкой», зависит от того, извлекли ли союзники выгоду (ротация / захват / продвижение на другом фланге / время на разведку): бэкенд даёт только временну́ю корреляцию; запрещено утверждать причинность («действие A принесло выгоду B»).
            3. «Отрыв» требует отсутствия выгоды от задержки и размена без пользы (без поддержки, высокий полученный урон или уничтожение, вдали от целей).
            4. Когда бэкенд даёт кандидатов OPENING_MAP_CONTROL / SOLO_DELAY / SOLO_DETACHED, сначала укажите обоснование по сигналам; при недостатке или противоречивости сигналов прямо пишите «невозможно определить по данным реплея» и не навешивайте ярлык.
            5. Оценивайте только наблюдаемые паттерны поведения (позиция, движение, перестрелки, захват точек); не выдавайте паттерн поведения за психологические намерения игрока.""";

    /** Team 专用：争霸赛占点规则（ZH；与 prompts/team/single.zh.md 内文本逐字一致）。 */
    static final String CAPTURE_RULE = """

            === 争霸赛占点规则（强制，训练房/联赛恒为争霸赛） ===
            1. 集中一波（多车同簇推进）可能付出代价：失去高视野 + 被敌方偷家/占点，复盘必须权衡。
            2. 残局守家 vs 占点是点数胜负的关键：双方未全灭时以点数分高者胜（pointsDecided）。
            3. 占点分/占领分（victoryPointsEarned/Seized）是权威结算总量，不代表时间线；不得把总量说成某时刻占领进度。
            4. 地图占领点区域（CONTAINS_CONTROL_POINT）只用于描述方位，未提供时不得声称谁在占点。""";

    static final String CAPTURE_RULE_EN = """

            === SUPREMACY CAPTURE RULES (mandatory; training room / clan battles are always supremacy) ===
            1. A concentrated one-lane rush can cost the team: losing high vision and risking a base capture / being capped; always weigh this in the review.
            2. Late-game base defense vs capture decides point victories: when both teams are not fully destroyed, the team with more capture points wins (pointsDecided).
            3. victoryPointsEarned / victoryPointsSeized are authoritative settlement totals, not a timeline; never present totals as capture progress at a specific moment.
            4. Capture-point areas (CONTAINS_CONTROL_POINT) only describe direction; when not provided, never claim who is capturing.""";

    static final String CAPTURE_RULE_RU = """

            === ПРАВИЛА ЗАХВАТА (обязательно; тренировочные бои и клановые бои — всегда supremacy) ===
            1. Концентрированный рывок одной линией может стоить команде: потеря высокого обзора и риск захвата базы противником; всегда взвешивайте это в разборе.
            2. В концовке защита базы против захвата решает исход по очкам: если обе команды не уничтожены полностью, побеждает команда с большим числом очков захвата (pointsDecided).
            3. victoryPointsEarned / victoryPointsSeized — авторитетные итоги расчёта, а не таймлайн; не выдавайте итоги за прогресс захвата в конкретный момент.
            4. Области точек захвата (CONTAINS_CONTROL_POINT) описывают только направление; если они не предоставлены, не утверждайте, кто захватывает.""";

    /**
     * 组装团队 system prompt：ZH 返回原样；EN/RU 在中文基座上替换中文输出强制句
     * （输出语言、时间格式、语言规则与团队规则）。
     */
    static String localizeTeamSystemPrompt(final String zhPrompt, final AllowedLanguage language) {
        if (language == null || language == AllowedLanguage.ZH) {
            return zhPrompt;
        }
        final boolean en = language == AllowedLanguage.EN;
        return zhPrompt
                .replace("请用简体中文输出：",
                        en ? PlayerPromptRules.EN_OUTPUT_INTRO
                                : PlayerPromptRules.RU_OUTPUT_INTRO)
                .replace(PlayerPromptRules.ZH_TIME_RULE,
                        en ? PlayerPromptRules.EN_TIME_RULE
                                : PlayerPromptRules.RU_TIME_RULE)
                .replace(PlayerPromptRules.COMMON_CHINESE_LANGUAGE_RULE,
                        en ? PlayerPromptRules.COMMON_LANGUAGE_RULE_EN
                                : PlayerPromptRules.COMMON_LANGUAGE_RULE_RU)
                .replace(PlayerPromptRules.ZH_UNKNOWN_FIELD_RULE,
                        en ? PlayerPromptRules.EN_UNKNOWN_FIELD_RULE
                                : PlayerPromptRules.RU_UNKNOWN_FIELD_RULE)
                .replace(ZH_CANNOT_DETERMINE_RULE,
                        en ? EN_CANNOT_DETERMINE_RULE : RU_CANNOT_DETERMINE_RULE)
                .replace(TEAM_ANALYSIS_RULE,
                        en ? TEAM_ANALYSIS_RULE_EN : TEAM_ANALYSIS_RULE_RU)
                .replace(PlayerPromptRules.COMMON_DAMAGE_SEMANTICS_RULE,
                        en ? PlayerPromptRules.COMMON_DAMAGE_SEMANTICS_RULE_EN
                                : PlayerPromptRules.COMMON_DAMAGE_SEMANTICS_RULE_RU)
                .replace(PlayerPromptRules.COMMON_EVIDENCE_LOGIC_RULE,
                        en ? PlayerPromptRules.COMMON_EVIDENCE_LOGIC_RULE_EN
                                : PlayerPromptRules.COMMON_EVIDENCE_LOGIC_RULE_RU)
                .replace(TEAM_PRIOR_RULE,
                        en ? TEAM_PRIOR_RULE_EN : TEAM_PRIOR_RULE_RU)
                .replace(TEAM_REGION_RULE,
                        en ? TEAM_REGION_RULE_EN : TEAM_REGION_RULE_RU)
                .replace(SOLO_INTENT_RULE,
                        en ? SOLO_INTENT_RULE_EN : SOLO_INTENT_RULE_RU)
                .replace(CAPTURE_RULE,
                        en ? CAPTURE_RULE_EN : CAPTURE_RULE_RU);
    }

    static final String SINGLE_TEAM_PROMPT = AiPromptLibrary.zh("team/single");

}
