package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.CanonicalMapPosition;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamEngagementSummary;
import com.wotb.core.replay.feature.TeamFormationCluster;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.util.PlayerResultFormat;
import com.wotb.core.util.PromptDataQuoter;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static com.wotb.ai.review.TeamEvidenceFormatter.format;
import static com.wotb.ai.review.TeamEvidenceFormatter.quoteData;
import static com.wotb.ai.review.TeamRosterFormatter.resolveTankClass;
import static com.wotb.ai.review.TeamRosterFormatter.resolveTankName;
import static com.wotb.ai.review.TeamRosterFormatter.structuredTankFacts;
import static com.wotb.ai.review.TeamOutcomeFormatter.appendAuthoritative;
import static com.wotb.ai.review.TeamOutcomeFormatter.appendCaptureAndPoints;
import static com.wotb.ai.review.TeamOutcomeFormatter.appendSpatialSeparationEvidence;
import static com.wotb.ai.review.TeamOutcomeFormatter.appendObserved;

/** Member, formation, engagement, and timeline evidence rendering. */
final class TeamBattleEvidenceFormatter {
    private TeamBattleEvidenceFormatter() {
    }

    /**
         * 逐成员掉血时间窗口（事件流观测子集）：把每名成员的受击 DamageEvent 聚类成窗口，
         * 输出时间范围 + 总掉血量。与 {@code OBSERVED_EVENT_SUBSET} 同一覆盖率口径：
         * {@code OBSERVED_DAMAGE_IS_PARTIAL} 时抑制数字，输出 UNAVAILABLE。
         */
    static void appendMemberDamageReceivedWindows(
            final TeamPromptBudgetWriter writer,
            final Battle battle,
            final List<TeamMemberFeatureSet> members,
            final ReplayReconstruction recon,
            final boolean suppressObservedNumbers) {
        if (members == null || members.isEmpty()) {
            return;
        }
        if (suppressObservedNumbers) {
            writer.append("\n=== MEMBER_DAMAGE_RECEIVED_WINDOWS ===\n");
            writer.append("UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)\n");
            return;
        }
        final StringBuilder rows = new StringBuilder(1024);
        for (final TeamMemberFeatureSet member : members) {
            final List<DamageWindowClusterer.DamageWindow> windows =
                    DamageWindowClusterer.receivedWindows(battle, recon, member.accountId());
            if (windows.isEmpty()) {
                continue;
            }
            rows.append("member accountId=").append(member.accountId())
                    .append(" nickname=").append(quoteData(member.nickname()))
                    .append(" damageReceivedWindows=");
            for (final DamageWindowClusterer.DamageWindow window : windows) {
                rows.append(PlayerAnalysisTerms.battleRange(window.startSec(), window.endSec()))
                        .append("掉血").append(window.totalDamage())
                        .append('/').append(window.hitCount()).append("次")
                        .append("攻击者").append(window.uniqueAttackerCount())
                        .append(window.attackersUnresolved() ? "（部分未解析）" : "")
                        .append(window.focusFireCandidate() ? "（短时多车集火证据）" : "")
                        .append(window.entryHpProven() ? "伤害/进场满血pct=" : "伤害/base满血pct=")
                        .append(window.damageVsEntryMaxHpPct() == null
                                ? "未知" : Math.round(window.damageVsEntryMaxHpPct()) + "%")
                        .append(window.criticalWindow() ? "（短窗高额伤害窗口）" : "");
            }
            rows.append('\n');
        }
        if (rows.isEmpty()) {
            return;
        }
        writer.append("\n=== MEMBER_DAMAGE_RECEIVED_WINDOWS（逐成员掉血窗口·事件流观测） ===\n");
        writer.append("注意: 每条为一名成员的掉血窗口, 观测子集, 非权威总量; 攻击者N=窗口内不同攻击者数; "
                + "只有窗口总跨度 ≤" + (int) DamageWindowClusterer.SHORT_FOCUS_WINDOW_SEC
                + " 秒、攻击者≥2 且无未解析攻击者时才标注「（短时多车集火证据）」; "
                + "攻击者=1 → 短时间集中掉血/高压掉血窗口（不是集火）; "
                + "标注「（部分未解析）」时攻击者数不完整, 不得断言集火; "
                + "链式聚类形成的大跨度窗口不得当作短时集火; "
                + "伤害/进场满血pct=窗口累计伤害/已证明进场满血量(回放受击前样本证明, 含装备/物资加成)的百分比; "
                + "伤害/base满血pct=窗口累计伤害/tankopedia 基础血量的百分比(进场满血未被证明时的 base baseline, "
                + "只是计算基准, 不是实际掉血比例; 未知则为「未知」); "
                + "仅当进场满血被证明且窗口跨度≤" + (int) DamageWindowClusterer.CRITICAL_WINDOW_SPAN_SEC
                + " 秒、伤害≥" + (int) DamageWindowClusterer.CRITICAL_HP_PCT
                + "% 已证明进场满血量才标注「（短窗高额伤害窗口）」; "
                + "数据无法证明窗口起始血量/窗口内阵亡/装备加成后的实际最大血量, 不得判定「从满血被秒杀」.\n");
        writer.append(rows.toString());
    }

    static void appendMemberFacts(
            final TeamPromptBudgetWriter writer,
            final List<TeamMemberFeatureSet> members
    ) {
        appendMemberFacts(writer, members, null);
    }

    static void appendMemberFacts(
            final TeamPromptBudgetWriter writer,
            final List<TeamMemberFeatureSet> members,
            final Map<Long, PlayerResult> playersByAccount
    ) {
        writer.append("\n=== TEAM_MEMBERS ===\n");
        for (final TeamMemberFeatureSet member : members) {
            writer.append("member accountId=" + member.accountId()
                    + " nickname=" + quoteData(member.nickname())
                    + " tank=" + quoteData(resolveTankName(member.tankId(), member.tankName()))
                    // vehicleClass / tier / nation 只来自 tankopedia 的结构化字段，不得由 tank 名称推断
                    + " vehicleClass=" + resolveTankClass(member.tankId())
                    + structuredTankFacts(member.tankId(),
                            playersByAccount == null ? null : playersByAccount.get(member.accountId()))
                    + " entityIds=" + member.entityIds()
                    + " mapping=" + PlayerAnalysisTerms.confidenceLabel(member.mappingConfidence())
                    + " finalDamage=" + member.finalDamage()
                    + " damageReceived=" + member.damageReceived()
                    + " assisted=" + member.assistedDamage()
                    + " blocked=" + member.blockedDamage()
                    + " kills=" + member.kills()
                    + " survived=" + member.survived()
                    + " deathTime=" + (member.deathTimeSec() == null
                            ? "未知" : PlayerAnalysisTerms.survivalDisplay(
                                    member.survived(), member.deathTimeSec()))
                    + "\n");
            final TeamMemberFeatureSet.DeathProximity prox = member.deathProximity();
            if (prox != null) {
                writer.append("  deathProximityMeters=" + format(prox.distanceMeters())
                        + " observedDeltaSec=" + format(prox.observedDeltaSec())
                        + " confidence=" + PlayerAnalysisTerms.confidenceLabel(prox.confidence())
                        + "\n");
            }
            if (!member.limitations().isEmpty()) {
                writer.append("  memberLimitations=" + member.limitations() + "\n");
            }
        }
    }

    static void appendMemberMovements(
            final TeamPromptBudgetWriter writer,
            final List<TeamMemberFeatureSet> members,
            final String mapCode
    ) {
        boolean hasMovements = false;
        for (final TeamMemberFeatureSet teamMemberFeatureSet : members) {
            if (!teamMemberFeatureSet.movements().isEmpty()) {
                hasMovements = true;
                break;
            }
        }
        if (!hasMovements) return;
        writer.append("\n=== MEMBER_MOVEMENTS ===\n");
        for (final TeamMemberFeatureSet member : members) {
            if (member.movements().isEmpty()) continue;
            // 必须标出归属成员：否则所有成员的移动段被打成一个匿名平铺列表，AI 无法归属
            writer.append("member accountId=" + member.accountId()
                    + " nickname=" + quoteData(member.nickname())
                    + " tank=" + quoteData(resolveTankName(member.tankId(), member.tankName()))
                    + " vehicleClass=" + resolveTankClass(member.tankId())
                    + "\n");
            // 压缩区域序列（1-9 区，与回放九宫格一致）：让 AI 一眼看到该成员的整场路线
            final List<String> regionSequence = new ArrayList<>();
            String lastRegion = null;
            for (final MovementSegment movement : member.movements()) {
                final String startRegion = regionOf(movement.rawStartPosition(), mapCode);
                if (startRegion != null && !startRegion.equals(lastRegion)) {
                    regionSequence.add(startRegion);
                    lastRegion = startRegion;
                }
                final String endRegion = regionOf(movement.rawEndPosition(), mapCode);
                if (endRegion != null && !endRegion.equals(lastRegion)) {
                    regionSequence.add(endRegion);
                    lastRegion = endRegion;
                }
            }
            if (!regionSequence.isEmpty()) {
                writer.append("  regionSequence=" + String.join("→", regionSequence) + "\n");
            }
            for (final MovementSegment movement : member.movements()) {
                final String startInfo = formatRawPosition(movement.rawStartPosition(), mapCode);
                final String endInfo = formatRawPosition(movement.rawEndPosition(), mapCode);
                writer.append("  movement[" + format(movement.startTime())
                        + "-" + format(movement.endTime()) + "]"
                        + " type=" + PlayerAnalysisTerms.movementLabel(movement.type())
                        + " distance=" + format(movement.distance())
                        + " avgSpeed=" + format(movement.averageSpeed())
                        + " start=" + startInfo
                        + " end=" + endInfo
                        + " confidence=" + PlayerAnalysisTerms.confidenceLabel(movement.confidence())
                        + "\n");
            }
        }
    }

    static void appendFormation(
            final TeamPromptBudgetWriter writer,
            final List<TeamFormationPhase> phases
    ) {
        writer.append("\n=== FORMATION_PHASES ===\n");
        for (final TeamFormationPhase phase : phases) {
            final String phasePosInfo = formatCanonicalPosition(phase.centroid());
            writer.append("formation[" + format(phase.startTime())
                    + "-" + format(phase.endTime()) + "]"
                    + " " + phasePosInfo
                    + " dispersion=" + format(phase.averageDispersion())
                    + " clusters=" + phase.clusterCount()
                    + " members=" + phase.observedMemberCount()
                    + " confidence=" + PlayerAnalysisTerms.confidenceLabel(phase.confidence())
                    + "\n");
            // Structured cluster output
            for (final TeamFormationCluster cluster : phase.clusters()) {
                writer.append("  cluster[" + format(cluster.startTime())
                        + "-" + format(cluster.endTime()) + "]"
                        + " region=" + cluster.region()
                        + " centroidXZ=(" + format(cluster.centroidX())
                        + "," + format(cluster.centroidZ()) + ")"
                        + " centroidStatus=" + cluster.centroidStatus()
                        + " clampedMemberPositions=" + cluster.clampedMemberPositionCount()
                        + " members=" + cluster.memberIdentities().stream()
                        .map(id -> PromptDataQuoter.quote(id, "?"))
                        .collect(Collectors.joining(",", "[", "]"))
                        + " memberCount=" + cluster.memberCount()
                        + " confidence=" + PlayerAnalysisTerms.confidenceLabel(cluster.confidence())
                        + "\n");
            }
        }
    }

    static void appendEngagements(
            final TeamPromptBudgetWriter writer,
            final List<TeamEngagementSummary> engagements,
            final boolean partial
    ) {
        writer.append("\n=== TEAM_ENGAGEMENTS_OBSERVED_SUBSET ===\n");
        if (partial) {
            writer.append("UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)\n");
            return;
        }
        for (final TeamEngagementSummary engagement : engagements) {
            writer.append("engagement[" + format(engagement.startTime())
                    + "-" + format(engagement.endTime()) + "]"
                    + " allies=" + engagement.alliedAccountIds()
                    + " enemies=" + engagement.enemyAccountIds()
                    + " dealtSubset=" + engagement.damageDealt()
                    + " receivedSubset=" + engagement.damageReceived()
                    + " focusedTargets=" + engagement.focusedTargetAccountIds()
                    + " targetSwitches=" + engagement.targetSwitchCount()
                    + " confidence=" + PlayerAnalysisTerms.confidenceLabel(engagement.confidence())
                    + "\n");
        }
    }

    static void appendKeyEvents(
            final TeamPromptBudgetWriter writer,
            final List<KeyBattleEvent> events
    ) {
        writer.append("\n=== KEY_EVENTS ===\n");
        for (final KeyBattleEvent event : events) {
            writer.append("event[" + format(event.clockSec()) + "]"
                    + " type=" + PlayerAnalysisTerms.keyEventLabel(event.type())
                    + " evidence=" + quoteData(event.label())
                    + " source=" + event.source()
                    + " confidence=" + PlayerAnalysisTerms.confidenceLabel(event.confidence())
                    + " entities=" + event.relatedEntityIds()
                    + "\n");
        }
    }

    static void appendBattlePhases(
            final TeamPromptBudgetWriter writer,
            final List<BattlePhaseSummary> phases,
            final Battle battle,
            final int perspectiveTeam
    ) {
        writer.append("\n=== BATTLE_PHASES ===\n");
        if (phases != null && !phases.isEmpty()) {
            writer.append(BattlePhaseTimelineSection.PHASE_SEMANTICS_NOTE);
            writer.append(BattlePhaseTimelineSection.renderTeamRows(phases));
            appendDeathTimeline(writer, battle, perspectiveTeam);
        }
    }

    static void appendDeathTimeline(
            final TeamPromptBudgetWriter writer,
            final Battle battle,
            final int perspectiveTeam
    ) {
        if (battle == null || battle.players == null) {
            return;
        }
        final List<PlayerResult> dead = battle.players.stream()
                .filter(p -> PlayerSideResolver.isValidRawTeam(p.team) && !p.survived)
                // 未知死亡时间（deathSec<=0）排到已知时间之后，绝不因 0 被排到整场最前
                .sorted(java.util.Comparator
                        .comparingDouble((PlayerResult p) -> PlayerResultFormat.deathSec(p) > 0
                                ? PlayerResultFormat.deathSec(p) : Double.MAX_VALUE)
                        .thenComparingLong(p -> p.accountId))
                .toList();
        if (dead.isEmpty()) {
            return;
        }
        writer.append("\n=== DEATH_TIMELINE（双方逐车阵亡时刻） ===\n");
        for (final PlayerResult p : dead) {
            final String side = p.team == perspectiveTeam ? "本队" : "对方";
            final double deathSec = PlayerResultFormat.deathSec(p);
            final String clock = deathSec > 0
                    ? PlayerAnalysisTerms.battleClock((float) deathSec) : "未知";
            final String suffix = deathSec > 0 ? "阵亡" : "阵亡（时刻未知）";
            writer.append(clock
                    + " " + side + " " + quoteData(p.nickname)
                    + "（" + quoteData(resolveTankName(p.tankId, p.tankName)) + "）" + suffix + "\n");
        }
    }

    static String formatCanonicalPosition(final CanonicalMapPosition pos) {
        if (pos == null) return "UNKNOWN";
        return "(" + format(pos.x()) + "," + format(pos.z()) + ")";
    }

    static String formatRawPosition(final Vector3 position, final String mapCode) {
        if (position == null) return "UNKNOWN";
        final MapCoordinateResolution res = MapRegionResolver.resolve(position.x(), position.z(), mapCode);
        if (!res.usable()) return "UNKNOWN";
        return "(" + format(res.position().x()) + "," + format(res.position().z())
                + ") r=" + res.region() + " s=" + res.status().name();
    }

    static String regionOf(final Vector3 position, final String mapCode) {
        if (position == null) return null;
        final int region = MapRegionResolver.resolveRegionFromRaw(position.x(), position.z(), mapCode);
        return region > 0 ? String.valueOf(region) : null;
    }
    static void appendOptionalDetails(
            final TeamPromptBudgetWriter writer,
            final TeamBattleFeatureSet features,
            final String analysisUnitId,
            final String mapCode,
            final Battle battle,
            final int perspectiveTeam,
            final List<String> limitations
    ) {
        writer.append("\n=== PERSPECTIVE_OPTIONAL ===\n");
        writer.append("analysisUnitId=" + quoteData(analysisUnitId) + "\n");
        if (features == null) {
            return;
        }
        appendMemberMovements(writer, features.members(), mapCode);
        appendFormation(writer, features.formationPhases());
        appendBattlePhases(writer, features.battlePhases(), battle, perspectiveTeam);
        // 覆盖不全时 Team Engagement 的 dealtSubset/receivedSubset 是事件流伤害数字：一并抑制
        appendEngagements(writer, features.engagements(),
                limitations != null && limitations.contains("OBSERVED_DAMAGE_IS_PARTIAL"));
        appendKeyEvents(writer, features.keyEvents());
        appendCaptureAndPoints(writer, battle, perspectiveTeam, mapCode);
        appendSpatialSeparationEvidence(writer, features, battle, mapCode);
    }

    static void appendHighPriorityFacts(
            final TeamPromptBudgetWriter writer,
            final TeamBattleFeatureSet features,
            final String analysisUnitId,
            final List<String> limitations,
            final Map<Long, PlayerResult> playersByAccount
    ) {
        writer.append("\n=== PERSPECTIVE_FACTS ===\n");
        writer.append("analysisUnitId=" + quoteData(analysisUnitId) + "\n");
        if (features == null) {
            writer.append("features=UNAVAILABLE\n");
            return;
        }
        appendAuthoritative(writer, features.authoritativeAggregate());
        // 使用合并后的 limitations（context + features + extra），不能只检查 features.limitations
        appendObserved(writer, features.observedAggregate(), limitations);
        appendMemberFacts(writer, features.members(), playersByAccount);
        writer.append("coverage=" + features.coverage() + "\n");
    }

}

