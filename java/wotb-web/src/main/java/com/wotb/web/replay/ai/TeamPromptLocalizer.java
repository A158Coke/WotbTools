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
            5. 只基于可观测行为（位置、移动、交火、占点）判定战术行为模式，不得把行为模式说成玩家心理意图；正文不得出现「簇/质心/候选/规则候选/PARTIAL」等内部术语，一律转成自然中文。""";

    static final String SOLO_INTENT_RULE_EN = """

            === SOLO-PLAY JUDGMENT RULES (mandatory) ===
            1. An opening spread (before first contact or within the first 45 seconds, no damage dealt/received, no destruction) is map control / vision gathering, not detachment; never call it a mistake.
            2. Whether a solo member's play is "delay" depends on whether teammates profited from it (rotation / capture / advance on another flank / vision time): the backend provides temporal correlation only; never claim causation ("A's play caused B's profit").
            3. "Detachment" requires no delay benefit and being caught out / losing ground (no support, high damage taken or destruction, away from objectives).
            4. When the backend provides OPENING_MAP_CONTROL / SOLO_DELAY / SOLO_DETACHED candidates, state the signal basis before concluding; when signals are insufficient or contradictory, explicitly write "cannot be determined from the current replay data" and never force a label.
            5. Judge tactical behavior patterns only from observable behavior (position, movement, engagements, capture points); never describe a behavior pattern as the player's mental intent. Never echo internal terms such as cluster/centroid/candidate/PARTIAL; use natural language.""";

    static final String SOLO_INTENT_RULE_RU = """

            === ПРАВИЛА ОЦЕНКИ ДЕЙСТВИЙ В ОДИНОЧКУ (обязательно) ===
            1. Рассредоточение на старте (до первого контакта или в первые 45 секунд, без нанесённого/полученного урона, без уничтожения) — это контроль карты / сбор разведданных, а не отрыв; не считайте это ошибкой.
            2. Является ли действие игрока «задержкой», зависит от того, извлекли ли союзники выгоду (ротация / захват / продвижение на другом фланге / время на разведку): бэкенд даёт только временну́ю корреляцию; запрещено утверждать причинность («действие A принесло выгоду B»).
            3. «Отрыв» требует отсутствия выгоды от задержки и размена без пользы (без поддержки, высокий полученный урон или уничтожение, вдали от целей).
            4. Когда бэкенд даёт кандидатов OPENING_MAP_CONTROL / SOLO_DELAY / SOLO_DETACHED, сначала укажите обоснование по сигналам; при недостатке или противоречивости сигналов прямо пишите «невозможно определить по данным реплея» и не навешивайте ярлык.
            5. Оценивайте только наблюдаемые паттерны поведения (позиция, движение, перестрелки, захват точек); не выдавайте паттерн поведения за психологические намерения игрока. Не используйте внутренние термины (кластер/центроид/кандидат/PARTIAL); излагайте естественно.""";

    /** Team 专用：争霸赛占点规则（ZH；与 prompts/team/single.zh.md 内文本逐字一致）。 */
    static final String CAPTURE_RULE = """

            === 争霸赛占点规则（强制，训练房/联赛恒为争霸赛） ===
            1. 集中一波（多车同簇推进）可能付出代价：失去高视野 + 被敌方偷家/占点，复盘必须权衡。
            2. result 行的胜负来源以 resultSource 为准，只有三级证据，BATTLE_RESULTS 存在时最高优先级：
               a. BATTLE_RESULTS：来自 battle_results#winnerTeam 的权威结算；LLM 不得用事件流、存活数或点数覆盖胜方；
               b. SURVIVOR_SETTLEMENT：结算存活状态推导（一方全员阵亡）；非 battle result 权威，不得伪装成权威结算；
               c. 无权威胜方（winnerTeam 缺失）时胜负为未知：禁止用占点分、knownPointsSubtotal 或存活数推断胜方。
               d. 结算阵容不完整（SETTLEMENT_ROSTER_INCOMPLETE=true / pointsTotalsUnavailable=true）时，逐人/双方
                  占点分均为部分数据：禁止用残缺点数推断胜方或「时间耗尽/达到 1000 分」结束方式，点数结束方式只能写「点数判定」。
            3. 全歼语义按存活情况双向判定（与 resultSource 无关）：
               a. 本方获胜且对方 survivors=0 → 写「全歼敌方获胜」；
               b. 本方落败且本方 survivors=0 → 写「被敌方全歼落败」；
               c. 双方均有存活车辆时，才允许进入点数结束方式判断（争霸赛所有模式均为标准 7 分钟/1000 分规则，游戏不提供时长调整）：
                  任一方 knownPointsSubtotal ≥ 1000 → 写「达到 1000 分提前获胜」（部分分下界证明，精确比分未知）；
                  战斗时长未到 7 分钟且权威胜方存在 → 写「达到 1000 分提前获胜」，胜利方终局比分=1000（规则保证），失败方比分未知；
                  时长 ≥7 分钟且双方部分分均 <1000 → 写「时间耗尽后以点数优势获胜」，必须写「时间耗尽」；
                  无法证明时限或胜负时只写「点数判定」，终局比分未知，不得编造。
            4. 禁止把失败方被全歼写成「全歼敌方获胜」；禁止把点数胜负写成全歼或常规胜利；禁止用 <1000 的中间比分作为获胜理由。
            5. 占点分/占领分（victoryPointsEarned/Seized）是逐人占点统计，不含被动占点增长与击杀夺分，不代表时间线也不是终局比分；
               knownPointsSubtotal = 逐人占点分 + 击杀夺取分 − 被夺分，仍是部分可计算值（不含被动增长），同样不是终局比分；
               不得把总量说成某时刻占领进度，也不得把 victoryPointsEarned 合计或 knownPointsSubtotal 冒充终局比分。
            6. 地图占领点区域（CONTAINS_CONTROL_POINT）只用于描述方位，未提供时不得声称谁在占点。
            7. 击杀夺分（强制）：争霸赛每击杀一辆敌方坦克，击杀方夺取对方 40 分补充自身，被击杀方损失 40 分；
               已知部分分 = 占点分 + 击杀夺取分 − 被夺分（证据 knownPointsSubtotal 即该口径）；
               只有标准时限且权威胜方存在时，胜利方终局比分才=1000（规则保证），其余终局比分一律未知；
               禁止用不含击杀夺分的中间比分解释获胜，禁止编造失败方精确比分。""";

    static final String CAPTURE_RULE_EN = """

            === SUPREMACY CAPTURE RULES (mandatory; training room / clan battles are always supremacy) ===
            1. A concentrated one-lane rush can cost the team: losing high vision and risking a base capture / being capped; always weigh this in the review.
            2. The win/loss line must be read with resultSource; there are only three evidence levels, and BATTLE_RESULTS has the highest priority when present:
               a. BATTLE_RESULTS: authoritative settlement from battle_results#winnerTeam; never override the winner with event-stream observations, survival counts, or points;
               b. SURVIVOR_SETTLEMENT: derived from settlement survival state (one team fully destroyed); not an authoritative battle-result winner, never present it as one;
               c. Without an authoritative winner (winnerTeam missing) the winner is unknown: never infer it from capture points, knownPointsSubtotal, or survivor counts.
               d. When the settlement roster is incomplete (SETTLEMENT_ROSTER_INCOMPLETE=true / pointsTotalsUnavailable=true), the per-player and team capture-point totals are partial data: never infer the winner or a "time expired / reached 1000 points" end condition from partial points; the points end condition can only be written as "points decision".
            3. Annihilation wording is bidirectional and based on survivors (independent of resultSource):
               a. Your team wins and the opposing team has 0 survivors → write "won by annihilating the enemy team";
               b. Your team loses and your team has 0 survivors → write "lost, annihilated by the enemy team";
               c. Only when both teams have surviving vehicles may you judge the points end condition (every Supremacy mode — random battles, training rooms and tournaments — uses the standard 7-minute / 1000-point rules; the game offers no battle-duration setting):
                  either team's knownPointsSubtotal >= 1000 → write "won by reaching 1000 points early" (a lower-bound proof from partial points; the exact score is unknown);
                  battle shorter than 7 minutes + authoritative winner → write "won by reaching 1000 points early"; the winning team's final score is 1000 (guaranteed by the rules), the losing team's score is unknown;
                  duration >= 7 minutes + both partial totals < 1000 → write "won on points after time expired" — always write "time expired";
                  when the time limit or the winner cannot be proven, only write "points decision" and the final score is unknown — never invent it.
            4. Never write "won by annihilating the enemy team" when your own team was annihilated; never present a points win as annihilation or a regular win; never use a mid-match score below 1000 as the reason for winning.
            5. victoryPointsEarned / victoryPointsSeized are per-player capture statistics without passive accumulation or kill steals; they are not a timeline and not the final score. knownPointsSubtotal = per-player capture points + kill steals − stolen points is still a partial computable value (without passive accumulation) and is likewise not the final score — never present the totals as capture progress at a specific moment and never pass off the victoryPointsEarned sum or knownPointsSubtotal as the final score.
            6. Capture-point areas (CONTAINS_CONTROL_POINT) only describe direction; when not provided, never claim who is capturing.
            7. Kill steals (mandatory): in Supremacy every destroyed enemy tank steals 40 points from the enemy team and adds them to the killer's team, while the team that lost the tank loses 40 points; known partial points = capture points + kill steals − stolen points (the evidence's knownPointsSubtotal uses this formula); only with a standard time limit and an authoritative winner is the winning team's final score 1000 (guaranteed by the rules) — all other final scores are unknown; never explain the win with a score that omits kill steals and never invent the losing team's exact score.""";

    static final String CAPTURE_RULE_RU = """

            === ПРАВИЛА ЗАХВАТА (обязательно; тренировочные бои и клановые бои — всегда supremacy) ===
            1. Концентрированный рывок одной линией может стоить команде: потеря высокого обзора и риск захвата базы противником; всегда взвешивайте это в разборе.
            2. Строку result следует читать вместе с resultSource; существует только три уровня доказательности, и при наличии BATTLE_RESULTS он имеет высший приоритет:
               a. BATTLE_RESULTS: авторитетный итог из battle_results#winnerTeam; не подменяйте победителя наблюдениями из потока событий, числом выживших или очками;
               b. SURVIVOR_SETTLEMENT: вывод по статусу выживших из итогов (одна команда полностью уничтожена); это не авторитетное поле победителя battle result, не выдавайте его за таковое;
               c. Без авторитетного победителя (winnerTeam отсутствует) победитель неизвестен: не выводите его из очков захвата, knownPointsSubtotal или числа выживших.
               d. Когда состав расчёта неполон (SETTLEMENT_ROSTER_INCOMPLETE=true / pointsTotalsUnavailable=true), суммы очков захвата по игрокам и командам являются частичными данными: запрещено выводить победителя или условие завершения «время истекло / набрано 1000 очков» по неполным очкам; условие завершения по очкам можно писать только как «решение по очкам».
            3. Формулировка полного уничтожения двунаправленна и зависит от выживших (независимо от resultSource):
               a. Ваша команда победила, а у противника 0 выживших → напишите «победа полным уничтожением противника»;
               b. Ваша команда проиграла, а в вашей команде 0 выживших → напишите «поражение — противник полностью уничтожил вашу команду»;
               c. Только когда в обеих командах есть выжившие машины, оценивайте завершение по очкам (во всех режимах Supremacy — случайные бои, тренировочные комнаты и турниры — действуют стандартные правила 7 минут / 1000 очков; в игре нет настройки длительности боя):
                  knownPointsSubtotal любой команды ≥1000 → напишите «победа досрочно по достижении 1000 очков» (доказательство по нижней границе частичных очков, точный счёт неизвестен);
                  бой короче 7 минут + авторитетный победитель → напишите «победа досрочно по достижении 1000 очков», итоговый счёт победителя = 1000 (гарантировано правилами), счёт проигравшего неизвестен;
                  длительность ≥7 минут + обе частичные суммы <1000 → напишите «победа по очкам после истечения времени» — обязательно укажите «время истекло»;
                  если лимит времени или победитель недоказуемы, пишите только «решение по очкам», итоговый счёт неизвестен — не выдумывайте его.
            4. Не пишите «победа полным уничтожением противника», когда полностью уничтожена ваша команда; не выдавайте победу по очкам за уничтожение или обычную победу; не используйте промежуточный счёт ниже 1000 как причину победы.
            5. victoryPointsEarned / victoryPointsSeized — посчётная статистика захвата игроков без пассивного накопления и очков за фраги; это не таймлайн и не итоговый счёт. knownPointsSubtotal = очки захвата игроков + очки за фраги − потерянные очки — всё ещё частичная вычисляемая величина (без пассивного накопления) и тоже не итоговый счёт — не выдавайте суммы за прогресс захвата в конкретный момент и не выдавайте сумму victoryPointsEarned или knownPointsSubtotal за итоговый счёт.
            6. Области точек захвата (CONTAINS_CONTROL_POINT) описывают только направление; если они не предоставлены, не утверждайте, кто захватывает.
            7. Очки за фраги (обязательно): в Supremacy каждый уничтоженный вражеский танк отнимает у вражеской команды 40 очков и добавляет их команде убийцы, а команда, потерявшая машину, теряет 40 очков; известные частичные очки = очки захвата + очки за фраги − потерянные очки (в данных knownPointsSubtotal используется эта формула); только при стандартном лимите времени и авторитетном победителе итоговый счёт победителя = 1000 (гарантировано правилами), все остальные итоговые счета неизвестны; запрещено объяснять победу счётом без очков за фраги и выдумывать точный счёт проигравшей команды.""";

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
                .replace(PlayerPromptRules.HP_LOSS_TIME_RULE,
                        en ? PlayerPromptRules.HP_LOSS_TIME_RULE_EN
                                : PlayerPromptRules.HP_LOSS_TIME_RULE_RU)
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
