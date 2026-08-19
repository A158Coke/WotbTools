package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.BattlePhaseType;
import com.wotb.core.replay.feature.EngagementOutcome;
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
 * 单走行为候选 Skill（team perspective）：把「开局分散 / 拖延 / 脱节」从可观测行为 + 队友获利
 * 时序关联中确定性推导为候选证据（用户 B1 口径：单走判拖延取决于队友是否因他获利）。
 * <p>只输出候选与信号数字（confidence=PARTIAL，规则候选），最终行为标签由 Call #2 结合
 * prior/战局类型判定；信号不足/矛盾/无法按时间归属时不输出结论（prompt 规则要求 AI 写「无法确定」）。</p>
 * <p>时间口径：所有信号（接火、承伤、阵亡、队友获利）只使用与当前单走窗口重叠的证据；
 * 整场结算（击杀、占点分、最终存活）不作为局部窗口依据。</p>
 * <p>主力簇：每个 15s 窗口先确定全局最大簇；平票不判；主力簇成员不产生单走候选，
 * 非主力簇仅当明显小于主力簇（人数差 ≥ {@link #MAIN_CLUSTER_DOMINANCE}）且距离达标时进入候选。</p>
 */
public final class TeamSoloIntentSkill {

    /** 与主力簇质心距离 ≥ 该值视为单走（与 RouteSkill 脱节窗口同口径）。 */
    public static final float SOLO_DISTANCE_M = 150f;
    /** 静止判定速度上限（canonical 米/秒）。 */
    public static final float STATIONARY_SPEED_MPS = 1.0f;
    /** 拖延候选要求的静止占比下限。 */
    public static final float MIN_STATIONARY_SHARE = 0.6f;
    /** 队友获利判定：主力质心位移下限（canonical 米）。 */
    public static final float TEAMMATE_BENEFIT_ROTATION_M = 30f;
    /** 脱节候选的窗口内承伤下界（无法归属到窗口时不生效）。 */
    public static final int DETACH_DAMAGE_RECEIVED = 800;
    /** 单走窗口内距离增长下限（canonical 米），用于「持续拉大」信号。 */
    public static final float DISTANCE_GROWTH_M = 20f;
    /** 非主力簇相对主力簇的最小人数差（明显小于才算单走）。 */
    public static final int MAIN_CLUSTER_DOMINANCE = 2;

    private static final int MAX_EVIDENCE = 6;
    /** 移动覆盖门控：窗口内被移动证据覆盖时长占比低于该值时移动状态视为 UNKNOWN。 */
    public static final float MIN_MOVEMENT_COVERAGE_RATIO = 0.5f;
    /** span 连续性容差：相邻 formation window 间隔超过该值视为缺窗口，禁止跨缺口合并。 */
    static final float SPAN_CONTINUITY_EPSILON_SEC = 0.01f;
    /** 事件流观测伤害与权威结算不一致：伤害/交火事件覆盖不完整，否定判断（“没有观察到事件”）不可靠。 */
    public static final String OBSERVED_DAMAGE_IS_PARTIAL = "OBSERVED_DAMAGE_IS_PARTIAL";

    /** 队友获利三态：TRUE=有可靠归属到 span 的获利证据；FALSE=覆盖可靠且无获利；UNKNOWN=存在无法可靠归属的部分重叠交火。 */
    private enum TeammateBenefit { TRUE, FALSE, UNKNOWN }

    private TeamSoloIntentSkill() {
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
            final List<SoloSpan> spans = soloSpans(member, phases, features.members());
            for (final SoloSpan span : spans) {
                final String intent = classify(member, span, features, opening);
                if (intent == null) {
                    continue;
                }
                if (index >= MAX_EVIDENCE) {
                    break;
                }
                final Double stationaryRatio = stationaryRatio(member, span);
                final TeammateBenefit benefit = teammateBenefit(features, span, member);
                final int objectiveProximity = objectiveProximity(span.regionInfo().region(),
                        controlPointRegions, mapSemantics);
                result.add(new AiEvidence(
                        String.format("SI_%02d", ++index),
                        EvidenceType.SOLO_INTENT,
                        span.startSec(),
                        span.endSec(),
                        List.of(),
                        java.util.Map.of(
                                "distanceM", (double) span.maxDistanceM(),
                                "stationaryRatio", stationaryRatio == null
                                        ? -1.0 : stationaryRatio,
                                "teammateBenefit", benefitNumber(benefit),
                                "objectiveProximity", (double) objectiveProximity,
                                "nearbyEnemy", (double) span.enemyPressureCount()),
                        java.util.Map.of(
                                "intent", intent,
                                "region", "GRID_REGION_" + span.regionInfo().region()),
                        DecodeConfidence.PARTIAL,
                        EvidencePriority.IMPORTANT,
                        EvidenceProvenance.RECONSTRUCTION_INFERRED,
                        summary(intent, span, member)));
            }
        }
        return List.copyOf(result);
    }

    private static String classify(
            final TeamMemberFeatureSet member,
            final SoloSpan span,
            final TeamBattleFeatureSet features,
            final OpeningWindow opening) {
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
            // 单走成员自身存在与 span 部分重叠的交火：压力/承伤无法可靠归属，
            // 不得依靠其他信号（移动/距离/阵亡/承伤）硬生成拖延或脱节。
            return null;
        }
        final Double stationaryRatio = stationaryRatio(member, span);
        final boolean stationary = stationaryRatio != null
                && stationaryRatio >= MIN_STATIONARY_SHARE;
        final boolean pressure = span.enemyPressureCount() > 0;
        final TeammateBenefit benefit = teammateBenefit(features, span, member);
        if (stationary && pressure && benefit == TeammateBenefit.TRUE) {
            return "SOLO_DELAY";
        }
        // moving 必须由窗口内移动证据证明：覆盖不足（null）不等于正在移动
        final boolean moving = stationaryRatio != null
                && stationaryRatio < MIN_STATIONARY_SHARE;
        final boolean pulledAway = span.distanceGrowthM() >= DISTANCE_GROWTH_M;
        final boolean whiteEaten = memberDeadIn(member, span)
                || span.damageReceived() >= DETACH_DAMAGE_RECEIVED
                || span.enemyPressureCount() >= 2;
        if (moving && pulledAway && benefit == TeammateBenefit.FALSE && whiteEaten) {
            return "SOLO_DETACHED";
        }
        return null;
    }

    private static String summary(final String intent, final SoloSpan span,
                                  final TeamMemberFeatureSet member) {
        return switch (intent) {
            case "OPENING_SPREAD" -> ("开局分散：%s 在开局阶段与主力保持明显距离，扩大了队伍的空间覆盖；"
                    + "实际获得多少敌方信息需结合后续敌方已知状态与接敌情况判断（与主力相距约 %.0fm）")
                    .formatted(member.nickname(), span.maxDistanceM());
            case "SOLO_DELAY" -> "单走拖延：%s 静止卡点/守点且有敌情压力，队友获利（约 %.0fs，与主力相距约 %.0fm）"
                    .formatted(member.nickname(), span.durationSec(), span.maxDistanceM());
            case "SOLO_DETACHED" -> "单走脱节：%s 持续脱离主力且无队友获利（约 %.0fs，与主力相距约 %.0fm）"
                    .formatted(member.nickname(), span.durationSec(), span.maxDistanceM());
            default -> "单走：%s".formatted(member.nickname());
        };
    }

    private static boolean memberDeadIn(final TeamMemberFeatureSet member, final SoloSpan span) {
        return !member.survived() && member.deathTimeSec() != null
                && member.deathTimeSec() >= span.startSec()
                && member.deathTimeSec() <= span.endSec();
    }

    /** 每名成员：把连续「非主力簇且距离 ≥150m」的 15s 窗口合并为单走时段。 */
    private static List<SoloSpan> soloSpans(final TeamMemberFeatureSet member,
                                            final List<TeamFormationPhase> phases,
                                            final List<TeamMemberFeatureSet> allMembers) {
        final List<SoloSpan> spans = new ArrayList<>();
        SoloSpan current = null;
        for (final TeamFormationPhase phase : phases) {
            final WindowInfo info = windowInfo(member, phase, allMembers);
            if (info.solo()) {
                if (current == null) {
                    current = new SoloSpan(member, phase.startTime(), phase.endTime(), info);
                } else if (phase.startTime() <= current.endSec() + SPAN_CONTINUITY_EPSILON_SEC
                        && phase.startTime() >= current.endSec() - SPAN_CONTINUITY_EPSILON_SEC) {
                    current = current.extend(phase.endTime(), info);
                } else {
                    spans.add(current);
                    current = new SoloSpan(member, phase.startTime(), phase.endTime(), info);
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

    /** 全局主力簇：窗口内人数最多的簇；平票返回 null（不硬判）。 */
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

    /** 全局主力簇（观测门控版）：只有观测成员数达到该时刻应存活成员数时才承认全局主力。 */
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
            return WindowInfo.NOT_SOLO;
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
            // 主力簇成员：不产生单走候选
            return WindowInfo.NOT_SOLO;
        }
        if (main.memberCount() < memberCluster.memberCount() + MAIN_CLUSTER_DOMINANCE) {
            // 非主力簇未明显小于主力簇：不是单走
            return WindowInfo.NOT_SOLO;
        }
        final float distance = distance(
                memberCluster.centroidX(), memberCluster.centroidZ(),
                main.centroidX(), main.centroidZ());
        if (distance < SOLO_DISTANCE_M) {
            return WindowInfo.NOT_SOLO;
        }
        return new WindowInfo(
                true,
                distance,
                memberCluster.centroid().region(),
                main.centroidX(),
                main.centroidZ());
    }

    /** 该 phase 开始时应当存活的成员数（死亡时刻未知或晚于 phase 开始视为存活）。 */
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

    /** 静止占比：时段内移动段重叠部分中「静止/低速」的占比；无覆盖返回 null。 */
    private static Double stationaryRatio(final TeamMemberFeatureSet member,
                                          final SoloSpan span) {
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
     * 队友获利三态（时间边界 = 当前 span）：TRUE=主力质心位移 ≥ 阈值 / span 内完全包含的队友有利交火；
     * FALSE=覆盖可靠且无涉及 span 的队友交火（或 span 内本队成员阵亡）；UNKNOWN=存在与 span 部分重叠、无法可靠归属的队友交火，或伤害观测覆盖不完整（OBSERVED_DAMAGE_IS_PARTIAL）无法证明无获利。
     * 整场击杀/占点分不参与（无法归属到窗口）。
     */
    private static TeammateBenefit teammateBenefit(final TeamBattleFeatureSet features,
                                                   final SoloSpan span,
                                                   final TeamMemberFeatureSet soloMember) {
        if (otherFriendlyDied(features, span, soloMember)) {
            return TeammateBenefit.FALSE;
        }
        if (span.mainCentroidDisplacementM() >= TEAMMATE_BENEFIT_ROTATION_M) {
            return TeammateBenefit.TRUE;
        }
        boolean partialOverlap = false;
        for (final TeamMemberFeatureSet member : features.members()) {
            if (member.accountId() == soloMember.accountId()) {
                continue;
            }
            for (final EngagementSummary engagement : member.engagements()) {
                if (fullyContained(engagement, span.startSec(), span.endSec())) {
                    if (engagement.outcome() == EngagementOutcome.FAVORABLE) {
                        return TeammateBenefit.TRUE;
                    }
                } else if (intersects(engagement, span.startSec(), span.endSec())) {
                    partialOverlap = true;
                }
            }
        }
        if (partialOverlap || observedDamageIsPartial(features)) {
            // 部分重叠交火无法可靠归属，或伤害观测覆盖不完整：无法证明窗口内不存在队友获利 → UNKNOWN
            return TeammateBenefit.UNKNOWN;
        }
        return TeammateBenefit.FALSE;
    }

    /** 事件流观测伤害覆盖不完整时，否定判断（“没有观察到队友获利/交火”）不可靠。 */
    private static boolean observedDamageIsPartial(final TeamBattleFeatureSet features) {
        return features.limitations() != null
                && features.limitations().contains(OBSERVED_DAMAGE_IS_PARTIAL);
    }

    /** 队友获利的数值渲染：TRUE=1 / FALSE=0 / UNKNOWN=-1（不得把 UNKNOWN 当 false）。 */
    private static double benefitNumber(final TeammateBenefit benefit) {
        return switch (benefit) {
            case TRUE -> 1.0;
            case FALSE -> 0.0;
            case UNKNOWN -> -1.0;
        };
    }

    private static boolean otherFriendlyDied(final TeamBattleFeatureSet features,
                                             final SoloSpan span,
                                             final TeamMemberFeatureSet soloMember) {
        for (final TeamMemberFeatureSet member : features.members()) {
            if (member.accountId() == soloMember.accountId()) {
                continue;
            }
            if (!member.survived() && member.deathTimeSec() != null
                    && member.deathTimeSec() >= span.startSec()
                    && member.deathTimeSec() <= span.endSec()) {
                return true;
            }
        }
        return false;
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

    /** 地图语义中占领点/战略点覆盖的九宫格区域（GRID_REGION_N 的数字部分）。 */
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

    /** 目标点关系三态：1=邻近 / 0=已知不在 / -1=未知（region 缺失或无语义）。 */
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

    /** 交火段是否完全位于 [startSec, endSec] 内：只有完全包含才允许把整段总量归属到局部窗口。 */
    private static boolean fullyContained(final EngagementSummary engagement,
                                          final float startSec, final float endSec) {
        return engagement.startTime() >= startSec - SPAN_CONTINUITY_EPSILON_SEC
                && engagement.endTime() <= endSec + SPAN_CONTINUITY_EPSILON_SEC;
    }

    /** 交火段是否与 [startSec, endSec] 相交（含端点）。 */
    private static boolean intersects(final EngagementSummary engagement,
                                      final float startSec, final float endSec) {
        return engagement.startTime() <= endSec && engagement.endTime() >= startSec;
    }

    /** 单走时段聚合：窗口序列 + 距离趋势 + 主力质心位移。 */
    private static final class SoloSpan {
        private final TeamMemberFeatureSet member;
        private final float startSec;
        private final float endSec;
        private final List<WindowInfo> windows = new ArrayList<>();

        SoloSpan(final TeamMemberFeatureSet member, final float startSec,
                 final float endSec, final WindowInfo window) {
            this.member = member;
            this.startSec = startSec;
            this.endSec = endSec;
            this.windows.add(window);
        }

        SoloSpan extend(final float endSec, final WindowInfo window) {
            final SoloSpan extended = new SoloSpan(member, startSec, endSec, windows);
            extended.windows.add(window);
            return extended;
        }

        private SoloSpan(final TeamMemberFeatureSet member, final float startSec,
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

        /** 窗口内敌情压力：只统计完全位于 span 内的 engagements（部分重叠不可可靠归属，禁止整段计入）。 */
        int enemyPressureCount() {
            final Set<Long> enemies = new LinkedHashSet<>();
            for (final EngagementSummary engagement : member.engagements()) {
                if (fullyContained(engagement, startSec, endSec)) {
                    enemies.addAll(engagement.enemyAccountIds());
                }
            }
            return enemies.size();
        }

        /** 窗口内承伤：只统计完全位于 span 内的 engagements（部分重叠禁止整段计入）。 */
        float damageReceived() {
            float damage = 0f;
            for (final EngagementSummary engagement : member.engagements()) {
                if (fullyContained(engagement, startSec, endSec)) {
                    damage += engagement.damageReceived();
                }
            }
            return damage;
        }

        /** 是否存在与 span 相交但不完全包含的交火：无法可靠归属，禁止据此下结论。 */
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

    private record WindowInfo(
            boolean solo,
            float distanceM,
            int region,
            float mainCentroidX,
            float mainCentroidZ
    ) {
        static final WindowInfo NOT_SOLO = new WindowInfo(false, 0f, 0, 0f, 0f);
    }

    private record OpeningWindow(float startSec, float endSec) {
    }
}