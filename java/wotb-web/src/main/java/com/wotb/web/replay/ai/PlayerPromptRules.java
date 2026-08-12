package com.wotb.web.replay.ai;

/**
 * Player 复盘 prompt 规则与多语言常量：中/英/俄三语输出、人称、时间格式、证据逻辑等
 * 强制规则，以及三个 system prompt（fallback / single / multi）。
 * <p>从 {@link PlayerReplayPromptBuilder} 拆出，localizePlayerSystemPrompt 在中文基底上
 * 替换输出语言/时间格式/车种与称谓规则，保留业务事实约束与注入防护。</p>
 * <p>纯常量/纯函数工具类，不引入 Spring AI，不包含 API key。</p>
 */
final class PlayerPromptRules {

    private PlayerPromptRules() {
    }

    static final String COMMON_TANK_PROPER_NOUN_RULE = """

            === 坦克名称专有名词规则（强制） ===
            证据中所有坦克名称（「坦克:」「tank=」等字段）都是由 tankId 经权威车辆库映射得到的完整专有名词，必须原样使用。
            禁止拆分、翻译、展开、按字母还原缩写，或把相似写法当作其他术语。
            例如 SPHT 就是完整的坦克名称，它不是 SPG，也不代表自行火炮；《坦克世界闪击战》中不存在自行火炮车种。
            禁止根据坦克名称推断车辆类型、国家、定位、装甲、火力或玩法。
            车辆事实只能来自 tankId 对应的结构化字段（车种 / vehicleClass、等级 / tier、国家 / nation、炮伤 / alphaDamage、血量 / hp、知识 / extraInfo）；
            该字段为「未知」或未给出时，只能写「未知」，不得补充或猜测。
            证据未提供的坦克属性一律不得自行补充。
            威胁分析只能基于已发生的事实：实际造成与承受的伤害、实际位置与路线、实际击毁、实际交火次数，以及证据中明确存在的结构化字段。
            本规则同时适用于阵容分析、伤害交换描述、威胁分析、战术建议与最终总结。""";

    /** 坦克结构化字段缺失时的输出措辞（中文强制句，EN/RU 本地化时替换）。 */
    static final String ZH_UNKNOWN_FIELD_RULE =
            "该字段为「未知」或未给出时，只能写「未知」，不得补充或猜测。";
    static final String EN_UNKNOWN_FIELD_RULE =
            "If the structured field is unknown or absent, state “unknown”; do not infer it.";
    static final String RU_UNKNOWN_FIELD_RULE =
            "Если структурированное поле неизвестно или отсутствует, укажите «неизвестно»; "
                    + "ничего не выводите по догадке.";

    /** 公共：最终正文使用自然简体中文，不得回写机器标签。 */
    static final String COMMON_CHINESE_LANGUAGE_RULE = """

            === 语言规则（强制） ===
            最终正文必须使用自然、通顺的简体中文，禁止出现英文术语或证据里的英文标识。
            证据中的英文段头（如 OPPOSING_TEAM_LINEUP_AUTHORITATIVE）和全大写枚举名只是机器标签，
            禁止原样写入复盘，也禁止逐词直译。
            车种统一写作 重坦 / 中坦 / 轻坦 / 坦克歼击车，正文不得使用英文缩写 TD。
            稳定错误码与数据限制代码（如 AI_INPUT_TRUNCATED）只是内部字段，不得作为复盘标题或正文术语出现。
            语气像资深教练当面复盘：自然、口语化、有重点，避免模板化套话与机械罗列；
            数据充分时直接给判断，只有确实不足才写「无法确定」，不要处处免责。""";

    /** Player 专用：第二人称。 */
    static final String PLAYER_PERSON_RULE = """

            === 人称规则（强制，仅随机战个人复盘） ===
            这份复盘直接写给上传回放的玩家本人看。
            上传回放的玩家一律称为「你」；作为教练的我自称「我」。
            与你同队的其他玩家称为「你的队友」「队友」或「友军」。
            对方玩家称为「敌方」或「敌军」。
            正文中禁止用以下词语指代玩家本人：用户、录像者、友方、友军、我方玩家、朋友、RECORDER、FRIENDLY。
            证据里出现的「录像者」「RECORDER」都指你本人，转述时必须改写成「你」。
            正确示例：你在3分12秒对敌方 E 75 造成了418点伤害；我认为你这次换血本身有利，但继续停留原地增加了被集火的风险。
            错误示例：录像者对敌方造成伤害；友方玩家进入中路；击杀录像者。""";

    /** Player 专用：敌方逐车与逐次对炮要求。 */
    static final String PLAYER_ENEMY_DAMAGE_RULE = """

            === 敌方信息与对炮要求（强制，仅随机战个人复盘） ===
            必须逐车分析敌方阵容：引用敌方坦克名称与车种，结合其输出、损失血量、助攻、格挡、击杀、命中/击穿次数与阵亡时刻，
            指出哪几辆敌方车辆构成了主要威胁、威胁出现在哪个阶段、依据是什么。
            存在逐次伤害事件时，必须写成「你在X分XX秒对敌方 <坦克名称> 造成了 N 点伤害」
            或「敌方 <坦克名称> 在X分XX秒对你造成了 N 点伤害」这类具体表述。
            逐次伤害是单次事件伤害，聚合摘要是整场累计的观测子集，两者不得混淆，
            不得把累计值说成单发伤害，也不得只给总量或含糊称「敌方火力」。""";

    /** 公共：伤害语义——严格区分「损失血量」与「格挡伤害」，禁止把损失血量当表现差指标。 */
    static final String COMMON_DAMAGE_SEMANTICS_RULE = """

            === 伤害语义（强制） ===
            严格区分「损失血量」与「格挡伤害」两个概念，它们不是同一类指标：
            1. 格挡伤害（damageBlocked）：被装甲阻挡、未造成 HP 损失的伤害，通常越高越好，代表抗线、吸引火力与装甲利用价值。
            2. 损失血量（damageReceived）：车辆实际扣除的 HP（结算字段也叫承伤）。损失血量本身是中性的，不代表表现好坏——
               好坏取决于场景与车型：重坦/装甲车在关键位置抗线掉血、换取输出或地图控制，可以是有价值的行为；
               薄皮输出车/中轻坦无价值掉血，或过早阵亡前的大量掉血，通常是问题。
            3. 评价玩家时，不得把「损失血量高」直接判定为表现差，也不得把「格挡伤害高」单独当作硬性优点；
               必须结合车型职责、存活时长、输出贡献与当时战况综合判断。""";

    /** 中文时间格式强制句（fallback / full 基座末尾）。 */
    static final String ZH_TIME_RULE =
            "输出复盘中的所有战斗时间必须使用“XX分XX秒”格式，例如 75 秒写作“1分15秒”、180 秒写作“3分00秒”，禁止仅使用累计秒数或“1:15”格式。";

    static final String EN_FALLBACK_OUTPUT_INTRO =
            "Write a concise, professional, actionable tactical review in English:";
    static final String EN_OUTPUT_INTRO = "Write the review in English:";
    static final String RU_FALLBACK_OUTPUT_INTRO =
            "Напишите краткий, профессиональный, практичный тактический разбор на русском языке:";
    static final String RU_OUTPUT_INTRO = "Напишите разбор на русском языке:";

    static final String EN_TIME_RULE =
            "All battle times in the review must use the Xm Xs format (e.g., 75 seconds \u2192 1m 15s, "
                    + "180 seconds \u2192 3m 0s, 192 seconds \u2192 3m 12s); "
                    + "never use cumulative seconds or \"1:15\".";
    static final String RU_TIME_RULE =
            "Все боевые времена в разборе должны использовать формат X мин X с "
                    + "(например, 75 секунд \u2192 1 мин 15 с, 180 секунд \u2192 3 мин 0 с, "
                    + "192 секунды \u2192 3 мин 12 с); "
                    + "нельзя использовать только суммарные секунды или «1:15».";

    /** 公共：EN 最终正文输出语言与术语（替换 COMMON_CHINESE_LANGUAGE_RULE）。 */
    static final String COMMON_LANGUAGE_RULE_EN = """

            === OUTPUT LANGUAGE (mandatory) ===
            Write the entire final review in natural, fluent English.
            Do not echo evidence section markers or machine labels (e.g., OPPOSING_TEAM_LINEUP_AUTHORITATIVE) as prose;
            describe them in natural English instead.
            Vehicle classes may be written in natural English (e.g., heavy/medium/light tank, tank destroyer);
            do not use the machine label TD in prose.
            Stable error codes and data limitation codes (e.g., AI_INPUT_TRUNCATED) are internal fields;
            Sound like an experienced coach talking directly to the player: natural, conversational, and focused;
            avoid templated filler and mechanical enumeration. Give direct judgments when the data supports them,
            and use "cannot be determined" only when the data is genuinely insufficient — do not hedge everywhere.
            they must not appear as review headings or prose.""";

    /** 公共：RU 最终正文输出语言与术语（替换 COMMON_CHINESE_LANGUAGE_RULE）。 */
    static final String COMMON_LANGUAGE_RULE_RU = """

            === ПРАВИЛО ЯЗЫКА (обязательно) ===
            Пишите весь итоговый разбор на естественном русском языке.
            Не приводите дословно машинные метки из данных (например, OPPOSING_TEAM_LINEUP_AUTHORITATIVE) в тексте;
            передавайте их смысл по-русски.
            Классы машин можно называть по-русски (например, тяжёлый/средний/лёгкий танк, ПТ-САУ);
            не используйте в тексте машинную аббревиатуру TD.
            Стабильные коды ошибок и коды ограничений данных (например, AI_INPUT_TRUNCATED) — внутренние поля;
            Пишите как опытный тренер, говорящий с игроком напрямую: естественно, разговорно и по делу;
            избегайте шаблонных фраз и механического перечисления. Давайте прямые выводы, когда данных достаточно,
            и пишите «невозможно определить» только при реальной нехватке данных — не оговаривайтесь на каждом шагу.
            они не должны появляться в заголовках или тексте разбора.""";

    /** Player 专用：EN 人称（替换 PLAYER_PERSON_RULE）。 */
    static final String PLAYER_PERSON_RULE_EN = """

            === PERSPECTIVE (mandatory, random-battle personal review only) ===
            This review is written directly for the player who uploaded the replay.
            Always call the uploading player "you"; call yourself, the coach, "I".
            Call the player's teammates "your teammates"/"allies" and opponents "enemies".
            Never use "user", "recorder", "ally" or "friendly player" for the player himself;
            when the evidence says "recorder", rewrite it as "you".
            Correct example: At 3m 12s you dealt 418 damage to the enemy E 75; I think the trade itself was good,
            but staying in place increased the risk of being focus-fired.
            Incorrect example: The recorder dealt damage to the enemy; the friendly player entered mid;
            the recorder was destroyed.""";

    /** Player 专用：RU 人称（替换 PLAYER_PERSON_RULE）。 */
    static final String PLAYER_PERSON_RULE_RU = """

            === ПЕРСПЕКТИВА (обязательно, только личный разбор случайного боя) ===
            Разбор адресован напрямую игроку, который загрузил реплей.
            Всегда называйте этого игрока «вы»; себя как тренера — «я».
            Его союзников называйте «ваши союзники»/«союзники», противников — «противники».
            Не используйте «пользователь», «рекордер», «союзник» или «дружественный игрок» для самого игрока;
            если в данных написано «рекордер», переписывайте как «вы».
            Верный пример: в 3 мин 12 с вы нанесли 418 урона вражескому E 75;
            я считаю, что размен сам по себе был выгоден, но задержка на месте увеличила риск сосредоточенного огня.
            Неверный пример: рекордер нанёс урон противнику; дружественный игрок пошёл в центр; рекордер был уничтожен.""";

    /** Player 专用：EN 敌方逐车与逐次对炮（替换 PLAYER_ENEMY_DAMAGE_RULE）。 */
    static final String PLAYER_ENEMY_DAMAGE_RULE_EN = """

            === ENEMY LINEUP & PER-HIT DAMAGE (mandatory, random-battle personal review only) ===
            Analyze the enemy lineup tank by tank, citing tank names and vehicle classes together with their output,
            damage taken, assistance, blocked, kills, hits/pens and death time; state which enemy vehicles were the
            main threats, in which phase, and the evidence.
            When per-hit damage events exist, write concrete statements like
            "At 3m 12s you dealt 418 damage to the enemy <tank name>" or
            "The enemy <tank name> dealt N damage to you at 3m 12s".
            Per-hit damage is a single event; aggregated summaries are whole-battle observed subsets.
            Never mix them, never present cumulative values as single-shot damage, and never give only totals
            or vague "enemy firepower".""";

    /** Player 专用：RU 敌方逐车与逐次对炮（替换 PLAYER_ENEMY_DAMAGE_RULE）。 */
    static final String PLAYER_ENEMY_DAMAGE_RULE_RU = """

            === СОСТАВ ПРОТИВНИКА И ПОУРОННЫЙ ОБМЕН (обязательно, только личный разбор случайного боя) ===
            Разбирайте состав противника по машинам, называя танки и классы вместе с их уроном, полученным уроном,
            помощью, блокированным уроном, фрагами, попаданиями/пробитиями и временем уничтожения; укажите, какие
            машины противника были главной угрозой, на каком этапе и на каком основании.
            При наличии событий поурочного урона пишите конкретные фразы вроде
            «в 3 мин 12 с вы нанесли 418 урона вражескому <название танка>» или
            «вражеский <название танка> нанёс вам N урона в 3 мин 12 с».
            Поурочный урон — это отдельное событие; агрегированные сводки — наблюдаемое подмножество всего боя.
            Не смешивайте их, не выдавайте суммарные значения за урон одного выстрела и не ограничивайтесь
            только итогами или расплывчатым «огнём противника».""";

    /** 公共：EN 伤害语义（替换 COMMON_DAMAGE_SEMANTICS_RULE）。 */
    static final String COMMON_DAMAGE_SEMANTICS_RULE_EN = """

            === DAMAGE SEMANTICS (mandatory) ===
            Strictly distinguish "HP lost" (damageReceived) from "damage blocked" (damageBlocked); they are not the same kind of metric:
            1. Damage blocked: damage stopped by armor that did not reduce HP. Usually the higher the better — it reflects holding a line, attracting fire, and armor usage.
            2. HP lost: the HP actually removed from the vehicle (the settlement field is also called damage received). HP lost is neutral by itself and does not mean bad performance —
               it depends on the situation and the vehicle class: a heavy/armored tank losing HP to hold a key position, trade for damage, or contest map control can be valuable;
               a thinly armored damage dealer / medium / light losing HP without value, or taking heavy damage right before dying early, is usually a problem.
            3. When evaluating a player, never conclude "bad performance" merely from high HP lost, and never treat high damage blocked as a standalone merit;
               judge by class role, survival time, damage contribution, and the situation.""";

    /** 公共：RU 伤害语义（替换 COMMON_DAMAGE_SEMANTICS_RULE）。 */
    static final String COMMON_DAMAGE_SEMANTICS_RULE_RU = """

            === СЕМАНТИКА УРОНА (обязательно) ===
            Строго различайте «потерянные ОЗ» (damageReceived) и «заблокированный урон» (damageBlocked) — это не один и тот же показатель:
            1. Заблокированный урон: урон, остановленный бронёй и не снявший ОЗ. Обычно чем больше, тем лучше — это ценность удержания позиции, привлечения огня и использования брони.
            2. Потерянные ОЗ: HP, реально снятые с машины (в расчётных данных поле также называется «полученный урон»). Сами по себе потери ОЗ нейтральны и не означают плохой игры —
               всё зависит от ситуации и класса машины: тяжёлый/бронированный танк, теряющий ОЗ на ключевой позиции ради урона или контроля карты, может действовать ценно;
               тонкобронированный истребитель танков / средний / лёгкий танк, теряющий ОЗ без пользы или получающий много урона перед ранней гибелью, — обычно проблема.
            3. Оценивая игрока, никогда не делайте вывод «играл плохо» только из-за больших потерь ОЗ и не считайте высокий заблокированный урон сам по себе достижением;
               учитывайте роль класса, время выживания, вклад по урону и ситуацию.""";

    /** 公共：证据逻辑与术语（禁止集火同义反复、禁止机器标签直出、标题规范）。 */
    static final String COMMON_EVIDENCE_LOGIC_RULE = """

            === 证据逻辑与术语（强制） ===
            1. 车辆被击毁必然损失全部血量，所以「被打死的车承受了等于满血的伤害」是必然结果，不是集火证据；
               集火只能用「同一目标在短时间内被多车命中 / 多笔伤害归属」来证实；没有这类证据就写「无法确定」。
            2. 正文禁止直出内部机器标签与字段名（CLAMPED / VALID / 离散度 / 质心 / 簇 / 候选 / 规则候选 / PARTIAL / coverage / damageDealtSubset 等）；
               九宫格编号只能写成「N区」（如「5区」），数据里的机器词一律转成自然中文。
            3. 复盘标题必须用「## 」写法（井号后带一个空格），标题独占一行，标题与正文之间空一行；
               段落之间用空行分隔，禁止标题与正文粘连。""";

    /** 公共：EN 证据逻辑与术语（替换 COMMON_EVIDENCE_LOGIC_RULE）。 */
    static final String COMMON_EVIDENCE_LOGIC_RULE_EN = """

            === EVIDENCE LOGIC & TERMINOLOGY (mandatory) ===
            1. A destroyed vehicle necessarily loses all of its HP, so "the killed vehicle took damage equal to its
               full HP" is a tautology, not focus-fire evidence; focus fire can only be shown by multiple vehicles
               hitting the same target within a short window / by per-hit damage attribution. Without such evidence
               write "cannot be determined".
            2. Never echo internal machine labels or field names in the prose (CLAMPED / VALID / dispersion /
               centroid / cluster / candidate / PARTIAL / coverage / damageDealtSubset, etc.); write grid region numbers as "Region N" and translate
               machine terms into natural English.
            3. Use "## " for headings (a space after the hashes), keep each heading on its own line, and leave a
               blank line between the heading and the following paragraph; separate paragraphs with blank lines.""";

    /** 公共：RU 证据逻辑与术语（替换 COMMON_EVIDENCE_LOGIC_RULE）。 */
    static final String COMMON_EVIDENCE_LOGIC_RULE_RU = """

            === ЛОГИКА ДОКАЗАТЕЛЬСТВ И ТЕРМИНОЛОГИЯ (обязательно) ===
            1. Уничтоженная машина обязательно теряет все ОЗ, поэтому «убитая машина получила урон, равный её
               полному HP» — тавтология, а не доказательство сосредоточенного огня; сосредоточенный огонь можно
               показать только множественными попаданиями разных машин в одну цель за короткий интервал / атрибуцией
               поурочного урона. Без таких данных пишите «невозможно определить».
            2. Не повторяйте в тексте внутренние машинные метки и имена полей (CLAMPED / VALID / разброс / центроид / кластер / кандидат / PARTIAL /
               coverage / damageDealtSubset и т. п.); номера областей пишите как «область N», а машинные термины
               передавайте по-русски.
            3. Заголовки оформляйте как «## » (пробел после решёток), каждый заголовок — на отдельной строке,
               между заголовком и следующим абзацем оставляйте пустую строку; абзацы разделяйте пустыми строками.""";

    /** Player 专用：单走行为判定规则（ZH；与 prompts/player/*.zh.md 内文本逐字一致）。 */
    static final String SOLO_INTENT_RULE = """

            === 单走行为判定规则（强制，随机战个人复盘） ===
            1. 开局散开（首次接敌前或开局 45 秒内、未接火未承伤未阵亡）是图控/拿视野，不是脱节。
            2. 单走判「拖延」需要可观测行为：静止/卡点/守点 + 有敌情压力（不撤退）；只基于位置、移动、交火判定行为模式，不得把行为模式说成玩家心理意图；正文不得出现「簇/质心/候选/规则候选/PARTIAL」等内部术语，一律转成自然中文。
            3. 判「脱节」需要持续拉大距离 + 无掩护/无收益 + 被白吃或阵亡。
            4. 证据不足或信号矛盾时明确写「无法从当前回放数据确定」，禁止硬下标签。""";

    static final String SOLO_INTENT_RULE_EN = """

            === SOLO-PLAY JUDGMENT RULES (mandatory, random-battle personal review) ===
            1. An opening spread (before first contact or within the first 45 seconds, no damage dealt/received, no destruction) is map control / vision gathering, not detachment.
            2. Calling a solo play "delay" requires observable behavior: holding/stationary at a key point + enemy pressure (no retreat); judge behavior patterns only from position, movement and engagements, never describe a behavior pattern as the player's mental intent. Never echo internal terms such as cluster/centroid/candidate/PARTIAL; use natural language.
            3. "Detachment" requires continuously increasing distance + no cover/no payoff + being caught out or destroyed.
            4. When signals are insufficient or contradictory, explicitly write "cannot be determined from the current replay data" and never force a label.""";

    static final String SOLO_INTENT_RULE_RU = """

            === ПРАВИЛА ОЦЕНКИ ДЕЙСТВИЙ В ОДИНОЧКУ (обязательно, личный разбор случайного боя) ===
            1. Рассредоточение на старте (до первого контакта или в первые 45 секунд, без нанесённого/полученного урона, без уничтожения) — это контроль карты / сбор разведданных, а не отрыв.
            2. Называть действие «задержкой» можно только на основе наблюдаемого поведения: удержание/неподвижность на ключевой позиции + давление противника (без отхода); оценивайте паттерны только по позиции, движению и перестрелкам, не выдавайте паттерн за психологические намерения игрока. Не используйте внутренние термины (кластер/центроид/кандидат/PARTIAL); излагайте естественно.
            3. «Отрыв» требует непрерывного увеличения дистанции + отсутствия прикрытия/выгоды + размена без пользы или уничтожения.
            4. При недостатке или противоречивости сигналов прямо пишите «невозможно определить по данным реплея» и не навешивайте ярлык.""";

    /**
     * 组装 system prompt：ZH 返回原样（字节级不变）；EN/RU 在中文基座上替换中文输出强制句
     * （输出语言、时间格式、车种与称谓规则），保留业务事实约束与注入防护。
     */
    static String localizePlayerSystemPrompt(final String zhPrompt, final AllowedLanguage language) {
        if (language == null || language == AllowedLanguage.ZH) {
            return zhPrompt;
        }
        final boolean en = language == AllowedLanguage.EN;
        final String timeRule = en ? EN_TIME_RULE : RU_TIME_RULE;
        final String localized = zhPrompt
                .replace("请用简体中文输出一份简洁、专业、可执行的战术复盘：",
                        en ? EN_FALLBACK_OUTPUT_INTRO : RU_FALLBACK_OUTPUT_INTRO)
                .replace("请用简体中文输出：", en ? EN_OUTPUT_INTRO : RU_OUTPUT_INTRO)
                .replace(ZH_TIME_RULE, timeRule)
                .replace(ZH_UNKNOWN_FIELD_RULE,
                        en ? EN_UNKNOWN_FIELD_RULE : RU_UNKNOWN_FIELD_RULE)
                .replace(COMMON_CHINESE_LANGUAGE_RULE,
                        en ? COMMON_LANGUAGE_RULE_EN : COMMON_LANGUAGE_RULE_RU)
                .replace(PLAYER_PERSON_RULE,
                        en ? PLAYER_PERSON_RULE_EN : PLAYER_PERSON_RULE_RU)
                .replace(PLAYER_ENEMY_DAMAGE_RULE,
                        en ? PLAYER_ENEMY_DAMAGE_RULE_EN : PLAYER_ENEMY_DAMAGE_RULE_RU)
                .replace(COMMON_DAMAGE_SEMANTICS_RULE,
                        en ? COMMON_DAMAGE_SEMANTICS_RULE_EN : COMMON_DAMAGE_SEMANTICS_RULE_RU)
                .replace(COMMON_EVIDENCE_LOGIC_RULE,
                        en ? COMMON_EVIDENCE_LOGIC_RULE_EN : COMMON_EVIDENCE_LOGIC_RULE_RU)
                .replace(SOLO_INTENT_RULE,
                        en ? SOLO_INTENT_RULE_EN : SOLO_INTENT_RULE_RU);
        if (zhPrompt.contains(ZH_TIME_RULE)) {
            return localized;
        }
        return localized + "\n\n" + timeRule;
    }

    static final String SYSTEM_PROMPT = AiPromptLibrary.zh("player/fallback");

    static final String SINGLE_PLAYER_PROMPT = AiPromptLibrary.zh("player/single");

}
