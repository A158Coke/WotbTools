package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.processing.TeamEntityMapper;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 阵型深度（前后排）与地图控制区域（实际控制）确定性证据，仅供团队复盘（Team 路径）。
 * <p>口径（全确定性，只描述几何/计数事实，不裁决）：</p>
 * <ul>
 *   <li>阶段窗口按首次交火（首个 DamageEvent）与战斗时长切分 opening/mid/late
 *       （残局 = 战斗末 15s 窗口，与地图鸟瞰同口径）；</li>
 *   <li><b>前后排</b>：某阶段内本队成员平均位置沿「本队质心 → 敌方质心」轴投影，
 *       按深度三分位分 前排/中排/后排（仅双方均有可用位置时输出）；</li>
 *   <li><b>区域驻留优势（dwell advantage）</b>：九宫格区域按双方位置样本计数——本队>敌队 → own、
 *       双方>0 → contested、仅敌队 → enemy。这只是「某区域双方活动/驻留计数」的确定性近似，
 *       不等于「真正控制该区域」，更不等于占领点得分；AI 只可据此说「驻留更多」，不得断言控制了某区。</li>
 * </ul>
 * <p>成员用 {@code account:<accountId>}（与 FORMATION_PHASES 簇成员一致）供 AI 交叉引用。</p>
 */
final class FormationDepthEvidence {

    private FormationDepthEvidence() {
    }

    /** 阶段窗口（battle-relative 秒）。 */
    private record PhaseRange(String key, double start, double end) {
    }

    static String renderSection(
            final Battle battle,
            final ReplayReconstruction recon,
            final int perspectiveTeam,
            final String mapCode
    ) {
        if (battle == null || recon == null || recon.events() == null || battle.players == null) {
            return "";
        }
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        if (mapping.entitiesById().isEmpty()) {
            return "";
        }
        final Float battleStart = recon.battleStartRawClockSec();
        // 每账号位置样本（双方）+ 队伍；t/x/z 三元组
        final Map<Long, List<double[]>> tracks = new LinkedHashMap<>();
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
            tracks.computeIfAbsent(identity.accountId(), k -> new ArrayList<>())
                    .add(new double[]{t, pos.x(), pos.z()});
            teamByAccount.putIfAbsent(identity.accountId(), identity.team());
        }
        if (tracks.isEmpty()) {
            return "";
        }
        final double battleEnd = battle.durationS != null && battle.durationS > 0
                ? battle.durationS : lastSampleTime(tracks);
        if (battleEnd <= 0) {
            return "";
        }
        final List<PhaseRange> phases = buildPhases(firstDamageTime(recon.events(), battleStart), battleEnd);
        final StringBuilder sb = new StringBuilder();
        for (final PhaseRange phase : phases) {
            sb.append(renderPhase(phase, tracks, teamByAccount, perspectiveTeam, mapCode));
        }
        return sb.isEmpty() ? "" : "\n=== FORMATION_DEPTH（阵型深度·确定性） ===\n" + sb;
    }

    /** 单阶段：前后排（深度三分位）+ 控制区域（九宫格计数优势）。 */
    private static String renderPhase(
            final PhaseRange phase,
            final Map<Long, List<double[]>> tracks,
            final Map<Long, Integer> teamByAccount,
            final int perspectiveTeam,
            final String mapCode
    ) {
        // 阶段内每账号平均位置 + 九宫格样本计数
        final Map<Long, double[]> meanByAccount = new LinkedHashMap<>();
        final Map<Integer, Integer> ownRegionCount = new LinkedHashMap<>();
        final Map<Integer, Integer> enemyRegionCount = new LinkedHashMap<>();
        for (final Map.Entry<Long, List<double[]>> entry : tracks.entrySet()) {
            final int team = teamByAccount.getOrDefault(entry.getKey(), 0);
            double sx = 0, sz = 0;
            int n = 0;
            for (final double[] sample : entry.getValue()) {
                if (sample[0] < phase.start() || sample[0] > phase.end()) {
                    continue;
                }
                sx += sample[1];
                sz += sample[2];
                n++;
                final MapCoordinateResolution res = MapRegionResolver.resolve(
                        (float) sample[1], (float) sample[2], mapCode);
                if (res != null && res.usable()) {
                    final Map<Integer, Integer> counts = team == perspectiveTeam
                            ? ownRegionCount : enemyRegionCount;
                    counts.merge(res.region(), 1, Integer::sum);
                }
            }
            if (n > 0) {
                meanByAccount.put(entry.getKey(), new double[]{sx / n, sz / n});
            }
        }
        final StringBuilder sb = new StringBuilder();
        final String header = "phase=" + phase.key()
                + " [" + fmt(phase.start()) + "-" + fmt(phase.end()) + "s]\n";

        // 前后排：本队成员沿本队质心→敌方质心轴投影，三分位
        final List<Map.Entry<Long, double[]>> own = new ArrayList<>();
        final List<double[]> enemyMeans = new ArrayList<>();
        for (final Map.Entry<Long, double[]> entry : meanByAccount.entrySet()) {
            if (teamByAccount.getOrDefault(entry.getKey(), 0) == perspectiveTeam) {
                own.add(entry);
            } else {
                enemyMeans.add(entry.getValue());
            }
        }
        if (own.size() >= 2 && !enemyMeans.isEmpty()) {
            final double[] ownCentroid = centroid(own.stream().map(Map.Entry::getValue).toList());
            final double[] enemyCentroid = centroid(enemyMeans);
            final double ax = enemyCentroid[0] - ownCentroid[0];
            final double az = enemyCentroid[1] - ownCentroid[1];
            final double len = Math.hypot(ax, az);
            if (len > 1e-6) {
                final double ux = ax / len, uz = az / len;
                final List<double[]> depths = new ArrayList<>();
                for (final Map.Entry<Long, double[]> member : own) {
                    final double d = (member.getValue()[0] - ownCentroid[0]) * ux
                            + (member.getValue()[1] - ownCentroid[1]) * uz;
                    depths.add(new double[]{d, member.getKey()});
                }
                depths.sort(Comparator.comparingDouble(a -> -a[0]));
                final double minD = depths.get(depths.size() - 1)[0];
                final double maxD = depths.get(0)[0];
                final double span = maxD - minD;
                final double frontThreshold = span > 1e-6 ? minD + span * 2.0 / 3.0 : maxD;
                final double backThreshold = span > 1e-6 ? minD + span / 3.0 : maxD;
                final List<String> front = new ArrayList<>();
                final List<String> mid = new ArrayList<>();
                final List<String> back = new ArrayList<>();
                for (final double[] d : depths) {
                    final String key = "account:" + Math.round(d[1]);
                    if (d[0] >= frontThreshold - 1e-9) {
                        front.add(key);
                    } else if (d[0] <= backThreshold + 1e-9) {
                        back.add(key);
                    } else {
                        mid.add(key);
                    }
                }
                sb.append(header)
                        .append("frontLine=").append(String.join(",", front)).append('\n')
                        .append("midLine=").append(String.join(",", mid)).append('\n')
                        .append("backLine=").append(String.join(",", back)).append('\n');
                return sb.toString() + renderControl(ownRegionCount, enemyRegionCount);
            }
        }
        sb.append(header);
        return sb.toString() + renderControl(ownRegionCount, enemyRegionCount);
    }

    /** 区域驻留优势：本队>敌队 → own；双方>0 → contested；仅敌队 → enemy（计数事实，非「控制」断言）。 */
    private static String renderControl(
            final Map<Integer, Integer> own,
            final Map<Integer, Integer> enemy
    ) {
        final List<String> ownList = new ArrayList<>();
        final List<String> contested = new ArrayList<>();
        final List<String> enemyList = new ArrayList<>();
        final java.util.Set<Integer> regions = new java.util.LinkedHashSet<>();
        regions.addAll(own.keySet());
        regions.addAll(enemy.keySet());
        for (final int region : regions) {
            final int o = own.getOrDefault(region, 0);
            final int e = enemy.getOrDefault(region, 0);
            if (o > 0 && e == 0) {
                ownList.add("GRID_REGION_" + region);
            } else if (o > 0 && e > 0) {
                contested.add("GRID_REGION_" + region);
            } else if (e > 0 && o == 0) {
                enemyList.add("GRID_REGION_" + region);
            }
        }
        if (ownList.isEmpty() && contested.isEmpty() && enemyList.isEmpty()) {
            return "";
        }
        final StringBuilder sb = new StringBuilder();
        if (!ownList.isEmpty()) {
            sb.append("dwellRegions own=").append(String.join(",", ownList)).append('\n');
        }
        if (!contested.isEmpty()) {
            sb.append("dwellRegions contested=").append(String.join(",", contested)).append('\n');
        }
        if (!enemyList.isEmpty()) {
            sb.append("dwellRegions enemy=").append(String.join(",", enemyList)).append('\n');
        }
        return sb.toString();
    }

    /** 阶段：opening = [0, 首次交火+15s（无交火则整场）]；late = 末 15s；mid = 中间。 */
    private static List<PhaseRange> buildPhases(final double firstContact, final double battleEnd) {
        final List<PhaseRange> phases = new ArrayList<>();
        final double openingEnd = firstContact >= 0
                ? Math.min(battleEnd, firstContact + 15.0) : battleEnd;
        final double lateStart = Math.max(openingEnd, battleEnd - 15.0);
        phases.add(new PhaseRange("opening", 0.0, openingEnd));
        if (lateStart > openingEnd + 1e-3) {
            phases.add(new PhaseRange("mid", openingEnd, lateStart));
        }
        if (battleEnd - lateStart > 1e-3) {
            phases.add(new PhaseRange("late", lateStart, battleEnd));
        }
        return phases;
    }

    private static double firstDamageTime(final List<ReplayEvent> events, final Float battleStart) {
        double first = -1;
        if (events == null) {
            return first;
        }
        for (final ReplayEvent event : events) {
            if (!(event instanceof DamageEvent damage)) {
                continue;
            }
            final double t = relativeSec(damage, battleStart);
            if (Double.isFinite(t) && t >= 0 && (first < 0 || t < first)) {
                first = t;
            }
        }
        return first;
    }

    private static double lastSampleTime(final Map<Long, List<double[]>> tracks) {
        double last = 0;
        for (final List<double[]> list : tracks.values()) {
            for (final double[] s : list) {
                last = Math.max(last, s[0]);
            }
        }
        return last;
    }

    private static double[] centroid(final List<double[]> points) {
        double sx = 0, sz = 0;
        for (final double[] p : points) {
            sx += p[0];
            sz += p[1];
        }
        return new double[]{sx / points.size(), sz / points.size()};
    }

    private static double relativeSec(final ReplayEvent event, final Float battleStartRawClockSec) {
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

    private static String fmt(final double sec) {
        return String.valueOf(Math.round(sec * 10.0) / 10.0);
    }
}
