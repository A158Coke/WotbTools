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

    /** Team 专用：阵型深度（前后排）与控制区域规则（ZH；与 prompts/team/single.zh.md 内文本逐字一致）。 */
    static final String FORMATION_DEPTH_RULE = """
            === 阵型深度与区域驻留规则（强制） ===
            FORMATION_DEPTH 段是确定性几何/计数证据，用于理解阵型、前后排与双方活动覆盖（区域驻留优势）：
            1. frontLine / midLine / backLine 是本队成员沿「本队质心 → 敌方质心」轴按深度三分位的分类，
               描述阵型时用自然中文（如「前排抗线、中排输出、后排支援」），不得改判成员排位。
            2. dwellRegions 的 own / contested / enemy 是九宫格区域内双方车辆驻留计数优势——
               own=本方驻留更多、contested=双方都有驻留、enemy=对方驻留更多；这只是区域活动/驻留计数事实，
               不得断言「控制/占领了某区」，也不得表述为占领点得分、实时比分或地图语义区域名。
            3. 未提供 FORMATION_DEPTH 段时（位置观测不足）禁止编造前后排或区域驻留情况。
            4. 区域只能引用证据中的 GRID_REGION_1~9 编号，禁止用裸坐标重新划区。""";

    static final String FORMATION_DEPTH_RULE_EN = """

            === FORMATION DEPTH AND DWELL ADVANTAGE RULE (mandatory) ===
            The FORMATION_DEPTH section is deterministic geometric/counting evidence for understanding the formation, the front/mid/back lines and where each team has activity/dwell coverage:
            1. frontLine / midLine / backLine classify own-team members by depth terciles along the "own centroid → enemy centroid" axis; describe the formation in natural language (e.g. "front line holds, middle line outputs, back line supports") and do not re-judge member positions.
            2. dwellRegions own / contested / enemy are nine-grid region dwell-count advantages (own = own team dwelled more, contested = both dwelled, enemy = the enemy dwelled more); this is only a deterministic dwell/activity counting fact — never claim a region is "controlled/captured", and never present it as capture points, a live score, or named tactical map areas.
            3. If the FORMATION_DEPTH section is absent (insufficient position observation), never fabricate front/back lines or dwell coverage.
            4. Reference regions only by the GRID_REGION_1~9 ids in the evidence; never re-derive regions from raw coordinates.""";

    static final String FORMATION_DEPTH_RULE_RU = """

            === ПРАВИЛО ГЛУБИНЫ СТРОЯ И ПРЕИМУЩЕСТВА ПРИСУТСТВИЯ (обязательно) ===
            Секция FORMATION_DEPTH — детерминированное геометрическое/счётное свидетельство для понимания строя, передней/средней/задней линий и зон активности/присутствия команд:
            1. frontLine / midLine / backLine классифицируют участников своей команды по терцилям глубины вдоль оси «центроид своей команды → центроид противника»; описывайте строй естественным языком (например, «передняя линия держит, средняя наносит урон, задняя поддерживает») и не пересматривайте позиции участников.
            2. dwellRegions own / contested / enemy — преимущество по числу нахождений в девятисекторных областях (own = своя команда находилась больше, contested = находились обе, enemy = больше находился противник); это только детерминированный факт счёта присутствия — запрещено утверждать, что область «контролируется/захвачена», и выдавать это за очки захвата, живой счёт или именованные тактические зоны карты.
            3. Если секция FORMATION_DEPTH отсутствует (недостаточно наблюдений позиций), запрещено выдумывать переднюю/заднюю линию или зоны присутствия.
            4. Зоны можно указывать только по идентификаторам GRID_REGION_1~9 из свидетельств; запрещено переопределять зоны по сырым координатам.""";

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
            1. 集中一波（多车集群推进）可能付出代价：失去高视野 + 被敌方偷家/占点，复盘必须权衡。
            2. result 行的胜负来源以 resultSource 为准，只有三级证据，BATTLE_RESULTS 存在时最高优先级：
               a. BATTLE_RESULTS：来自 battle_results#winnerTeam 的权威结算；LLM 不得用事件流、存活数或点数覆盖胜方；
               b. SURVIVOR_SETTLEMENT：结算存活状态推导（一方全员阵亡）；非 battle result 权威，不得伪装成权威结算；
               c. 无权威胜方（winnerTeam 缺失）时：仅当 rosterComplete=true 且一方全员阵亡，才可用 SURVIVOR_SETTLEMENT
                  按完整结算存活状态推导全歼胜方；双方均有存活时胜方未知，禁止比较占点字段推断胜方。
               d. 结算阵容不完整（SETTLEMENT_ROSTER_INCOMPLETE=true / pointsTotalsUnavailable=true）时，逐人/双方
                  占点分均为部分数据：禁止用残缺点数推断胜方或「时间耗尽/达到 1000 分」结束方式，点数结束方式只能写「点数判定」。
            3. 全歼语义按存活情况双向判定（与 resultSource 无关）：
               a. 本方获胜且对方 survivors=0 → 写「全歼敌方获胜」；
               b. 本方落败且本方 survivors=0 → 写「被敌方全歼落败」；
               c. 双方均有存活车辆时，才允许进入点数结束方式判断（争霸赛所有模式均为固定 7 分钟/420 秒、胜利点数上限 1000 分的业务规则——项目所有者确认，游戏不提供时长调整；arenaBonusType 只证明战斗类别，不直接解码出 420s/1000）：
                  战斗时长未到 7 分钟 → 结束原因为「某一方达到 1000 分导致提前结束」：权威胜方存在时写「达到 1000 分提前获胜」，胜利方终局比分=1000（1000 分上限业务约定），失败方比分未知；
                  胜方缺失时只写「某一方达到 1000 分导致提前结束，具体胜方未知」，双方终局比分未知；
                  时长 ≥7 分钟 → 权威胜方存在时写「时间耗尽后以点数优势获胜」，必须写「时间耗尽」；胜方缺失时只写「时间耗尽点数判定，具体胜方未知」，双方终局比分未知；
                  无法证明时限时只写「点数判定」，终局比分未知，不得编造。
            4. 禁止把失败方被全歼写成「全歼敌方获胜」；禁止把点数胜负写成全歼或常规胜利；禁止用 <1000 的中间比分作为获胜理由。
            5. 占点分/占领分（victoryPointsEarned/Seized）是逐人结算字段：其精确定义及是否包含被动占点增长、击杀夺分等调整仍未证明，
               不代表时间线也不是终局比分；每据点每 tick 产分与 tick 间隔均未解码（无任何已验证的 tick 产分规则），
               禁止用 tick 数或占点分计算终局比分；不得把总量说成某时刻占领进度，也不得把 victoryPointsEarned 合计
               或任何公式计算结果冒充终局比分。
            6. 地图占领点区域（CONTAINS_CONTROL_POINT）只用于描述方位，未提供时不得声称谁在占点。
            7. 击杀夺分（业务规则，项目所有者确认）：争霸赛每击杀一辆敌方坦克，击杀方夺取对方 40 分补充自身，被击杀方损失 40 分；
               该规则只作叙述口径（「击毁车辆通常会改变双方点数」），结算字段是否已包含该调整未经证明，
               禁止自行用「占点分 + 40×击杀 − 40×阵亡」等公式计算结果并当作事实输出；
               只有权威胜方存在且标准规则下提前结束时，胜利方终局比分才=1000（1000 分上限业务约定），其余终局比分一律未知；
               禁止用不含击杀夺分的中间比分解释获胜，禁止编造失败方精确比分。
            8. 点数局势与攻防姿态（只基于可证明信号）：
               a. 终局前任意时刻的绝对比分未解码（实时比分/占点进度/被动占点增长均无证据），禁止编造任何中间比分、
                  精确领先幅度或「此刻领先多少分」式断言。击杀夺分时间线只表达「击杀换分项」的累计净差值，
                  是部分可证明信号，不是整体点数：禁止把击杀换分项净劣势/优势直接写成整体点数落后/领先；
                  终局点数落败只能描述终局结果，禁止反推早期任意时刻的整体点数状态。判断点数压力只能用
                  POINTS_SITUATION 段的可证明信号（击杀夺分时间线、占领点区域位置存在、推进窗口）与终局结算/结束方式。
               b. 条件式分析（允许，须写明前提）：若双方未通过占点取得更大的点数积累（占点积累不可观测），
                  击杀换分项净劣势的一方进攻压力更大——需要进攻抢点；击杀换分项净优势的一方可以更从容地
                  防守拉交叉。必须先说明这是基于击杀换分项与占点存在信号的推断，不得说成整体比分领先/落后。
               c. 进攻推进大概率付出掉血代价：评价进攻方掉血必须结合点数压力情境——为抢点/进攻付出的掉血未必是失误；
                  无点数压力时的无谓掉血、无交换的单方面掉血才是问题。
               d. 过路费：对方进攻推进窗口（PUSH_WINDOWS）内，防守方对推进方造成的伤害就是过路费；
                  窗口内推进方几乎无伤完成推进或达成占点存在（过路费明显不足）时，必须指出防守方失误；
                  伤害数字不可用（OBSERVED_DAMAGE_IS_PARTIAL）时只做定性描述，不得报数字。
               e. 信号不足或矛盾时写「无法从当前回放数据确定」，不得硬下「落后/领先」结论。""";

    static final String CAPTURE_RULE_EN = """

            === SUPREMACY CAPTURE RULES (mandatory; training room / clan battles are always supremacy) ===
            1. A concentrated one-lane rush can cost the team: losing high vision and risking a base capture / being capped; always weigh this in the review.
            2. The win/loss line must be read with resultSource; there are only three evidence levels, and BATTLE_RESULTS has the highest priority when present:
               a. BATTLE_RESULTS: authoritative settlement from battle_results#winnerTeam; never override the winner with event-stream observations, survival counts, or points;
               b. SURVIVOR_SETTLEMENT: derived from settlement survival state (one team fully destroyed); not an authoritative battle-result winner, never present it as one;
               c. Without an authoritative winner (winnerTeam missing): only when rosterComplete=true and one team is fully destroyed may you derive the annihilation winner via SURVIVOR_SETTLEMENT from the complete settlement survival state; when both teams have survivors the winner is unknown — never infer it by comparing capture-point fields.
               d. When the settlement roster is incomplete (SETTLEMENT_ROSTER_INCOMPLETE=true / pointsTotalsUnavailable=true), the per-player and team capture-point totals are partial data: never infer the winner or a "time expired / reached 1000 points" end condition from partial points; the points end condition can only be written as "points decision".
            3. Annihilation wording is bidirectional and based on survivors (independent of resultSource):
               a. Your team wins and the opposing team has 0 survivors → write "won by annihilating the enemy team";
               b. Your team loses and your team has 0 survivors → write "lost, annihilated by the enemy team";
               c. Only when both teams have surviving vehicles may you judge the points end condition (every Supremacy mode uses the fixed 7-minute / 420-second duration and a 1000-point victory cap — business rules confirmed by the project owner; the game offers no battle-duration setting, and arenaBonusType only proves the battle category, it does not decode 420s/1000):
                  battle shorter than 7 minutes → the end reason is "a team reached 1000 points, ending the battle early"; with an authoritative winner write "won by reaching 1000 points early" and the winning team's final score is 1000 (the 1000-point cap, a business convention), the losing team's score is unknown;
                  without an authoritative winner write only "a team reached 1000 points, ending the battle early; the winning team is unknown" and both final scores are unknown;
                  duration >= 7 minutes → with an authoritative winner write "won on points after time expired" — always write "time expired"; without one, write only "points decision after time expired, the winning team is unknown" and both final scores are unknown;
                  when the time limit cannot be proven, only write "points decision" and the final score is unknown — never invent it.
            4. Never write "won by annihilating the enemy team" when your own team was annihilated; never present a points win as annihilation or a regular win; never use a mid-match score below 1000 as the reason for winning.
            5. victoryPointsEarned / victoryPointsSeized are per-player settlement fields whose exact meaning and whether they already include passive accumulation or kill steals is unproven; they are not a timeline and not the final score. Capture scoring business rule (confirmed by the project owner): No per-base per-tick scoring rule has been verified, and the tick interval is undecoded, so never compute a final score from tick counts or capture points. Never present the totals as capture progress at a specific moment and never pass off the victoryPointsEarned sum or any formula result as the final score.
            6. Capture-point areas (CONTAINS_CONTROL_POINT) only describe direction; when not provided, never claim who is capturing.
            7. Kill steals (business rule, confirmed by the project owner): in Supremacy every destroyed enemy tank steals 40 points from the enemy team and adds them to the killer's team, while the team that lost the tank loses 40 points; this rule is a narrative guideline only ("destroying vehicles usually changes both teams' points") — whether the settlement fields already include this adjustment is unproven, so never compute "capture points + 40×kills − 40×deaths" yourself and present the result as fact; only with an authoritative winner and a rule-provable early end is the winning team's final score 1000 (the 1000-point cap, a business convention) — all other final scores are unknown; never explain the win with a score that omits kill steals and never invent the losing team's exact score.
            8. Points situation and attack/defense posture (provable signals only):
               a. The absolute score at any moment before the end is undecoded (live score, capture progress, and passive accumulation have no evidence); never invent any mid-match score, an exact lead margin, or claims like "currently behind by X points". The kill-steal timeline expresses only the cumulative net delta of the "kill-steal component" — a partial provable signal, not the overall score: never present a net kill-steal deficit/lead as an overall points disadvantage/advantage; a final points loss describes only the final result — never retro-infer the overall points state at any earlier moment. Judge points pressure only from the provable signals in the POINTS_SITUATION section (kill-steal timeline, capture-point area presence, push windows) and the final settlement / end condition.
               b. Conditional analysis is allowed but must state its premise: if neither team accumulated more points through captures (capture accumulation is not observable), the team with a net kill-steal deficit faces greater attack pressure — it needs to attack and capture; the team with a net kill-steal lead can more comfortably defend with crossfire. Always state first that this is an inference based on the kill-steal component and capture-presence signals — never present it as an overall score lead/deficit.
               c. Attacking pushes usually cost HP: judge an attacker's HP loss together with the points-pressure context — HP paid for a capture/push is not necessarily a mistake; pointless HP loss under no pressure, or one-sided loss without any trade, is the problem.
               d. Toll: inside the opposing team's push window (PUSH_WINDOWS), the damage the defenders deal to the pushing team is the toll; when the pushing team completed the push or established capture-point presence almost unharmed (the toll is clearly insufficient), you must call out the defensive mistake; when damage numbers are unavailable (OBSERVED_DAMAGE_IS_PARTIAL), describe qualitatively only and never report numbers.
               e. When signals are insufficient or contradictory, write "cannot be determined from the current replay data"; never force a "behind/ahead" conclusion.""";

    static final String CAPTURE_RULE_RU = """

            === ПРАВИЛА ЗАХВАТА (обязательно; тренировочные бои и клановые бои — всегда supremacy) ===
            1. Концентрированный рывок одной линией может стоить команде: потеря высокого обзора и риск захвата базы противником; всегда взвешивайте это в разборе.
            2. Строку result следует читать вместе с resultSource; существует только три уровня доказательности, и при наличии BATTLE_RESULTS он имеет высший приоритет:
               a. BATTLE_RESULTS: авторитетный итог из battle_results#winnerTeam; не подменяйте победителя наблюдениями из потока событий, числом выживших или очками;
               b. SURVIVOR_SETTLEMENT: вывод по статусу выживших из итогов (одна команда полностью уничтожена); это не авторитетное поле победителя battle result, не выдавайте его за таковое;
               c. Без авторитетного победителя (winnerTeam отсутствует): только при rosterComplete=true и полном уничтожении одной из команд можно вывести победителя полного уничтожения через SURVIVOR_SETTLEMENT из полного состояния выживших; когда в обеих командах есть выжившие, победитель неизвестен — не выводите его сравнением полей захвата.
               d. Когда состав расчёта неполон (SETTLEMENT_ROSTER_INCOMPLETE=true / pointsTotalsUnavailable=true), суммы очков захвата по игрокам и командам являются частичными данными: запрещено выводить победителя или условие завершения «время истекло / набрано 1000 очков» по неполным очкам; условие завершения по очкам можно писать только как «решение по очкам».
            3. Формулировка полного уничтожения двунаправленна и зависит от выживших (независимо от resultSource):
               a. Ваша команда победила, а у противника 0 выживших → напишите «победа полным уничтожением противника»;
               b. Ваша команда проиграла, а в вашей команде 0 выживших → напишите «поражение — противник полностью уничтожил вашу команду»;
               c. Только когда в обеих командах есть выжившие машины, оценивайте завершение по очкам (во всех режимах Supremacy действует фиксированная длительность 7 минут / 420 секунд и предел победы 1000 очков — бизнес-правила, подтверждённые владельцем проекта; в игре нет настройки длительности боя, а arenaBonusType лишь доказывает категорию боя и не декодирует 420с/1000):
                  бой короче 7 минут → причина завершения «одна из команд достигла 1000 очков, бой завершён досрочно»; при авторитетном победителе напишите «победа досрочно по достижении 1000 очков», итоговый счёт победителя = 1000 (предел 1000 очков, деловое соглашение), счёт проигравшего неизвестен;
                  без авторитетного победителя напишите только «одна из команд достигла 1000 очков, бой завершён досрочно; победитель неизвестен», оба итоговых счёта неизвестны;
                  длительность ≥7 минут → при авторитетном победителе напишите «победа по очкам после истечения времени» — обязательно укажите «время истекло»; без него напишите только «решение по очкам после истечения времени, победитель неизвестен», оба итоговых счёта неизвестны;
                  если лимит времени недоказуем, пишите только «решение по очкам», итоговый счёт неизвестен — не выдумывайте его.
            4. Не пишите «победа полным уничтожением противника», когда полностью уничтожена ваша команда; не выдавайте победу по очкам за уничтожение или обычную победу; не используйте промежуточный счёт ниже 1000 как причину победы.
            5. victoryPointsEarned / victoryPointsSeized — посчётные поля расчёта, чьё точное значение и включены ли уже очки за фраги или пассивное накопление не доказаны; это не таймлайн и не итоговый счёт. Бизнес-правило начисления за захват (подтверждено владельцем проекта): Никакое правило начисления очков за базу за тик не проверено, интервал тика не декодирован, поэтому не вычисляйте итоговый счёт из числа тиков или очков захвата. Не выдавайте суммы за прогресс захвата в конкретный момент и не выдавайте сумму victoryPointsEarned или любой результат формулы за итоговый счёт.
            6. Области точек захвата (CONTAINS_CONTROL_POINT) описывают только направление; если они не предоставлены, не утверждайте, кто захватывает.
            7. Очки за фраги (бизнес-правило, подтверждённое владельцем проекта): в Supremacy каждый уничтоженный вражеский танк отнимает у вражеской команды 40 очков и добавляет их команде убийцы, а команда, потерявшая машину, теряет 40 очков; это правило — только ориентир для описания («уничтожение машин обычно меняет очки обеих команд»): включена ли эта поправка в поля расчёта, не доказано, поэтому запрещено самому вычислять «очки захвата + 40×фраги − 40×потери» и выдавать результат за факт; только при авторитетном победителе и доказуемом по правилам досрочном завершении итоговый счёт победителя = 1000 (предел 1000 очков, деловое соглашение), все остальные итоговые счета неизвестны; запрещено объяснять победу счётом без очков за фраги и выдумывать точный счёт проигравшей команды.
            8. Ситуация по очкам и стойка атаки/обороны (только доказуемые сигналы):
               a. Абсолютный счёт в любой момент до конца боя не декодирован (живой счёт, прогресс захвата и пассивное накопление не имеют доказательств); запрещено выдумывать любой промежуточный счёт, точный отрыв или утверждения вида «сейчас позади на X очков». Таймлайн очков за фраги выражает только накопленную чистую разницу «компоненты очков за фраги» — частичный доказуемый сигнал, а не общий счёт: запрещено выдавать чистый минус/плюс по очкам за фраги за общее отставание/преимущество по очкам; поражение по очкам описывает только итоговый результат — запрещено обратно выводить общее состояние по очкам на любой ранний момент. Оценивайте давление по очкам только по доказуемым сигналам секции POINTS_SITUATION (таймлайн очков за фраги, присутствие в зонах точек захвата, окна продвижения) и итогу расчёта / условию завершения.
               b. Условный анализ разрешён, но обязан указывать предпосылку: если ни одна команда не накопила больше очков захватом (накопление за захват ненаблюдаемо), команда с чистым минусом по очкам за фраги испытывает большее атакующее давление — ей нужно атаковать и захватывать точки; команда с чистым плюсом по очкам за фраги может спокойнее обороняться с перекрёстным огнём. Сначала обязательно укажите, что это вывод на основе компоненты очков за фраги и сигналов присутствия на точках, — не выдавайте его за общий счёт впереди/позади.
               c. Атакующее продвижение обычно стоит HP: оценивайте потерю HP атакующего вместе с давлением по очкам — HP, отданные за захват/атаку, не обязательно ошибка; бесполезная потеря HP без давления или односторонняя потеря без размена — проблема.
               d. Плата за проезд: в окне продвижения противника (PUSH_WINDOWS) урон, который обороняющиеся наносят продвигающейся команде, и есть плата за проезд; когда продвигающаяся команда завершила продвижение или заняла точку почти без потерь (плата явно недостаточна), обязательно укажите ошибку обороны; когда цифры урона недоступны (OBSERVED_DAMAGE_IS_PARTIAL), описывайте только качественно и не называйте чисел.
               e. При недостаточных или противоречивых сигналах пишите «невозможно определить по данным реплея»; не навязывайте вывод «позади/впереди».""";

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
                        en ? CAPTURE_RULE_EN : CAPTURE_RULE_RU)
                .replace(FORMATION_DEPTH_RULE,
                        en ? FORMATION_DEPTH_RULE_EN : FORMATION_DEPTH_RULE_RU);
    }

    static final String SINGLE_TEAM_PROMPT = AiPromptLibrary.zh("team/single");

}
