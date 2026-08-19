package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.processing.TeamEntityMapper;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.evidence.TankTacticalProfile;
import com.wotb.core.replay.evidence.TankTacticalProfileRegistry;
import com.wotb.core.replay.feature.MapCoordinateProfile;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 阵型纵深（纯几何深度三分位）与区域覆盖测量（REGION_COVERAGE_MEASUREMENTS）确定性证据，仅供团队复盘（Team 路径）。
 * <p>口径（全确定性，只描述几何/测量事实，不裁决）：</p>
 * <ul>
 *   <li>阶段窗口按首次交火（首个 DamageEvent）与战斗时长切分 opening/mid/late
 *       （残局 = 战斗末 15s 窗口，与地图鸟瞰同口径）；</li>
 *   <li><b>几何纵深（纯几何，不引用 tank profile）</b>：某阶段内本队成员平均位置沿「本队质心 → 敌方质心」轴投影，
 *       按深度三分位输出 GEOMETRIC_FORWARD / GEOMETRIC_MIDDLE / GEOMETRIC_REAR（仅双方均有可用位置时输出）。
 *       三分位只是几何分类，不是「前排抗线/后排支援」等战术角色；tank profile（车种/装甲等）作为成员静态事实附注，
 *       该车处于这个纵深是否合理由 LLM 综合地图、阵容与战局判断。</li>
 *   <li><b>区域覆盖测量（REGION_COVERAGE_MEASUREMENTS）</b>：九宫格每区输出双方位置存在数
 *       （ownPositionPresence/enemyPositionPresence）与双方距离加权火力覆盖分
 *       （F=Σ 火力权重/(1+d/100)，ownWeightedCoverageScore/enemyWeightedCoverageScore）及 ratio；
 *       只给确定性测量，不输出 own/contested/enemy 权威控制权标签——哪方「实际控制/压制某区」由 LLM 判断。</li>
 * </ul>
 * <p>成员用 {@code account:<accountId>}（与 FORMATION_PHASES 簇成员一致）供 AI 交叉引用。</p>
 */
final class FormationDepthEvidence {

    private FormationDepthEvidence() {
    }

    /** 阶段窗口（battle-relative 秒）。 */
    record PhaseRange(String key, double start, double end) {
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
        // 权威死亡边界（PlayerResult 结算）：knownDeathSec > 0 的车辆，t 超过该时刻的位置样本不进入阵型/控制权
        final Map<Long, PlayerResult> playersByAccount = new LinkedHashMap<>();
        if (battle.players != null) {
            for (final PlayerResult p : battle.players) {
                if (p != null) {
                    playersByAccount.put(p.accountId, p);
                }
            }
        }

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
            final PlayerResult player = playersByAccount.get(identity.accountId());
            final Double deathSec = player == null ? null : knownDeathSec(player);
            if (deathSec != null && t > deathSec + 1e-6) {
                continue; // 阵亡后的服务器位置流残留不得进入阵型/控制权
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
        // 本队/敌方车辆战术画像（tankId → TankTacticalProfile，语义为主 + tankopedia 数值兜底佐证）
        final Map<Long, TankTacticalProfile> accountProfiles = new LinkedHashMap<>();
        if (battle.players != null) {
            final TankTacticalProfileRegistry registry = profileRegistry();
            for (final PlayerResult p : battle.players) {
                if (p == null) {
                    continue;
                }
                accountProfiles.put(p.accountId, registry.profileFor(p.tankId, p.tankName,
                        ReplayDisplayNames.tankClass(p.tankId), ReplayDisplayNames.tankTier(p.tankId)));
            }
        }

        final List<PhaseRange> phases = buildPhases(firstDamageTime(recon.events(), battleStart), battleEnd);

        // entity -> 最后一次 EntityLeave（battle-relative）；carry-forward 位置 state 的终止边界
        final Map<Integer, Double> lastLeaveByEntity = new HashMap<>();
        for (final ReplayEvent event : recon.events()) {
            if (event instanceof EntityRemovedEvent removed) {
                final double t = relativeSec(removed, battleStart);
                lastLeaveByEntity.merge(removed.entityId(), t, Math::max);
            }
        }

        final StringBuilder sb = new StringBuilder();
        for (final PhaseRange phase : phases) {
            sb.append(renderPhase(phase, tracks, teamByAccount, perspectiveTeam, mapCode, playersByAccount, accountProfiles, mapping, lastLeaveByEntity));
        }
        return sb.isEmpty() ? "" : "\n=== FORMATION_DEPTH（阵型深度·确定性） ===\n" + sb;
    }

    /** 单阶段：前后排（深度三分位）+ 控制区域（九宫格计数优势）。 */
    private static String renderPhase(
            final PhaseRange phase,
            final Map<Long, List<double[]>> tracks,
            final Map<Long, Integer> teamByAccount,
            final int perspectiveTeam,
            final String mapCode,
            final Map<Long, PlayerResult> playersByAccount,
            final Map<Long, TankTacticalProfile> profiles,
            final TeamEntityMapping mapping,
            final Map<Integer, Double> lastLeaveByEntity
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
        // carry-forward 位置 state：phase 内无新 PositionChanged 但 phase 前有最后位置（无 EntityLeave/未阵亡）的车辆
        // 其位置沿用（friendly=authoritative carry-forward；enemy=LAST_KNOWN 参考，均不 future-leak）。
        // 不再把「phase 内无事件」当作「位置缺失」（2026-08-19 真实样本：存活己方静止 10.8s 无新位置）。
        for (final Map.Entry<Long, List<double[]>> entry : tracks.entrySet()) {
            if (meanByAccount.containsKey(entry.getKey())) {
                continue;
            }
            if (!isAliveAt(playersByAccount, entry.getKey(), phase.end())) {
                continue; // 阵亡车辆不 carry-forward（位置 state 已终止）
            }
            final double[] carry = carriedForwardReference(
                    entry.getValue(), phase.end(), mapping, lastLeaveByEntity, entry.getKey());
            if (carry != null) {
                meanByAccount.put(entry.getKey(), new double[]{carry[1], carry[2]});
            }
        }
        // 位置参考完整性（fail-closed 门禁）：本阶段存活的双方成员中拥有位置参考（meanByAccount）的计数
        final int ownTeam = perspectiveTeam;
        final int enemyTeam = 3 - ownTeam;
        int ownRefCount = 0;
        int enemyRefCount = 0;
        int ownAliveCount = 0;
        int enemyAliveCount = 0;
        for (final Map.Entry<Long, PlayerResult> entry : playersByAccount.entrySet()) {
            final PlayerResult pl = entry.getValue();
            if (pl == null || (pl.team != ownTeam && pl.team != enemyTeam)) {
                continue;
            }
            if (!isAliveAt(playersByAccount, entry.getKey(), phase.end())) {
                continue; // 本阶段已阵亡：不要求位置参考，也不计入 alive
            }
            final boolean hasRef = meanByAccount.containsKey(entry.getKey());
            if (pl.team == ownTeam) {
                ownAliveCount++;
                if (hasRef) {
                    ownRefCount++;
                }
            } else {
                enemyAliveCount++;
                if (hasRef) {
                    enemyRefCount++;
                }
            }
        }

        // 控制权：车辆阶段平均位置 → canonical（九宫格距离加权火力覆盖基准）
        final Map<Long, double[]> ownCanonical = new LinkedHashMap<>();
        final Map<Long, double[]> enemyCanonical = new LinkedHashMap<>();
        for (final Map.Entry<Long, double[]> entry : meanByAccount.entrySet()) {
            final MapCoordinateResolution res = MapRegionResolver.resolve(
                    (float) entry.getValue()[0], (float) entry.getValue()[1], mapCode);
            if (res == null || !res.usable() || res.position() == null) {
                continue;
            }
            final double[] pos = {res.position().x(), res.position().z()};
            if (teamByAccount.getOrDefault(entry.getKey(), 0) == perspectiveTeam) {
                ownCanonical.put(entry.getKey(), pos);
            } else {
                enemyCanonical.put(entry.getKey(), pos);
            }
        }
        final StringBuilder sb = new StringBuilder();
        final String header = "phase=" + phase.key()
                + " [" + fmt(phase.start()) + "-" + fmt(phase.end()) + "s]\n";

        // 几何纵深：本队成员沿本队质心→敌方质心轴投影，按深度三分位（纯几何，不引用 tank profile 分类）
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
                // 纯几何深度三分位：不引用 tank profile 分类，任何车种都按几何位置归入三分位
                final double minD = depths.get(depths.size() - 1)[0];
                final double maxD = depths.get(0)[0];
                final double span = maxD - minD;
                final double frontThreshold = span > 1e-6 ? minD + span * 2.0 / 3.0 : maxD;
                final double backThreshold = span > 1e-6 ? minD + span / 3.0 : maxD;
                final List<String> geometricForward = new ArrayList<>();
                final List<String> geometricMiddle = new ArrayList<>();
                final List<String> geometricRear = new ArrayList<>();
                for (final double[] d : depths) {
                    final String key = annotate(Math.round(d[1]), profiles);
                    if (d[0] >= frontThreshold - 1e-9) {
                        geometricForward.add(key);
                    } else if (d[0] <= backThreshold + 1e-9) {
                        geometricRear.add(key);
                    } else {
                        geometricMiddle.add(key);
                    }
                }
                sb.append(header)
                        .append("GEOMETRIC_FORWARD=").append(String.join(",", geometricForward)).append("\n")
                        .append("GEOMETRIC_MIDDLE=").append(String.join(",", geometricMiddle)).append("\n")
                        .append("GEOMETRIC_REAR=").append(String.join(",", geometricRear)).append("\n");
return sb.toString() + renderCoverage(ownRegionCount, enemyRegionCount,
                ownCanonical, enemyCanonical, profiles, mapCode,
                ownRefCount, enemyRefCount, ownAliveCount, enemyAliveCount);
            }
        }
        sb.append(header);
return sb.toString() + renderCoverage(ownRegionCount, enemyRegionCount,
                ownCanonical, enemyCanonical, profiles, mapCode,
                ownRefCount, enemyRefCount, ownAliveCount, enemyAliveCount);
    }

    /**
     * 该账号在 phaseEnd 时刻的 carry-forward 位置参考：取 ≤ phaseEnd 的最后位置样本；
     * 若该样本之后有 EntityLeave 且 leave ≤ phaseEnd（位置 state 已终止）或从未有样本 → null。
     */
    static double[] carriedForwardReference(
            final List<double[]> track,
            final double phaseEnd,
            final TeamEntityMapping mapping,
            final Map<Integer, Double> lastLeaveByEntity,
            final long accountId) {
        double[] carry = null;
        for (final double[] s : track) {
            if (s[0] <= phaseEnd + 1e-6) {
                carry = s;
            } else {
                break;
            }
        }
        if (carry == null) {
            return null;
        }
        final List<Integer> eids = mapping.entityIds(accountId);
        for (final int eid : eids) {
            final Double leave = lastLeaveByEntity.get(eid);
            if (leave != null && leave >= carry[0] - 1e-6 && leave <= phaseEnd + 1e-6) {
                return null;
            }
        }
        return carry;
    }

    /** 账号展示 key：附 tank profile 标注（如 account:1234(HEAVY,armor=HIGH)）；UNKNOWN 只标未知。 */
    private static String annotate(final long accountId, final Map<Long, TankTacticalProfile> profiles) {
        final TankTacticalProfile profile = profiles.get(accountId);
        if (profile == null || "UNKNOWN".equals(profile.vehicleClass())) {
            return "account:" + accountId + "(UNKNOWN)";
        }
        return "account:" + accountId + "(" + profile.vehicleClass() + ",armor=" + profile.armorReliability() + ")";
    }

    /** 坦克静态属性事实（车种/装甲）：只作成员标注，不参与几何三分位判定（Backend Evidence Boundary）。 */

    /** TankTacticalProfileRegistry 惰性加载（classpath json，与 PreBattleStrategicService 同源）。 */
    private static volatile TankTacticalProfileRegistry profileRegistryInstance;

    static TankTacticalProfileRegistry profileRegistry() {
        TankTacticalProfileRegistry local = profileRegistryInstance;
        if (local == null) {
            synchronized (FormationDepthEvidence.class) {
                local = profileRegistryInstance;
                if (local == null) {
                    local = TankTacticalProfileRegistry.load();
                    profileRegistryInstance = local;
                }

            }
        }
        return local;
    }

    /** 权威死亡边界（秒）：结算存活或死亡时刻未知 → null（不猜）。复用 PlayerResultFormat 口径。 */
    static Double knownDeathSec(final PlayerResult p) {
        if (p == null || p.survived) {
            return null;
        }
        final double sec = PlayerResultFormat.deathSec(p);
        return sec > 0 ? sec : null;
    }

    /** 该账号在 t 时刻是否存活：死亡边界未知时视为存活（不猜）；已知且 t 超过边界 → 已阵亡。 */
    static boolean isAliveAt(final Map<Long, PlayerResult> playersByAccount, final long accountId, final double t) {
        final PlayerResult p = playersByAccount == null ? null : playersByAccount.get(accountId);
        if (p == null) {
            return true;
        }
        final Double deathSec = knownDeathSec(p);
        return deathSec == null || t <= deathSec + 1e-6;
    }



    /** 区域覆盖测量：九宫格每区输出 own/enemy 位置存在数 + 双方距离加权火力覆盖分（F=Σ fireWeight/(1+d/100)）与 ratio。
     * 只输出确定性测量（位置几何 + 火力权重近似），不输出 own/contested/enemy 权威控制权标签——
     * 哪方「实际控制/压制/放弃某区」由 LLM 综合交火、点数压力等自行判断（Backend Evidence Boundary）。
     */
    private static String renderCoverage(
            final Map<Integer, Integer> own,
            final Map<Integer, Integer> enemy,
            final Map<Long, double[]> ownCanonical,
            final Map<Long, double[]> enemyCanonical,
            final Map<Long, TankTacticalProfile> profiles,
            final String mapCode,
            final int ownRefCount,
            final int enemyRefCount,
            final int ownAliveCount,
            final int enemyAliveCount
    ) {
        final boolean ownRefComplete = ownRefCount >= ownAliveCount;
        final boolean enemyRefComplete = enemyRefCount >= enemyAliveCount;
        if (!ownRefComplete || !enemyRefComplete) {
            // 位置参考完整性门禁：任一方存活车辆缺少位置参考时，禁止输出分数对比（缺失的敌方车辆 ≠ 不存在）；
            // 只输出双方位置存在纯事实 + coverage completeness。
            final StringBuilder fail = new StringBuilder();
            final List<String> presence = new ArrayList<>(own.keySet().stream()
                    .sorted().map(r -> "GRID_REGION_" + r).toList());
            fail.append("REGION_COVERAGE_MEASUREMENTS（POSITION_COVERAGE_INSUFFICIENT：")
                    .append("ownRef=").append(ownRefCount).append("/").append(ownAliveCount)
                    .append(" enemyRef=").append(enemyRefCount).append("/").append(enemyAliveCount).append("）\n");
            if (!presence.isEmpty()) {
                fail.append("ownPositionPresence=").append(String.join(",", presence)).append("\n");
            }
            return fail.toString();
        }
        final java.util.Set<Integer> regions = new java.util.LinkedHashSet<>();
        regions.addAll(own.keySet());
        regions.addAll(enemy.keySet());
        final StringBuilder sb = new StringBuilder();
        sb.append("REGION_COVERAGE_MEASUREMENTS（区域覆盖测量·确定性；LLM 自行判断含义）:\n");
        for (final int region : regions) {
            final double fOwn = fireCoverage(region, ownCanonical, profiles);
            final double fEnemy = fireCoverage(region, enemyCanonical, profiles);
            final int ownPresence = own.getOrDefault(region, 0);
            final int enemyPresence = enemy.getOrDefault(region, 0);
            sb.append("  GRID_REGION_").append(region)
                    .append(" ownPositionPresence=").append(ownPresence)
                    .append(" enemyPositionPresence=").append(enemyPresence)
                    .append(" ownWeightedCoverageScore=").append(fmt(fOwn))
                    .append(" enemyWeightedCoverageScore=").append(fmt(fEnemy))
                    .append(" ratio=").append(fmt(ratioOf(fOwn, fEnemy)))
                    .append(" coverageCompleteness=ownRef=").append(ownRefCount).append("/").append(ownAliveCount)
                    .append(" enemyRef=").append(enemyRefCount).append("/").append(enemyAliveCount)
                    .append("\n");
        }
        return sb.toString();
    }

    /** 双方分数比：一方为 0 时给 0（无对比意义）；两者皆 0 给 1（无信号）。 */
    private static double ratioOf(final double own, final double enemy) {
        if (own <= 0 && enemy <= 0) {
            return 1.0;
        }
        if (own <= 0 || enemy <= 0) {
            return 0.0;
        }
        return own / enemy;
    }

    /** 火力覆盖距离归一化（米，初值可标定）。 */
    static final double FIRE_DISTANCE_NORM_M = 100.0;

    /** 距离加权火力覆盖分：Σ fireWeight(v) / (1 + d/100)，d = 区域中心到车辆 canonical 位置距离。 */
    private static double fireCoverage(final int region, final Map<Long, double[]> positions,
                                       final Map<Long, TankTacticalProfile> profiles) {
        final double[] center = regionCenter(region);
        double f = 0;
        for (final Map.Entry<Long, double[]> entry : positions.entrySet()) {
            final double d = Math.hypot(entry.getValue()[0] - center[0], entry.getValue()[1] - center[1]);
            f += fireWeight(entry.getKey(), profiles) / (1.0 + d / FIRE_DISTANCE_NORM_M);
        }
        return f;
    }

    /** 火力权重（初值，纯静态 profile 事实）：HEAVY/TD=2、MEDIUM=1.5、LIGHT=1；burst/sustained=HIGH 各 +0.5。
     * 不按任何战术角色调整权重（Backend Evidence Boundary：车种/火力属性只是静态事实，不是战术判定）。 */
    private static double fireWeight(final long accountId, final Map<Long, TankTacticalProfile> profiles) {
        final TankTacticalProfile profile = profiles.get(accountId);
        final String cls = profile == null ? "" : profile.vehicleClass();
        double w = switch (cls) {
            case "HEAVY", "TANK_DESTROYER" -> 2.0;
            case "MEDIUM" -> 1.5;
            case "LIGHT" -> 1.0;
            default -> 1.0;
        };
        if (profile != null) {
            if ("HIGH".equals(profile.burstPotential())) {
                w += 0.5;
            }
            if ("HIGH".equals(profile.sustainedDpm())) {
                w += 0.5;
            }
        }
        return w;
    }

    /** 九宫格区域 canonical 几何中心（与 MapRegionResolver.resolveRegion 同网格）。 */
    private static double[] regionCenter(final int region) {
        final float third = MapCoordinateProfile.MAP_SIZE / 3f;
        final int row = (region - 1) / 3;
        final int col = (region - 1) % 3;
        return new double[]{(col + 0.5) * third, MapCoordinateProfile.MAP_SIZE - (row + 0.5) * third};
    }


    /** 阶段：opening = [0, 首次交火+15s（无交火则整场）]；late = 末 15s；mid = 中间。 */
    static List<PhaseRange> buildPhases(final double firstContact, final double battleEnd) {
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

    static double firstDamageTime(final List<ReplayEvent> events, final Float battleStart) {
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

    static double lastSampleTime(final Map<Long, List<double[]>> tracks) {
        double last = 0;
        for (final List<double[]> list : tracks.values()) {
            for (final double[] s : list) {
                last = Math.max(last, s[0]);
            }
        }
        return last;
    }

    static double[] centroid(final List<double[]> points) {
        double sx = 0, sz = 0;
        for (final double[] p : points) {
            sx += p[0];
            sz += p[1];
        }
        return new double[]{sx / points.size(), sz / points.size()};
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

    static String fmt(final double sec) {
        return String.valueOf(Math.round(sec * 10.0) / 10.0);
    }
}

