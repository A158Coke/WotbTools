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
 * 单走行为候选 Skill（team perspective）：把「图控 / 拖延 / 脱节」从可观测行为 + 队友获利
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

    private TeamSoloIntentSkill() {
    }

    /**
     * @param features     团队特征（阵型簇/成员移动/交火）
     * @param battle       权威结算（仅作胜负/背景，不用于窗口内获利判定）
     * @param battlePhases 战斗阶段（OPENING 边界/首次接敌；缺失时不开局图控）
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
            final List<SoloSpan> spans = soloSpans(member, phases);
            for (final SoloSpan span : spans) {
                final String intent = classify(member, span, features, opening);
                if (intent == null) {
                    continue;
                }
                if (index >= MAX_EVIDENCE) {
                    break;
                }
                final Double stationaryRatio = stationaryRatio(member, span);
                final boolean benefit = teammateBenefit(features, span, member);
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
                                "teammateBenefit", benefit ? 1.0 : 0.0,
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
        // 开局图控：OPENING 窗口已确定、span 完全在内、窗口内未接火/未阵亡
        if (opening != null
                && span.startSec() >= opening.startSec()
                && span.endSec() <= opening.endSec()
                && span.enemyPressureCount() == 0
                && !memberDeadIn(member, span)) {
            return "OPENING_MAP_CONTROL";
        }
        if (opening != null && span.startSec() < opening.endSec()) {
            // 与开局窗口重叠但不完全在内：窗口信号混合，不硬判
            return null;
        }
        final Double stationaryRatio = stationaryRatio(member, span);
        final boolean stationary = stationaryRatio != null
                && stationaryRatio >= MIN_STATIONARY_SHARE;
        final boolean pressure = span.enemyPressureCount() > 0;
        final boolean benefit = teammateBenefit(features, span, member);
        if (stationary && pressure && benefit) {
            return "SOLO_DELAY";
        }
        // moving 必须由窗口内移动证据证明：覆盖不足（null）不等于正在移动
        final boolean moving = stationaryRatio != null
                && stationaryRatio < MIN_STATIONARY_SHARE;
        final boolean pulledAway = span.distanceGrowthM() >= DISTANCE_GROWTH_M;
        final boolean whiteEaten = memberDeadIn(member, span)
                || span.damageReceived() >= DETACH_DAMAGE_RECEIVED
                || span.enemyPressureCount() >= 2;
        if (moving && pulledAway && !benefit && whiteEaten) {
            return "SOLO_DETACHED";
        }
        return null;
    }

    private static String summary(final String intent, final SoloSpan span,
                                  final TeamMemberFeatureSet member) {
        return switch (intent) {
            case "OPENING_MAP_CONTROL" -> "开局图控：%s 在开局散开拿视野（距主力簇 %.0fm）"
                    .formatted(member.nickname(), span.maxDistanceM());
            case "SOLO_DELAY" -> "单走拖延候选：%s 静止卡点/守点且有敌情压力，队友获利（%.0fs，距主力簇 %.0fm）"
                    .formatted(member.nickname(), span.durationSec(), span.maxDistanceM());
            case "SOLO_DETACHED" -> "单走脱节候选：%s 持续拉大距离且无队友获利（%.0fs，距主力簇 %.0fm）"
                    .formatted(member.nickname(), span.durationSec(), span.maxDistanceM());
            default -> "单走候选：%s".formatted(member.nickname());
        };
    }

    private static boolean memberDeadIn(final TeamMemberFeatureSet member, final SoloSpan span) {
        return !member.survived() && member.deathTimeSec() != null
                && member.deathTimeSec() >= span.startSec()
                && member.deathTimeSec() <= span.endSec();
    }

    /** 每名成员：把连续「非主力簇且距离 ≥150m」的 15s 窗口合并为单走时段。 */
    private static List<SoloSpan> soloSpans(final TeamMemberFeatureSet member,
                                            final List<TeamFormationPhase> phases) {
        final List<SoloSpan> spans = new ArrayList<>();
        SoloSpan current = null;
        for (final TeamFormationPhase phase : phases) {
            final WindowInfo info = windowInfo(member, phase);
            if (info.solo()) {
                current = current == null
                        ? new SoloSpan(phase.startTime(), phase.endTime(), info)
                        : current.extend(phase.endTime(), info);
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

    private static WindowInfo windowInfo(final TeamMemberFeatureSet member,
                                         final TeamFormationPhase phase) {
        final TeamFormationCluster main = mainClusterOf(phase);
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
                main.centroidZ(),
                engagementCount(member, phase.startTime(), phase.endTime()),
                engagementDamage(member, phase.startTime(), phase.endTime()));
    }

    private static int engagementCount(final TeamMemberFeatureSet member,
                                       final float start, final float end) {
        int count = 0;
        for (final EngagementSummary engagement : member.engagements()) {
            if (engagement.startTime() <= end && engagement.endTime() >= start) {
                count += engagement.enemyAccountIds().size();
            }
        }
        return count;
    }

    private static float engagementDamage(final TeamMemberFeatureSet member,
                                          final float start, final float end) {
        float damage = 0f;
        for (final EngagementSummary engagement : member.engagements()) {
            if (engagement.startTime() <= end && engagement.endTime() >= start) {
                damage += engagement.damageReceived();
            }
        }
        return damage;
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
        if (covered <= 0f) {
            return null;
        }
        return (double) stationary / covered;
    }

    /**
     * 队友获利（时间边界 = 当前 span）：主力质心在 span 内位移 ≥ 阈值 /
     * span 内其他成员存在有利交火；span 内其他本队成员阵亡则视为未获利。
     * 整场击杀/占点分不参与（无法归属到窗口）。
     */
    private static boolean teammateBenefit(final TeamBattleFeatureSet features,
                                           final SoloSpan span,
                                           final TeamMemberFeatureSet soloMember) {
        if (otherFriendlyDied(features, span, soloMember)) {
            return false;
        }
        if (span.mainCentroidDisplacementM() >= TEAMMATE_BENEFIT_ROTATION_M) {
            return true;
        }
        for (final TeamMemberFeatureSet member : features.members()) {
            if (member.accountId() == soloMember.accountId()) {
                continue;
            }
            for (final EngagementSummary engagement : member.engagements()) {
                if (engagement.startTime() <= span.endSec()
                        && engagement.endTime() >= span.startSec()
                        && engagement.outcome() == EngagementOutcome.FAVORABLE) {
                    return true;
                }
            }
        }
        return false;
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

    /** 单走时段聚合：窗口序列 + 距离趋势 + 主力质心位移。 */
    private static final class SoloSpan {
        private final float startSec;
        private final float endSec;
        private final List<WindowInfo> windows = new ArrayList<>();

        SoloSpan(final float startSec, final float endSec, final WindowInfo window) {
            this.startSec = startSec;
            this.endSec = endSec;
            this.windows.add(window);
        }

        SoloSpan extend(final float endSec, final WindowInfo window) {
            final SoloSpan extended = new SoloSpan(startSec, endSec, windows);
            extended.windows.add(window);
            return extended;
        }

        private SoloSpan(final float startSec, final float endSec,
                         final List<WindowInfo> windows) {
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

        int enemyPressureCount() {
            return windows.stream().mapToInt(WindowInfo::enemyPressureCount).sum();
        }

        float damageReceived() {
            return windows.stream().map(WindowInfo::damageReceived).reduce(0f, Float::sum);
        }
    }

    private record WindowInfo(
            boolean solo,
            float distanceM,
            int region,
            float mainCentroidX,
            float mainCentroidZ,
            int enemyPressureCount,
            float damageReceived
    ) {
        static final WindowInfo NOT_SOLO = new WindowInfo(false, 0f, 0, 0f, 0f, 0, 0f);
    }

    private record OpeningWindow(float startSec, float endSec) {
    }
}
