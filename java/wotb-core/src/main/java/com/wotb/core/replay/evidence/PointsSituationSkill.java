package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.processing.FriendlyEnemyResult;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * 争霸赛点数局势证据（纯函数，确定性战斗语义）。
 * <p>数据边界：终局前任意时刻的实时比分/占点进度/被动产分均未解码（见
 * {@code PointsEvidenceProbeTest} 结论），本技能只产出可证明的点数压力信号，全部
 * 结果禁止冒充实时比分或占点进度：</p>
 * <ul>
 *   <li>击杀夺分时间线：±40/击杀业务规则（项目所有者确认）按双方阵亡时刻对齐，仅叙述口径；</li>
 *   <li>占领点区域位置存在：服务器位置流（type-10）在占领点九宫格区域内的存在，
 *       几何可证；位置存在 ≠ 占点产分（产分规则未解码）；</li>
 *   <li>控制点区域进入窗口（ControlRegionEntryWindow）：车辆从非控制点区域持续移动进入
 *       控制点区域的时间窗口（仅 MOVING 相邻采样位移判定，不声称进攻/抢点/防守意图）。</li>
 * </ul>
 * <p>位置流覆盖 ≠ 点亮：所有存在/推进判断都基于服务器上报位置，不表达任何一方的可见性。</p>
 */
public final class PointsSituationSkill {

    private PointsSituationSkill() {
    }


    /** 占领点存在聚合时间窗（秒）。 */
    public static final float PRESENCE_BIN_SEC = 15f;

    /** 相邻位置采样间 canonical 位移 ≥ 该值（米）视为移动（位置流 2s 采样 → 约 2 m/s）。 */
    public static final float MIN_MOVE_METERS_PER_SAMPLE = 4f;

    /** 进入控制点区域前向前追溯移动采样的上限（秒）。 */
    public static final float MAX_ENTRY_LOOKBACK_SEC = 20f;

    /** 同队进入窗口合并的最大间隔（秒）。 */
    public static final float ENTRY_MERGE_GAP_SEC = 8f;

    /** 相邻位置采样时间差超过该值视为位置流中断，不得跨断线判移动/驻留。 */
    public static final float POSITION_STREAM_GAP_SEC = 5f;

    /** battle-relative 秒的可信位置样本（raw replay 坐标 x/z）。 */
    public record PositionSample(float timeSec, float x, float z) {
        public PositionSample {
            if (!Float.isFinite(timeSec) || timeSec < 0
                    || !Float.isFinite(x) || !Float.isFinite(z)) {
                throw new IllegalArgumentException(
                        "position sample must be finite with non-negative time: "
                                + timeSec + "," + x + "," + z);
            }
        }
    }

    /** 一车的按时间升序位置样本序列。 */
    public record VehicleTrack(long accountId, int team, List<PositionSample> samples) {
        public VehicleTrack {
            samples = samples == null ? List.of() : List.copyOf(samples);
        }
    }

    /** 击杀夺分事件：victimTeam 掉车（−40），beneficiaryTeam 得 40（叙述口径）。 */
    public record KillPointsEvent(float timeSec, int victimTeam, int beneficiaryTeam) {
        public KillPointsEvent {
            if (!Float.isFinite(timeSec) || timeSec < 0) {
                throw new IllegalArgumentException("timeSec must be finite and >= 0: " + timeSec);
            }
        }
    }

    /** 占领点区域位置存在窗口：窗口内两队各有几辆车在该区域出现过（去重计数）。 */
    public record CapturePresence(float startSec, float endSec, int team1Vehicles, int team2Vehicles) {
    }

    /** 控制点区域进入窗口：team 的若干车辆从非控制点区域移动进入控制点区域的时间窗口
     *  （中性结构分类；不表达进攻/抢点/防守意图——那是 LLM 的战术解释）。 */
    public record ControlRegionEntryWindow(
            float startSec,
            float endSec,
            int team,
            List<Long> accountIds,
            int targetRegion
    ) {
        public ControlRegionEntryWindow {
            accountIds = accountIds == null ? List.of() : List.copyOf(accountIds);
        }
    }

    /**
     * 击杀夺分时间线：按双方阵亡时刻升序。
     * 只取权威结算中已知阵亡时刻（deathSec &gt; 0）且队伍有效的玩家；
     * 无击杀者的坠落/自毁无法与正常击杀区分，同样按「受害队 −40 / 对方 +40」叙述口径对齐，
     * 调用方必须标注该口径与局限，不得将其说成实时比分。
     */
    public static List<KillPointsEvent> killPointsTimeline(final Battle battle) {
        if (battle == null || battle.players == null) {
            return List.of();
        }
        final List<KillPointsEvent> events = new ArrayList<>();
        for (final PlayerResult player : battle.players) {
            if (player == null || player.survived) {
                continue;
            }
            if (!PlayerSideResolver.isValidRawTeam(player.team)) {
                continue;
            }
            final double deathSec = PlayerResultFormat.deathSec(player);
            if (!Double.isFinite(deathSec) || deathSec <= 0) {
                continue;
            }
            events.add(new KillPointsEvent(
                    (float) deathSec, player.team, player.team == 1 ? 2 : 1));
        }
        events.sort(Comparator.comparingDouble(KillPointsEvent::timeSec));
        return List.copyOf(events);
    }

    /**
     * 占领点区域位置存在：按 {@link #PRESENCE_BIN_SEC} 秒窗聚合，
     * 只输出至少一辆车出现的窗口；每队按去重车辆数计数。
     * 样本区域由调用方给定的占领点九宫格区域集合判定（几何可证；位置存在 ≠ 占点产分）。
     */
    public static List<CapturePresence> capturePresence(
            final List<VehicleTrack> tracks,
            final Set<String> controlRegions,
            final String mapCode,
            final float binSec
    ) {
        if (tracks == null || tracks.isEmpty()
                || controlRegions == null || controlRegions.isEmpty()
                || !Float.isFinite(binSec) || binSec <= 0) {
            return List.of();
        }
        final Map<Integer, Set<Long>> team1ByBin = new TreeMap<>();
        final Map<Integer, Set<Long>> team2ByBin = new TreeMap<>();
        for (final VehicleTrack track : tracks) {
            final boolean team1 = track.team() == 1;
            if (!team1 && track.team() != 2) {
                continue;
            }
            final Map<Integer, Set<Long>> byBin = team1 ? team1ByBin : team2ByBin;
            for (final PositionSample sample : track.samples()) {
                final int region = regionOf(sample.x(), sample.z(), mapCode);
                if (region <= 0 || !controlRegions.contains(String.valueOf(region))) {
                    continue;
                }
                final int bin = (int) Math.floor(sample.timeSec() / binSec);
                byBin.computeIfAbsent(bin, k -> new LinkedHashSet<>())
                        .add(track.accountId());
            }
        }
        final Set<Integer> bins = new TreeSet<>();
        bins.addAll(team1ByBin.keySet());
        bins.addAll(team2ByBin.keySet());
        final List<CapturePresence> result = new ArrayList<>();
        for (final int bin : bins) {
            result.add(new CapturePresence(
                    bin * binSec,
                    (bin + 1) * binSec,
                    team1ByBin.getOrDefault(bin, Set.of()).size(),
                    team2ByBin.getOrDefault(bin, Set.of()).size()));
        }
        return List.copyOf(result);
    }

    /**
     * 控制点区域进入窗口：对每辆车识别「从非控制点区域移动进入控制点区域」——
     * 进入必须满足 previous→entry 段连续且 canonical 位移 ≥ {@link #MIN_MOVE_METERS_PER_SAMPLE}
     * （九宫格边界小幅移动/坐标抖动不算进入）；进入时刻向前追溯到进入前连续移动的最早采样
     * （上限 {@link #MAX_ENTRY_LOOKBACK_SEC}），向后延续到离开控制点区域为止；
     * 同队同目标区域窗口按 {@link #ENTRY_MERGE_GAP_SEC} 合并，不同目标区域不合并。
     * 位置流中断（相邻采样时间差 &gt; {@link #POSITION_STREAM_GAP_SEC}）处不跨断线。
     * 只表达「车辆从非控制点区域移动进入控制点区域」这一结构事实，不声称进攻/抢点/防守意图。
     */
    public static List<ControlRegionEntryWindow> controlRegionEntryWindows(
            final List<VehicleTrack> tracks,
            final Set<String> controlRegions,
            final String mapCode
    ) {
        if (tracks == null || tracks.isEmpty()
                || controlRegions == null || controlRegions.isEmpty()) {
            return List.of();
        }
        final List<ControlRegionEntryWindow> perVehicle = new ArrayList<>();
        for (final VehicleTrack track : tracks) {
            if (track.samples().size() < 2) {
                continue;
            }
            perVehicle.addAll(entryWindowsOf(track, controlRegions, mapCode));
        }
        return mergeByTeamAndRegion(perVehicle);
    }

    private static List<ControlRegionEntryWindow> entryWindowsOf(
            final VehicleTrack track,
            final Set<String> controlRegions,
            final String mapCode
    ) {
        final List<PositionSample> samples = track.samples();
        final List<ControlRegionEntryWindow> windows = new ArrayList<>();
        for (int i = 1; i < samples.size(); i++) {
            final PositionSample entry = samples.get(i);
            final int entryRegion = regionOf(entry.x(), entry.z(), mapCode);
            if (entryRegion <= 0 || !controlRegions.contains(String.valueOf(entryRegion))) {
                continue;
            }
            final PositionSample previous = samples.get(i - 1);
            if (inside(previous, controlRegions, mapCode)
                    || entry.timeSec() - previous.timeSec() > POSITION_STREAM_GAP_SEC) {
                // 进入时刻前一个采样已在占领点区域，或跨位置流断线：无「从外进入」证据
                continue;
            }
            // 创建窗口前必须验证 previous→entry 的 canonical 位移达到移动阈值：
            // 九宫格边界附近的小幅移动/坐标抖动（位移 < MIN_MOVE_METERS_PER_SAMPLE）不算推进
            final float entryDisplacement = MapRegionResolver.canonicalDistanceMeters(
                    previous.x(), previous.z(), entry.x(), entry.z(), mapCode);
            if (entryDisplacement < MIN_MOVE_METERS_PER_SAMPLE) {
                continue;
            }
            final float start = approachStart(samples, i, controlRegions, mapCode);
            final float end = presenceEnd(samples, i, controlRegions, mapCode);
            windows.add(new ControlRegionEntryWindow(start, end, track.team(),
                    List.of(track.accountId()), entryRegion));
        }
        return windows;
    }

    /** 从进入采样向前追溯连续移动采样；停在不移动、已在占领点区域或跨断线处。 */
    private static float approachStart(
            final List<PositionSample> samples,
            final int entryIndex,
            final Set<String> controlRegions,
            final String mapCode
    ) {
        final float entryTime = samples.get(entryIndex).timeSec();
        float start = entryTime;
        for (int j = entryIndex - 1; j >= 1; j--) {
            final PositionSample current = samples.get(j);
            final PositionSample before = samples.get(j - 1);
            if (entryTime - before.timeSec() > MAX_ENTRY_LOOKBACK_SEC) {
                break;
            }
            if (inside(current, controlRegions, mapCode)) {
                break;
            }
            if (current.timeSec() - before.timeSec() > POSITION_STREAM_GAP_SEC) {
                break;
            }
            final float distance = MapRegionResolver.canonicalDistanceMeters(
                    before.x(), before.z(), current.x(), current.z(), mapCode);
            if (distance < MIN_MOVE_METERS_PER_SAMPLE) {
                break;
            }
            start = before.timeSec();
        }
        return start;
    }

    /** 从进入采样向后延续，直到离开占领点区域或位置流断线。 */
    private static float presenceEnd(
            final List<PositionSample> samples,
            final int entryIndex,
            final Set<String> controlRegions,
            final String mapCode
    ) {
        float end = samples.get(entryIndex).timeSec();
        for (int k = entryIndex + 1; k < samples.size(); k++) {
            final PositionSample sample = samples.get(k);
            final PositionSample before = samples.get(k - 1);
            if (sample.timeSec() - before.timeSec() > POSITION_STREAM_GAP_SEC) {
                break;
            }
            if (!inside(sample, controlRegions, mapCode)) {
                break;
            }
            end = sample.timeSec();
        }
        return end;
    }

    private static boolean inside(
            final PositionSample sample,
            final Set<String> controlRegions,
            final String mapCode
    ) {
        final int region = regionOf(sample.x(), sample.z(), mapCode);
        return region > 0 && controlRegions.contains(String.valueOf(region));
    }

    private static int regionOf(final float x, final float z, final String mapCode) {
        return MapRegionResolver.resolveRegionFromRaw(x, z, mapCode);
    }

    /** 同队同目标区域窗口按开始时刻排序、间隔 ≤ ENTRY_MERGE_GAP_SEC 时合并（车辆去重）；
     *  不同目标区域不得合并（同一队伍同时进入不同控制点区域是两个独立进入窗口）。 */
    private static List<ControlRegionEntryWindow> mergeByTeamAndRegion(
            final List<ControlRegionEntryWindow> windows) {
        final List<ControlRegionEntryWindow> sorted = new ArrayList<>(windows);
        sorted.sort(Comparator
                .comparingInt(ControlRegionEntryWindow::team)
                .thenComparingInt(ControlRegionEntryWindow::targetRegion)
                .thenComparingDouble(ControlRegionEntryWindow::startSec)
                .thenComparingDouble(ControlRegionEntryWindow::endSec));
        final List<ControlRegionEntryWindow> merged = new ArrayList<>();
        ControlRegionEntryWindow current = null;
        for (final ControlRegionEntryWindow window : sorted) {
            if (current == null) {
                current = window;
                continue;
            }
            if (current.team() == window.team()
                    && current.targetRegion() == window.targetRegion()
                    && window.startSec() <= current.endSec() + ENTRY_MERGE_GAP_SEC) {
                final Set<Long> accounts = new LinkedHashSet<>(current.accountIds());
                accounts.addAll(window.accountIds());
                current = new ControlRegionEntryWindow(
                        Math.min(current.startSec(), window.startSec()),
                        Math.max(current.endSec(), window.endSec()),
                        current.team(),
                        List.copyOf(accounts),
                        current.targetRegion());
            } else {
                merged.add(current);
                current = window;
            }
        }
        if (current != null) {
            merged.add(current);
        }
        return List.copyOf(merged);
    }
}
