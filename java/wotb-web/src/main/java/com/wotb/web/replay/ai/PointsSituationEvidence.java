package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.processing.TeamEntityMapper;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.evidence.PointsSituationSkill;
import com.wotb.core.replay.evidence.TeamSoloIntentSkill;
import com.wotb.core.replay.map.MapTacticalSemantics;
import com.wotb.core.replay.map.MapTacticalSemanticsRegistry;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 点数局势证据采集与渲染（Team / Player 两条复盘线共用）：
 * 从重建事件流采集双方车辆位置轨迹（服务器位置流，battle-relative 秒），
 * 调用 {@link PointsSituationSkill} 产出击杀夺分时间线 / 占领点区域位置存在 /
 * 进攻推进窗口；过路费按原始 {@link DamageEvent} 计算——事件时间严格限制在推进窗口内，
 * 攻击者/受击者身份经 {@link DamageEventIdentityResolver} 解析，只有攻击者属于推进方
 * 对面队伍（队伍可信）的伤害才计入，环境伤害/自伤/未解析攻击者一律排除并输出 limitation。
 * <p>口径约束（与 team/single、player 三 prompt 的点数局势规则一致）：
 * 实时比分/占点进度未解码——本段只给可证明信号，禁止据此编造任何中间比分；
 * 击杀夺分时间线只是击杀换分项，不代表整体点数；位置存在 ≠ 占点产分；
 * 伤害数字按 OBSERVED_DAMAGE_IS_PARTIAL 抑制。</p>
 */
final class PointsSituationEvidence {

    private static final MapTacticalSemanticsRegistry SEMANTICS_REGISTRY =
            MapTacticalSemanticsRegistry.load();

    private PointsSituationEvidence() {
    }

    /** 采集双方车辆位置轨迹（按 accountId 合并 re-entry 实体，样本按时间升序）。 */
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
                continue; // 单点轨迹不足以判定存在/推进
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

    /** battle-relative 秒：优先事件流 battleClock，回退 battleStart 差值（与 MapOverviewBuilder 同口径）。 */
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

    /**
     * 渲染点数局势证据段（perspectiveTeam 为分析视角队伍：1 或 2；
     * 无效/无信号时返回空串）。selfLabel/otherLabel 由调用方按产品线传入
     * （team 线「本队/对方」，player 线「你的队伍/敌方」）。
     */
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
                TeamSoloIntentSkill.controlPointRegions(semantics);

        final List<PointsSituationSkill.KillPointsEvent> killTimeline =
                PointsSituationSkill.killPointsTimeline(battle);
        final List<PointsSituationSkill.VehicleTrack> tracks =
                collectTracks(battle, recon);
        final List<PointsSituationSkill.CapturePresence> presence = controlRegions.isEmpty()
                ? List.of()
                : PointsSituationSkill.capturePresence(
                        tracks, controlRegions, battle.mapName,
                        PointsSituationSkill.PRESENCE_BIN_SEC);
        final List<PointsSituationSkill.PushWindow> pushes = controlRegions.isEmpty()
                ? List.of()
                : PointsSituationSkill.pushWindows(tracks, controlRegions, battle.mapName);

        if (killTimeline.isEmpty() && presence.isEmpty() && pushes.isEmpty()) {
            return "";
        }

        final StringBuilder sb = new StringBuilder(2048);
        sb.append("\n=== POINTS_SITUATION（点数局势·后端计算） ===\n");
        sb.append("实时比分/占点进度未解码：本段只给可证明信号（击杀夺分时间线、占领点区域位置存在、"
                + "推进窗口），禁止据此编造任何中间比分或精确领先幅度；击杀夺分时间线只是击杀换分项，"
                + "不代表整体点数，禁止把击杀换分项净劣势/优势说成整体落后/领先；位置存在≠占点产分。\n");
        if (!killTimeline.isEmpty()) {
            sb.append("KILL_POINTS_TIMELINE（击杀夺分 ±").append(PointsSituationSkill.KILL_STEAL_POINTS)
                    .append("/击杀业务规则，按阵亡时刻对齐，叙述口径，非实时比分，不含占点基础产分）:\n");
            int selfDelta = 0;
            int otherDelta = 0;
            for (final PointsSituationSkill.KillPointsEvent event : killTimeline) {
                final boolean selfVictim = event.victimTeam() == perspectiveTeam;
                selfDelta += selfVictim
                        ? -PointsSituationSkill.KILL_STEAL_POINTS : PointsSituationSkill.KILL_STEAL_POINTS;
                otherDelta += selfVictim
                        ? PointsSituationSkill.KILL_STEAL_POINTS : -PointsSituationSkill.KILL_STEAL_POINTS;
                sb.append("  ").append(PlayerAnalysisTerms.battleClock(event.timeSec()))
                        .append(" ").append(selfVictim ? selfLabel : otherLabel)
                        .append("车辆被击毁 → ").append(selfLabel).append(" ")
                        .append(selfVictim ? "-" : "+").append(PointsSituationSkill.KILL_STEAL_POINTS)
                        .append(" / ").append(otherLabel).append(" ")
                        .append(selfVictim ? "+" : "-").append(PointsSituationSkill.KILL_STEAL_POINTS)
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
        if (!pushes.isEmpty()) {
            sb.append("PUSH_WINDOWS（朝占领点区域推进窗口·服务器位置流）:\n");
            for (final PointsSituationSkill.PushWindow push : pushes) {
                final String pushLabel = push.team() == perspectiveTeam ? selfLabel : otherLabel;
                sb.append("  [").append(PlayerAnalysisTerms.battleClock(push.startSec()))
                        .append("-").append(PlayerAnalysisTerms.battleClock(push.endSec()))
                        .append("] ").append(pushLabel).append(" ").append(push.accountIds().size())
                        .append(" 车(").append(String.join(",", push.accountIds().stream()
                                .map(String::valueOf).toList()))
                        .append(") 目标 ").append(push.targetRegion()).append(" 区\n");
                if (damagePartial) {
                    sb.append("    推进方窗口内承受伤害不可用（OBSERVED_DAMAGE_IS_PARTIAL）\n");
                } else {
                    final Toll toll = tollDuring(push, battle, recon);
                    sb.append("    推进方窗口内承受伤害 ").append(toll.damage())
                            .append("（防守方过路费，观测子集：仅计入攻击者属推进方对面队伍且双方身份已解析的伤害；")
                            .append("0 表示窗口内无此类伤害记录）\n");
                    if (toll.excludedCount() > 0) {
                        sb.append("    过路费排除 ").append(toll.excludedCount())
                                .append(" 笔事件（环境伤害/自伤/攻击者未解析或队伍不可信，不计入）\n");
                    }
                }
            }
        }
        return sb.toString();
    }

    /** 防守方过路费（观测子集）：推进窗口内（事件时间严格在 push.startSec～push.endSec）推进方车辆
     *  承受的伤害；仅当攻击者与受击者身份均解析、攻击者属于推进方对面队伍（队伍可信）时计入。
     *  环境伤害/自伤/攻击者未解析或队伍不可信的事件一律不计入，并通过 {@code excludedCount} 输出 limitation。 */
    private static Toll tollDuring(
            final PointsSituationSkill.PushWindow push,
            final Battle battle,
            final ReplayReconstruction recon
    ) {
        int total = 0;
        int excluded = 0;
        if (recon == null || recon.events() == null || battle == null || battle.players == null) {
            return new Toll(0, 0);
        }
        final TeamEntityMapping mapping = DamageEventIdentityResolver.mapping(battle, recon);
        final Float battleStart = recon.battleStartRawClockSec();
        final Set<Long> pusherIds = new HashSet<>(push.accountIds());
        for (final ReplayEvent event : recon.events()) {
            if (!(event instanceof DamageEvent damage) || damage.damage() <= 0) {
                continue;
            }
            final double t = relativeSec(event, battleStart);
            if (t < push.startSec() || t > push.endSec()) {
                continue;
            }
            final long victim = DamageEventIdentityResolver.victimAccount(damage, mapping);
            if (victim <= 0 || !pusherIds.contains(victim)) {
                continue;
            }
            final long attacker = DamageEventIdentityResolver.attackerAccount(damage, mapping);
            if (attacker <= 0) {
                excluded++; // 攻击者未解析（环境伤害/盲区）：不计入
                continue;
            }
            if (attacker == victim) {
                excluded++; // 自伤：不计入
                continue;
            }
            final Integer attackerTeam = teamOf(battle, attacker);
            if (attackerTeam == null || attackerTeam == push.team()) {
                excluded++; // 队伍不可信或非对面队伍：不计入
                continue;
            }
            total += damage.damage();
        }
        return new Toll(total, excluded);
    }

    /** 玩家队伍查询：名册中不存在 → null（不可信）。 */
    private static Integer teamOf(final Battle battle, final long accountId) {
        for (final PlayerResult player : battle.players) {
            if (player != null && player.accountId == accountId) {
                return player.team;
            }
        }
        return null;
    }

    /** 过路费结果：damage 计入额，excludedCount 被排除事件数（limitation 输出用）。 */
    private record Toll(int damage, int excludedCount) {
    }
}
