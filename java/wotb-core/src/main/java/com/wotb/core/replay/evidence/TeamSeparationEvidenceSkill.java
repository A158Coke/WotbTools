package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.BattlePhaseType;
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

import static com.wotb.core.replay.evidence.SeparationWindowAnalyzer.SeparationSpan;

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

    /** 与主力簇质心距离 ≥ 该值视为空间分离（与 RouteSkill 分离窗口同口径）。 */
    public static final float SEPARATION_DISTANCE_M = SeparationThresholds.SEPARATION_DISTANCE_M;
    /** 静止判定速度上限（canonical 米/秒）。 */
    public static final float STATIONARY_SPEED_MPS = SeparationThresholds.STATIONARY_SPEED_MPS;
    /** 移动覆盖门控：窗口内被移动证据覆盖时长占比低于该值时移动状态视为 UNKNOWN。 */
    public static final float MIN_MOVEMENT_COVERAGE_RATIO = SeparationThresholds.MIN_MOVEMENT_COVERAGE_RATIO;
    /** Legacy public constant retained for source compatibility; current output reports raw distance growth. */
    public static final float DISTANCE_GROWTH_M = 20f;
    /** 非主力簇相对主力簇的最小人数差（明显小于才算分离）。 */
    public static final int MAIN_CLUSTER_DOMINANCE = SeparationWindowAnalyzer.MAIN_CLUSTER_DOMINANCE;
    /** 事件流观测伤害与权威结算不一致：伤害/交火事件覆盖不完整，否定判断（“没有观察到事件”）不可靠。 */
    public static final String OBSERVED_DAMAGE_IS_PARTIAL = "OBSERVED_DAMAGE_IS_PARTIAL";

    private static final int MAX_EVIDENCE = 6;
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
            final List<SeparationSpan> spans = SeparationWindowAnalyzer.separationSpans(member, phases, features.members());
            for (final SeparationSpan span : spans) {
                final String kind = kindOf(span, opening, member, features);
                if (kind == null) {
                    continue;
                }
                if (index >= MAX_EVIDENCE) {
                    break;
                }
                final Double stationaryRatio = SeparationWindowAnalyzer.stationaryRatio(member, span);
                final int objectiveProximity = objectiveProximity(span.regionInfo().region(),
                        controlPointRegions, mapSemantics);
                final int[] otherActivity = SeparationWindowAnalyzer.otherFriendlyActivity(features.members(), span, member);
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

    /** 确定性测量：全部是事实，不包含任何战术结论。 */
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
        out.put("deathDuringSpan", SeparationWindowAnalyzer.memberDeadIn(member, span) ? 1.0 : 0.0);
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
                && !SeparationWindowAnalyzer.memberDeadIn(member, span)
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

    /** battle-relative 秒 → X分XX秒（与 PlayerAnalysisTerms 同口径的本地格式化）。 */
    private static String battleRange(final float startSec, final float endSec) {
        return battleClock(startSec) + "-" + battleClock(endSec);
    }

    private static String battleClock(final float sec) {
        final int total = (int) Math.max(0, Math.round(sec));
        return (total / 60) + "分" + String.format("%02d", total % 60) + "秒";
    }

    /** 全局主力簇：窗口内人数最多的簇；平票返回 null（不硬判）。 */
    static TeamFormationCluster mainClusterOf(final TeamFormationPhase phase) {
        return SeparationWindowAnalyzer.mainClusterOf(phase);
    }

    /** 全局主力簇（观测门控版）：只有观测成员数达到该时刻应存活成员数时才承认全局主力。 */
    static TeamFormationCluster mainClusterOf(final TeamFormationPhase phase,
                                              final int expectedAliveMembers) {
        return SeparationWindowAnalyzer.mainClusterOf(phase, expectedAliveMembers);
    }

    /** 事件流观测伤害覆盖不完整时，否定判断（“没有观察到队友活动/交火”）不可靠。 */
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

    /** 阶段标签（OPENING / MID_GAME / END_GAME / UNKNOWN）：按窗口起点所属阶段。 */
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

    private record OpeningWindow(float startSec, float endSec) {
    }
}
