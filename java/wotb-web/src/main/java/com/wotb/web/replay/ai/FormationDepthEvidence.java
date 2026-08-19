package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.processing.TeamEntityMapper;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DamageEvent;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 阵型深度（前后排）与地图控制区域（实际控制）确定性证据，仅供团队复盘（Team 路径）。
 * <p>口径（全确定性，只描述几何/计数事实，不裁决）：</p>
 * <ul>
 *   <li>阶段窗口按首次交火（首个 DamageEvent）与战斗时长切分 opening/mid/late
 *       （残局 = 战斗末 15s 窗口，与地图鸟瞰同口径）；</li>
 *   <li><b>前后排（profile-aware）</b>：某阶段内本队成员平均位置沿「本队质心 → 敌方质心」轴投影，
 *       按深度三分位分 前排/中排/后排（仅双方均有可用位置时输出）；阵容结构按 TankTacticalProfile
 *       判定（isFrontlineCapable=HEAVY/高装甲、isBacklineCapable=TD/LIGHT、MEDIUM 中性）——
 *       无前线型车辆时不产出前排名单（noFrontlineVehicle + 几何参考）、无后排型车辆时不产出后排名单（noBacklineVehicle）；</li>
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

    /**
     * 阶段窗口（battle-relative 秒）。
     */
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

        final StringBuilder sb = new StringBuilder();
        for (final PhaseRange phase : phases) {
            sb.append(renderPhase(phase, tracks, teamByAccount, perspectiveTeam, mapCode, playersByAccount, accountProfiles));
        }
        return sb.isEmpty() ? "" : "\n=== FORMATION_DEPTH（阵型深度·确定性） ===\n" + sb;
    }

    /**
     * 单阶段：前后排（深度三分位）+ 控制区域（九宫格计数优势）。
     */
    private static String renderPhase(
            final PhaseRange phase,
            final Map<Long, List<double[]>> tracks,
            final Map<Long, Integer> teamByAccount,
            final int perspectiveTeam,
            final String mapCode,
            final Map<Long, PlayerResult> playersByAccount,
            final Map<Long, TankTacticalProfile> profiles
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
        boolean hasFront = false;

        final StringBuilder sb = new StringBuilder();
        final String header = "phase=" + phase.key()
                + " [" + fmt(phase.start()) + "-" + fmt(phase.end()) + "s]\n";

        // 前后排：本队成员沿本队质心→敌方质心轴投影，三分位（profile-aware）
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
                // 阵容结构（tank profile）：可扛线（前线型）与后排型计数
                int frontline = 0;
                int backline = 0;
                int neutralOnly = 0;
                for (final double[] d : depths) {
                    final TankTacticalProfile profile = profiles.get(Math.round(d[1]));
                    final boolean f = isFrontlineCapable(profile);
                    final boolean b = isBacklineCapable(profile);
                    if (f) {
                        frontline++;
                    }
                    if (b) {
                        backline++;
                    }
                    if (!f && !b) {
                        // neutralOnly 逐车按 !frontline && !backline 计数，绝不用减法推导（capability 可重叠）
                        neutralOnly++;
                    }
                }
                hasFront = frontline > 0;
                final boolean hasBack = backline > 0;
                sb.append(header)
                        .append("lineupStructure=totalVehicles=").append(own.size())
                        .append("/frontlineCapable=").append(frontline)
                        .append("/backlineCapable=").append(backline)
                        .append("/neutralOnly=").append(neutralOnly).append("\n");
                if (!hasFront) {
                    sb.append("noFrontlineVehicle=本阶段阵容无前线型车辆\n");
                }
                if (!hasBack) {
                    sb.append("noBacklineVehicle=本阶段阵容无后排型车辆（几何靠后成员仍为前线型车辆）\n");
                }
                final double minD = depths.get(depths.size() - 1)[0];
                final double maxD = depths.get(0)[0];
                final double span = maxD - minD;
                final double frontThreshold = span > 1e-6 ? minD + span * 2.0 / 3.0 : maxD;
                final double backThreshold = span > 1e-6 ? minD + span / 3.0 : maxD;
                final List<String> front = new ArrayList<>();
                final List<String> mid = new ArrayList<>();
                final List<String> back = new ArrayList<>();
                for (final double[] d : depths) {
                    final String key = annotate(Math.round(d[1]), profiles);
                    if (d[0] >= frontThreshold - 1e-9) {
                        front.add(key);
                    } else if (d[0] <= backThreshold + 1e-9) {
                        back.add(key);
                    } else {
                        mid.add(key);
                    }
                }
                if (hasFront) {
                    sb.append("frontLine=").append(String.join(",", front)).append("\n");
                    sb.append("midLine=").append(String.join(",", mid)).append("\n");
                    if (hasBack) {
                        sb.append("backLine=").append(String.join(",", back)).append("\n");
                    }
                } else {
                    // 无前线型车辆：不产出 frontLine/midLine/backLine 名单，只给几何位置参考
                    sb.append("geometryFront=").append(geometryRef(depths, 0, 2)).append("\n");
                }
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
     * 账号展示 key：附 tank profile 标注（如 account:1234(HEAVY,armor=HIGH)）；UNKNOWN 只标未知。
     */
    private static String annotate(final long accountId, final Map<Long, TankTacticalProfile> profiles) {
        final TankTacticalProfile profile = profiles.get(accountId);
        if (profile == null || "UNKNOWN".equals(profile.vehicleClass())) {
            return "account:" + accountId + "(UNKNOWN)";
        }
        return "account:" + accountId + "(" + profile.vehicleClass() + ",armor=" + profile.armorReliability() + ")";
    }

    /**
     * 几何参考：depth 排序（降序=最靠前）中取 [from, from+count) 的账号列表。
     */
    private static String geometryRef(final List<double[]> depths, final int from, final int count) {
        final int end = Math.min(depths.size(), from + count);
        final StringBuilder sb = new StringBuilder();
        for (int i = from; i < end; i++) {
            if (sb.length() > 0) {
                sb.append(",");
            }
            sb.append("account:").append(Math.round(depths.get(i)[1]));
        }
        return sb.toString();
    }

    /**
     * 可扛线（前线型）：HEAVY 或装甲可靠性 HIGH（TankTacticalProfile 语义）。
     */
    static boolean isFrontlineCapable(final TankTacticalProfile profile) {
        return profile != null
                && ("HEAVY".equals(profile.vehicleClass())
                || "HIGH".equals(profile.armorReliability()));
    }

    /**
     * 后排型：TANK_DESTROYER 或 LIGHT（远程支援/侦查车，天然后排；MEDIUM 为中性）。
     */
    static boolean isBacklineCapable(final TankTacticalProfile profile) {
        return profile != null
                && ("TANK_DESTROYER".equals(profile.vehicleClass())
                || "LIGHT".equals(profile.vehicleClass()));
    }

    /**
     * TankTacticalProfileRegistry 惰性加载（classpath json，与 PreBattleStrategicService 同源）。
     */
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

    /**
     * 权威死亡边界（秒）：结算存活或死亡时刻未知 → null（不猜）。复用 PlayerResultFormat 口径。
     */
    static Double knownDeathSec(final PlayerResult p) {
        if (p == null || p.survived) {
            return null;
        }
        final double sec = PlayerResultFormat.deathSec(p);
        return sec > 0 ? sec : null;
    }

    /**
     * 该账号在 t 时刻是否存活：死亡边界未知时视为存活（不猜）；已知且 t 超过边界 → 已阵亡。
     */
    static boolean isAliveAt(final Map<Long, PlayerResult> playersByAccount, final long accountId, final double t) {
        final PlayerResult p = playersByAccount == null ? null : playersByAccount.get(accountId);
        if (p == null) {
            return true;
        }
        final Double deathSec = knownDeathSec(p);
        return deathSec == null || t <= deathSec + 1e-6;
    }


    /**
     * 区域覆盖测量：九宫格每区输出 own/enemy 位置存在数 + 双方距离加权火力覆盖分（F=Σ fireWeight/(1+d/100)）与 ratio。
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

    /**
     * 双方分数比：一方为 0 时给 0（无对比意义）；两者皆 0 给 1（无信号）。
     */
    private static double ratioOf(final double own, final double enemy) {
        if (own <= 0 && enemy <= 0) {
            return 1.0;
        }
        if (own <= 0 || enemy <= 0) {
            return 0.0;
        }
        return own / enemy;
    }

    /**
     * 火力覆盖距离归一化（米，初值可标定）。
     */
    static final double FIRE_DISTANCE_NORM_M = 100.0;

    /**
     * 距离加权火力覆盖分：Σ fireWeight(v) / (1 + d/100)，d = 区域中心到车辆 canonical 位置距离。
     */
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

    /**
     * 火力权重（初值）：HEAVY/TD=2、MEDIUM=1.5、LIGHT=1；burst/sustained=HIGH 各 +0.5；可扛线 +0.5。
     */
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
            if (isFrontlineCapable(profile)) {
                w += 0.5;
            }
        }
        return w;
    }

    /**
     * 九宫格区域 canonical 几何中心（与 MapRegionResolver.resolveRegion 同网格）。
     */
    private static double[] regionCenter(final int region) {
        final float third = MapCoordinateProfile.MAP_SIZE / 3f;
        final int row = (region - 1) / 3;
        final int col = (region - 1) % 3;
        return new double[]{(col + 0.5) * third, MapCoordinateProfile.MAP_SIZE - (row + 0.5) * third};
    }


    /**
     * 阶段：opening = [0, 首次交火+15s（无交火则整场）]；late = 末 15s；mid = 中间。
     */
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

