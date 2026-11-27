package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.evidence.PointsSituationSkill;
import com.wotb.core.replay.evidence.TeamSeparationEvidenceSkill;
import com.wotb.core.replay.map.MapTacticalSemantics;
import com.wotb.core.replay.map.MapTacticalSemanticsRegistry;
import com.wotb.core.replay.processing.FriendlyEnemyResult;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class PointsSituationEvidence {

    private static final MapTacticalSemanticsRegistry SEMANTICS_REGISTRY =
            MapTacticalSemanticsRegistry.load();

    private PointsSituationEvidence() {
    }

    static List<PointsSituationSkill.VehicleTrack> collectTracks(
            final Battle battle,
            final ReplayReconstruction recon
    ) {
        if (battle == null || recon == null || recon.events() == null) {
            return List.of();
        }
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        if (mapping.entitiesById().isEmpty()) {
            return List.of();
        }
        final Float battleStart = recon.battleStartRawClockSec();
        final Map<Long, List<PointsSituationSkill.PositionSample>> samplesByAccount =
                new LinkedHashMap<>();
        final Map<Long, Integer> teamByAccount = new LinkedHashMap<>();
        for (final ReplayEvent event : recon.events()) {
            if (!(event instanceof PositionChangedEvent pos)) {
                continue;
            }
            final TeamEntityIdentity identity = mapping.identity(pos.entityId());
            if (identity == null || !identity.usable() || identity.accountId() <= 0) {
                continue;
            }
            if (!Float.isFinite(pos.x()) || !Float.isFinite(pos.z())) {
                continue;
            }
            final double t = relativeSec(event, battleStart);
            if (!Double.isFinite(t) || t < 0) {
                continue;
            }
            samplesByAccount.computeIfAbsent(identity.accountId(), k -> new ArrayList<>())
                    .add(new PointsSituationSkill.PositionSample(
                            (float) t, pos.x(), pos.z()));
            teamByAccount.putIfAbsent(identity.accountId(), identity.team());
        }
        final List<PointsSituationSkill.VehicleTrack> tracks = new ArrayList<>();
        for (final Map.Entry<Long, List<PointsSituationSkill.PositionSample>> entry
                : samplesByAccount.entrySet()) {
            final List<PointsSituationSkill.PositionSample> samples = entry.getValue();
            if (samples.size() < 2) {
                continue;
            }
            samples.sort(Comparator.comparingDouble(
                    PointsSituationSkill.PositionSample::timeSec));
            final Integer team = teamByAccount.get(entry.getKey());
            if (team == null || (team != 1 && team != 2)) {
                continue;
            }
            tracks.add(new PointsSituationSkill.VehicleTrack(
                    entry.getKey(), team, samples));
        }
        return List.copyOf(tracks);
    }

    static double relativeSec(final ReplayEvent event, final Float battleStartRawClockSec) {
        if (event.timestamp() == null) {
            return 0;
        }
        final Float battle = event.timestamp().battleClockSec();
        if (battle != null) {
            return battle;
        }
        if (battleStartRawClockSec != null && Float.isFinite(battleStartRawClockSec)) {
            return event.timestamp().rawClockSec() - battleStartRawClockSec;
        }
        return event.timestamp().rawClockSec();
    }

    static String renderSection(
            final Battle battle,
            final ReplayReconstruction recon,
            final int perspectiveTeam,
            final boolean damagePartial,
            final String selfLabel,
            final String otherLabel
    ) {
        if (battle == null || battle.mapName == null
                || (perspectiveTeam != 1 && perspectiveTeam != 2)) {
            return "";
        }
        final MapTacticalSemantics semantics =
                SEMANTICS_REGISTRY.semanticsFor(battle.mapName);
        final Set<String> controlRegions =
                TeamSeparationEvidenceSkill.controlPointRegions(semantics);

        final List<PointsSituationSkill.KillPointsEvent> killTimeline =
                PointsSituationSkill.killPointsTimeline(battle);
        final List<PointsSituationSkill.VehicleTrack> tracks =
                collectTracks(battle, recon);
        final List<PointsSituationSkill.CapturePresence> presence = controlRegions.isEmpty()
                ? List.of()
                : PointsSituationSkill.capturePresence(
                        tracks, controlRegions, battle.mapName,
                        PointsSituationSkill.PRESENCE_BIN_SEC);
        final List<PointsSituationSkill.ControlRegionEntryWindow> entries = controlRegions.isEmpty()
                ? List.of()
                : PointsSituationSkill.controlRegionEntryWindows(tracks, controlRegions, battle.mapName);

        if (killTimeline.isEmpty() && presence.isEmpty() && entries.isEmpty()) {
            return "";
        }

        final StringBuilder sb = new StringBuilder(2048);
        sb.append("\n=== POINTS_SITUATION（点数局势·后端计算） ===\n");
        sb.append("实时比分/占点进度未解码：本段只给可证明信号（击杀夺分时间线、占领点区域位置存在、"
                + "控制点区域进入窗口），禁止据此编造任何中间比分或精确领先幅度；击杀夺分时间线只是击杀换分项，"
                + "不代表整体点数，禁止把击杀换分项净劣势/优势说成整体落后/领先；位置存在≠占点产分。\n");
        if (!killTimeline.isEmpty()) {
            sb.append("KILL_POINTS_TIMELINE（击杀夺分 ±").append(FriendlyEnemyResult.KILL_STEAL_POINTS)
                    .append("/击杀业务规则，按阵亡时刻对齐，叙述口径，非实时比分，不含占点基础产分）:\n");
            long selfDelta = 0;
            long otherDelta = 0;
            for (final PointsSituationSkill.KillPointsEvent event : killTimeline) {
                final boolean selfVictim = event.victimTeam() == perspectiveTeam;
                selfDelta += selfVictim
                        ? -FriendlyEnemyResult.KILL_STEAL_POINTS : FriendlyEnemyResult.KILL_STEAL_POINTS;
                otherDelta += selfVictim
                        ? FriendlyEnemyResult.KILL_STEAL_POINTS : -FriendlyEnemyResult.KILL_STEAL_POINTS;
                sb.append("  ").append(PlayerAnalysisTerms.battleClock(event.timeSec()))
                        .append(" ").append(selfVictim ? selfLabel : otherLabel)
                        .append("车辆被击毁 → ").append(selfLabel).append(" ")
                        .append(selfVictim ? "-" : "+").append(FriendlyEnemyResult.KILL_STEAL_POINTS)
                        .append(" / ").append(otherLabel).append(" ")
                        .append(selfVictim ? "+" : "-").append(FriendlyEnemyResult.KILL_STEAL_POINTS)
                        .append("（累计：").append(selfLabel).append(" ").append(selfDelta)
                        .append("，").append(otherLabel).append(" ").append(otherDelta).append("）\n");
            }
        }
        if (!presence.isEmpty()) {
            sb.append("CAPTURE_PRESENCE（占领点区域位置存在·").append((int) PointsSituationSkill.PRESENCE_BIN_SEC)
                    .append(" 秒窗·服务器位置流；位置存在 ≠ 占点产分）:\n");
            for (final PointsSituationSkill.CapturePresence bin : presence) {
                final int selfVehicles = perspectiveTeam == 1 ? bin.team1Vehicles() : bin.team2Vehicles();
                final int otherVehicles = perspectiveTeam == 1 ? bin.team2Vehicles() : bin.team1Vehicles();
                sb.append("  [").append(PlayerAnalysisTerms.battleClock(bin.startSec()))
                        .append("-").append(PlayerAnalysisTerms.battleClock(bin.endSec()))
                        .append("] ").append(selfLabel).append(" ").append(selfVehicles)
                        .append(" 车 / ").append(otherLabel).append(" ").append(otherVehicles)
                        .append(" 车\n");
            }
        }
        if (!entries.isEmpty()) {
            sb.append("CONTROL_REGION_ENTRY_WINDOWS（进入控制点区域窗口·服务器位置流；不声称进攻/抢点/防守意图）:\n");
            for (final PointsSituationSkill.ControlRegionEntryWindow entry : entries) {
                final String entryLabel = entry.team() == perspectiveTeam ? selfLabel : otherLabel;
                sb.append("  [").append(PlayerAnalysisTerms.battleClock(entry.startSec()))
                        .append("-").append(PlayerAnalysisTerms.battleClock(entry.endSec()))
                        .append("] ").append(entryLabel).append(" ").append(entry.accountIds().size())
                        .append(" 车(").append(String.join(",", entry.accountIds().stream()
                                .map(String::valueOf).toList()))
                        .append(") 目标 ").append(entry.targetRegion()).append(" 区\n");
                if (damagePartial) {
                    sb.append("    进入窗口车辆承受伤害不可用（OBSERVED_DAMAGE_IS_PARTIAL）\n");
                } else {
                    final Toll toll = tollDuring(entry, battle, recon);
                    sb.append("    进入窗口车辆承受伤害（权威掉血口径）：")
                            .append(" 总实际掉血 ").append(toll.totalDamage())
                            .append(" / 可归属敌方 ").append(toll.enemyDamage())
                            .append(" / 来源未知 ").append(toll.unknownDamage())
                            .append("\n");
                    sb.append("      其中来源未知掉血（无法归属攻击者/自伤/队伍未知）")
                            .append(toll.unknownLossCount())
                            .append(" 笔，" + "仅计入总掉血、不计入任何具体攻击者或敌方玩家\n");
                }
            }
        }
        return sb.toString();
    }

    private static Toll tollDuring(
            final PointsSituationSkill.ControlRegionEntryWindow entry,
            final Battle battle,
            final ReplayReconstruction recon
    ) {
        int total = 0;
        int enemy = 0;
        int unknownLosses = 0;
        if (recon == null || recon.events() == null || battle == null || battle.players == null) {
            return new Toll(0, 0, 0, 0);
        }
        final TeamEntityMapping mapping = DamageEventIdentityResolver.mapping(battle, recon);
        final Float battleStart = recon.battleStartRawClockSec();
        final double duration = recon.battleDurationSec() > 0
                ? recon.battleDurationSec()
                : (battle.durationS != null && battle.durationS > 0 ? battle.durationS : 0.0);
        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat =
                com.wotb.core.replay.feature.PlaybackCombatReconstruction.derive(
                        recon.events(), mapping,
                        battleStart == null ? 0.0 : battleStart.doubleValue(), duration, battle);
        final Set<Long> pusherIds = new HashSet<>(entry.accountIds());
        for (final java.util.Map.Entry<Long,
                List<com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss>> e
                : combat.lossesByVictim().entrySet()) {
            final long victim = e.getKey();
            if (!pusherIds.contains(victim)) {
                continue;
            }
            for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss loss : e.getValue()) {
                if (loss.toSec() < entry.startSec() || loss.toSec() > entry.endSec()) {
                    continue;
                }
                total += loss.hpLoss();
                final Long attacker = loss.attackerAccountId();
                final boolean attributable = loss.attackerReliable()
                        && attacker != null && attacker > 0 && attacker != victim;
                if (!attributable) {
                    unknownLosses++;
                    continue;
                }
                final Integer attackerTeam = teamOf(battle, attacker);
                if (attackerTeam == null || attackerTeam == entry.team()) {
                    unknownLosses++;
                    continue;
                }
                enemy += loss.hpLoss();
            }
        }
        return new Toll(total, enemy, total - enemy, unknownLosses);
    }

    private static Integer teamOf(final Battle battle, final long accountId) {
        for (final PlayerResult player : battle.players) {
            if (player != null && player.accountId == accountId) {
                return player.team;
            }
        }
        return null;
    }

    private record Toll(int totalDamage, int enemyDamage, int unknownDamage, int unknownLossCount) {
    }
}
