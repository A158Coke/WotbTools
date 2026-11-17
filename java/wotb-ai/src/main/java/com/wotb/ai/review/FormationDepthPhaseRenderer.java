package com.wotb.ai.review;

import com.wotb.core.replay.evidence.TankTacticalProfile;
import com.wotb.core.replay.feature.MapCoordinateProfile;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MapRegionResolver;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Renders deterministic formation geometry and region coverage for a single battle phase. */
final class FormationDepthPhaseRenderer {

    private FormationDepthPhaseRenderer() {
    }

    /**
     * Position data consumed by rendering. Account identity is the enclosing map key; current/enemy status
     * is preserved by the map partition, while AOI and knowledge-state resolution stays in the resolver.
     */
    record PositionReference(double x, double z, double observedAtSec, double ageSec) {
    }

    static String renderPhase(
            final String phaseKey,
            final double phaseStart,
            final double phaseEnd,
            final Map<Long, PositionReference> ownCurrent,
            final Map<Long, PositionReference> enemyCurrent,
            final Map<Long, PositionReference> enemyLastKnown,
            final Map<Long, TankTacticalProfile> profiles,
            final String mapCode,
            final int ownRefCount,
            final int enemyRefCount,
            final int ownAliveCount,
            final int enemyAliveCount
    ) {
        // 区域 presence 来自 resolved 车辆位置 state：每辆 CURRENT 车辆 +1，而非位置包数量。
        // 因而移动更频繁的车不会人为增加 presence（coverageCompleteness=7/7 时 presence/coverage 同源）。
        final Map<Integer, Integer> ownRegionCount = new LinkedHashMap<>();
        final Map<Integer, Integer> enemyRegionCount = new LinkedHashMap<>();
        for (final Map.Entry<Long, PositionReference> entry : ownCurrent.entrySet()) {
            final int region = regionOf(entry.getValue(), mapCode);
            if (region > 0) {
                ownRegionCount.merge(region, 1, Integer::sum);
            }
        }
        for (final Map.Entry<Long, PositionReference> entry : enemyCurrent.entrySet()) {
            final int region = regionOf(entry.getValue(), mapCode);
            if (region > 0) {
                enemyRegionCount.merge(region, 1, Integer::sum);
            }
        }
        // 控制权：车辆 CURRENT 位置 → canonical（九宫格距离加权火力覆盖基准；LAST_KNOWN 不得作为当前坐标）
        final Map<Long, double[]> ownCanonical = new LinkedHashMap<>();
        final Map<Long, double[]> enemyCanonical = new LinkedHashMap<>();
        for (final Map.Entry<Long, PositionReference> entry : ownCurrent.entrySet()) {
            final double[] canonical = canonicalOf(entry.getValue(), mapCode);
            if (canonical != null) {
                ownCanonical.put(entry.getKey(), canonical);
            }
        }
        for (final Map.Entry<Long, PositionReference> entry : enemyCurrent.entrySet()) {
            final double[] canonical = canonicalOf(entry.getValue(), mapCode);
            if (canonical != null) {
                enemyCanonical.put(entry.getKey(), canonical);
            }
        }
        final StringBuilder sb = new StringBuilder();
        final String header = phaseHeader(phaseKey, phaseStart, phaseEnd);

        // 几何纵深：本队成员沿本队质心→敌方质心轴投影，按深度三分位（纯几何，只消费 CURRENT 位置；
        // enemy LAST_KNOWN 不得作为当前 enemy centroid / 轴参考）。
        // fail-close gate（PR #103）：任何依赖双方 current geometry 的 exact 计算
        // （enemy centroid / GEOMETRIC_* / 距离加权覆盖分 / ratio）必须在 completeness gate 之前判定，
        // 且只有 ownRefComplete && enemyRefComplete 才允许输出——enemyRef=1/2 时用 1 辆敌方 CURRENT
        // 建立 whole-team enemy centroid 会与覆盖段 POSITION_COVERAGE_INSUFFICIENT 自相矛盾；
        // partial CURRENT 只允许 INSUFFICIENT + CURRENT presence + coverage counts + LAST_KNOWN 独立信息。
        final boolean ownRefComplete = ownRefCount >= ownAliveCount;
        final boolean enemyRefComplete = enemyRefCount >= enemyAliveCount;
        final List<Map.Entry<Long, double[]>> own = new ArrayList<>();
        final List<double[]> enemyMeans = new ArrayList<>();
        for (final Map.Entry<Long, PositionReference> entry : ownCurrent.entrySet()) {
            own.add(new java.util.AbstractMap.SimpleImmutableEntry<>(entry.getKey(),
                    new double[]{entry.getValue().x(), entry.getValue().z()}));
        }
        for (final Map.Entry<Long, PositionReference> entry : enemyCurrent.entrySet()) {
            enemyMeans.add(new double[]{entry.getValue().x(), entry.getValue().z()});
        }
        if (ownRefComplete && enemyRefComplete && own.size() >= 2 && !enemyMeans.isEmpty()) {
            final double[] ownCentroid = FormationDepthMath.centroid(own.stream().map(Map.Entry::getValue).toList());
            final double[] enemyCentroid = FormationDepthMath.centroid(enemyMeans);
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
                        ownRefCount, enemyRefCount, ownAliveCount, enemyAliveCount,
                        enemyLastKnown);
            }
        }
        sb.append(header);
        return sb.toString() + renderCoverage(ownRegionCount, enemyRegionCount,
                ownCanonical, enemyCanonical, profiles, mapCode,
                ownRefCount, enemyRefCount, ownAliveCount, enemyAliveCount,
                enemyLastKnown);
    }

    /** 参考位置所属九宫格 region（0 = 不可用）。 */
    private static int regionOf(final PositionReference ref, final String mapCode) {
        final MapCoordinateResolution res = MapRegionResolver.resolve(
                (float) ref.x(), (float) ref.z(), mapCode);
        if (res == null || !res.usable()) {
            return 0;
        }
        return res.region();
    }

    /** 参考位置 → canonical 坐标（null = 不可用；供距离加权火力覆盖计算）。 */
    private static double[] canonicalOf(final PositionReference ref, final String mapCode) {
        final MapCoordinateResolution res = MapRegionResolver.resolve(
                (float) ref.x(), (float) ref.z(), mapCode);
        if (res == null || !res.usable() || res.position() == null) {
            return null;
        }
        return new double[]{res.position().x(), res.position().z()};
    }

    /** 账号展示 key：附 tank profile 标注（如 account:1234(HEAVY,armor=HIGH)）；UNKNOWN 只标未知。 */
    private static String annotate(final long accountId, final Map<Long, TankTacticalProfile> profiles) {
        final TankTacticalProfile profile = profiles.get(accountId);
        if (profile == null || "UNKNOWN".equals(profile.vehicleClass())) {
            return "account:" + accountId + "(UNKNOWN)";
        }
        return "account:" + accountId + "(" + profile.vehicleClass() + ",armor=" + profile.armorReliability() + ")";
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
            final int enemyAliveCount,
            final Map<Long, PositionReference> enemyLastKnown
    ) {
        final boolean ownRefComplete = ownRefCount >= ownAliveCount;
        final boolean enemyRefComplete = enemyRefCount >= enemyAliveCount;
        if (!ownRefComplete || !enemyRefComplete) {
            // 位置参考完整性门禁：任一方存活车辆缺少 CURRENT 位置参考时，禁止输出分数对比
            // （缺失/LAST_KNOWN 的敌方车辆 ≠ 不存在）；只输出 CURRENT 位置存在纯事实 + coverage completeness
            // + 敌方 LAST_KNOWN 独立信息（不得伪装成 current，不得 future-leak）。
            final StringBuilder fail = new StringBuilder();
            final List<String> presence = new ArrayList<>(own.keySet().stream()
                    .sorted().map(r -> "GRID_REGION_" + r).toList());
            fail.append("REGION_COVERAGE_MEASUREMENTS（POSITION_COVERAGE_INSUFFICIENT：")
                    .append("ownRef=").append(ownRefCount).append("/").append(ownAliveCount)
                    .append(" enemyRef=").append(enemyRefCount).append("/").append(enemyAliveCount).append("）\n");
            if (!presence.isEmpty()) {
                fail.append("ownPositionPresence=").append(String.join(",", presence)).append("\n");
            }
            if (!enemyLastKnown.isEmpty()) {
                fail.append("ENEMY_LAST_KNOWN_POSITION_REFERENCES（独立信息，不得当作当前精确位置）:\n");
                final List<Map.Entry<Long, PositionReference>> lastKnown =
                        new ArrayList<>(enemyLastKnown.entrySet());
                lastKnown.sort(java.util.Comparator.comparingLong(Map.Entry::getKey));
                for (final Map.Entry<Long, PositionReference> entry : lastKnown) {
                    final PositionReference ref = entry.getValue();
                    final int region = regionOf(ref, mapCode);
                    fail.append("  account:").append(entry.getKey())
                            .append(" region=").append(region > 0 ? "GRID_REGION_" + region : "UNKNOWN")
                            .append(" observedAtSec=").append(FormationDepthMath.fmt(ref.observedAtSec()))
                            .append(" ageSec=").append(FormationDepthMath.fmt(ref.ageSec()))
                            .append(" knowledge=LAST_KNOWN\n");
                }
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
                    .append(" ownWeightedCoverageScore=").append(FormationDepthMath.fmt(fOwn))
                    .append(" enemyWeightedCoverageScore=").append(FormationDepthMath.fmt(fEnemy))
                    .append(" ratio=").append(FormationDepthMath.fmt(ratioOf(fOwn, fEnemy)))
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





    private static String phaseHeader(final String key, final double start, final double end) {
        return "phase=" + key + " [" + FormationDepthMath.fmt(start) + "-"
                + FormationDepthMath.fmt(end) + "s]\n";
    }
}
