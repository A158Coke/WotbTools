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
 * Team Review 事实一致性 Validator（确定性，docs/current-plan.md Natural Coach 轮 §11–§15）。
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
 *   <li>引用不存在的证据编号 / 空输出。</li>
 * </ul>
 * <p>Validator 失败时不修改任何句子：由编排层把 {@link FactConflict} 反馈给 LLM 自行改写
 * （targeted rewrite → full rewrite → fail-safe），Backend 绝不代改正文（§13）。</p>
 */
public final class TeamFactualConsistencyValidator {

    /** V2 玩家阵亡时间容差（秒）。 */
    public static final double DEATH_TIME_TOLERANCE_SEC = 2.0;
    /** V1 时间窗口包含容差（秒）。 */
    public static final double WINDOW_EDGE_TOLERANCE_SEC = 1.0;
    /** V4 位置快照时间匹配容差（秒）。 */
    public static final double SNAPSHOT_TIME_TOLERANCE_SEC = 6.0;

    /** 一条校验冲突（checkId = V1..V6 / EVIDENCE / OUTPUT；message 面向 LLM 反馈，自然中文）。 */
    public record FactConflict(String checkId, String message) {
    }

    private static final Pattern CN_MIN_SEC = Pattern.compile("(\\d+)分(\\d+)秒");
    private static final Pattern CN_MIN = Pattern.compile("(\\d+)分");
    private static final Pattern CN_SEC = Pattern.compile("(\\d+)秒");
    private static final Pattern COLON_TIME = Pattern.compile("(\\d+):(\\d+)");
    private static final Pattern DECIMAL_SEC = Pattern.compile("(\\d+(?:\\.\\d+)?)s");
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
            "(\\d+)\\s*[vV对比]\\s*(\\d+)\\s*(?:变成|变为|变作|→|->|至|到)\\s*"
                    + "(\\d+)\\s*[vV对比]\\s*(\\d+)");
    // 位置断言：7辆全部在6区 / 7辆集中6区 / 全部在GRID6
    private static final Pattern REGION_WITH_COUNT = Pattern.compile(
            "(\\d+)\\s*辆(?:全部|都|几乎|基本)?\\s*(?:集中|压进|位于|在|进入|挤在)?\\s*"
                    + "(?:GRID)?(\\d+)\\s*区");
    private static final Pattern REGION_ALL = Pattern.compile(
            "全部\\s*(?:在|位于|集中到|压进)?\\s*(?:GRID)?(\\d+)\\s*区");
    private static final Pattern GRID_COUNT = Pattern.compile("GRID(\\d+)=(\\d+)");

    /** V6 无证据硬事实化表达（命中即需降级表达，否则 FAIL）。 */
    static final List<String> BANNED_HARD_FACT_PHRASES = List.of(
            "进入对方所有炮线", "进入所有炮线", "所有炮线", "具备完整LOS", "完整LOS",
            "拥有直接炮线", "直接炮线", "被掩体卡住", "卡住掩体", "掩体卡住",
            "已经点亮", "点亮了", "提供了视野", "提供视野", "侦察到了", "获得侦察收益",
            "获得了视野", "拿到了视野", "拿到视野", "对方正在瞄准", "正在瞄准",
            "无遮挡射界", "遮挡射界", "卖头", "hull-down", "HULL-DOWN", "Hull-down",
            "掩体切割", "没有掩体");

    /** 降级表达标记：同一句出现任一标记则硬事实化表达可降级放行。 */
    static final List<String> DOWNGRADE_MARKERS = List.of(
            "更可能", "从交换结果看", "如果当时", "推测", "可能", "或许", "大概",
            "射界关系确实如此", "无法确认", "不确定", "看来", "像是", "疑似");

    /** V5 当前断言短语（把 LAST_KNOWN 说成当前位置）。 */
    static final List<String> CURRENT_ASSERTION_PHRASES = List.of(
            "就在这里", "正在这里", "就在原地", "现在还在", "此刻在", "此时在", "现在还在这里", "正在原地");

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
                    "缺少主判断：必须选择且只选择一个 PRIMARY DIAGNOSIS（title + reasoning 非空）。"));
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

        checkTemporalOwnership(envelope, facts, conflicts);
        checkPlayerEventTimes(units, facts, conflicts);
        checkAliveTransitions(units, facts, conflicts);
        checkPositionGrounding(envelope, units, facts, conflicts);
        checkCurrentVsLastKnown(envelope, units, facts, conflicts);
        checkUnsupportedHardFacts(units, conflicts);
        checkInternalLabelLeak(envelope, conflicts);
        return conflicts;
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
                        conflicts.add(new FactConflict("V1",
                                "时间归属冲突：陈述声称窗口 " + rangeText(r)
                                        + "，但引用的证据 " + id + "（" + factBrief(fact) + "，"
                                        + TeamGroundingFacts.formatClock(t) + "）不在该窗口内。"));
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
                        final int from = Math.max(0, idx - 15);
                        final int to = Math.min(unit.length(), idx + key.length() + 15);
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
                // 「全部在N区」无数量断言：区域数必须等于该时刻本方存活总数
                final Matcher all = REGION_ALL.matcher(seg.text);
                while (all.find()) {
                    final RegionSnapshot snap = nearestSnapshot(facts, seg.time);
                    if (snap == null) {
                        continue;
                    }
                    final String region = "GRID" + all.group(1);
                    final int total = snap.friendlyCounts().values().stream()
                            .mapToInt(Integer::intValue).sum();
                    final Integer actual = snap.friendlyCounts().get(region);
                    if (actual != null && total > 0 && actual < total) {
                        conflicts.add(new FactConflict("V4",
                                "位置时间归属错误：正文称「" + timeText(seg.time) + "左右全部在 GRID"
                                        + all.group(1) + "」，后端该时刻快照该区只有 " + actual + " 辆（共 "
                                        + total + " 辆存活，其余在别区）。"));
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
        return out;
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
