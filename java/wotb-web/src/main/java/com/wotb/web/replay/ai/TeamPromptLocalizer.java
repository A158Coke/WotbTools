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
            分析主体是 teamDisplayLabel 标识的整支队伍（无可靠军团标签时称「我方」），不是任何个人。
            对手称为「对方队伍」（opponentDisplayLabel 有值时用该标签，无值时称「对方」）。
            录像者只用于确定 perspective（分析视角），不得围绕录像者个人组织团队复盘，也不得把他的个人表现当作队伍结论。
            禁止把整支队伍称为「你」，本文不使用第二人称。
            如需提及双方名称，只能使用 backend 提供的 teamDisplayLabel / opponentDisplayLabel（无值时用我方/对方）；
            禁止自创「X 对阵 Y」标题；「主要军团/对方队伍」等只是通用措辞，不是 proper noun 队名。
            分析对方阵容并指出对方主要威胁车辆（最多 3 辆，不逐车作文）；对方数据缺失时明确说明，不得猜测。
            """;

    /** Team 专用：EN 团队规则（替换 TEAM_ANALYSIS_RULE）。 */
    static final String TEAM_ANALYSIS_RULE_EN = """

                        === TEAM REVIEW RULES (mandatory, training room / clan battle team review only) ===
                        The subject of the review is the entire team identified by teamDisplayLabel (or "our team" when no reliable clan tag exists), not any individual player.
                        Refer to the opponents as "the opposing team" (use opponentDisplayLabel when provided, otherwise "the opposing team").
                        The recorder is used only to determine the perspective; do not organize the team review around the
                        recorder as an individual, and do not present his personal performance as team conclusions.
                        Never address the whole team as "you"; do not use the second person in this review.
                        When naming either side, use only the backend-provided teamDisplayLabel / opponentDisplayLabel (fall back to "our team"/"the opposing team" when empty);
                        never invent an "X vs Y" title; "the main clan / the opposing team" are generic wording, not proper-noun team names.
                        Analyze the opposing lineup and point out the opposing team's main threat vehicles (at most 3,
                        without a tank-by-tank essay); when opposing data is missing, say so explicitly instead of guessing.
            """;

    /** Team 专用：RU 团队规则（替换 TEAM_ANALYSIS_RULE）。 */
    static final String TEAM_ANALYSIS_RULE_RU = """

                        === ПРАВИЛА КОМАНДНОГО РАЗБОРА (обязательно, только командный разбор тренировочного боя или клановой игры) ===
                        Объект разбора — вся команда, обозначенная teamDisplayLabel (или «наша команда», если надёжного кланового тега нет), а не отдельный игрок.
                        Противников называйте «команда противника» (при наличии opponentDisplayLabel — этим тегом, иначе «команда противника»).
                        Рекордер используется только для определения перспективы; не стройте командный разбор вокруг рекордера
                        как личности и не выдавайте его личные действия за выводы о команде.
                        Не обращайтесь ко всей команде как к «вы»; в этом разборе не используйте второе лицо.
                        При упоминании сторон используйте только предоставленные бэкендом teamDisplayLabel / opponentDisplayLabel (при отсутствии — «наша команда»/«команда противника»);
                        не выдумывайте заголовок «X против Y»; «главный клан / команда противника» — лишь общие слова, а не собственные имена команд.
                        Проанализируйте состав противника и укажите основные угрозы команды противника (не более 3 машин,
                        без разбора каждой машины отдельно); при отсутствии данных о противнике прямо скажите об этом, не угадывая.
            """;

    /** Team 专用（PR #103 review BLOCKER B）：内部证据 ≠ 用户输出模板。 */
    static final String TEAM_INTERNAL_VS_USER_FACING_RULE = """

            === 内部证据与用户正文的关系（强制） ===
            输入中的 AUTHORITATIVE_*、OBSERVED_*、TACTICAL TIMELINE、TEAM REVIEW FOCUS WINDOWS、
            EVIDENCE LIMITATIONS、FACT、SUPPORTED INFERENCE、UNKNOWN、confidence、provenance、
            canonical 等标签全部是【后台推理材料】，不是用户输出模板：
            1. 先内部读懂 → 判断 → 用自然的 WoT Blitz 教练语言说出结论；正文默认不得主动复述这些标签
               或解释证据体系（不写「根据 canonical timeline」「根据权威结算」「根据事件流观测子集」
               「从 evidence limitation 看」「根据后端确定性证据」）。
            2. 正文不得出现「UNKNOWN」「FACT」「SUPPORTED INFERENCE」「PARTIAL」「AUTHORITATIVE_*」
               「OBSERVED_*」等机器标签；表达不确定性用自然中文（如「这个原因单靠回放看不死」）。
            3. 避免「综上所述」「从多维度数据来看」等审计腔；像懂 WoT Blitz 的真人队友/教练：直接、简洁、有判断。
            """;

    static final String TEAM_INTERNAL_VS_USER_FACING_RULE_EN = """

                        === INTERNAL EVIDENCE VS USER-FACING PROSE (mandatory) ===
                        The labels in the input — AUTHORITATIVE_*, OBSERVED_*, TACTICAL TIMELINE, TEAM REVIEW FOCUS WINDOWS,
                        EVIDENCE LIMITATIONS, FACT, SUPPORTED INFERENCE, UNKNOWN, confidence, provenance, canonical —
                        are all INTERNAL REASONING MATERIAL, not user-output templates:
                        1. First read internally, then judge, then state the result in natural WoT Blitz coaching language; the body must NOT
                           echo these labels or explain the evidence system by default (never write "according to the canonical timeline",
                           "according to the authoritative settlement", "based on the observed event subset", "from the evidence limitation perspective",
                           "based on backend deterministic evidence").
                        2. The body must not contain machine labels such as UNKNOWN, FACT, SUPPORTED INFERENCE, PARTIAL, AUTHORITATIVE_*, OBSERVED_*;
                           express uncertainty in natural language (e.g. "the replay alone cannot pin down this cause").
                        3. Avoid audit-report phrasing such as "in summary" / "from a multi-dimensional view"; sound like a real WoT Blitz
                           teammate/coach: direct, concise, opinionated.
            """;

    static final String TEAM_INTERNAL_VS_USER_FACING_RULE_RU = """

                        === ВНУТРЕННИЕ СВИДЕТЕЛЬСТВА И ТЕКСТ ДЛЯ ПОЛЬЗОВАТЕЛЯ (обязательно) ===
                        Метки во входе — AUTHORITATIVE_*, OBSERVED_*, TACTICAL TIMELINE, TEAM REVIEW FOCUS WINDOWS,
                        EVIDENCE LIMITATIONS, FACT, SUPPORTED INFERENCE, UNKNOWN, confidence, provenance, canonical —
                        это ВНУТРЕННИЙ МАТЕРИАЛ ДЛЯ РАССУЖДЕНИЙ, а не шаблон вывода:
                        1. Сначала прочитайте внутри, затем оцените, затем изложите результат естественным тренерским языком WoT Blitz; в тексте по умолчанию
                           нельзя повторять эти метки или объяснять систему доказательств (не пишите «согласно canonical таймлайну»,
                           «согласно авторитетному итогу», «по наблюдаемому подмножеству событий», «с точки зрения ограничений доказательств»,
                           «по детерминированным данным бэкенда»).
                        2. В тексте не должно быть машинных меток вроде UNKNOWN, FACT, SUPPORTED INFERENCE, PARTIAL, AUTHORITATIVE_*, OBSERVED_*;
                           неопределённость выражайте естественно (например, «по одному реплею эту причину не установить»).
                        3. Избегайте канцелярских оборотов вроде «резюмируя» / «с многомерной точки зрения»; звучите как живой товарищ/тренер
                           по WoT Blitz: прямо, кратко, с оценкой.
            """;

    static final String TEAM_OUTPUT_STRUCTURE_RULE = """

            === 团队复盘输出结构（强制） ===
            正文采用以下结构；证据不足的章节可以直接省略，禁止为了凑章节硬写内容：
            1. 核心结论：2-4 句，只回答——这局什么时候真正开始失控/建立优势；最大的、证据最强的团队问题是什么；哪些关键原因目前无法确认（只在该未知影响结论时才提）。
            2. 关键决策窗口：只输出 1-3 个真正重要的窗口（优先分析输入中的 TEAM REVIEW FOCUS WINDOWS；backend 给 3 个不强制全写）。
               每个窗口在内部按「发生了什么（canonical facts）/ 为什么重要（supported inference）/ 能够确认的问题（仅证据支持）/ 无法确认（evidence boundary）/ 更好的处理（只给与该窗口直接对应的 alternative，不创造精确战术数字）」组织思考，
               正文用自然 1-3 段写出；禁止机械输出「发生了什么：/为什么重要：/能够确认的问题：/无法确认：/更好的处理：」小标题。
            3. 可确认的团队问题：只写 1-3 个；没有三个就写一个或两个，禁止为了结构完整凑数量。
            4. 训练建议：只写 1-3 条；每一条必须明确对应前面的一个「可确认问题」；禁止通用教练式空话。
            5. 对方关键威胁（可选）：只在确实有价值时写 1-3 辆；禁止逐车分析对方全部阵容。
            长度：中文默认 600–1200 字；简单一边倒 400–700 字；复杂比赛最多约 1500 字；不是硬 minimum，禁止为了达到字数填充；能一句说完，不写三句。
            数字筛选：输出只保留支撑核心判断的数字（如关键窗口减员比、人数变化）；总伤害/总承伤/总助攻/总格挡/双方逐车数据由 UI/后端展示，正文不得重复罗列。
            不单独建立「数据完整性/证据限制」章节；不重复结算结果；禁止把复盘写成时间线流水账或 10 章作文。
            """;

    static final String TEAM_OUTPUT_STRUCTURE_RULE_EN = """

                        === TEAM REVIEW OUTPUT STRUCTURE (mandatory) ===
                        Organize the review as follows; sections with insufficient evidence may be omitted — never pad sections just to fill a template:
                        1. Core conclusion: 2-4 sentences answering only: when did this battle really start to slip away / build an advantage; what is the largest, best-supported team problem; which key causes cannot currently be confirmed (mention an unknown only when it affects the conclusion).
                        2. Key decision windows: output only 1-3 truly important windows (prioritize the TEAM REVIEW FOCUS WINDOWS in the input; when the backend gives 3, you are not required to write all of them).
                           Think through each window internally with "what happened (canonical facts) / why it matters (supported inference) / issues that can be confirmed (evidence-backed only) / what cannot be confirmed (evidence boundary) / better handling (only an alternative directly tied to this window; never invent precise tactical numbers)",
                           then write it as 1-3 natural paragraphs; never mechanically output the sub-headings "What happened: / Why it matters: / What can be confirmed: / What cannot be confirmed: / Better handling:".
                        3. Confirmed team problems: only 1-3; if there are fewer than three, write one or two — never pad to reach a fixed count.
                        4. Training recommendations: only 1-3; each must map to a confirmed problem above; no generic coaching filler.
                        5. Opposing threats (optional): only 1-3 vehicles when genuinely useful; never write a tank-by-tank essay of the whole opposing lineup.
                        Length: default 600-1200 Chinese characters; 400-700 for a simple one-sided game; at most about 1500 for a complex game; not a hard minimum — never pad to reach a length; if one sentence suffices, do not write three.
                        Number filtering: keep only the numbers that support the core judgment (e.g. kill ratios, population changes in the key window); total damage/received/assisted/blocked and per-vehicle data are shown by the UI/backend — do not re-list them.
                        Do not create a separate "data completeness / evidence limitations" section; do not repeat the settlement; never turn the review into a timeline log or a ten-chapter essay.
            """;

    static final String TEAM_OUTPUT_STRUCTURE_RULE_RU = """

                        === СТРУКТУРА КОМАНДНОГО РАЗБОРА (обязательно) ===
                        Стройте разбор по следующей структуре; разделы с недостаточными доказательствами можно опустить — не заполняйте разделы лишь ради шаблона:
                        1. Ключевой вывод: 2–4 предложения, отвечающие только на: когда бой реально начал уходить из-под контроля / создавалось преимущество; какая самая крупная и лучше всего подтверждённая командная проблема; какие ключевые причины сейчас нельзя подтвердить (упоминайте неизвестное, только если оно влияет на вывод).
                        2. Ключевые окна решений: только 1–3 действительно важных окна (в первую очередь из TEAM REVIEW FOCUS WINDOWS во входе; если бэкенд даёт 3, писать все не обязательно).
                           Внутренне продумайте каждое окно по схеме «что произошло (canonical факты) / почему это важно (подтверждённый вывод) / какие проблемы можно подтвердить (только на основе доказательств) / что подтвердить нельзя (граница доказательств) / как следовало поступить (только альтернатива, напрямую связанная с этим окном; не выдумывайте точных тактических цифр)»,
                           затем изложите 1–3 естественными абзацами; никогда не выводите механически подзаголовки «Что произошло: / Почему это важно: / Что можно подтвердить: / Что нельзя подтвердить: / Как следовало поступить:».
                        3. Подтверждённые командные проблемы: только 1–3; если их меньше трёх, напишите одну или две — не добирайте до фиксированного числа.
                        4. Тренировочные рекомендации: только 1–3; каждая должна соответствовать подтверждённой проблеме выше; никаких общих тренерских шаблонов.
                        5. Ключевые угрозы противника (опционально): только 1–3 машины, если это действительно полезно; не пишите разбор каждой машины противника отдельно.
                        Объём: по умолчанию 600–1200 китайских знаков; 400–700 для простого одностороннего боя; не более примерно 1500 для сложного боя; это не жёсткий минимум — не добирайте объём ради объёма; если хватает одного предложения, не пишите трёх.
                        Фильтр цифр: оставляйте только цифры, поддерживающие ключевой вывод (например, соотношение потерь, изменение числа машин в ключевом окне); общий урон/полученный урон/ассист/блок и данные по каждой машине показывает UI/бэкенд — не перечисляйте их.
                        Не создавайте отдельный раздел «полнота данных / ограничения доказательств»; не повторяйте итог; не превращайте разбор в лог таймлайна или сочинение из десяти глав.
            """;

    static final String TEAM_EVIDENCE_CONTRACT_RULE = """
            === 证据契约（强制）：FACT / SUPPORTED INFERENCE / UNKNOWN / FORBIDDEN ===
            1. FACT（事实）：只能来自权威结算、权威阵容、已验证的 canonical timeline 与后端确定性证据。
               例如「1分52秒至2分12秒，本方连续损失3辆，对方同期损失1辆」。
            2. SUPPORTED INFERENCE（有支撑的推断）：必须有明确 FACT 支撑、不超出当前能力、不把相关性写成确定因果，
               措辞保守。允许：「更符合…」「从当前证据看…」「可以确认的是…」「较可能意味着…」「无法进一步证明其具体原因…」。
            3. UNKNOWN（未知）是正常答案，不是失败答案——它是合法内部状态。只有以下情况才向用户自然说明无法确定：
               a. 不说明就会把相关性误写成确定因果；
               b. 这个未知直接影响核心结论；
               c. 这个未知直接影响训练建议；
               d. 用户自然会关心这个关键原因。
               其他未知静默，不要逐条列出（如装填时间、LOS、玩家心理、全部地形——本来不需要分析就完全不要提）。
               需要表达时用自然中文（如「这个原因单靠回放看不死」），不出现 UNKNOWN/PARTIAL 等机器标签。
            4. RECOMMENDATION（建议）：必须从可确认问题反推、对应本局真实失败、不创造精确数字、不形成通用规则。
            5. 没有对应后端证据时，禁止输出以下断言或其同义改写：
                a. 视野/点亮/侦察类：允许一般战术解释——「分散可以扩大地图信息覆盖」「这种打法的潜在价值是更早确认敌方主力方向」「分路是以局部兵力密度换取空间/信息覆盖」；
                  禁止无专门 visibility evidence 的具体归因——「A 点亮了 B」「A 提供了具体视野」「A 获得了侦察收益」「敌人是被 A 发现的」「开局散开就是图控/拿视野」；
                  「敌方主力确认后本方没有及时合流」是本场具体结论，不是一般战术解释——必须满足「重新集中推断规则」的证据要求才能写（见该规则）；
                b. 地形/掩体/LOS 类：「没有掩体」「没有掩体切割」「卡住掩体」「卖头」「hull-down」「对方有无遮挡射界」；
                c. 位置感类：「位置感很好」「位置感差」；
                d. 结算→时间线因果类：如「几乎每一波伤害都有他」「助攻高说明为队友提供输出窗口」「队友没有保护他」；
                e. 必然性类：「必然导致」「必然被逐个击破」「必然被逐个收走」；
                f. 精确数字类：禁止创造「15米」「25米」「三分之一血」「连续两炮」「5秒」等精确阈值，除非由后端提供、
                   项目所有者登记的业务规则或已验证的车辆战术参数提供；改用非伪精确表达，如「低血量成员应减少继续承担
                   第一接触火力」「有血量的队友应考虑承担下一轮交换」「目标切换应减少火力分散」；
                g. 残局万能规则类：禁止「2v4/3v5 就必须立刻离开当前掩体向地图另一端转移」；残局决策取决于地图、位置、
                   车型、血量、点数、时间与敌方分布，证据不足时只能描述观察到的行为并写明无法确定最优转场方向。
                h. 车辆角色类：禁止自创「薄皮输出型」「前排坦克」「肉盾」「狙击车」等角色标签；角色只能来自后端提供的
                   结构化字段（vehicleClass / 已验证的坦克战术 Profile 标签），后端未提供时只写坦克名称与车种；
            6. 禁止为了结构完整凑数量：没有 3 个问题不要凑 3 个；没有 5 条建议不要凑 5 条；没有值得分析的 7 辆敌车不要
                逐车作文；没有足够强的 positive 证据时不得硬写「做得好的团队行为」。
            """;

    static final String TEAM_EVIDENCE_CONTRACT_RULE_EN = """

                        === EVIDENCE CONTRACT (mandatory): FACT / SUPPORTED INFERENCE / UNKNOWN / FORBIDDEN ===
                        1. FACT: only from the authoritative battle result, the authoritative roster/settlement, the validated canonical timeline, and backend-derived deterministic evidence.
                           Example: "From 1m 52s to 2m 12s, your team lost 3 tanks in a row while the opposing team lost 1."
                        2. SUPPORTED INFERENCE: must be backed by explicit FACTs, stay within current capabilities, never present correlation as proven causation, and use conservative wording.
                           Allowed: "is more consistent with...", "based on the current evidence...", "what can be confirmed is...", "likely means...", "the specific cause cannot be proven further...".
                        3. UNKNOWN is a normal answer, not a failure — it is a legitimate internal state. Explain an unknown to the user only when:
                           a. not saying so would mislead correlation into causation;
                           b. this unknown directly affects the core conclusion;
                           c. this unknown directly affects the training advice;
                           d. the user would naturally care about this key cause.
                           Keep all other unknowns silent — do not list them (e.g. reload times, LOS, player psychology, all terrain: if you did not need to analyze them, do not mention them at all).
                           When you do need to express uncertainty, use natural language (e.g. "the replay alone cannot pin down this cause"); never emit machine labels like UNKNOWN/PARTIAL in the body.
                        4. RECOMMENDATION: must derive from a confirmed problem, correspond to the real failure in this battle, never invent precise numbers, and never form universal rules.
                        5. Without corresponding backend evidence, the following claims (or equivalent rewording) are forbidden:
                           a. Vision/spotting/recon: general tactical interpretation is allowed — "spreading can widen map information coverage", "the potential value of this play is confirming the enemy's main force direction earlier", "splitting trades local force density for spatial/information coverage";
                  without dedicated visibility evidence, specific attribution is forbidden — "A spotted B", "A provided specific vision", "A gained recon benefit", "the enemy was found by A", "an opening spread is map control / vision gathering";
                  "after the enemy main force was confirmed, the team did not regroup in time" is a battle-specific conclusion, not a general interpretation — it may only be written when the REGROUPING INFERENCE RULE evidence requirements are met (see that rule);
                           b. Terrain/cover/LOS: "no cover", "no cover cutting", "held cover", "hull-down", "the enemy had an unobstructed firing angle";
                           c. Positioning sense: "great positioning sense", "poor positioning sense";
                           d. Turning settlement aggregates into timeline causation: "he was in every wave of damage", "high assisted damage proves he created firing windows for teammates", "teammates did not protect him";
                           e. Certainty: "inevitably led to", "inevitably picked off one by one";
                           f. Precise numbers: never invent thresholds such as "15m", "25m", "one third HP", "two consecutive hits", "5 seconds", unless provided by the backend, a registered business rule of the project owner, or a verified tank tactical profile parameter.
                              Use non-false-precision phrasing instead: "low-HP members should stop absorbing first-contact fire", "teammates with HP should consider taking the next trade", "switching targets should reduce split fire";
                           g. Endgame universal rules: never issue commands like "in a 2v4 or 3v5 you must immediately leave cover and rotate to the other end of the map"; endgame decisions depend on map, position, tank composition, HP, points, time and enemy distribution — with insufficient evidence, only describe observed behavior and state that the optimal rotation cannot be determined.
               h. Vehicle roles: never invent role labels such as "thin-skinned damage dealer", "frontline tank", "meat shield", "sniper"; roles may only come from backend-provided structured fields (vehicleClass / verified tank tactical profile labels); when the backend provides none, write only the tank name and class;
                        6. Never pad for structural completeness: do not force 3 problems, 5 recommendations, or a tank-by-tank essay of 7 enemy vehicles when there is not enough to analyze; without strong positive evidence, do not force a "what the team did well" section.
            """;

    static final String TEAM_EVIDENCE_CONTRACT_RULE_RU = """

                        === КОНТРАКТ ДОКАЗАТЕЛЬСТВ (обязательно): FACT / SUPPORTED INFERENCE / UNKNOWN / FORBIDDEN ===
                        1. FACT (факт): только из авторитетного результата боя, авторитетного состава, проверенного canonical таймлайна и детерминированных свидетельств бэкенда.
                           Пример: «С 1 мин 52 с по 2 мин 12 с ваша команда потеряла 3 машины подряд, а противник — 1».
                        2. SUPPORTED INFERENCE (подтверждённый вывод): должен опираться на явные FACT, не выходить за текущие возможности, не превращать корреляцию в доказанную причинность и использовать сдержанные формулировки.
                           Допустимо: «более соответствует…», «по текущим данным…», «можно подтвердить, что…», «вероятно, означает…», «конкретную причину далее доказать нельзя…».
                        3. UNKNOWN (неизвестно) — нормальный ответ, а не провал: это легитимное внутреннее состояние. Объясняйте неизвестное пользователю, только когда:
                           a. умолчание превратило бы корреляцию в причинность;
                           b. это неизвестное напрямую влияет на ключевой вывод;
                           c. это неизвестное напрямую влияет на рекомендации;
                           d. пользователю естественно захочется узнать эту ключевую причину.
                           Остальные неизвестные держите молча — не перечисляйте их (например, время перезарядки, линию огня, психологию игрока, весь рельеф: если это не нужно было анализировать, вообще не упоминайте).
                           Когда нужно выразить неопределённость, используйте естественный язык (например, «по одному реплею эту причину не установить»); не выводите в тексте машинные метки вроде UNKNOWN/PARTIAL.
                        4. RECOMMENDATION (рекомендация): должна выводиться из подтверждённой проблемы, соответствовать реальному провалу в этом бою, не выдумывать точных цифр и не формулировать универсальные правила.
                        5. Без соответствующих доказательств бэкенда запрещены следующие утверждения (или их пересказ):
                           a. Обзор/засвет/разведка: допустима общая тактическая интерпретация — «рассредоточение может расширить покрытие карты информацией», «потенциальная ценность этого хода — раньше подтвердить направление главных сил противника», «разделение меняет плотность локальных сил на пространственное/информационное покрытие»;
                  без специальных visibility evidence запрещена конкретная атрибуция — «A засветил B», «A обеспечил конкретный обзор», «A получил разведывательную выгоду», «врага обнаружил A», «рассредоточение на старте = контроль карты / сбор обзора»;
                  «после подтверждения главных сил противника команда не перегруппировалась вовремя» — конкретный вывод по этому бою, а не общая интерпретация: его можно писать только при выполнении требований ПРАВИЛА ВЫВОДА О ПЕРЕГРУППИРОВКЕ (см. это правило);
                           b. Рельеф/укрытия/линия огня: «нет укрытий», «нет работы по укрытиям», «держал укрытие», «игра с башни», «hull-down», «у противника был свободный угол обстрела»;
                           c. Чувство позиции: «отличное чувство позиции», «плохое чувство позиции»;
                           d. Итоги → причинность таймлайна: «он был в каждой волне урона», «высокий урон с ассистом доказывает, что он создавал окна для союзников», «союзники его не прикрывали»;
                           e. Неизбежность: «неизбежно привело к», «неизбежно добили по одному»;
                           f. Точные цифры: не выдумывайте пороги вроде «15 м», «25 м», «треть ОЗ», «два попадания подряд», «5 секунд», если их не дал бэкенд, не зарегистрировал владелец проекта как бизнес-правило или не подтвердил проверенный тактический профиль машины.
                              Используйте формулировки без ложной точности: «участники с низким ОЗ должны перестать принимать первый огонь», «союзники с ОЗ должны рассмотреть следующий размен», «смена целей должна уменьшить распыление огня»;
                           g. Универсальные правила концовки: запрещены приказы вроде «при 2v4/3v5 немедленно уйти из укрытия и ротироваться на другой конец карты»; решения концовки зависят от карты, позиции, состава машин, ОЗ, очков, времени и распределения противника — при недостатке доказательств описывайте только наблюдаемое поведение и указывайте, что оптимальное направление ротации определить нельзя.
               h. Роли машин: не выдумывайте ярлыки вроде «тонкобронная машина поддержки», «танк первой линии», «танк-мясник», «снайпер»; роли могут браться только из структурированных полей бэкенда (vehicleClass / проверенные метки тактического профиля машины); если бэкенд их не дал, пишите только название и класс машины;
                        6. Не добирайте объём ради полноты структуры: нет 3 проблем — не пишите 3; нет 5 рекомендаций — не пишите 5; нет смысла разбирать 7 машин противника — не пишите про каждую; без достаточно сильных положительных доказательств не вставляйте раздел «что команда сделала хорошо».
            """;

    /** Team 专用：Call #1 赛前战略基线的使用规则（强制；EN/RU 本地化时替换）。 */
    static final String TEAM_PRIOR_RULE = """

            === 赛前战略基线（Call #1）使用规则（强制） ===
            输入可能包含 PRE-BATTLE STRATEGIC PRIOR：仅基于地图、双方阵容、双方总血量与坦克战术属性的
            赛前先验判断（含分阶段预期打法），未读取任何战斗结果。
            其中 TEAM_A=你的队伍（teamDisplayLabel，无值时称「我方」）、TEAM_B=对方队伍；没有该段时不得编造基线。
            复盘必须对照基线：先识别本场实际战局类型（常规推进 / 一波流 / 蹲坑僵持 / 其他特殊战局），
            再逐条对照"预期打法 vs 实际执行"的差异与原因；实际战局偏离预期不等于失误，
            一波流等特殊战局可能让任何阶段计划失效，必须基于实际事件判断，不得仅因胜负倒推。""";

    static final String TEAM_PRIOR_RULE_EN = """

            === PRE-BATTLE STRATEGIC PRIOR (Call #1) USAGE RULE (mandatory) ===
            The input may include a PRE-BATTLE STRATEGIC PRIOR: a pre-battle judgment based only on the map,
            both lineups, total HP and tank tactical attributes (including staged expected play), with no battle results read.
            In it, TEAM_A = your team (teamDisplayLabel, or "our team" when empty) and TEAM_B = the opposing team; if the section is absent, never fabricate a baseline.
            The review must be checked against this baseline: first identify the actual battle pattern
            (normal push / one-lane rush / camped stalemate / other special pattern), then compare
            "expected play vs actual execution" item by item with reasons. Deviation from the expectation
            is not automatically a mistake; special patterns such as a one-lane rush can invalidate any
            staged plan, so judge from actual events, never reason backwards from the result alone.""";

    static final String TEAM_PRIOR_RULE_RU = """

            === ПРАВИЛО ПРЕДБОЕВОЙ БАЗЫ (Call #1) (обязательно) ===
            Во входе может быть PRE-BATTLE STRATEGIC PRIOR — предбоевое суждение только по карте, составам,
            суммарному HP и тактическим атрибутам машин (включая поэтапный ожидаемый план), без чтения результатов боя.
            В нём TEAM_A = ваша команда (teamDisplayLabel, при отсутствии — «наша команда»), TEAM_B = команда противника; если секции нет, базу выдумывать нельзя.
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
            === 阵型深度与地图控制权规则（强制） ===
            FORMATION_DEPTH 段是确定性几何/火力近似证据，用于理解阵型、前后排与地图控制权（哪方有能力实际控制的区域）：
            1. frontLine / midLine / backLine 是本队成员沿「本队质心 → 敌方质心」轴按深度三分位的分类，
               描述阵型时用自然中文（如「前排抗线、中排输出、后排支援」），不得改判成员排位。
            2. controlRegions 的 own / contested / enemy 是九宫格区域的「控制权确定性近似」——按双方距离加权火力覆盖分（F=Σ 火力权重/(1+距离/100)）对比：own=本方火力覆盖显著占优（≥1.2×）、contested=双方接近、enemy=敌方占优；(presence)=区域内有本方位置样本（位置存在，非视野/点亮）、(firepower)=无位置样本但火力覆盖占优（距离+profile 权重的确定性近似，不代表真实射界/地形 LOS）；noArmorNote=本队无重甲车辆，控制权依赖火力投射。这只是火力覆盖+位置几何的确定性近似，不等于真实占领/点亮/视野，不得断言「控制/占领了某区」，也不得表述为占领点得分、实时比分或地图语义区域名。
            3. 未提供 FORMATION_DEPTH 段时（位置观测不足）禁止编造前后排或控制权情况。
            4. 区域只能引用证据中的 GRID_REGION_1~9 编号，禁止用裸坐标重新划区。""";

    static final String FORMATION_DEPTH_RULE_EN = """

            === FORMATION DEPTH AND MAP CONTROL RULE (mandatory) ===
            The FORMATION_DEPTH section is deterministic geometric/firepower-approximation evidence for understanding the formation, the front/mid/back lines and map control (regions a team is capable of actually controlling):
            1. frontLine / midLine / backLine classify own-team members by depth terciles along the "own centroid → enemy centroid" axis; describe the formation in natural language (e.g. "front line holds, middle line outputs, back line supports") and do not re-judge member positions.
            2. controlRegions own / contested / enemy are a "deterministic map-control approximation" of the nine-grid regions — computed from distance-weighted fire coverage (F=Σ fire weight/(1+distance/100)): own = own fire coverage significantly dominates (≥1.2×), contested = roughly even, enemy = the enemy dominates; (presence) = own position samples are present in the region (positional presence, not spotting/LOS), (firepower) = no positional samples but fire coverage dominates (deterministic approximation from distance + profile weights; not real line-of-fire or terrain LOS); noArmorNote = the team has no heavy-armor vehicles, control relies on firepower projection. This is only a deterministic approximation of fire coverage + position geometry — never claim a region is truly "controlled/captured", and never present it as capture points, a live score, or named tactical map areas.
            3. If the FORMATION_DEPTH section is absent (insufficient position observation), never fabricate front/back lines or control coverage.
            4. Reference regions only by the GRID_REGION_1~9 ids in the evidence; never re-derive regions from raw coordinates.""";

    static final String FORMATION_DEPTH_RULE_RU = """

            === ПРАВИЛО ГЛУБИНЫ СТРОЯ И КОНТРОЛЯ КАРТЫ (обязательно) ===
            Секция FORMATION_DEPTH — детерминированное геометрическое/огневое приближение для понимания строя, передней/средней/задней линий и контроля карты (регионы, которые команда способна фактически контролировать):
            1. frontLine / midLine / backLine классифицируют участников своей команды по терцилям глубины вдоль оси «центроид своей команды → центроид противника»; описывайте строй естественным языком (например, «передняя линия держит, средняя наносит урон, задняя поддерживает») и не пересматривайте позиции участников.
            2. controlRegions own / contested / enemy — «детерминированное приближение контроля карты» по девятисекторным областям — по дистанционно-взвешенному огневому покрытию (F=Σ огневой вес/(1+дистанция/100)): own = своё огневое покрытие значительно превосходит (≥1.2×), contested = примерно равно, enemy = превосходит противник; (presence) = в области есть свои позиционные сэмплы (позиционное присутствие, не обнаружение/линия обзора), (firepower) = позиционных сэмплов нет, но огневое покрытие превосходит (детерминированное приближение по дистанции и весам профиля; не реальная линия огня/рельеф); noArmorNote = у команды нет тяжёлых машин, контроль зависит от огневой проекции. Это лишь детерминированное приближение огневого покрытия и геометрии позиций — запрещено утверждать, что область реально «контролируется/захвачена», и выдавать это за очки захвата, живой счёт или именованные тактические зоны карты.
            3. Если секция FORMATION_DEPTH отсутствует (недостаточно наблюдений позиций), запрещено выдумывать переднюю/заднюю линию или контроль областей.
            4. Зоны можно указывать только по идентификаторам GRID_REGION_1~9 из свидетельств; запрещено переопределять зоны по сырым координатам.""";

    /** Team 专用：身后输出/血量优势（吸血/避战候选）规则（ZH；与 prompts/team/single.zh.md 内文本逐字一致）。 */
    static final String BEHIND_LINE_RULE = """
            === 身后输出/血量优势规则（强制·团队语境负面） ===
            BEHIND_LINE_HP_ADVANTAGE 段是确定性事实（位置/血量/距离/已观察攻击事件/tank profile），用于识别「有扛线能力却在队友身后输出（利用队友扛伤害）」或「避战」的成员：
            1. 判据由后端计算：扛线队友 = 本队内具备扛线能力（HEAVY/高装甲）且距敌最近的成员（无合格扛线队友时不判定）；
               成员可扛线、血量比率 ≥ 扛线队友 × 1.2、距敌比扛线队友更远；degree=轻/中/重为跨阶段三因子分级。
            2. 输出分类受事件流观测覆盖约束：OBSERVED_DAMAGE_IS_PARTIAL 时 outputStatus=UNKNOWN 表示「已观察攻击事件=0」，
               <b>禁止</b>据此推断「无输出/避战」，也不得把 UNKNOWN 输出当作负面贡献依据；
               完整覆盖时才可写「有输出（利用队友输出）/无输出（避战）」。
            3. HP_ADVANTAGE_UNKNOWN（血量数据不足）只提供位置关系与已观察攻击事件事实，禁止据此判定吸血/避战。
            4. 团队语境可作负面评价：指出成员「避战/利用队友输出」属于团队复盘，但只依据本段事实，不得超出证据断言玩家意图。
            5. 输出高不等于贡献高：即使伤害较高，若吸血程度重，其对团队贡献应打折——除非输出显著高于本队均值/输出占比靠前（可视为「非常非常高」）才可部分抵消；
               战犯/MVP 判断（TEAM_AUTOPSY）必须考虑吸血程度。
            6. 未提供本段时（位置/血量观测不足）禁止编造身后输出或吸血情况。""";

    static final String BEHIND_LINE_RULE_EN = """

            === BEHIND-LINE OUTPUT / HP ADVANTAGE RULE (mandatory · negative in team context) ===
            The BEHIND_LINE_HP_ADVANTAGE section contains deterministic facts (position/HP/distance/observed attack events/tank profile) for identifying members who, despite frontline capability, output from behind a teammate (letting the teammate absorb fire) or avoid engagement:
            1. The criteria are computed server-side: the carrier teammate is the own-team member with frontline capability (HEAVY/high armor) nearest to the enemy (no verdict when no qualified carrier exists);
               the member is frontline-capable, HP ratio ≥ the carrier teammate × 1.2, and is farther from the enemy than the carrier teammate; degree=light/medium/heavy is the cross-phase three-factor grade.
            2. Output classification respects event-stream observation coverage: under OBSERVED_DAMAGE_IS_PARTIAL, outputStatus=UNKNOWN means "observed attack events = 0" — never infer "no output / avoidance" from it, and never treat UNKNOWN output as negative-contribution evidence;
               only with full coverage may you write "outputs from behind (uses teammate cover) / avoids engagement".
            3. HP_ADVANTAGE_UNKNOWN (insufficient HP data) provides only positional-relation and observed-attack-event facts — never judge behind-line output or HP-hoarding from it.
            4. In the team context this may be phrased negatively: pointing out that a member "avoids engagement / outputs from behind" is part of the team review, but only within these facts — never assert player intent beyond them.
            5. High damage is not equal to high contribution: even with fairly high damage, a heavy behind-line grade must discount that member's team contribution — unless the damage is very high (significantly above the team average / top damage share, which may partially offset);
               the war-criminal/MVP judgement (TEAM_AUTOPSY) must account for the behind-line degree.
            6. When this section is absent (insufficient position/HP observation), never fabricate behind-line output or HP-hoarding.""";

    static final String BEHIND_LINE_RULE_RU = """

            === ПРАВИЛО «ИГРА ЗА СПИНОЙ / ПРЕИМУЩЕСТВО ПО ОЗ» (обязательное · негатив в командном контексте) ===
            Секция BEHIND_LINE_HP_ADVANTAGE содержит детерминированные факты (позиция/ОЗ/дистанция/наблюдаемые события атаки/профиль танка) для выявления членов, которые, имея способность держать фронт, стреляют из-за спин союзников (заставляя союзника принимать огонь) или избегают боя:
            1. Критерии вычисляются на сервере: союзник на первой линии = член своей команды со способностью держать фронт (HEAVY/высокая броня), ближайший к противнику (при отсутствии такого союзника вердикт не выносится);
               член способен держать фронт, доля ОЗ ≥ союзника на первой линии × 1.2 и он дальше от противника, чем этот союзник; degree=лёгкая/средняя/тяжёлая — трёхфакторная оценка за фазы.
            2. Классификация выхода уважает полноту наблюдения событий: при OBSERVED_DAMAGE_IS_PARTIAL outputStatus=UNKNOWN означает «наблюдаемых событий атаки = 0» — запрещено выводить из этого «без выхода/избегание боя» и использовать UNKNOWN-выход как негативное свидетельство вклада;
               только при полном покрытии можно писать «стреляет из-за спины (использует прикрытие союзника) / избегает боя».
            3. HP_ADVANTAGE_UNKNOWN (недостаточно данных об ОЗ) даёт только факты о позиционных отношениях и наблюдаемых событиях атаки — запрещено судить об игре за спиной или накоплении ОЗ по ним.
            4. В командном контексте это может быть негативной оценкой: указывать, что член «избегает боя / стреляет из-за спины», — часть командного разбора, но только в рамках фактов секции; не утверждать намерения игрока сверх них.
            5. Высокий урон ≠ высокий вклад: даже при довольно высоком уроне тяжёлая оценка «игры за спиной» должна снижать вклад члена — если только урон не очень высок (заметно выше среднего по команде / большая доля урона команды, что может частично компенсировать);
               вердикт «виновник/MVP» (TEAM_AUTOPSY) обязан учитывать степень игры за спиной.
            6. Если секция отсутствует (недостаточно наблюдений позиций/ОЗ), запрещено выдумывать игру за спиной или накопление ОЗ.""";

    /** 数据不足时的输出措辞（PR #103 review BLOCKER B：UNKNOWN selective，不再 blanket 强制写明）。 */
    static final String ZH_CANNOT_DETERMINE_RULE =
            "UNKNOWN 是合法内部状态：只有不说明会误写成确定因果、或该未知直接影响核心结论/训练建议、"
                    + "或用户自然会关心这个关键原因时，才自然说明「无法从当前回放数据确定」；其他未知静默，不要逐条列出。";
    static final String EN_CANNOT_DETERMINE_RULE =
            "UNKNOWN is a legitimate internal state: only when failing to say so would mislead correlation "
                    + "into causation, or when the unknown directly affects the core conclusion / training advice, "
                    + "or when the user would naturally care about this key cause, naturally say that it \"cannot be "
                    + "determined from the current replay data\"; otherwise keep unknowns silent — do not list them.";
    static final String RU_CANNOT_DETERMINE_RULE =
            "UNKNOWN — легитимное внутреннее состояние: только если умолчание привело бы к выдаче корреляции "
                    + "за причинность, или это неизвестное напрямую влияет на ключевой вывод / рекомендации, "
                    + "или пользователь естественно захочет узнать эту ключевую причину, — естественно скажите, что "
                    + "«по данным реплея это определить нельзя»; остальные неизвестные не перечисляйте.";

    /** Team 专用：单走行为判定规则（ZH；与 prompts/team/single.zh.md 内文本逐字一致）。 */
    static final String SOLO_INTENT_RULE = """

            === 单走行为判定规则（强制） ===
            1. 开局分散（OPENING_SPREAD：首次接敌前或开局 45 秒内、未接火未承伤未阵亡、与主力保持明显距离）是
               「地图信息覆盖 ↔ 局部兵力集中度」的战术交换：收益是扩大队伍早期的空间覆盖、更有机会从多个方向确认
               敌方主力动向；代价是降低单一路线的局部兵力密度，面对对方集中推进时被接敌一侧可能短时间处于人数劣势。
               可以分析这种 trade-off，但不得把「可能获得更多地图信息」说成「已经点亮了谁/提供了具体侦察收益」；
               开局分散不是天然正确也不是天然错误，不能仅凭分散判为脱节，也不能仅凭分散判为图控/拿视野。
            2. 只有专门且经过验证的 visibility/spotting evidence 才允许写「点亮了」「提供了视野」「侦察到了」等具体归因；
               当前没有这种 evidence 时，开局分散的视野类收益统一视为 UNKNOWN（写「无法确认其实际视野收益」）。
            3. 单走成员是否判「拖延」取决于队友是否因他获利（转场/占点/另一侧推进/视野时间）：后端只提供时序关联，禁止声称「A 的行为导致 B 获利」的因果。
            4. 判「脱节」需要无拖延收益且被白吃/丢点（无接应、承伤高或阵亡、远离目标点）。
            5. 后端给出 OPENING_SPREAD / SOLO_DELAY / SOLO_DETACHED 候选时，先说明信号依据再下结论；信号不足或矛盾时明确写「无法从当前回放数据确定」，禁止硬下标签。
            6. 只基于可观测行为（位置、移动、交火、占点）判定战术行为模式，不得把行为模式说成玩家心理意图；正文不得出现「簇/质心/候选/规则候选/PARTIAL」等内部术语，一律转成自然中文。
            7. 开局分散的质量取决于拿到信息后是否及时响应：敌方主力方向确认后本方是否及时合流/收缩/转场、被接敌一侧的
               局部人数关系、另一侧支援能否及时赶到；分散获得的信息价值是否抵得上局部兵力不足的代价。
            """;
    static final String SOLO_INTENT_RULE_EN = """

            === SOLO-PLAY JUDGMENT RULES (mandatory) ===
            1. An opening spread (OPENING_SPREAD: before first contact or within the first 45 seconds, no damage dealt/received, no destruction, and a clear distance from the main body) is a tactical trade of "information/spatial coverage ↔ local force concentration": the gain is wider early map coverage and a better chance to confirm the enemy's main force direction from several directions; the cost is lower local force density on a single lane, so if the enemy pushes concentrated, the contacted group may briefly fight at a numbers disadvantage. You may analyze this trade-off, but you may NOT present "possibly gaining more map information" as "already spotted someone / provided specific recon benefit"; an opening spread is neither inherently correct nor inherently wrong — do not call it detachment merely because the team is spread out, and do not call it map control / vision gathering either.
            2. Only dedicated, validated visibility/spotting evidence allows specific claims like "spotted", "provided vision", "recon'd"; without such evidence, the vision benefit of an opening spread is UNKNOWN (write "its actual vision benefit cannot be confirmed").
            3. Whether a solo member's play is "delay" depends on whether teammates profited from it (rotation / capture / advance on another flank / vision time): the backend provides temporal correlation only; never claim causation ("A's play caused B's profit").
            4. "Detachment" requires no delay benefit and being caught out / losing ground (no support, high damage taken or destruction, away from objectives).
            5. When the backend provides OPENING_SPREAD / SOLO_DELAY / SOLO_DETACHED candidates, state the signal basis before concluding; when signals are insufficient or contradictory, explicitly write "cannot be determined from the current replay data" and never force a label.
            6. Judge tactical behavior patterns only from observable behavior (position, movement, engagements, capture points); never describe a behavior pattern as the player's mental intent. Never echo internal terms such as cluster/centroid/candidate/PARTIAL; use natural language.
            7. The quality of an opening spread depends on how the team responded once information arrived: after the enemy's main force direction was confirmed, did the team regroup/contract/rotate in time, what were the local force relations on the contacted side, and could the other side support in time; was the information value of the spread worth the cost of local force scarcity.
            """;
    static final String SOLO_INTENT_RULE_RU = """

            === ПРАВИЛА ОЦЕНКИ ДЕЙСТВИЙ В ОДИНОЧКУ (обязательно) ===
            1. Рассредоточение на старте (OPENING_SPREAD: до первого контакта или в первые 45 секунд, без нанесённого/полученного урона, без уничтожения и при заметном удалении от основной группы) — это тактический размен «покрытие информацией/пространством ↔ концентрация локальных сил»: выгода — более широкое раннее покрытие карты и больше шансов с нескольких направлений подтвердить направление главных сил противника; цена — меньшая плотность локальных сил на одной линии, поэтому при концентрированном наступлении противника группа, принявшая контакт, может кратко оказаться в численном меньшинстве. Вы можете анализировать этот размен, но НЕ можете выдавать «возможно, получили больше информации о карте» за «уже засветил кого-то / дал конкретную разведывательную выгоду»; рассредоточение на старте не является ни изначально правильным, ни изначально ошибочным — не называйте его отрывом только из-за рассредоточения и не называйте его контролем карты / сбором обзора.
            2. Только специальные проверенные visibility/spotting evidence позволяют писать конкретные утверждения вроде «засветил», «обеспечивал обзор», «разведал»; без таких evidence обзорная выгода рассредоточения — UNKNOWN (пишите «его фактическую обзорную выгоду подтвердить нельзя»).
            3. Является ли действие игрока «задержкой», зависит от того, извлекли ли союзники выгоду (ротация / захват / продвижение на другом фланге / время на разведку): бэкенд даёт только временну́ю корреляцию; запрещено утверждать причинность («действие A принесло выгоду B»).
            4. «Отрыв» требует отсутствия выгоды от задержки и размена без пользы (без поддержки, высокий полученный урон или уничтожение, вдали от целей).
            5. Когда бэкенд даёт кандидатов OPENING_SPREAD / SOLO_DELAY / SOLO_DETACHED, сначала укажите обоснование по сигналам; при недостатке или противоречивости сигналов прямо пишите «невозможно определить по данным реплея» и не навешивайте ярлык.
            6. Оценивайте только наблюдаемые паттерны поведения (позиция, движение, перестрелки, захват точек); не выдавайте паттерн поведения за психологические намерения игрока. Не используйте внутренние термины (кластер/центроид/кандидат/PARTIAL); излагайте естественно.
            7. Качество рассредоточения зависит от реакции после получения информации: после подтверждения направления главных сил противника успела ли команда вовремя перегруппироваться/сжаться/ротироваться, каково было локальное соотношение сил на стороне контакта и успела ли подойти поддержка с другой стороны; стоила ли информационная ценность рассредоточения цены нехватки локальных сил.
            """;
    /** Team 专用（PR #103 review BLOCKER E）：重新集中/合流是本场具体结论，必须有证据。 */
    static final String TEAM_REGROUP_INFERENCE_RULE = """

            === 重新集中推断规则（强制：本场具体结论必须有证据） ===
            「对方主力方向确认后本方没有及时合流/重新集中」是本场具体结论，不是一般战术解释：
            只有同时满足以下条件才允许作为 supported inference 输出：
            1. 当时已有足够的敌方已知信息支持「对方主力方向已经基本确认」（例如敌方最后已知位置段显示
               该方向已观察到大部分敌车，未知车辆数量较少）；
            2. 本方仍存在多个显著分离的集群；
            3. 后续一段时间内两个己方集群没有明显靠近或形成支援；
            4. 首次关键交火/减员发生在其中一个集群。
            满足时措辞：「对方主力方向已经比较明确后，本方仍保持分散，重新集中的速度不够。」
            敌方位置未知数量较多时（例如已知 4 辆、未知 3 辆），只能说「这一侧当时至少已经观察到 4 辆敌车，
            其余 3 辆的位置还不明确」，禁止说「对方 7 辆主力已经集中在这一侧」。
            后面才获得/亮出的敌方信息不得回填到更早的判断窗口（anti-future-leak）。
            """;

    static final String TEAM_REGROUP_INFERENCE_RULE_EN = """

                        === REGROUPING INFERENCE RULE (mandatory: battle-specific conclusions need evidence) ===
                        "After the enemy's main force direction was confirmed, the team did not regroup in time" is a
                        battle-specific conclusion, not a general tactical interpretation. It may only be written as a
                        supported inference when ALL of the following hold:
                        1. enough enemy-known information existed at that time to support "the enemy's main force direction was basically confirmed"
                           (e.g. the enemy last-known-position section shows most enemy vehicles observed on that direction, with few unknown vehicles);
                        2. our team still had several significantly separated clusters;
                        3. over the following period, the two own clusters did not clearly approach or support each other;
                        4. the first key engagement / losses happened in one of those clusters.
                        When satisfied, phrase it as: "after the enemy's main force direction became fairly clear, our team stayed spread out and regrouped too slowly."
                        When many enemy positions are unknown (e.g. 4 known, 3 unknown), only write "at least 4 enemy vehicles were observed on this side at that time; the positions of the other 3 were still unclear" —
                        never write "all 7 enemy vehicles of the main force were already concentrated on this side".
                        Information revealed/obtained later must not be back-filled into an earlier judgment window (anti-future-leak).
            """;

    static final String TEAM_REGROUP_INFERENCE_RULE_RU = """

                        === ПРАВИЛО ВЫВОДА О ПЕРЕГРУППИРОВКЕ (обязательно: конкретные выводы по бою требуют доказательств) ===
                        «После подтверждения направления главных сил противника команда не перегруппировалась вовремя» —
                        конкретный вывод по этому бою, а не общая тактическая интерпретация. Его можно писать как подтверждённый
                        вывод только при одновременном выполнении всех условий:
                        1. к тому моменту было достаточно известной информации о противнике, чтобы подтвердить «направление главных сил в основном определено»
                           (например, секция последних известных позиций противника показывает большинство вражеских машин на этом направлении, неизвестных машин мало);
                        2. наша команда всё ещё имела несколько заметно разделённых групп;
                        3. в последующий период две свои группы явно не сближались и не поддерживали друг друга;
                        4. первый ключевой бой / потери произошли в одной из этих групп.
                        При выполнении формулируйте так: «после того как направление главных сил противника стало достаточно ясным, наша команда осталась рассредоточенной и перегруппировалась слишком медленно».
                        Когда позиций противника неизвестно много (например, известно 4, неизвестно 3), пишите только «на этой стороне в тот момент наблюдалось как минимум 4 машины противника; позиции остальных 3 были неясны» —
                        запрещено писать «все 7 машин главных сил противника уже сосредоточились на этой стороне».
                        Информация, полученная/проявившаяся позже, не должна переноситься в более раннее окно оценки (anti-future-leak).
            """;

    static final String CAPTURE_RULE = """

            === 争霸赛占点规则（强制，训练房/联赛恒为争霸赛） ===
            1. 集中推进可能减少分散的地图覆盖；是否实际造成侦察/视野损失必须有对应 evidence（不得仅凭集中断言失去视野），复盘必须权衡集中与分散的代价。
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
            1. A concentrated push may reduce distributed map coverage; whether it actually caused spotting/vision loss must have corresponding evidence (never claim vision loss from concentration alone); always weigh the cost of concentrating vs spreading.
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
            1. Концентрированное продвижение может уменьшить распределённое покрытие карты; действительно ли оно привело к потере обзора/разведки — должно подтверждаться evidence (нельзя утверждать потерю обзора только из-за концентрации); всегда взвешивайте цену концентрации против рассредоточения.
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
                .replace(BEHIND_LINE_RULE,
                        en ? BEHIND_LINE_RULE_EN : BEHIND_LINE_RULE_RU)
                .replace(FORMATION_DEPTH_RULE,
                        en ? FORMATION_DEPTH_RULE_EN : FORMATION_DEPTH_RULE_RU)
                .replace(TEAM_OUTPUT_STRUCTURE_RULE,
                        en ? TEAM_OUTPUT_STRUCTURE_RULE_EN : TEAM_OUTPUT_STRUCTURE_RULE_RU)
                .replace(TEAM_EVIDENCE_CONTRACT_RULE,
                        en ? TEAM_EVIDENCE_CONTRACT_RULE_EN : TEAM_EVIDENCE_CONTRACT_RULE_RU)
                .replace(TEAM_INTERNAL_VS_USER_FACING_RULE,
                        en ? TEAM_INTERNAL_VS_USER_FACING_RULE_EN : TEAM_INTERNAL_VS_USER_FACING_RULE_RU)
                .replace(TEAM_REGROUP_INFERENCE_RULE,
                        en ? TEAM_REGROUP_INFERENCE_RULE_EN : TEAM_REGROUP_INFERENCE_RULE_RU);
    }

    static final String SINGLE_TEAM_PROMPT = AiPromptLibrary.zh("team/single");

}