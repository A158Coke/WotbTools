package com.wotb.core.replay.evidence;

import com.wotb.core.replay.evidence.TeamGroundingFacts.AliveTransition;
import com.wotb.core.replay.evidence.TeamGroundingFacts.EvidenceFact;
import com.wotb.core.replay.evidence.TeamGroundingFacts.GroundingFacts;
import com.wotb.core.replay.evidence.TeamGroundingFacts.RegionSnapshot;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Team Review 事实一致性 Validator（确定性，Natural Coach 轮）。
 * <p>它<b>不是</b>第二个战术模型：只检查「LLM 有没有改写 Backend 事实」，绝不判断战术观点
 * （「这局主要问题是第一次正面交换」「应该先回收」这类 coaching judgment 一律放行）。</p>
 * <p>检查项：</p>
 * <ul>
 *   <li>V1 temporal ownership：声称的时间窗口必须包含其引用的阵亡/存活变化事件；</li>
 *   <li>V2 player event correctness：玩家阵亡时间与后端事实一致（容差 2s）；</li>
 *   <li>V3 alive transition correctness：正文存活变化（如 7v7→4v6）必须存在于后端事实；</li>
 *   <li>V4 position temporal grounding：某时刻「X辆全部在N区」不得超出该时刻区域快照；</li>
 *   <li>V5 CURRENT / LAST_KNOWN：敌方 LAST_KNOWN 不得被写成「此时就在这里」；</li>
 *   <li>V6 unsupported hard facts：无 LOS/spotting 证据时禁止硬事实化表达（除非已降级为
 *       「更可能/从交换结果看/如果当时」级别）；</li>
 *   <li>B1 evidence binding：有 {@code evidenceIds} 时引用证据是 primary
     *       source——每个引用必须存在且属于该 claimType 允许的 evidence 类型，且至少一个必须
     *       完整支撑该 claim（身份/时间/数值/区域/knowledge 一致）；DEATH 必须引用该玩家的
     *       PLAYER_DESTROYED，ALIVE_TRANSITION 必须引用 before/after 一致的 ALIVE_COUNT_TRANSITION
     *       或 FOCUS_WINDOW，POSITION_REGION 必须引用对应快照的 POSITION_REGION，ENEMY_POSITION
     *       必须引用身份+时间+区域+knowledge 全部一致的 ENEMY_POSITION_KNOWN；借用无关编号 /
     *       「全局恰好存在该变化」式 PASS 一律 FAIL（checkId=BINDING）。</li>
 *   <li>引用不存在的证据编号 / 空输出。</li>
 * </ul>
 * <p>Validator 失败时不修改任何句子：由编排层把 {@link FactConflict} 反馈给 LLM 自行改写
 * （targeted rewrite → full rewrite → fail-safe），Backend 绝不代改正文。</p>
 */
public final class TeamFactualConsistencyValidator {

    /** V2 玩家阵亡时间容差（秒）。 */
    public static final double DEATH_TIME_TOLERANCE_SEC = 2.0;
    /** V1 时间窗口包含容差（秒）。 */
    public static final double WINDOW_EDGE_TOLERANCE_SEC = 1.0;
    /** V4 位置快照时间匹配容差（秒）。 */
    public static final double SNAPSHOT_TIME_TOLERANCE_SEC = 6.0;

    /**
     * 一条校验冲突（checkId = V1..V6 / BINDING / EVIDENCE / OUTPUT / DIAGNOSIS / CONTRACT / INTERNAL；
     * message 面向 LLM 反馈，自然中文）。
     * <p>reasonCode：机器可分类的冲突原因（UNKNOWN_EVIDENCE /
     * EVIDENCE_TYPE_MISMATCH / SUBJECT_MISMATCH / TIME_MISMATCH / REGION_MISMATCH /
     * KNOWLEDGE_MISMATCH / COUNT_MISMATCH / UNSUPPORTED_HARD_FACT / TEMPORAL_OWNERSHIP 等），
     * 供 production 直接判断 validator 为什么失败；2 参构造器按 checkId 推断（BINDING 类冲突
     * 必须显式传具体原因，见各 binding 校验点）。</p>
     * <p>severity（P0：production availability + factual safety 分界）：
     * <ul>
     *   <li>{@link Severity#HARD_FACT}：真正用户可见事实错误（阵亡时间/存活变化/位置数量/
     *       knowledge/身份/unsupported hard fact）——必须阻止输出，可 retry，最终 fail-safe；</li>
     *   <li>{@link Severity#STRUCTURED_METADATA}：structured envelope 内部 metadata 问题
     *       （evidence binding 类型/时间细节、冗余引用、coverage 缺失但正文可 deterministic 验证、
     *       非关键 machine 字段）——正文事实正确时不阻塞输出（P0-6）；</li>
     *   <li>{@link Severity#FORMAT}：可 deterministic normalize 的格式问题——由 parser 容错处理。</li>
     * </ul></p>
     */
    public record FactConflict(String checkId, String message, String reasonCode, Severity severity) {

        /** 兼容旧契约：按 checkId 推断 reasonCode 与 severity。 */
        public FactConflict(final String checkId, final String message) {
            this(checkId, message, inferReason(checkId), inferSeverity(checkId, inferReason(checkId)));
        }

        /** 显式 reasonCode + 按 checkId/reasonCode 推断 severity。 */
        public FactConflict(final String checkId, final String message, final String reasonCode) {
            this(checkId, message, reasonCode, inferSeverity(checkId, reasonCode));
        }

        private static String inferReason(final String checkId) {
            return switch (checkId) {
                case "V1" -> "TEMPORAL_OWNERSHIP";
                case "V2" -> "TIME_MISMATCH";
                case "V3", "V4" -> "COUNT_MISMATCH";
                case "V5" -> "KNOWLEDGE_MISMATCH";
                case "V6" -> "UNSUPPORTED_HARD_FACT";
                case "EVIDENCE" -> "UNKNOWN_EVIDENCE";
                case "OUTPUT" -> "EMPTY_OUTPUT";
                case "DIAGNOSIS" -> "MISSING_DIAGNOSIS";
                case "CONTRACT" -> "CLAIMS_COVERAGE";
                case "INTERNAL" -> "INTERNAL_LABEL_LEAK";
                default -> "UNCLASSIFIED";
            };
        }

        /** 按 checkId + reasonCode 推断严重级（BINDING 中类型/时间/冗余/歧义 = metadata；身份/区域 = hard）。 */
        private static Severity inferSeverity(final String checkId, final String reasonCode) {
            return switch (checkId) {
                // 用户可见事实错误：HARD
                case "V2", "V4", "V5", "V6" -> Severity.HARD_FACT;
                // V1/V3 默认 HARD（正文窗口/存活变化错误）；structured binding 变体在调用点显式覆盖
                case "V1", "V3" -> Severity.HARD_FACT;
                // BINDING：类型/时间/未知编号/身份歧义 → structured metadata（正文事实不受影响）；
                // 身份不符/区域不符 → HARD（wrong player / position exact error）
                case "BINDING" -> switch (reasonCode == null ? "" : reasonCode) {
                    case "SUBJECT_MISMATCH", "REGION_MISMATCH" -> Severity.HARD_FACT;
                    default -> Severity.STRUCTURED_METADATA;
                };
                case "EVIDENCE", "CONTRACT", "INTERNAL" -> Severity.STRUCTURED_METADATA;
                case "OUTPUT", "DIAGNOSIS" -> Severity.HARD_FACT;
                default -> Severity.HARD_FACT;
            };
        }
    }

    /** 冲突严重级（P0 production availability 分界，见 {@link FactConflict#severity()}）。 */
    public enum Severity {
        /** 用户可见事实错误：必须阻止输出（可 retry，最终 fail-safe）。 */
        HARD_FACT,
        /** structured envelope 内部 metadata 问题：正文事实正确时不阻塞输出。 */
        STRUCTURED_METADATA,
        /** 可 deterministic normalize 的格式问题：由 parser 容错处理。 */
        FORMAT
    }

    /** 是否有任何 HARD_FACT 冲突（production 编排只对 HARD 触发 retry / fail-safe）。 */
    public static boolean hasHardConflict(final List<FactConflict> conflicts) {
        if (conflicts == null) {
            return false;
        }
        return conflicts.stream().anyMatch(c -> c.severity() == Severity.HARD_FACT);
    }

    private static final Pattern CN_MIN_SEC = Pattern.compile("(\\d+)分(\\d+)秒");
    private static final Pattern CN_MIN = Pattern.compile("(\\d+)分");
    private static final Pattern CN_SEC = Pattern.compile("(\\d+)秒");
    private static final Pattern COLON_TIME = Pattern.compile("(\\d+):(\\d+)");
    private static final Pattern DECIMAL_SEC = Pattern.compile("(\\d+(?:\\.\\d+)?)s");
    // 三语机器/常见时间格式：109s / 1m49s / 1 мин 49 сек / 109 seconds / 109 секунд
    private static final Pattern EN_MIN_SEC = Pattern.compile("(\\d+)\\s*m\\s*(\\d+)\\s*s");
    private static final Pattern RU_MIN_SEC = Pattern.compile("(\\d+)\\s*мин\\s*(\\d+)\\s*сек");
    private static final Pattern EN_SEC = Pattern.compile("(\\d+)\\s*(?:sec|seconds)(?![\\p{L}\\p{N}])");
    private static final Pattern RU_SEC = Pattern.compile("(\\d+)\\s*(?:сек|секунд)(?![\\p{L}\\p{N}])");
    // 范围：1分49秒-2分08秒 / 109-128秒 / 1:49–2:08 / 1分52秒后面那二十秒
    private static final Pattern RANGE_CN = Pattern.compile(
            "(\\d+)分(\\d+)秒\\s*[-–~至到]\\s*(\\d+)分(\\d+)秒");
    private static final Pattern RANGE_SEC = Pattern.compile(
            "(\\d+)\\s*[-–~至到]\\s*(\\d+)\\s*秒");
    private static final Pattern RANGE_COLON = Pattern.compile(
            "(\\d+):(\\d+)\\s*[-–~至到]\\s*(\\d+):(\\d+)");
    private static final Pattern RANGE_TAIL_SEC = Pattern.compile(
            "(\\d+)分(\\d+)秒后面那(\\d+)秒");
    // 存活变化：7v7→4v6 / 7对7变成4对6 / 7比7变4比6
    private static final Pattern TRANSITION = Pattern.compile(
            "(\\d+)\\s*[vV对比]\\s*(\\d+)\\s*(?:变成|变为|变作|→|->|至|到|to|стало)\\s*"
                    + "(\\d+)\\s*[vV对比]\\s*(\\d+)");
    // 位置断言：7辆全部在6区 / 7辆集中6区 / 全部在GRID6
    private static final Pattern REGION_WITH_COUNT = Pattern.compile(
            "(\\d+)\\s*辆(?:全部|都|几乎|基本)?\\s*(?:集中|压进|位于|在|进入|挤在)?\\s*"
                    + "(?:GRID)?(\\d+)\\s*区");
    private static final Pattern REGION_ALL = Pattern.compile(
            "全部\\s*(?:在|位于|集中到|压进)?\\s*(?:GRID)?(\\d+)\\s*区");
    // EN/RU 位置断言：7 vehicles in region 6 / 7 машин в 6-й зоне
    private static final Pattern REGION_WITH_COUNT_EN = Pattern.compile(
            "(\\d+)\\s*(?:vehicles|tanks|units)?\\s*(?:in|at|on|near)?\\s*(?:GRID|region|sector|zone|area)\\s*(\\d+)");
    private static final Pattern REGION_WITH_COUNT_RU = Pattern.compile(
            "(\\d+)\\s*(?:машин|танков|техники|единиц)?\\s*(?:в|на)\\s*(?:GRID)?\\s*(\\d+)(?:-?\\s*(?:зоне|области|регионе|секторе))?");
    private static final Pattern REGION_ALL_EN = Pattern.compile(
            "all\\s*(?:in|at|on|near)?\\s*(?:GRID|region|sector|zone|area)\\s*(\\d+)");
    private static final Pattern REGION_ALL_RU = Pattern.compile(
            "все\\s*(?:в|на)\\s*(?:GRID)?\\s*(\\d+)(?:-?\\s*(?:зоне|области|регионе|секторе))?");
    private static final Pattern GRID_COUNT = Pattern.compile("GRID(\\d+)=(\\d+)");

    /** V5 当前断言短语（把 LAST_KNOWN 说成当前位置；ZH + EN + RU 三语覆盖）。 */
    static final List<String> CURRENT_ASSERTION_PHRASES = List.of(
            // ZH
            "就在这里", "正在这里", "就在原地", "现在还在", "此刻在", "此时在", "现在还在这里", "正在原地",
            // EN
            "is right here", "is right here now", "is currently in", "is still in",
            "is now at", "is still at", "remains in", "is here now", "is standing here",
            // RU
            "прямо здесь", "сейчас находится", "до сих пор находится", "всё ещё на",
            "стоит здесь", "здесь сейчас", "находится прямо сейчас");

    /** V6 无证据硬事实化表达（ZH + EN + RU；命中即需降级表达，否则 FAIL）。 */
    static final List<String> BANNED_HARD_FACT_PHRASES = List.of(
            // ZH（原清单）
            "进入对方所有炮线", "进入所有炮线", "所有炮线", "具备完整LOS", "完整LOS",
            "拥有直接炮线", "直接炮线", "被掩体卡住", "卡住掩体", "掩体卡住",
            "已经点亮", "点亮了", "提供了视野", "提供视野", "侦察到了", "获得侦察收益",
            "获得了视野", "拿到了视野", "拿到视野", "对方正在瞄准", "正在瞄准",
            "无遮挡射界", "遮挡射界", "卖头", "hull-down", "HULL-DOWN", "Hull-down",
            "掩体切割", "没有掩体",
            // EN
            "full LOS", "complete line of sight", "clear line of sight", "direct line of fire",
            "inside every enemy firing line", "inside all enemy firing lines",
            "all enemy firing lines", "has direct fire line", "direct fire line",
            "blocked by cover", "stuck behind cover", "behind cover", "has no cover",
            "has spotted", "spotted the", "provides vision", "provides spotting",
            "gained spotting", "is aiming at", "was aiming at", "unobstructed firing angle",
            "hull-down", "hull down", "no cover",
            // RU
            "полная линия огня", "прямая линия огня", "внутри всех линий огня противника",
            "все линии огня противника", "закрыт укрытием", "застрял за укрытием", "за укрытием",
            "без укрытия", "засветил", "обеспечивает обзор", "получил засвет",
            "прицеливается в", "целится в", "свободный угол обстрела", "hull-down");

    /** 降级表达标记（ZH + EN + RU）：同一句出现任一标记则硬事实化表达可降级放行。 */
    static final List<String> DOWNGRADE_MARKERS = List.of(
            // ZH
            "更可能", "从交换结果看", "如果当时", "推测", "可能", "或许", "大概",
            "射界关系确实如此", "无法确认", "不确定", "看来", "像是", "疑似",
            // EN
            "more likely", "probably", "perhaps", "maybe", "based on the exchange",
            "if the", "seems", "likely", "cannot be confirmed", "uncertain",
            // RU
            "более вероятно", "вероятно", "возможно", "по обмену", "судя по",
            "если бы", "похоже", "наверное", "нельзя подтвердить", "неопределённо");

    private TeamFactualConsistencyValidator() {
    }

    /**
     * 校验 envelope 与后端 grounding facts 的一致性；返回冲突列表（空 = PASS）。
     * 战术观点、coaching recommendation 一律不检查。
     */
    public static List<FactConflict> validate(final TeamReviewEnvelope envelope,
                                              final GroundingFacts facts) {
        final List<FactConflict> conflicts = new ArrayList<>();
        if (envelope == null) {
            conflicts.add(new FactConflict("OUTPUT", "输出为空，无法校验。"));
            return conflicts;
        }
        if (envelope.reviewMarkdown() == null || envelope.reviewMarkdown().isBlank()) {
            conflicts.add(new FactConflict("OUTPUT", "reviewMarkdown 为空：正文必须是一段完整的自然语言复盘。"));
        }
        if (envelope.primaryDiagnosis() == null || !envelope.primaryDiagnosis().hasContent()) {
            conflicts.add(new FactConflict("DIAGNOSIS",
                    "缺少主结论：必须选择且只选择一个 PRIMARY DIAGNOSIS（title + reasoning 非空；可以是无明显确认错误）。"));
        }

        final List<String> units = new ArrayList<>();
        if (envelope.primaryDiagnosis() != null) {
            units.add(nonNull(envelope.primaryDiagnosis().title()));
            units.add(nonNull(envelope.primaryDiagnosis().reasoning()));
        }
        units.add(nonNull(envelope.reviewMarkdown()));
        for (final TeamReviewEnvelope.Claim c : envelope.claims()) {
            units.add(nonNull(c.text()));
        }

        // 机器结构化校验（语言无关，三语通用）优先于正文文本兜底
        checkStructuredMachineClaims(envelope, facts, conflicts);
        checkTemporalOwnership(envelope, facts, conflicts);
        checkPlayerEventTimes(units, facts, conflicts);
        checkAliveTransitions(units, facts, conflicts);
        checkPositionGrounding(envelope, units, facts, conflicts);
        checkCurrentVsLastKnown(envelope, units, facts, conflicts);
        checkUnsupportedHardFacts(units, conflicts);
        checkInternalLabelLeak(envelope, conflicts);
        return conflicts;
    }

    // ===== 机器结构化校验（语言无关，三语通用） =====

    private static void checkStructuredMachineClaims(final TeamReviewEnvelope envelope,
                                                     final GroundingFacts facts,
                                                     final List<FactConflict> conflicts) {
        checkClaimsCoverage(envelope, facts, conflicts);
        // structured evidence binding——有 evidenceIds 时引用证据是 primary source
        checkStructuredEvidenceBinding(envelope, facts, conflicts);
        for (final TeamReviewEnvelope.Claim c : envelope.claims()) {
            final String type = c.claimType() == null ? "" : c.claimType().toUpperCase(java.util.Locale.ROOT);
            // V6m：claim 显式声明 LOS/SPOTTING 事实类型 → 后端没有对应 evidence kind，一律 FAIL
            if ("LOS".equals(type) || "SPOTTING".equals(type)
                    || "LINE_OF_SIGHT".equals(type) || "VISION".equals(type)) {
                conflicts.add(new FactConflict("V6",
                        "声明了 " + c.claimType() + " 事实类型，但当前后端没有 LOS / spotting / 视野 evidence；"
                                + "这类内容只能作为战术判断（TACTICAL claimType）+ 降级表达输出。"));
            }
            // 无 evidenceIds 时的全局兜底（defense-in-depth；parser fail-close 下 factual claim 必有 ids）
            if (c.evidenceIds().isEmpty()) {
                checkMachineFallback(c, type, facts, conflicts);
            }
        }
    }

    // ===== ：Evidence Binding Contract（claim ↔ evidenceFact 必须真正绑定） =====

    /** claimType → 允许引用的 evidence 类型（TACTICAL/未知 = 无要求）。 */
    private static java.util.Set<String> requiredEvidenceType(final String claimType) {
        return switch (claimType) {
            case "DEATH" -> java.util.Set.of(TeamGroundingFacts.TYPE_PLAYER_DESTROYED);
            case "ALIVE_TRANSITION" -> java.util.Set.of(TeamGroundingFacts.TYPE_ALIVE_TRANSITION,
                    TeamGroundingFacts.TYPE_FOCUS_WINDOW);
            case "POSITION_REGION" -> java.util.Set.of(TeamGroundingFacts.TYPE_POSITION_REGION);
            case "ENEMY_POSITION" -> java.util.Set.of(TeamGroundingFacts.TYPE_ENEMY_POSITION);
            default -> java.util.Set.of();
        };
    }

    /**
     * B1 evidence binding：每个引用必须存在且属于该 claimType 允许的 evidence 类型；再按 claimType
     * 做身份/时间/数值绑定。错误事实借用无关 evidenceId、或「全局恰好存在该变化」式 PASS 一律 FAIL。
     */
    private static void checkStructuredEvidenceBinding(final TeamReviewEnvelope envelope,
                                                       final GroundingFacts facts,
                                                       final List<FactConflict> conflicts) {
        for (final TeamReviewEnvelope.Claim c : envelope.claims()) {
            if (c.evidenceIds().isEmpty()) {
                continue; // 无引用证据：走全局兜底（defense-in-depth）
            }
            final String type = c.claimType() == null ? "" : c.claimType().toUpperCase(java.util.Locale.ROOT);
            final java.util.Set<String> allowed = requiredEvidenceType(type);
            if (allowed.isEmpty()) {
                continue; // TACTICAL / 未知
            }
            // 1) 存在性 + 类型：每个引用都必须存在且属于允许类型（不能借用无关证据编号）
            boolean typeOk = true;
            for (final String id : c.evidenceIds()) {
                final EvidenceFact fact = facts.byId().get(id);
                if (fact == null) {
                    conflicts.add(new FactConflict("BINDING",
                            "引用了不存在的证据编号 " + id + "（GROUNDING FACTS 中没有该编号，无法绑定）。",
                            "UNKNOWN_EVIDENCE"));
                    typeOk = false;
                    continue;
                }
                if (!allowed.contains(fact.type())) {
                    conflicts.add(new FactConflict("BINDING",
                            "证据类型不匹配（" + type + "）：claim 引用了 " + fact.type() + " 证据 " + id
                                    + "，必须引用 " + String.join("/", allowed) + " 类型证据。",
                            "EVIDENCE_TYPE_MISMATCH"));
                    typeOk = false;
                }
            }
            if (!typeOk) {
                continue; // 类型/存在性已 FAIL，不再做值绑定（避免噪音）
            }
            // 2) per-claimType 完整支撑绑定
            switch (type) {
                case "DEATH" -> checkDeathBinding(c, facts, conflicts);
                case "ALIVE_TRANSITION" -> checkTransitionBinding(c, facts, conflicts);
                case "POSITION_REGION" -> checkPositionRegionBinding(c, facts, conflicts);
                case "ENEMY_POSITION" -> checkEnemyPositionBinding(c, facts, conflicts);
                default -> { }
            }
        }
    }

    /** B1 DEATH：subject 必须真实存在于后端阵亡事实；至少一个引用 PLAYER_DESTROYED 证据身份+时间完整支撑。 */
    private static void checkDeathBinding(final TeamReviewEnvelope.Claim c,
                                          final GroundingFacts facts,
                                          final List<FactConflict> conflicts) {
        final boolean subjectHasDeath = deathFacts(facts).stream()
                .anyMatch(d -> identityMatches(c, d));
        if (!subjectHasDeath) {
            conflicts.add(new FactConflict("BINDING",
                    "DEATH claim 的 subject「" + c.subject() + "」在后端没有对应的阵亡事实"
                            + "（不能因为循环没有找到 matching death 就静默 PASS）。",
                    "SUBJECT_MISMATCH"));
            return;
        }
        boolean fullSupport = false;
        boolean identityMatch = false;
        for (final String id : c.evidenceIds()) {
            final EvidenceFact fact = facts.byId().get(id);
            if (fact == null || !TeamGroundingFacts.TYPE_PLAYER_DESTROYED.equals(fact.type())) {
                continue; // 类型/存在性已报
            }
            if (!identityMatches(c, fact)) {
                continue;
            }
            identityMatch = true;
            if (c.hasTime() && Math.abs(c.timeSec() - fact.timeSec()) > DEATH_TIME_TOLERANCE_SEC) {
                conflicts.add(new FactConflict("V2",
                        "玩家事件时间错误（structured binding）：" + playerBrief(fact) + " 后端事实为 "
                                + TeamGroundingFacts.formatClock(fact.timeSec())
                                + "，claim timeSec=" + timeText(c.timeSec()) + "。"));
                continue;
            }
            fullSupport = true;
        }
        if (!fullSupport && !identityMatch) {
            conflicts.add(new FactConflict("BINDING",
                    "DEATH claim 引用的证据身份与 subject「" + c.subject()
                            + "」不符（wrong entity：引用的阵亡证据属于其他玩家）。",
                    "SUBJECT_MISMATCH"));
        }
    }

    /** B1 ALIVE_TRANSITION：value 必须与引用的 ALIVE_COUNT_TRANSITION / FOCUS_WINDOW 证据 before/after 一致。 */
    private static void checkTransitionBinding(final TeamReviewEnvelope.Claim c,
                                               final GroundingFacts facts,
                                               final List<FactConflict> conflicts) {
        final Matcher m = TRANSITION.matcher(c.value());
        if (!m.find()) {
            return; // value 格式非法由 parser fail-close / V3 兜底
        }
        final int a = Integer.parseInt(m.group(1));
        final int b = Integer.parseInt(m.group(2));
        final int cc = Integer.parseInt(m.group(3));
        final int d = Integer.parseInt(m.group(4));
        boolean fullSupport = false;
        for (final String id : c.evidenceIds()) {
            final EvidenceFact fact = facts.byId().get(id);
            if (fact == null) {
                continue;
            }
            if (TeamGroundingFacts.TYPE_ALIVE_TRANSITION.equals(fact.type())) {
                final int[] before = parseVCount(fact.attrs().get("before"));
                final int[] after = parseVCount(fact.attrs().get("after"));
                if (before != null && after != null
                        && before[0] == a && before[1] == b
                        && after[0] == cc && after[1] == d) {
                    fullSupport = true;
                }
            } else if (TeamGroundingFacts.TYPE_FOCUS_WINDOW.equals(fact.type())) {
                final int bf = intAttr(fact, "beforeFriendly");
                final int be = intAttr(fact, "beforeEnemy");
                final int af = intAttr(fact, "afterFriendly");
                final int ae = intAttr(fact, "afterEnemy");
                if (bf == a && be == b && af == cc && ae == d) {
                    fullSupport = true;
                }
            }
        }
        // P0-8：允许引用证据链覆盖变化（如 6v7→6v3 引用 6v7→6v6→6v5→6v4→6v3 逐步变化链）——
        // 要求证据链首尾与 claim value 一致即可，不再要求单条证据完全等价。
        if (!fullSupport && !c.evidenceIds().isEmpty()) {
            fullSupport = chainSupportsTransition(facts, c.evidenceIds(), a, b, cc, d);
        }
        if (!fullSupport) {
            // P0-6 分界：value 与引用证据不一致，但全局存活变化中确实存在该变化（正文事实正确）
            // → STRUCTURED_METADATA（不阻塞输出）；全局也不存在该变化 → HARD_FACT（正文事实错误）。
            final boolean existsGlobally = matchesTransition(facts, a, b, cc, d);
            conflicts.add(new FactConflict("V3",
                    "存活变化错误（structured value binding）：claim " + c.value()
                            + " 与引用的证据（" + citedIds(c) + "）不一致"
                            + (existsGlobally ? "，但全局存活变化中存在该变化（正文事实正确）。" : "；"
                                    + "后端事实中也不存在该变化。"),
                    "COUNT_MISMATCH",
                    existsGlobally ? Severity.STRUCTURED_METADATA : Severity.HARD_FACT));
        }
    }

    /**
     * P0-8：引用证据链是否覆盖 claim 的存活变化（首尾一致 + 中间连续）。
     * 例：claim 6v7→6v3 引用 E111(6v7→6v6) E112(6v6→6v5) E113(6v5→6v4) E114(6v4→6v3) →
     * 首=E111.before(6v7) 尾=E114.after(6v3) 一致，且每步 after == 下一步 before → true。
     * <p>严格性（CI 约束）：</p>
     * <ol>
     *   <li>连续 evidence chain → PASS；</li>
     *   <li>首尾匹配但中间断链（如缺 6v6→6v5）→ 不得 PASS；</li>
     *   <li>evidence ID 顺序乱序，但真实 timeSec 连续 → PASS（按 timeSec 排序，不按 ID）；</li>
     *   <li>时间顺序错误/反向 → 不得 PASS（排序后 before/after 不连续）；</li>
     *   <li>ALIVE_TRANSITION + FOCUS_WINDOW 混合 chain → 按 timeSec 排序后统一验证连续性。</li>
     * </ol>
     * 时间键用 {@code fact.timeSec()}（AliveTransition 的 startSec/endSec 即变化时刻；
     * FOCUS_WINDOW 取 endSec 作为窗口代表时刻，与 GroundingFacts 排序口径一致）。
     */
    private static boolean chainSupportsTransition(final GroundingFacts facts,
                                                   final List<String> evidenceIds,
                                                   final int a, final int b,
                                                   final int cc, final int d) {
        final List<TransitionStep> steps = new ArrayList<>();
        for (final String id : evidenceIds) {
            final EvidenceFact fact = facts.byId().get(id);
            if (fact == null) {
                continue;
            }
            if (TeamGroundingFacts.TYPE_ALIVE_TRANSITION.equals(fact.type())) {
                final int[] before = parseVCount(fact.attrs().get("before"));
                final int[] after = parseVCount(fact.attrs().get("after"));
                if (before != null && after != null) {
                    steps.add(new TransitionStep(fact.timeSec(),
                            before[0], before[1], after[0], after[1]));
                }
            } else if (TeamGroundingFacts.TYPE_FOCUS_WINDOW.equals(fact.type())) {
                steps.add(new TransitionStep(fact.timeSec(),
                        intAttr(fact, "beforeFriendly"), intAttr(fact, "beforeEnemy"),
                        intAttr(fact, "afterFriendly"), intAttr(fact, "afterEnemy")));
            }
        }
        if (steps.isEmpty()) {
            return false;
        }
        // 按真实时间（battle-relative 秒）排序：evidence ID 乱序不影响链判定
        steps.sort(java.util.Comparator.comparingDouble(TransitionStep::timeSec));
        final TransitionStep first = steps.get(0);
        final TransitionStep last = steps.get(steps.size() - 1);
        if (first.beforeF() != a || first.beforeE() != b
                || last.afterF() != cc || last.afterE() != d) {
            return false;
        }
        // 中间连续性：每步 after 必须 == 下一步 before（断链 / 反向 / 时间错序 → false）
        for (int i = 0; i + 1 < steps.size(); i++) {
            final TransitionStep cur = steps.get(i);
            final TransitionStep next = steps.get(i + 1);
            if (cur.afterF() != next.beforeF() || cur.afterE() != next.beforeE()) {
                return false;
            }
        }
        return true;
    }

    /** 存活变化链的一步：时间 + before/after 存活数（friendly/enemy）。 */
    private record TransitionStep(double timeSec, int beforeF, int beforeE, int afterF, int afterE) {
    }

    /** B1 POSITION_REGION：引用的 POSITION_REGION 证据是 primary source（side/region/count/countSemantics）。 */
    private static void checkPositionRegionBinding(final TeamReviewEnvelope.Claim c,
                                                   final GroundingFacts facts,
                                                   final List<FactConflict> conflicts) {
        for (final String id : c.evidenceIds()) {
            final EvidenceFact fact = facts.byId().get(id);
            if (fact == null || !TeamGroundingFacts.TYPE_POSITION_REGION.equals(fact.type())) {
                continue;
            }
            if (c.hasTime() && Math.abs(c.timeSec() - fact.timeSec()) > SNAPSHOT_TIME_TOLERANCE_SEC) {
                conflicts.add(new FactConflict("BINDING",
                        "位置时间不匹配（structured binding）：claim timeSec=" + timeText(c.timeSec())
                                + " 与引用的证据 " + id + "（" + TeamGroundingFacts.formatClock(fact.timeSec())
                                + "）不一致。",
                        "TIME_MISMATCH"));
                continue;
            }
            final Map<String, Integer> counts = sideCounts(fact, c.side());
            final Integer actual = counts.get("GRID" + c.region());
            if (actual == null) {
                conflicts.add(new FactConflict("BINDING",
                        "位置区域不匹配（structured binding）：引用的证据 " + id
                                + "（" + TeamGroundingFacts.formatClock(fact.timeSec()) + "）"
                                + sideLabel(c.side()) + " 侧没有 GRID" + c.region() + " 的快照数据（"
                                + countsText(counts) + "）。",
                        "REGION_MISMATCH"));
                continue;
            }
            checkV4CountSemantics(c, actual, conflicts);
        }
    }

    /** B1 ENEMY_POSITION：引用的 ENEMY_POSITION_KNOWN 证据必须身份 + 时间 + 区域 + knowledge 全部一致。 */
    private static void checkEnemyPositionBinding(final TeamReviewEnvelope.Claim c,
                                                  final GroundingFacts facts,
                                                  final List<FactConflict> conflicts) {
        // 重复坦克名歧义防护：仅凭 tankName 无法唯一确定身份 → FAIL（要求 subjectAccountId / 昵称）
        if (c.subjectAccountId() == null && c.subject() != null && !c.subject().isBlank()) {
            final long distinctAccounts = enemyPositionFacts(facts).stream()
                    .filter(f -> sameName(f.tankName(), c.subject()))
                    .map(EvidenceFact::accountId)
                    .filter(java.util.Objects::nonNull)
                    .distinct()
                    .count();
            if (distinctAccounts > 1) {
                conflicts.add(new FactConflict("BINDING",
                        "敌方位置身份歧义（structured binding）：tankName「" + c.subject()
                                + "」对应 " + distinctAccounts + " 辆不同账号的敌车，不能仅凭坦克名绑定；"
                                + "请使用 subjectAccountId 或玩家昵称作为稳定身份。",
                        "IDENTITY_AMBIGUITY"));
                return;
            }
        }
        for (final String id : c.evidenceIds()) {
            final EvidenceFact fact = facts.byId().get(id);
            if (fact == null || !TeamGroundingFacts.TYPE_ENEMY_POSITION.equals(fact.type())) {
                continue;
            }
            if (!identityMatches(c, fact)) {
                conflicts.add(new FactConflict("BINDING",
                        "敌方位置身份不匹配（structured binding）：claim subject「" + c.subject()
                                + "」与引用的证据 " + id + "（" + tankBrief(fact) + "，acc "
                                + fact.accountId() + "）不符（different vehicle）。",
                        "SUBJECT_MISMATCH"));
                continue;
            }
            if (c.hasTime() && Math.abs(c.timeSec() - fact.timeSec()) > SNAPSHOT_TIME_TOLERANCE_SEC) {
                conflicts.add(new FactConflict("BINDING",
                        "敌方位置时间不匹配（structured binding）：claim " + timeText(c.timeSec())
                                + " 与引用的证据 " + id + "（" + TeamGroundingFacts.formatClock(fact.timeSec())
                                + "）不一致。",
                        "TIME_MISMATCH"));
                continue;
            }
            if (c.region() != null && !String.valueOf(c.region()).equals(fact.attrs().get("region"))) {
                conflicts.add(new FactConflict("BINDING",
                        "敌方位置区域不匹配（structured binding）：claim 称 GRID" + c.region()
                                + "，引用的证据 " + id + " 是 GRID" + fact.attrs().get("region")
                                + "（" + TeamGroundingFacts.formatClock(fact.timeSec()) + "）。",
                        "REGION_MISMATCH"));
                continue;
            }
            if (c.knowledge() != null
                    && !c.knowledge().equalsIgnoreCase(fact.attrs().getOrDefault("knowledge", ""))) {
                conflicts.add(new FactConflict("V5",
                        "敌方位置知识错误（structured binding）：claim 称 " + c.subject() + " @" + timeText(c.timeSec())
                                + " GRID" + c.region() + " 为 " + c.knowledge()
                                + "，引用的证据 " + id + " 是 " + fact.attrs().get("knowledge")
                                + "（" + TeamGroundingFacts.formatClock(fact.timeSec()) + "）。"));
                continue;
            }
            return; // 已找到完整支撑
        }
    }

    /** 无 evidenceIds 时的全局兜底（defense-in-depth；B1 后仅用于无引用证据的 claim）。 */
    private static void checkMachineFallback(final TeamReviewEnvelope.Claim c, final String type,
                                             final GroundingFacts facts,
                                             final List<FactConflict> conflicts) {
        // V2m fallback：DEATH subject + timeSec → 全局玩家阵亡时间
        if ("DEATH".equals(type) && c.hasTime() && c.subject() != null && !c.subject().isBlank()) {
            for (final EvidenceFact death : deathFacts(facts)) {
                if (!sameName(c.subject(), death.nickname())
                        && !sameName(c.subject(), death.tankName())) {
                    continue;
                }
                if (Math.abs(c.timeSec() - death.timeSec()) > DEATH_TIME_TOLERANCE_SEC) {
                    conflicts.add(new FactConflict("V2",
                            "玩家事件时间错误（structured）：" + playerBrief(death) + " 后端事实为 "
                                    + TeamGroundingFacts.formatClock(death.timeSec())
                                    + "，claim timeSec=" + timeText(c.timeSec()) + "。"));
                }
            }
        }
        // V3m fallback：ALIVE_TRANSITION value → 全局存活变化
        if ("ALIVE_TRANSITION".equals(type) && c.value() != null && !c.value().isBlank()) {
            final Matcher m = TRANSITION.matcher(c.value());
            if (m.find()) {
                final int a = Integer.parseInt(m.group(1));
                final int b = Integer.parseInt(m.group(2));
                final int cc = Integer.parseInt(m.group(3));
                final int d = Integer.parseInt(m.group(4));
                if (!matchesTransition(facts, a, b, cc, d)) {
                    conflicts.add(new FactConflict("V3",
                            "存活变化错误（structured value）：" + c.value()
                                    + "，后端事实中没有该变化（可用：" + transitionSummary(facts) + "）。"));
                }
            }
        }
        // V4m fallback：POSITION_REGION → 最近快照
        if ("POSITION_REGION".equals(type)
                && c.region() != null && c.count() != null && c.hasTime()
                && c.side() != null && c.countSemantics() != null) {
            final Integer actual = regionCountAt(facts, c.timeSec(), c.region(), c.side());
            if (actual != null) {
                checkV4CountSemantics(c, actual, conflicts);
            }
        }
        // V5m fallback：ENEMY_POSITION → 最近样本
        if ("ENEMY_POSITION".equals(type)
                && c.hasTime() && c.subject() != null && !c.subject().isBlank()
                && c.region() != null && c.knowledge() != null) {
            checkV5Knowledge(c, facts, conflicts);
        }
    }

    /** claim.subjectAccountId（稳定身份）优先；否则昵称/坦克名。 */
    private static boolean identityMatches(final TeamReviewEnvelope.Claim c, final EvidenceFact fact) {
        if (c.subjectAccountId() != null) {
            return c.subjectAccountId().equals(fact.accountId());
        }
        if (c.subject() == null || c.subject().isBlank()) {
            return false;
        }
        return sameName(c.subject(), fact.nickname()) || sameName(c.subject(), fact.tankName());
    }

    /** 引用证据的 side 侧区域计数（FRIENDLY→friendly；ENEMY→enemyCurrent）。 */
    private static Map<String, Integer> sideCounts(final EvidenceFact fact, final String side) {
        final String key = "ENEMY".equalsIgnoreCase(side) ? "enemyCurrent" : "friendly";
        return parseRegionCounts(fact.attrs().getOrDefault(key, ""));
    }

    private static String countsText(final Map<String, Integer> counts) {
        if (counts.isEmpty()) {
            return "无";
        }
        return counts.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(e -> e.getKey() + "=" + e.getValue())
                .collect(java.util.stream.Collectors.joining(" "));
    }

    private static String citedIds(final TeamReviewEnvelope.Claim c) {
        return String.join(",", c.evidenceIds());
    }

    /** 解析 "7v7" → [7,7]；格式非法返回 null。 */
    private static int[] parseVCount(final String s) {
        if (s == null) {
            return null;
        }
        final String[] parts = s.split("v");
        if (parts.length != 2) {
            return null;
        }
        try {
            return new int[]{Integer.parseInt(parts[0].trim()), Integer.parseInt(parts[1].trim())};
        } catch (final NumberFormatException e) {
            return null;
        }
    }

    /** V4m 数量校验：EXACT（count == actual）/ AT_LEAST / SUBSET（actual >= count）。 */
    private static void checkV4CountSemantics(final TeamReviewEnvelope.Claim c,
                                              final int actual,
                                              final List<FactConflict> conflicts) {
        final String semantics = c.countSemantics().toUpperCase(java.util.Locale.ROOT);
        final boolean fail;
        final String reason;
        switch (semantics) {
            case "AT_LEAST", "SUBSET" -> {
                fail = c.count() > actual;
                reason = semantics + "（claim " + c.count() + " > 后端快照 " + actual + "）";
            }
            default -> { // EXACT
                fail = c.count() != actual;
                reason = "EXACT（claim " + c.count() + " != 后端快照 " + actual + "）";
            }
        }
        if (fail) {
            conflicts.add(new FactConflict("V4",
                    "位置数量错误（structured " + c.countSemantics() + "）：claim 称 " + sideLabel(c.side())
                            + " GRID" + c.region() + " 有 " + c.count() + " 辆，后端该时刻快照为 "
                            + actual + " 辆（" + TeamGroundingFacts.formatClock(c.timeSec()) + "）；" + reason));
        }
    }

    /** V5m：ENEMY_POSITION knowledge（CURRENT/LAST_KNOWN）与后端 exact 校验。 */
    private static void checkV5Knowledge(final TeamReviewEnvelope.Claim c,
                                         final GroundingFacts facts,
                                         final List<FactConflict> conflicts) {
        final String claimKnowledge = c.knowledge().toUpperCase(java.util.Locale.ROOT);
        // 1) 引用 ENEMY_POSITION 证据事实：knowledge 必须与后端 exact 一致
        for (final String id : c.evidenceIds()) {
            final EvidenceFact fact = facts.byId().get(id);
            if (fact == null || !TeamGroundingFacts.TYPE_ENEMY_POSITION.equals(fact.type())) {
                continue;
            }
            final String backend = fact.attrs().getOrDefault("knowledge", "");
            if (!backend.equals(claimKnowledge)) {
                conflicts.add(new FactConflict("V5",
                        "敌方位置知识错误（structured）：claim 称 " + c.subject() + " @" + timeText(c.timeSec())
                                + " GRID" + c.region() + " 为 " + claimKnowledge
                                + "，但引用的证据 " + id + " 是 " + backend
                                + "（最后一次观测于 " + TeamGroundingFacts.formatClockSafe(
                                        fact.attrs().get("observedAtSec")) + "）。"));
            }
            return;
        }
        // 2) 无引用证据：按最近 enemy position 样本（±6s）比较
        final TeamGroundingFacts.EnemyPositionSample sample =
                nearestEnemySampleBySubject(facts, c.subject(), c.timeSec());
        if (sample != null && !sample.knowledge().equals(claimKnowledge)) {
            conflicts.add(new FactConflict("V5",
                    "敌方位置知识错误（structured）：claim 称 " + c.subject() + " @" + timeText(c.timeSec())
                            + " GRID" + c.region() + " 为 " + claimKnowledge
                            + "，后端该时刻样本为 " + sample.knowledge()
                            + "（GRID" + sample.region() + "，上次观测 "
                            + TeamGroundingFacts.formatClockSafe(sample.observedAtSec() == null
                                    ? "" : String.valueOf(sample.observedAtSec())) + "）。"));
        }
    }

    /** 按 subject（昵称/坦克名）找最近的 enemy position 样本（±6s）。 */
    private static TeamGroundingFacts.EnemyPositionSample nearestEnemySampleBySubject(
            final GroundingFacts facts, final String subject, final double timeSec) {
        TeamGroundingFacts.EnemyPositionSample best = null;
        double bestDelta = Double.MAX_VALUE;
        for (final TeamGroundingFacts.EnemyPositionSample s : facts.enemyPositions()) {
            if (!sameName(s.nickname(), subject) && !sameName(s.tankName(), subject)) {
                continue;
            }
            final double delta = Math.abs(s.sec() - timeSec);
            if (delta < bestDelta) {
                bestDelta = delta;
                best = s;
            }
        }
        return best != null && bestDelta <= SNAPSHOT_TIME_TOLERANCE_SEC ? best : null;
    }

    private static boolean hasTransitionAnchor(final String text) {
        return TRANSITION.matcher(text).find();
    }

    /** 正文是否出现「玩家名 + 紧邻时间」的阵亡锚点（defense-in-depth coverage）。 */
    private static boolean hasDeathTimeAnchor(final String markdown, final GroundingFacts facts) {
        for (final EvidenceFact death : deathFacts(facts)) {
            for (final String key : mentionKeys(death)) {
                int idx = markdown.indexOf(key);
                while (idx >= 0) {
                    final int from = Math.max(0, idx - 20);
                    final int to = Math.min(markdown.length(), idx + key.length() + 20);
                    if (firstTime(markdown.substring(from, to)) != null) {
                        return true;
                    }
                    idx = markdown.indexOf(key, idx + key.length());
                }
            }
        }
        return false;
    }

    /**
     * claims coverage 最低契约：Grounding Facts 非空且主判断引用证据编号，
     * 或正文出现可验证事实锚点（玩家阵亡+时间 / 存活变化 / 位置数量）时，claims 不允许无条件为空。
     */
    private static void checkClaimsCoverage(final TeamReviewEnvelope envelope,
                                            final GroundingFacts facts,
                                            final List<FactConflict> conflicts) {
        if (!envelope.claims().isEmpty() || facts.facts().isEmpty()) {
            return;
        }
        final boolean diagnosisCitesEvidence = envelope.primaryDiagnosis() != null
                && envelope.primaryDiagnosis().supportingEvidenceIds() != null
                && !envelope.primaryDiagnosis().supportingEvidenceIds().isEmpty();
        final String markdown = nonNull(envelope.reviewMarkdown());
        final boolean factualAnchorInBody = !findRanges(markdown).isEmpty()
                || hasTransitionAnchor(markdown)
                || !parseRegionClaims(markdown).isEmpty()
                || hasDeathTimeAnchor(markdown, facts);
        if (diagnosisCitesEvidence || factualAnchorInBody) {
            conflicts.add(new FactConflict("CONTRACT",
                    "正文/主判断包含可验证事实陈述（时间/人数/位置/阵亡），但 claims 为空："
                            + "每个可验证 factual statement 必须有对应 structured claim（DEATH / "
                            + "ALIVE_TRANSITION / POSITION_REGION / ENEMY_POSITION），claims 不是可选装饰。"));
        }
    }

    private static String sideLabel(final String side) {
        return "ENEMY".equalsIgnoreCase(side) ? "对方" : "本方";
    }

    /**
     * 某时刻某区域某阵营的车辆数（机器结构化校验用）：最近快照（±6s）兜底；无数据返回 null。
     * <p>FRIENDLY 读 friendlyCounts；ENEMY 读 enemyCurrentCounts（只含 CURRENT 位置知识——
     * enemy LAST_KNOWN 不得当作当前数量，V5 边界）。</p>
     */
    private static Integer regionCountAt(final GroundingFacts facts, final double timeSec,
                                         final int region, final String side) {
        final String key = "GRID" + region;
        RegionSnapshot best = null;
        double bestDelta = Double.MAX_VALUE;
        for (final RegionSnapshot s : facts.regionSnapshots()) {
            final double delta = Math.abs(s.sec() - timeSec);
            if (delta < bestDelta) {
                bestDelta = delta;
                best = s;
            }
        }
        if (best == null || bestDelta > SNAPSHOT_TIME_TOLERANCE_SEC) {
            return null;
        }
        if ("ENEMY".equalsIgnoreCase(side)) {
            // 缺失 key = 该区 0 辆 CURRENT 敌车
            return best.enemyCurrentCounts().getOrDefault(key, 0);
        }
        return best.friendlyCounts().get(key);
    }

    // ===== V1 =====

    private static void checkTemporalOwnership(final TeamReviewEnvelope envelope,
                                               final GroundingFacts facts,
                                               final List<FactConflict> conflicts) {
        final List<CitedUnit> cited = new ArrayList<>();
        if (envelope.primaryDiagnosis() != null) {
            cited.add(new CitedUnit(envelope.primaryDiagnosis().title() + " "
                    + envelope.primaryDiagnosis().reasoning(),
                    envelope.primaryDiagnosis().supportingEvidenceIds()));
        }
        for (final TeamReviewEnvelope.Claim c : envelope.claims()) {
            cited.add(new CitedUnit(c.text(), c.evidenceIds()));
        }
        for (final CitedUnit unit : cited) {
            final List<double[]> ranges = parseRanges(unit.text());
            for (final String id : unit.ids()) {
                final EvidenceFact fact = facts.byId().get(id);
                if (fact == null) {
                    conflicts.add(new FactConflict("EVIDENCE",
                            "引用了不存在的证据编号 " + id + "（GROUNDING FACTS 中没有该编号）。"));
                    continue;
                }
                if (ranges.isEmpty()
                        || (!fact.isDeath()
                        && !TeamGroundingFacts.TYPE_ALIVE_TRANSITION.equals(fact.type()))) {
                    continue; // 只校验带时刻的事件类事实（位置/窗口类由 V4/V5 覆盖）
                }
                final double t = fact.timeSec();
                for (final double[] r : ranges) {
                    if (t < r[0] - WINDOW_EDGE_TOLERANCE_SEC || t > r[1] + WINDOW_EDGE_TOLERANCE_SEC) {
                        // P0-6：structured binding 的引用窗口偏差——正文事实不受影响（正文窗口
                        // 检查在下方独立进行），降级为 STRUCTURED_METADATA，不阻塞整次 AI Review。
                        conflicts.add(new FactConflict("V1",
                                "时间归属冲突：陈述声称窗口 " + rangeText(r)
                                        + "，但引用的证据 " + id + "（" + factBrief(fact) + "，"
                                        + TeamGroundingFacts.formatClock(t) + "）不在该窗口内。",
                                "TEMPORAL_OWNERSHIP",
                                Severity.STRUCTURED_METADATA));
                    }
                }
            }
        }
        // 正文：窗口内点名阵亡的玩家必须在窗口内
        final String markdown = nonNull(envelope.reviewMarkdown());
        final List<TimeRange> mdRanges = findRanges(markdown);
        for (final TimeRange range : mdRanges) {
            final int start = Math.max(0, range.startOffset - 200);
            final int end = Math.min(markdown.length(), range.endOffset + 200);
            final String window = markdown.substring(start, end);
            for (final EvidenceFact death : deathFacts(facts)) {
                if (mentions(window, death)) {
                    final double t = death.timeSec();
                    if (t < range.start - WINDOW_EDGE_TOLERANCE_SEC
                            || t > range.end + WINDOW_EDGE_TOLERANCE_SEC) {
                        conflicts.add(new FactConflict("V1",
                                "时间归属冲突：正文称「" + rangeText(new double[]{range.start, range.end})
                                        + "」这段发生减员，但 " + playerBrief(death) + " 实际阵亡于 "
                                        + TeamGroundingFacts.formatClock(t) + "（不在该窗口内）。"));
                    }
                }
            }
        }
    }

    // ===== V2 =====

    private static void checkPlayerEventTimes(final List<String> units,
                                              final GroundingFacts facts,
                                              final List<FactConflict> conflicts) {
        for (final EvidenceFact death : deathFacts(facts)) {
            for (final String unit : units) {
                if (unit == null || unit.isBlank()) {
                    continue;
                }
                for (final String key : mentionKeys(death)) {
                    int idx = unit.indexOf(key);
                    while (idx >= 0) {
                        // 紧邻窗口（±15 字符）：只抓「WildCat 121s阵亡」这类直接挂在玩家名上的时间；
                        // 若紧邻出现的是时间范围（如「1分49秒至2分08秒那段阵亡」），
                        // 阵亡时间落在该范围内即视为正确归属（范围外引用由 V1 拦截）
                        // 紧邻窗口（±20 字符）：抓「WildCat 121s阵亡」/ "WildCat died at 121 sec"
                        // 这类直接挂在玩家名上的时间（EN/RU 词形需要更宽窗口）；
                        // 若紧邻出现的是时间范围（如「1分49秒至2分08秒那段阵亡」），
                        // 阵亡时间落在该范围内即视为正确归属（范围外引用由 V1 拦截）
                        final int from = Math.max(0, idx - 20);
                        final int to = Math.min(unit.length(), idx + key.length() + 20);
                        final String window = unit.substring(from, to);
                        final List<double[]> ranges = parseRanges(window);
                        if (!ranges.isEmpty()) {
                            final boolean contained = ranges.stream().anyMatch(r ->
                                    death.timeSec() >= r[0] - WINDOW_EDGE_TOLERANCE_SEC
                                            && death.timeSec() <= r[1] + WINDOW_EDGE_TOLERANCE_SEC);
                            if (!contained) {
                                final Double rangeTime = firstTime(window);
                                if (rangeTime != null) {
                                    conflicts.add(new FactConflict("V2",
                                            "玩家事件时间错误：" + playerBrief(death) + " 后端事实为 "
                                                    + TeamGroundingFacts.formatClock(death.timeSec())
                                                    + "，正文写成了 " + timeText(rangeTime) + "（或该窗口不包含该阵亡）。"));
                                }
                            }
                            idx = unit.indexOf(key, idx + key.length());
                            continue;
                        }
                        final Double time = firstTime(window);
                        if (time != null && Math.abs(time - death.timeSec()) > DEATH_TIME_TOLERANCE_SEC) {
                            conflicts.add(new FactConflict("V2",
                                    "玩家事件时间错误：" + playerBrief(death) + " 后端事实为 "
                                            + TeamGroundingFacts.formatClock(death.timeSec())
                                            + "，正文写成了 " + timeText(time) + "。"));
                        }
                        idx = unit.indexOf(key, idx + key.length());
                    }
                }
            }
        }
    }

    // ===== V3 =====

    private static void checkAliveTransitions(final List<String> units,
                                              final GroundingFacts facts,
                                              final List<FactConflict> conflicts) {
        final String backendSummary = transitionSummary(facts);
        for (final String unit : units) {
            if (unit == null || unit.isBlank()) {
                continue;
            }
            final Matcher m = TRANSITION.matcher(unit);
            while (m.find()) {
                final int a = Integer.parseInt(m.group(1));
                final int b = Integer.parseInt(m.group(2));
                final int c = Integer.parseInt(m.group(3));
                final int d = Integer.parseInt(m.group(4));
                if (!matchesTransition(facts, a, b, c, d)) {
                    conflicts.add(new FactConflict("V3",
                            "存活变化错误：正文声称 " + a + "v" + b + " → " + c + "v" + d
                                    + "，后端事实中没有该变化（可用："
                                    + (backendSummary.isEmpty() ? "无" : backendSummary) + "）。"));
                }
            }
        }
    }

    private static boolean matchesTransition(final GroundingFacts facts,
                                             final int a, final int b, final int c, final int d) {
        for (final AliveTransition t : facts.aliveTransitions()) {
            if (t.beforeFriendly() == a && t.beforeEnemy() == b
                    && t.afterFriendly() == c && t.afterEnemy() == d) {
                return true;
            }
        }
        // 关注窗口聚合前后（如 7v7 → 4v6 的窗口级描述）
        for (final EvidenceFact f : facts.facts()) {
            if (!TeamGroundingFacts.TYPE_FOCUS_WINDOW.equals(f.type())) {
                continue;
            }
            final int beforeF = intAttr(f, "beforeFriendly");
            final int beforeE = intAttr(f, "beforeEnemy");
            final int afterF = intAttr(f, "afterFriendly");
            final int afterE = intAttr(f, "afterEnemy");
            if (beforeF == a && beforeE == b && afterF == c && afterE == d) {
                return true;
            }
        }
        return false;
    }

    // ===== V4 =====

    private static void checkPositionGrounding(final TeamReviewEnvelope envelope,
                                               final List<String> units,
                                               final GroundingFacts facts,
                                               final List<FactConflict> conflicts) {
        // a) structured：claim 引用 POSITION_REGION 事实但文本宣称更多车辆在该区
        for (final TeamReviewEnvelope.Claim c : envelope.claims()) {
            for (final String id : c.evidenceIds()) {
                final EvidenceFact fact = facts.byId().get(id);
                if (fact == null || !TeamGroundingFacts.TYPE_POSITION_REGION.equals(fact.type())) {
                    continue;
                }
                final Map<String, Integer> counts = parseRegionCounts(
                        fact.attrs().getOrDefault("friendly", ""));
                for (final RegionClaim rc : parseRegionClaims(c.text())) {
                    final Integer actual = counts.get("GRID" + rc.region);
                    if (actual != null && rc.count > actual) {
                        conflicts.add(new FactConflict("V4",
                                "位置时间归属错误：陈述称「" + rc.count + "辆在 GRID" + rc.region
                                        + "」，但引用的证据 " + id + "（" + TeamGroundingFacts.formatClock(fact.timeSec())
                                        + "）该区域快照为 " + actual + " 辆。"));
                    }
                }
            }
        }
        // b) 正文：时间 + 数量/区域 与最近快照对照
        for (final String unit : units) {
            if (unit == null || unit.isBlank()) {
                continue;
            }
            for (final SegmentWithTime seg : segmentsWithTime(unit)) {
                for (final RegionClaim rc : parseRegionClaims(seg.text)) {
                    final RegionSnapshot snap = nearestSnapshot(facts, seg.time);
                    if (snap == null) {
                        continue;
                    }
                    final Integer actual = snap.friendlyCounts().get("GRID" + rc.region);
                    if (actual != null && rc.count > actual) {
                        conflicts.add(new FactConflict("V4",
                                "位置时间归属错误：正文称「" + timeText(seg.time) + "左右 "
                                        + rc.count + "辆在 GRID" + rc.region + "」，后端该时刻快照为 "
                                        + actual + " 辆（" + TeamGroundingFacts.formatClock(snap.sec()) + "）。"));
                    }
                }
                // 「全部在N区」无数量断言（三语）：区域数必须等于该时刻本方存活总数
                final int allRegion = parseRegionAll(seg.text);
                if (allRegion > 0) {
                    final RegionSnapshot snap = nearestSnapshot(facts, seg.time);
                    if (snap != null) {
                        final String region = "GRID" + allRegion;
                        final int total = snap.friendlyCounts().values().stream()
                                .mapToInt(Integer::intValue).sum();
                        final Integer actual = snap.friendlyCounts().get(region);
                        if (actual != null && total > 0 && actual < total) {
                            conflicts.add(new FactConflict("V4",
                                    "位置时间归属错误：正文称「" + timeText(seg.time) + "左右全部在 GRID"
                                            + allRegion + "」，后端该时刻快照该区只有 " + actual + " 辆（共 "
                                            + total + " 辆存活，其余在别区）。"));
                        }
                    }
                }
            }
        }
    }

    // ===== V5 =====

    private static void checkCurrentVsLastKnown(final TeamReviewEnvelope envelope,
                                                final List<String> units,
                                                final GroundingFacts facts,
                                                final List<FactConflict> conflicts) {
        // a) structured：claim 引用 LAST_KNOWN 敌方位置事实 + 当前断言短语
        for (final TeamReviewEnvelope.Claim c : envelope.claims()) {
            final boolean asserting = hasAny(c.text(), CURRENT_ASSERTION_PHRASES);
            if (!asserting) {
                continue;
            }
            for (final String id : c.evidenceIds()) {
                final EvidenceFact fact = facts.byId().get(id);
                if (fact == null || !TeamGroundingFacts.TYPE_ENEMY_POSITION.equals(fact.type())) {
                    continue;
                }
                if ("LAST_KNOWN".equals(fact.attrs().get("knowledge"))) {
                    conflicts.add(new FactConflict("V5",
                            "敌方位置断言错误：引用的证据 " + id + " 是 LAST_KNOWN（最后一次观测于 "
                                    + TeamGroundingFacts.formatClockSafe(fact.attrs().get("observedAtSec"))
                                    + "），不能写成「敌方此时就在这里/正在某区」；应写「最后一次观测在…」。"));
                }
            }
        }
        // b) 正文：敌方名 + 当前断言短语 + 时间 → 查该时刻知识状态
        for (final String unit : units) {
            if (unit == null || unit.isBlank()) {
                continue;
            }
            for (final SegmentWithTime seg : segmentsWithTime(unit)) {
                if (!hasAny(seg.text, CURRENT_ASSERTION_PHRASES)) {
                    continue;
                }
                for (final EvidenceFact enemyPos : enemyPositionFacts(facts)) {
                    if (!mentions(seg.text, enemyPos)) {
                        continue;
                    }
                    final TeamGroundingFacts.EnemyPositionSample sample =
                            nearestEnemySample(facts, enemyPos, seg.time);
                    if (sample == null || !"LAST_KNOWN".equals(sample.knowledge())) {
                        continue;
                    }
                    conflicts.add(new FactConflict("V5",
                            "敌方位置断言错误：正文称「" + timeText(seg.time) + "左右敌方 "
                                    + tankBrief(enemyPos) + " 就在这里」，后端该时刻该车为 LAST_KNOWN"
                                    + "（GRID" + sample.region() + "，上次观测 "
                                    + TeamGroundingFacts.formatClockSafe(sample.observedAtSec() == null
                                            ? "" : String.valueOf(sample.observedAtSec())) + "）。"));
                }
            }
        }
    }

    // ===== V6 =====

    private static void checkUnsupportedHardFacts(final List<String> units,
                                                  final List<FactConflict> conflicts) {
        for (final String unit : units) {
            if (unit == null || unit.isBlank()) {
                continue;
            }
            for (final String segment : splitSegments(unit)) {
                if (hasAny(segment, DOWNGRADE_MARKERS)) {
                    continue; // 已降级为战术假设表达
                }
                for (final String phrase : BANNED_HARD_FACT_PHRASES) {
                    if (segment.contains(phrase)) {
                        conflicts.add(new FactConflict("V6",
                                "无证据硬事实断言：正文出现「" + phrase + "」。当前没有 LOS / 已验证点亮 /"
                                        + "具体瞄准证据，不能作为事实；如需表达请降级为「更可能/从交换结果看/如果当时射界关系确实如此」级别，"
                                        + "或删除该句。"));
                    }
                }
            }
        }
    }

    // ===== INTERNAL LEAK（证据编号/结构化标识不得进入用户正文） =====

    private static void checkInternalLabelLeak(final TeamReviewEnvelope envelope,
                                               final List<FactConflict> conflicts) {
        final String md = nonNull(envelope.reviewMarkdown());
        if (EVIDENCE_ID_PATTERN.matcher(md).find()
                || md.contains("evidenceIds") || md.contains("primaryDiagnosis")
                || md.contains("GROUNDING FACTS")) {
            conflicts.add(new FactConflict("INTERNAL",
                    "reviewMarkdown 是用户正文，不得出现证据编号（E1xx）或 primaryDiagnosis/evidenceIds/"
                            + "GROUNDING FACTS 等内部标识；证据编号只能出现在 structured claims 字段。"));
        }
    }

    private static final Pattern EVIDENCE_ID_PATTERN = Pattern.compile("E[0-9]{2,}");

    // ===== 解析工具 =====

    private record CitedUnit(String text, List<String> ids) {
    }

    private record TimeRange(double start, double end, int startOffset, int endOffset) {
    }

    private record RegionClaim(int count, int region) {
    }

    private record SegmentWithTime(String text, double time) {
    }

    private static List<EvidenceFact> deathFacts(final GroundingFacts facts) {
        return facts.facts().stream().filter(EvidenceFact::isDeath).toList();
    }

    private static List<EvidenceFact> enemyPositionFacts(final GroundingFacts facts) {
        return facts.facts().stream()
                .filter(f -> TeamGroundingFacts.TYPE_ENEMY_POSITION.equals(f.type()))
                .toList();
    }

    /** 声明的时间窗口（值 + 偏移），供 V1b 取上下文窗口。 */
    private static List<TimeRange> findRanges(final String text) {
        final List<TimeRange> out = new ArrayList<>();
        final Matcher m1 = RANGE_CN.matcher(text);
        while (m1.find()) {
            out.add(new TimeRange(parseMinSec(m1.group(1), m1.group(2)),
                    parseMinSec(m1.group(3), m1.group(4)), m1.start(), m1.end()));
        }
        final Matcher m2 = RANGE_SEC.matcher(text);
        while (m2.find()) {
            out.add(new TimeRange(Double.parseDouble(m2.group(1)),
                    Double.parseDouble(m2.group(2)), m2.start(), m2.end()));
        }
        final Matcher m3 = RANGE_COLON.matcher(text);
        while (m3.find()) {
            out.add(new TimeRange(parseMinSec(m3.group(1), m3.group(2)),
                    parseMinSec(m3.group(3), m3.group(4)), m3.start(), m3.end()));
        }
        final Matcher m4 = RANGE_TAIL_SEC.matcher(text);
        while (m4.find()) {
            final double base = parseMinSec(m4.group(1), m4.group(2));
            final double delta = Double.parseDouble(m4.group(3));
            out.add(new TimeRange(base, base + delta, m4.start(), m4.end()));
        }
        return out;
    }

    private static List<double[]> parseRanges(final String text) {
        final List<double[]> out = new ArrayList<>();
        for (final TimeRange r : findRanges(text)) {
            out.add(new double[]{r.start, r.end});
        }
        return out;
    }

    private static String rangeText(final double[] range) {
        return TeamGroundingFacts.formatClock(range[0]) + "-" + TeamGroundingFacts.formatClock(range[1]);
    }

    /** 段内第一个时间（V2 用；分秒优先，再分，再冒号，再裸秒，再小数秒）。 */
    private static Double firstTime(final String text) {
        final Matcher ms = CN_MIN_SEC.matcher(text);
        if (ms.find()) {
            return parseMinSec(ms.group(1), ms.group(2));
        }
        final Matcher ems = EN_MIN_SEC.matcher(text);
        if (ems.find()) {
            return parseMinSec(ems.group(1), ems.group(2));
        }
        final Matcher rms = RU_MIN_SEC.matcher(text);
        if (rms.find()) {
            return parseMinSec(rms.group(1), rms.group(2));
        }
        final Matcher m = CN_MIN.matcher(text);
        if (m.find()) {
            return Double.parseDouble(m.group(1)) * 60.0;
        }
        final Matcher c = COLON_TIME.matcher(text);
        if (c.find()) {
            return parseMinSec(c.group(1), c.group(2));
        }
        final Matcher s = CN_SEC.matcher(text);
        if (s.find()) {
            return Double.parseDouble(s.group(1));
        }
        final Matcher es = EN_SEC.matcher(text);
        if (es.find()) {
            return Double.parseDouble(es.group(1));
        }
        final Matcher rs = RU_SEC.matcher(text);
        if (rs.find()) {
            return Double.parseDouble(rs.group(1));
        }
        final Matcher ds = DECIMAL_SEC.matcher(text);
        if (ds.find()) {
            return Double.parseDouble(ds.group(1));
        }
        return null;
    }

    private static double parseMinSec(final String min, final String sec) {
        return Double.parseDouble(min) * 60.0 + Double.parseDouble(sec);
    }

    private static String timeText(final double sec) {
        return TeamGroundingFacts.formatClock(sec);
    }

    /** 带时间的段：把文本按句子切开，段内第一个时间为该段时间。 */
    private static List<SegmentWithTime> segmentsWithTime(final String text) {
        final List<SegmentWithTime> out = new ArrayList<>();
        for (final String seg : splitSegments(text)) {
            final Double t = firstTime(seg);
            if (t != null) {
                out.add(new SegmentWithTime(seg, t));
            }
        }
        return out;
    }

    private static List<String> splitSegments(final String text) {
        final List<String> out = new ArrayList<>();
        final StringBuilder cur = new StringBuilder();
        for (int i = 0; i < text.length(); i++) {
            final char ch = text.charAt(i);
            cur.append(ch);
            if (ch == '。' || ch == '！' || ch == '？' || ch == '!' || ch == '?' || ch == '\n') {
                out.add(cur.toString());
                cur.setLength(0);
            }
        }
        if (!cur.isEmpty()) {
            out.add(cur.toString());
        }
        return out;
    }

    private static List<RegionClaim> parseRegionClaims(final String text) {
        final List<RegionClaim> out = new ArrayList<>();
        final Matcher m = REGION_WITH_COUNT.matcher(text);
        while (m.find()) {
            out.add(new RegionClaim(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2))));
        }
        final Matcher en = REGION_WITH_COUNT_EN.matcher(text);
        while (en.find()) {
            out.add(new RegionClaim(Integer.parseInt(en.group(1)), Integer.parseInt(en.group(2))));
        }
        final Matcher ru = REGION_WITH_COUNT_RU.matcher(text);
        while (ru.find()) {
            out.add(new RegionClaim(Integer.parseInt(ru.group(1)), Integer.parseInt(ru.group(2))));
        }
        return out;
    }

    /** 三语「全部在N区」断言：命中返回区域号；无匹配返回 -1。 */
    private static int parseRegionAll(final String text) {
        final Matcher zh = REGION_ALL.matcher(text);
        if (zh.find()) {
            return Integer.parseInt(zh.group(1));
        }
        final Matcher en = REGION_ALL_EN.matcher(text);
        if (en.find()) {
            return Integer.parseInt(en.group(1));
        }
        final Matcher ru = REGION_ALL_RU.matcher(text);
        if (ru.find()) {
            return Integer.parseInt(ru.group(1));
        }
        return -1;
    }

    private static Map<String, Integer> parseRegionCounts(final String text) {
        final Map<String, Integer> out = new java.util.LinkedHashMap<>();
        final Matcher m = GRID_COUNT.matcher(text);
        while (m.find()) {
            out.put("GRID" + m.group(1), Integer.parseInt(m.group(2)));
        }
        return out;
    }

    private static RegionSnapshot nearestSnapshot(final GroundingFacts facts, final double time) {
        RegionSnapshot best = null;
        double bestDelta = Double.MAX_VALUE;
        for (final RegionSnapshot s : facts.regionSnapshots()) {
            final double delta = Math.abs(s.sec() - time);
            if (delta < bestDelta) {
                bestDelta = delta;
                best = s;
            }
        }
        return best != null && bestDelta <= SNAPSHOT_TIME_TOLERANCE_SEC ? best : null;
    }

    private static TeamGroundingFacts.EnemyPositionSample nearestEnemySample(
            final GroundingFacts facts, final EvidenceFact enemyPos, final double time) {
        TeamGroundingFacts.EnemyPositionSample best = null;
        double bestDelta = Double.MAX_VALUE;
        for (final TeamGroundingFacts.EnemyPositionSample s : facts.enemyPositions()) {
            final Long aid = enemyPos.accountId();
            if (aid != null && s.accountId() != null && !aid.equals(s.accountId())) {
                continue;
            }
            if (aid == null && !sameName(s.nickname(), enemyPos.nickname())
                    && !sameName(s.tankName(), enemyPos.tankName())) {
                continue;
            }
            final double delta = Math.abs(s.sec() - time);
            if (delta < bestDelta) {
                bestDelta = delta;
                best = s;
            }
        }
        return best != null && bestDelta <= SNAPSHOT_TIME_TOLERANCE_SEC ? best : null;
    }

    // ===== 文本匹配工具 =====

    private static boolean mentions(final String text, final EvidenceFact f) {
        if (text == null || text.isBlank()) {
            return false;
        }
        for (final String key : mentionKeys(f)) {
            if (text.contains(key)) {
                return true;
            }
        }
        return false;
    }

    /** 玩家提及键：昵称（去下划线）+ 坦克名；大小写不敏感。 */
    private static List<String> mentionKeys(final EvidenceFact f) {
        final List<String> keys = new ArrayList<>();
        if (f.nickname() != null && !f.nickname().isBlank()) {
            final String stripped = f.nickname().replace("_", "").trim();
            keys.add(f.nickname());
            if (!stripped.isEmpty() && !stripped.equals(f.nickname())) {
                keys.add(stripped);
            }
        }
        if (f.tankName() != null && !f.tankName().isBlank()) {
            keys.add(f.tankName());
        }
        return keys;
    }

    private static boolean sameName(final String a, final String b) {
        if (a == null || b == null) {
            return false;
        }
        return a.replace("_", "").equalsIgnoreCase(b.replace("_", ""));
    }

    private static boolean hasAny(final String text, final List<String> phrases) {
        if (text == null) {
            return false;
        }
        for (final String p : phrases) {
            if (text.contains(p)) {
                return true;
            }
        }
        return false;
    }

    private static String nonNull(final String s) {
        return s == null ? "" : s;
    }

    private static String playerBrief(final EvidenceFact f) {
        return (f.nickname() == null || f.nickname().isBlank() ? "玩家" : f.nickname())
                + (f.tankName() == null || f.tankName().isBlank() ? "" : "（" + f.tankName() + "）");
    }

    private static String tankBrief(final EvidenceFact f) {
        return f.tankName() == null || f.tankName().isBlank() ? "该车" : f.tankName();
    }

    private static String factBrief(final EvidenceFact f) {
        return switch (f.type()) {
            case TeamGroundingFacts.TYPE_PLAYER_DESTROYED -> "阵亡";
            case TeamGroundingFacts.TYPE_ALIVE_TRANSITION -> "存活变化";
            default -> f.type();
        };
    }

    private static int intAttr(final EvidenceFact f, final String key) {
        try {
            return Integer.parseInt(f.attrs().getOrDefault(key, "-1"));
        } catch (final NumberFormatException e) {
            return -1;
        }
    }

    private static String transitionSummary(final GroundingFacts facts) {
        final StringBuilder sb = new StringBuilder();
        for (final AliveTransition t : facts.aliveTransitions()) {
            if (!sb.isEmpty()) {
                sb.append("；");
            }
            sb.append(t.beforeFriendly()).append("v").append(t.beforeEnemy())
                    .append(" → ").append(t.afterFriendly()).append("v").append(t.afterEnemy());
        }
        for (final EvidenceFact f : facts.facts()) {
            if (TeamGroundingFacts.TYPE_FOCUS_WINDOW.equals(f.type())) {
                final int bf = intAttr(f, "beforeFriendly");
                final int be = intAttr(f, "beforeEnemy");
                final int af = intAttr(f, "afterFriendly");
                final int ae = intAttr(f, "afterEnemy");
                if (bf >= 0 && be >= 0 && af >= 0 && ae >= 0) {
                    if (!sb.isEmpty()) {
                        sb.append("；");
                    }
                    sb.append(bf).append("v").append(be).append(" → ").append(af).append("v").append(ae)
                            .append("（窗口级）");
                }
            }
        }
        return sb.toString();
    }
}
