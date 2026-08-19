package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.BattlePhaseType;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.MovementType;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamFormationCluster;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.map.MapTacticalSemantics;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 空间分离证据 Skill（team perspective，Backend Evidence Boundary）。
 * <p>只输出【确定性派生证据】：某成员在一段时间内与主要友军集群保持空间分离的结构事实
 * （距离、距离增长、静止占比、移动覆盖、局部敌情数量、窗口内承伤/输出、阵亡、主力簇位移、
 * 其他队友窗口内活动）。<b>不输出任何战术判断</b>——「拖延 / 脱节 / 有效牵制 / 图控 / 拿视野 /
 * 队友是否获利」都是 LLM 基于这些事实做出的 supported tactical inference，不是 Backend label。</p>
 * <p>{@code OPENING_SPREAD} 仅表示「开局阶段队伍形成了空间分离结构」（中性结构分类），
 * 不表达地图信息收益/拿视野/点亮/战术对错。</p>
 * <p>时间口径：所有信号（接火、承伤、阵亡、队友活动）只使用与当前分离窗口重叠的证据；
 * 整场结算（击杀、占点分、最终存活）不作为局部窗口依据。</p>
 * <p>主力簇：每个 15s 窗口先确定全局最大簇；平票不判；主力簇成员不产生分离候选，
 * 非主力簇仅当明显小于主力簇（人数差 ≥ {@link #MAIN_CLUSTER_DOMINANCE}）且距离达标时进入候选。</p>
 */
public final class TeamSeparationEvidenceSkill {

    /**
     * 与主力簇质心距离 ≥ 该值视为空间分离（与 RouteSkill 分离窗口同口径）。
     */
    public static final float SEPARATION_DISTANCE_M = 150f;
    /**
     * 静止判定速度上限（canonical 米/秒）。
     */
    public static final float STATIONARY_SPEED_MPS = 1.0f;
    /**
     * 移动覆盖门控：窗口内被移动证据覆盖时长占比低于该值时移动状态视为 UNKNOWN。
     */
    public static final float MIN_MOVEMENT_COVERAGE_RATIO = 0.5f;
    /**
     * 距离增长阈值（canonical 米），作为「持续拉大」信号（仅事实，非判定）。
     */
    public static final float DISTANCE_GROWTH_M = 20f;
    /**
     * 非主力簇相对主力簇的最小人数差（明显小于才算分离）。
     */
    public static final int MAIN_CLUSTER_DOMINANCE = 2;
    /**
     * 事件流观测伤害与权威结算不一致：伤害/交火事件覆盖不完整，否定判断（“没有观察到事件”）不可靠。
     */
    public static final String OBSERVED_DAMAGE_IS_PARTIAL = "OBSERVED_DAMAGE_IS_PARTIAL";

    private static final int MAX_EVIDENCE = 6;
    /**
     * span 连续性容差：相邻 formation window 间隔超过该值视为缺窗口，禁止跨缺口合并。
     */
    static final float SPAN_CONTINUITY_EPSILON_SEC = 0.01f;

    private TeamSeparationEvidenceSkill() {
    }

    /**
     * @param features     团队特征（阵型簇/成员移动/交火）
     * @param battle       权威结算（仅作胜负/背景，不用于窗口内获利判定）
     * @param battlePhases 战斗阶段（OPENING 边界/首次接敌；缺失时不出开局分散候选）
     * @param mapSemantics 地图语义（占领点区域；可为 UNKNOWN）
     */
    public static List<AiEvidence> detect(
            final TeamBattleFeatureSet features,
            final Battle battle,
            final List<BattlePhaseSummary> battlePhases,
            final MapTacticalSemantics mapSemantics) {
        if (features == null || features.members() == null || features.members().isEmpty()) {
            return List.of();
        }
        final List<TeamFormationPhase> phases = features.formationPhases() == null
                ? List.of() : new ArrayList<>(features.formationPhases());
        phases.sort(Comparator.comparingDouble(TeamFormationPhase::startTime));
        final OpeningWindow opening = openingWindow(battlePhases);
        final Set<String> controlPointRegions = controlPointRegions(mapSemantics);
        final List<AiEvidence> result = new ArrayList<>();
        int index = 0;
        for (final TeamMemberFeatureSet member : features.members()) {
            final List<SeparationSpan> spans = separationSpans(member, phases, features.members());
            for (final SeparationSpan span : spans) {
                final String kind = kindOf(span, opening, member, features);
                if (kind == null) {
                    continue;
                }
                if (index >= MAX_EVIDENCE) {
                    break;
                }
                final Double stationaryRatio = stationaryRatio(member, span);
                final int objectiveProximity = objectiveProximity(span.regionInfo().region(),
                        controlPointRegions, mapSemantics);
                final int[] otherActivity = otherFriendlyActivity(features, span, member);
                result.add(new AiEvidence(
                        String.format("SS_%02d", ++index),
                        EvidenceType.SPATIAL_SEPARATION,
                        span.startSec(),
                        span.endSec(),
                        List.of(),
                        numbers(member, span, stationaryRatio, objectiveProximity, otherActivity),
                        java.util.Map.of(
                                "kind", kind,
                                "phase", phaseOf(battlePhases, span.startSec()),
                                "movementState", movementState(stationaryRatio),
                                "region", "GRID_REGION_" + span.regionInfo().region()),
                        DecodeConfidence.PARTIAL,
                        EvidencePriority.IMPORTANT,
                        EvidenceProvenance.RECONSTRUCTION_INFERRED,
                        summary(kind, member, span, stationaryRatio, otherActivity)));
            }
        }
        return List.copyOf(result);
    }

    /**
     * 确定性测量：全部是事实，不包含任何战术结论。
     */
    private static java.util.Map<String, Double> numbers(
            final TeamMemberFeatureSet member,
            final SeparationSpan span,
            final Double stationaryRatio,
            final int objectiveProximity,
            final int[] otherActivity) {
        final java.util.Map<String, Double> out = new java.util.HashMap<>();
        out.put("distanceM", (double) span.maxDistanceM());
        out.put("distanceGrowthM", (double) span.distanceGrowthM());
        out.put("stationaryRatio", stationaryRatio == null ? -1.0 : stationaryRatio);
        out.put("mainClusterDisplacementM", (double) span.mainCentroidDisplacementM());
        out.put("observedEnemyNearby", (double) span.enemyPressureCount());
        out.put("damageReceivedDuringSpan", (double) span.damageReceived());
        out.put("damageDealtDuringSpan", (double) span.damageDealt());
        out.put("deathDuringSpan", memberDeadIn(member, span) ? 1.0 : 0.0);
        out.put("objectiveProximity", (double) objectiveProximity);
        out.put("otherFriendlyDeathsDuringSpan", (double) otherActivity[0]);
        out.put("otherFriendlyEngagementCountDuringSpan", (double) otherActivity[1]);
        out.put("otherFriendlyDamageDealtDuringSpan", (double) otherActivity[2]);
        out.put("otherFriendlyDamageReceivedDuringSpan", (double) otherActivity[3]);
        return java.util.Collections.unmodifiableMap(out);
    }

    /**
     * 中性结构分类（不是战术 verdict）：
     * <ul>
     *   <li>{@code OPENING_SPREAD}：开局窗口内、未接火未阵亡的空间分离结构（中性）；</li>
     *   <li>{@code SEPARATION_WINDOW}：其余有效分离窗口（只给事实，不判拖延/脱节）；</li>
     *   <li>{@code null}：与开局窗口部分重叠（信号混合）或交火无法可靠归属（覆盖不足），不硬出。</li>
     * </ul>
     */
    private static String kindOf(
            final SeparationSpan span,
            final OpeningWindow opening,
            final TeamMemberFeatureSet member,
            final TeamBattleFeatureSet features) {
        // 开局分散（中性 signal）：OPENING 窗口已确定、span 完全在内、窗口内未接火/未阵亡
        // ——只证明位置/队形分离事实，不证明拿视野/图控/点亮/侦察
        if (opening != null
                && span.startSec() >= opening.startSec()
                && span.endSec() <= opening.endSec()
                && span.enemyPressureCount() == 0
                && !memberDeadIn(member, span)
                && !span.hasPartialOverlapEngagement()
                && !observedDamageIsPartial(features)) {
            return "OPENING_SPREAD";
        }
        if (opening != null && span.startSec() < opening.endSec()) {
            // 与开局窗口重叠但不完全在内：窗口信号混合，不硬判
            return null;
        }
        if (span.hasPartialOverlapEngagement()) {
            // 分离成员自身存在与 span 部分重叠的交火：压力/承伤无法可靠归属，
            // 不得依靠其他信号（移动/距离/阵亡/承伤）硬生成任何结论。
            return null;
        }
        // 有效分离窗口：输出事实，战术解释交给 LLM
        return "SEPARATION_WINDOW";
    }

    private static String summary(final String kind, final TeamMemberFeatureSet member,
                                  final SeparationSpan span, final Double stationaryRatio,
                                  final int[] otherActivity) {
        final String stationary = stationaryRatio == null
                ? "移动覆盖不足" : String.format("静止占比 %.0f%%", stationaryRatio * 100);
        return switch (kind) {
            case "OPENING_SPREAD" -> ("开局分散：%s 在开局阶段与主力保持明显距离（与主力相距约 %.0fm）；"
                    + "只反映空间分离结构，是否获得额外敌方信息需结合后续敌方已知状态与接敌情况判断")
                    .formatted(member.nickname(), span.maxDistanceM());
            case "SEPARATION_WINDOW" -> ("空间分离：%s 在 %s 与主要友军集群保持 ≥%.0fm 距离（最大 %.0fm），%s；"
                    + "观察到附近敌军至少 %d 辆，窗口内承伤 %.0f / 输出 %.0f，主力簇位移 %.0fm，"
                    + "其他队友阵亡 %d 辆——战术含义需综合判断")
                    .formatted(member.nickname(), battleRange(span.startSec(), span.endSec()),
                            SEPARATION_DISTANCE_M, span.maxDistanceM(), stationary,
                            span.enemyPressureCount(), span.damageReceived(), span.damageDealt(),
                            span.mainCentroidDisplacementM(), otherActivity[0]);
            default -> "空间分离：%s".formatted(member.nickname());
        };
    }

    /**
     * battle-relative 秒 → X分XX秒（与 PlayerAnalysisTerms 同口径的本地格式化）。
     */
    private static String battleRange(final float startSec, final float endSec) {
        return battleClock(startSec) + "-" + battleClock(endSec);
    }

    private static String battleClock(final float sec) {
        final int total = (int) Math.max(0, Math.round(sec));
        return (total / 60) + "分" + String.format("%02d", total % 60) + "秒";
    }

    private static boolean memberDeadIn(final TeamMemberFeatureSet member, final SeparationSpan span) {
        return !member.survived() && member.deathTimeSec() != null
                && member.deathTimeSec() >= span.startSec()
                && member.deathTimeSec() <= span.endSec();
    }

    /**
     * 每名成员：把连续「非主力簇且距离 ≥150m」的 15s 窗口合并为分离时段。
     */
    private static List<SeparationSpan> separationSpans(final TeamMemberFeatureSet member,
                                                        final List<TeamFormationPhase> phases,
                                                        final List<TeamMemberFeatureSet> allMembers) {
        final List<SeparationSpan> spans = new ArrayList<>();
        SeparationSpan current = null;
        for (final TeamFormationPhase phase : phases) {
            final WindowInfo info = windowInfo(member, phase, allMembers);
            if (info.separated()) {
                if (current == null) {
                    current = new SeparationSpan(member, phase.startTime(), phase.endTime(), info);
                } else if (phase.startTime() <= current.endSec() + SPAN_CONTINUITY_EPSILON_SEC
                        && phase.startTime() >= current.endSec() - SPAN_CONTINUITY_EPSILON_SEC) {
                    current = current.extend(phase.endTime(), info);
                } else {
                    spans.add(current);
                    current = new SeparationSpan(member, phase.startTime(), phase.endTime(), info);
                }
            } else if (current != null) {
                spans.add(current);
                current = null;
            }
        }
        if (current != null) {
            spans.add(current);
        }
        return spans;
    }

    /**
     * 全局主力簇：窗口内人数最多的簇；平票返回 null（不硬判）。
     */
    static TeamFormationCluster mainClusterOf(final TeamFormationPhase phase) {
        if (phase == null || phase.clusters() == null || phase.clusters().isEmpty()) {
            return null;
        }
        TeamFormationCluster main = null;
        for (final TeamFormationCluster cluster : phase.clusters()) {
            if (main == null || cluster.memberCount() > main.memberCount()) {
                main = cluster;
            }
        }
        if (main == null) {
            return null;
        }
        for (final TeamFormationCluster cluster : phase.clusters()) {
            if (cluster != main && cluster.memberCount() == main.memberCount()) {
                return null;
            }
        }
        return main;
    }

    /**
     * 全局主力簇（观测门控版）：只有观测成员数达到该时刻应存活成员数时才承认全局主力。
     */
    static TeamFormationCluster mainClusterOf(final TeamFormationPhase phase,
                                              final int expectedAliveMembers) {
        if (expectedAliveMembers <= 0 || phase == null
                || phase.observedMemberCount() < expectedAliveMembers) {
            return null;
        }
        return mainClusterOf(phase);
    }

    private static WindowInfo windowInfo(final TeamMemberFeatureSet member,
                                         final TeamFormationPhase phase,
                                         final List<TeamMemberFeatureSet> allMembers) {
        final TeamFormationCluster main = mainClusterOf(
                phase, expectedAliveMembers(allMembers, phase));
        if (main == null) {
            return WindowInfo.NOT_SEPARATED;
        }
        final String memberKey = identityKey(member);
        TeamFormationCluster memberCluster = null;
        for (final TeamFormationCluster cluster : phase.clusters()) {
            if (cluster.memberIdentities().contains(memberKey)) {
                memberCluster = cluster;
                break;
            }
        }
        if (memberCluster == null || memberCluster == main) {
            // 主力簇成员：不产生分离候选
            return WindowInfo.NOT_SEPARATED;
        }
        if (main.memberCount() < memberCluster.memberCount() + MAIN_CLUSTER_DOMINANCE) {
            // 非主力簇未明显小于主力簇：不是分离
            return WindowInfo.NOT_SEPARATED;
        }
        final float distance = distance(
                memberCluster.centroidX(), memberCluster.centroidZ(),
                main.centroidX(), main.centroidZ());
        if (distance < SEPARATION_DISTANCE_M) {
            return WindowInfo.NOT_SEPARATED;
        }
        return new WindowInfo(
                true,
                distance,
                memberCluster.centroid().region(),
                main.centroidX(),
                main.centroidZ());
    }

    /**
     * 该 phase 开始时应当存活的成员数（死亡时刻未知或晚于 phase 开始视为存活）。
     */
    private static int expectedAliveMembers(final List<TeamMemberFeatureSet> members,
                                            final TeamFormationPhase phase) {
        int alive = 0;
        for (final TeamMemberFeatureSet member : members) {
            final Double deathTimeSec = member.deathTimeSec();
            if (deathTimeSec == null || !Double.isFinite(deathTimeSec)
                    || deathTimeSec > phase.startTime()) {
                alive++;
            }
        }
        return alive;
    }

    /**
     * 静止占比：时段内移动段重叠部分中「静止/低速」的占比；无覆盖返回 null。
     */
    private static Double stationaryRatio(final TeamMemberFeatureSet member,
                                          final SeparationSpan span) {
        float covered = 0f;
        float stationary = 0f;
        for (final MovementSegment segment : member.movements()) {
            final float overlapStart = Math.max(segment.startTime(), span.startSec());
            final float overlapEnd = Math.min(segment.endTime(), span.endSec());
            if (overlapEnd <= overlapStart) {
                continue;
            }
            final float duration = overlapEnd - overlapStart;
            covered += duration;
            if (segment.type() == MovementType.STATIONARY
                    || segment.averageSpeed() < STATIONARY_SPEED_MPS) {
                stationary += duration;
            }
        }
        final float spanDuration = span.durationSec();
        if (covered <= 0f || spanDuration <= 0f
                || covered / spanDuration < MIN_MOVEMENT_COVERAGE_RATIO) {
            return null;
        }
        return (double) stationary / covered;
    }

    /**
     * 其他队友窗口内确定性活动（时间边界 = 当前 span，只统计完全位于 span 内的交火）：
     * [0]=阵亡数, [1]=完全包含的交火数, [2]=输出合计, [3]=承伤合计。
     * 只输出可证明信号，不判断「队友是否获利」。
     */
    private static int[] otherFriendlyActivity(final TeamBattleFeatureSet features,
                                               final SeparationSpan span,
                                               final TeamMemberFeatureSet soloMember) {
        int deaths = 0;
        int engagements = 0;
        float dealt = 0f;
        float received = 0f;
        for (final TeamMemberFeatureSet member : features.members()) {
            if (member.accountId() == soloMember.accountId()) {
                continue;
            }
            if (!member.survived() && member.deathTimeSec() != null
                    && member.deathTimeSec() >= span.startSec()
                    && member.deathTimeSec() <= span.endSec()) {
                deaths++;
            }
            for (final EngagementSummary engagement : member.engagements()) {
                if (fullyContained(engagement, span.startSec(), span.endSec())) {
                    engagements++;
                    dealt += engagement.damageDealt();
                    received += engagement.damageReceived();
                }
            }
        }
        return new int[]{deaths, engagements, (int) dealt, (int) received};
    }

    /**
     * 事件流观测伤害覆盖不完整时，否定判断（“没有观察到队友活动/交火”）不可靠。
     */
    private static boolean observedDamageIsPartial(final TeamBattleFeatureSet features) {
        return features.limitations() != null
                && features.limitations().contains(OBSERVED_DAMAGE_IS_PARTIAL);
    }

    private static OpeningWindow openingWindow(final List<BattlePhaseSummary> battlePhases) {
        if (battlePhases == null || battlePhases.isEmpty()) {
            return null;
        }
        for (final BattlePhaseSummary phase : battlePhases) {
            if (phase.type() == BattlePhaseType.OPENING) {
                return new OpeningWindow(phase.startTime(), phase.endTime());
            }
        }
        return null;
    }

    /**
     * 阶段标签（OPENING / MID_GAME / END_GAME / UNKNOWN）：按窗口起点所属阶段。
     */
    private static String phaseOf(final List<BattlePhaseSummary> battlePhases, final float sec) {
        if (battlePhases == null) {
            return "UNKNOWN";
        }
        for (final BattlePhaseSummary phase : battlePhases) {
            if (sec >= phase.startTime() && sec <= phase.endTime()) {
                return phase.type().name();
            }
        }
        return "UNKNOWN";
    }

    private static String movementState(final Double stationaryRatio) {
        if (stationaryRatio == null) {
            return "UNKNOWN";
        }
        return stationaryRatio >= 0.6 ? "STATIONARY" : "MOVING";
    }

    /**
     * 地图语义中占领点/战略点覆盖的九宫格区域（GRID_REGION_N 的数字部分）。
     */
    public static Set<String> controlPointRegions(final MapTacticalSemantics semantics) {
        final Set<String> regions = new LinkedHashSet<>();
        if (semantics == null || !semantics.hasSemantics()) {
            return regions;
        }
        for (final MapTacticalSemantics.TacticalRelationship relation : semantics.relationships()) {
            if (!"CONTAINS_CONTROL_POINT".equals(relation.type())
                    && !"CONTAINS_STRATEGIC_POINT".equals(relation.type())) {
                continue;
            }
            final MapTacticalSemantics.TacticalArea area = semantics.areas().get(relation.from());
            if (area == null) {
                continue;
            }
            for (final String region : area.gridRegions()) {
                if (region.startsWith("GRID_REGION_")) {
                    regions.add(region.substring("GRID_REGION_".length()));
                }
            }
        }
        return regions;
    }

    /**
     * 目标点关系三态：1=邻近 / 0=已知不在 / -1=未知（region 缺失或无语义）。
     */
    private static int objectiveProximity(final int region,
                                          final Set<String> controlPointRegions,
                                          final MapTacticalSemantics semantics) {
        if (region <= 0 || controlPointRegions.isEmpty()) {
            return -1;
        }
        return controlPointRegions.contains(String.valueOf(region)) ? 1 : 0;
    }

    private static String identityKey(final TeamMemberFeatureSet member) {
        return member.accountId() > 0
                ? "account:" + member.accountId()
                : "nickname:" + member.nickname();
    }

    private static float distance(final float x1, final float z1,
                                  final float x2, final float z2) {
        final float dx = x1 - x2;
        final float dz = z1 - z2;
        return (float) Math.sqrt(dx * dx + dz * dz);
    }

    /**
     * 交火段是否完全位于 [startSec, endSec] 内：只有完全包含才允许把整段总量归属到局部窗口。
     */
    private static boolean fullyContained(final EngagementSummary engagement,
                                          final float startSec, final float endSec) {
        return engagement.startTime() >= startSec - SPAN_CONTINUITY_EPSILON_SEC
                && engagement.endTime() <= endSec + SPAN_CONTINUITY_EPSILON_SEC;
    }

    /**
     * 分离时段聚合：窗口序列 + 距离趋势 + 主力质心位移。
     */
    private static final class SeparationSpan {
        private final TeamMemberFeatureSet member;
        private final float startSec;
        private final float endSec;
        private final List<WindowInfo> windows = new ArrayList<>();

        SeparationSpan(final TeamMemberFeatureSet member, final float startSec,
                       final float endSec, final WindowInfo window) {
            this.member = member;
            this.startSec = startSec;
            this.endSec = endSec;
            this.windows.add(window);
        }

        SeparationSpan extend(final float endSec, final WindowInfo window) {
            final SeparationSpan extended = new SeparationSpan(member, startSec, endSec, windows);
            extended.windows.add(window);
            return extended;
        }

        private SeparationSpan(final TeamMemberFeatureSet member, final float startSec,
                               final float endSec, final List<WindowInfo> windows) {
            this.member = member;
            this.startSec = startSec;
            this.endSec = endSec;
            this.windows.addAll(windows);
        }

        float startSec() {
            return startSec;
        }

        float endSec() {
            return endSec;
        }

        float durationSec() {
            return endSec - startSec;
        }

        float maxDistanceM() {
            return windows.stream().map(WindowInfo::distanceM).max(Float::compare).orElse(0f);
        }

        float distanceGrowthM() {
            if (windows.size() < 2) {
                return 0f;
            }
            return windows.getLast().distanceM() - windows.getFirst().distanceM();
        }

        float mainCentroidDisplacementM() {
            if (windows.size() < 2) {
                return 0f;
            }
            final WindowInfo first = windows.getFirst();
            final WindowInfo last = windows.getLast();
            return distance(first.mainCentroidX(), first.mainCentroidZ(),
                    last.mainCentroidX(), last.mainCentroidZ());
        }

        WindowInfo regionInfo() {
            return windows.getLast();
        }

        /**
         * 窗口内敌情数量：只统计完全位于 span 内的 engagements（部分重叠不可可靠归属，禁止整段计入）。
         */
        int enemyPressureCount() {
            final Set<Long> enemies = new LinkedHashSet<>();
            for (final EngagementSummary engagement : member.engagements()) {
                if (fullyContained(engagement, startSec, endSec)) {
                    enemies.addAll(engagement.enemyAccountIds());
                }
            }
            return enemies.size();
        }

        /**
         * 窗口内承伤：只统计完全位于 span 内的 engagements（部分重叠禁止整段计入）。
         */
        float damageReceived() {
            float damage = 0f;
            for (final EngagementSummary engagement : member.engagements()) {
                if (fullyContained(engagement, startSec, endSec)) {
                    damage += engagement.damageReceived();
                }
            }
            return damage;
        }

        /**
         * 窗口内输出：只统计完全位于 span 内的 engagements（部分重叠禁止整段计入）。
         */
        float damageDealt() {
            float damage = 0f;
            for (final EngagementSummary engagement : member.engagements()) {
                if (fullyContained(engagement, startSec, endSec)) {
                    damage += engagement.damageDealt();
                }
            }
            return damage;
        }

        /**
         * 是否存在与 span 相交但不完全包含的交火：无法可靠归属，禁止据此下结论。
         */
        boolean hasPartialOverlapEngagement() {
            for (final EngagementSummary engagement : member.engagements()) {
                if (intersects(engagement, startSec, endSec)
                        && !fullyContained(engagement, startSec, endSec)) {
                    return true;
                }
            }
            return false;
        }

    }

    /**
     * 交火段是否与 [startSec, endSec] 相交（含端点）。
     */
    private static boolean intersects(final EngagementSummary engagement,
                                      final float startSec, final float endSec) {
        return engagement.startTime() <= endSec && engagement.endTime() >= startSec;
    }

    private record WindowInfo(
            boolean separated,
            float distanceM,
            int region,
            float mainCentroidX,
            float mainCentroidZ
    ) {
        static final WindowInfo NOT_SEPARATED = new WindowInfo(false, 0f, 0, 0f, 0f);
    }

    private record OpeningWindow(float startSec, float endSec) {
    }
}
