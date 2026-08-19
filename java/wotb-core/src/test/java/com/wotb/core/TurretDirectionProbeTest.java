package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.parse.EventStreamReader;
import com.wotb.core.parse.Protobuf;
import com.wotb.core.parse.ReplayParser;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 真实性门禁 B：每辆车炮塔相对方向（turretRelativeYaw）事件流数据源探针。
 *
 * <p>只读探针，不改生产代码。样本：已提交夹具 common/fixtures/replays/*.wotbreplay +
 * 本地 gitignored common/data/*.wotbreplay（无任何样本时自动跳过）。</p>
 *
 * <p>运行：{@code cd java && mvn -s settings.xml test -Dtest=TurretDirectionProbeTest
 * -Dsurefire.failIfNoSpecifiedTests=false}</p>
 *
 * <p>调查清单（对 type-7 propId=2 及候选数据源逐项量化）：</p>
 * <ol>
 *   <li>字节序/signed/unsigned/缩放/角度单位：valueLen=4 按 u32/i32/float 三种解释对照 type-10 yaw/pitch；valueLen=1/2 出现情况。</li>
 *   <li>是否按 entity 分发：每 eid 的 propId=2 数量与时间跨度；本方/敌方覆盖。</li>
 *   <li>车体静止时（type-10 不变、yaw 不变）propId=2 是否独立变化。</li>
 *   <li>连续性与 wrap-around：相邻样本差分分布。</li>
 *   <li>变化速率：角速度分布是否落在炮塔旋转物理范围（20-40°/s 量级）。</li>
 *   <li>与同刻 type-10 yaw 的关系：差值 (prop2 - yaw) 分布（常数→车体相关；独立变化→相对角）。</li>
 *   <li>与录像者开火/受击证据对齐：type 23 开火时刻 prop2 是否指向目标；type 26/伤害事件锚定攻击者炮塔。</li>
 *   <li>随机战与团队样本编码一致性（仅当 common/data 有额外样本时）。</li>
 *   <li>敌我多车覆盖；entity 阵亡/观战切换后行为。</li>
 *   <li>hull yaw 验证：type-10 yaw 稳定性、与移动向量的关系（找倒车案例）。</li>
 * </ol>
 */
class TurretDirectionProbeTest {

    private static final double PI2 = 2.0 * Math.PI;

    /**
     * 一个 propId=2 样本（原始字节 + 无符号整数解释）。
     */
    private record Prop2Sample(float t, int len, long raw, byte[] bytes) {
    }

    /**
     * 解码候选：把原始值解释为角度（度）。
     */
    private record Cand(String name, Function<Prop2Sample, Double> toDeg) {
    }

    /**
     * 检查项 11 拟合样本：{propDeg, yawDeg, bearingA, bearingB}（命中锚点，跨全部样本累计）。
     */
    private static final List<double[]> FIRE_FIT = new ArrayList<>();
    private static final List<double[]> HIT_FIT = new ArrayList<>();

    @Test
    void probe() throws Exception {
        final List<Path> samples = findSamples();
        Assumptions.assumeTrue(!samples.isEmpty(),
                "no .wotbreplay under common/fixtures/replays or common/data -> skip");
        FIRE_FIT.clear();
        HIT_FIT.clear();
        for (final Path f : samples) {
            System.out.println("################ SAMPLE: " + f.getFileName() + " ################");
            final byte[] zip = Files.readAllBytes(f);
            final byte[] eventData = readZipEntry(zip, "data.wotreplay");
            Assumptions.assumeTrue(eventData != null, "data.wotreplay missing in " + f);
            analyze(f, zip, eventData);
        }
        check11OffsetFit();
    }

    // =====================================================================
    // 样本发现 / zip / meta
    // =====================================================================

    private static List<Path> findSamples() throws Exception {
        // 定向单样本（如旋转实验回放）：-Dprobe.sample=path
        final String single = System.getProperty("probe.sample");
        if (single != null && !single.isBlank() && Files.isRegularFile(Path.of(single))) {
            return List.of(Path.of(single));
        }
        final List<Path> out = new ArrayList<>();
        Path repo = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        while (repo != null && !Files.isDirectory(repo.resolve("common"))) {
            repo = repo.getParent();
        }
        if (repo == null) {
            return out;
        }
        for (final String sub : new String[]{"common/fixtures/replays", "common/data"}) {
            final Path dir = repo.resolve(sub);
            if (Files.isDirectory(dir)) {
                // 递归扫描（common/data 允许子目录放特殊样本，如旋转实验；ParityTest 仍非递归）
                try (Stream<Path> s = Files.walk(dir)) {
                    s.filter(p -> p.toString().toLowerCase().endsWith(".wotbreplay"))
                            .sorted().forEach(out::add);
                }
            }
        }
        return out;
    }

    private static byte[] readZipEntry(final byte[] zip, final String name) throws Exception {
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zip))) {
            ZipEntry e;
            while ((e = zis.getNextEntry()) != null) {
                if (name.equals(e.getName())) {
                    return zis.readAllBytes();
                }
            }
        }
        return null;
    }

    private static String metaString(final byte[] zip, final String key) throws Exception {
        final byte[] meta = readZipEntry(zip, "meta.json");
        if (meta == null) {
            return null;
        }
        final String text = new String(meta, StandardCharsets.UTF_8);
        final Matcher m = Pattern.compile("\"" + Pattern.quote(key) + "\"\\s*:\\s*\"([^\"]*)\"").matcher(text);
        return m.find() ? m.group(1) : null;
    }

    // =====================================================================
    // 主分析
    // =====================================================================

    private static void analyze(final Path f, final byte[] zip, final byte[] eventData) {
        final EventStreamReader.EventStream es;
        try {
            es = EventStreamReader.read(eventData);
        } catch (RuntimeException e) {
            System.out.println("  EventStreamReader failed: " + e.getMessage());
            return;
        }
        System.out.println("  packets=" + es.packets.size() + " clientVersion=" + es.clientVersion);

        final Map<Integer, List<EventStreamReader.ParsedPacket>> byType = new HashMap<>();
        for (final EventStreamReader.ParsedPacket p : es.packets) {
            byType.computeIfAbsent(p.type, k -> new ArrayList<>()).add(p);
        }

        Battle battle = null;
        try {
            battle = ReplayParser.parse(zip);
        } catch (Exception e) {
            System.out.println("  ReplayParser failed: " + e.getMessage());
        }
        if (battle != null) {
            System.out.printf(Locale.ROOT, "  battle: arenaId=%s map=%s winnerTeam=%s duration=%.1fs recorder=%s veh=%s players=%d%n",
                    battle.arenaId, battle.mapName, battle.winnerTeam,
                    battle.durationS == null ? -1 : battle.durationS,
                    battle.recorder, battle.recorderVehicle,
                    battle.players == null ? -1 : battle.players.size());
        }
        final String dbid = metaStringQuiet(zip);
        System.out.println("  meta dbid=" + dbid);

        final Map<Integer, Long> e2a = EventStreamReader.extractEntityToAccountMap(es.packets);
        final Map<Integer, Integer> e2team = extractTeams(es.packets);
        final Map<Long, Integer> a2e = new HashMap<>();
        for (final Map.Entry<Integer, Long> e : e2a.entrySet()) {
            a2e.putIfAbsent(e.getValue(), e.getKey());
        }
        System.out.println("  entityToAccount entries=" + e2a.size() + " teamMapped=" + e2team.size());

        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final Map<Integer, List<EventStreamReader.PositionData>> posByEid = new HashMap<>();
        for (final EventStreamReader.PositionData pd : positions) {
            posByEid.computeIfAbsent(pd.entityId, k -> new ArrayList<>()).add(pd);
        }
        for (final List<EventStreamReader.PositionData> l : posByEid.values()) {
            l.sort(Comparator.comparingDouble(p -> p.clockSecs));
        }

        final Map<Integer, List<Prop2Sample>> prop2ByEid = buildProp2(byType);
        System.out.println("  eidsWithProp2=" + prop2ByEid.size()
                + " totalProp2=" + prop2ByEid.values().stream().mapToInt(List::size).sum());

        // 录像者 eid（meta dbid -> account -> eid）
        final Integer recEid = dbid == null ? null : a2e.get(Long.parseLong(dbid));

        System.out.println();
        check1Units(prop2ByEid, posByEid, e2a);
        System.out.println();
        check2PerEntity(prop2ByEid, posByEid, e2team, recEid);
        System.out.println();
        check3Stationary(prop2ByEid, posByEid, e2a);
        System.out.println();
        check4ContinuityWrap(prop2ByEid);
        System.out.println();
        check5AngularVelocity(prop2ByEid, posByEid, e2a);
        System.out.println();
        check6DeltaVsYaw(prop2ByEid, posByEid, e2a);
        System.out.println();
        check7FireAlignment(es, byType, posByEid, prop2ByEid, e2a, a2e, recEid);
        System.out.println();
        check7bHitAlignment(es, byType, posByEid, prop2ByEid, e2a, recEid);
        System.out.println();
        check8EncodingConsistency(f, prop2ByEid);
        System.out.println();
        check9Coverage(prop2ByEid, posByEid, e2team, byType, recEid);
        System.out.println();
        check10HullYaw(posByEid, e2a);
        System.out.println();
        check39Cross(byType, prop2ByEid, posByEid, recEid);
        check12RotationDump(prop2ByEid, posByEid, recEid);
        System.out.println();
        type23AroundRecorder(byType, posByEid, prop2ByEid, recEid);
    }

    private static String metaStringQuiet(final byte[] zip) {
        try {
            return metaString(zip, "dbid");
        } catch (Exception e) {
            return null;
        }
    }

    // =====================================================================
    // 检查项 1：字节序 / signed / unsigned / 缩放 / 角度单位
    // =====================================================================

    private static void check1Units(final Map<Integer, List<Prop2Sample>> prop2ByEid,
                                    final Map<Integer, List<EventStreamReader.PositionData>> posByEid,
                                    final Map<Integer, Long> e2a) {
        System.out.println("== [1] propId=2 解码候选 vs type-10 yaw/pitch (度, 最近位置 0.5s 内) ==");
        // valueLen 直方图
        final Map<Integer, Integer> lenHist = new TreeMap<>();
        for (final List<Prop2Sample> l : prop2ByEid.values()) {
            for (final Prop2Sample s : l) {
                lenHist.merge(s.len(), 1, Integer::sum);
            }
        }
        System.out.println("  valueLen histogram: " + lenHist);

        for (final int len : new int[]{1, 2, 4}) {
            final int total = lenHist.getOrDefault(len, 0);
            if (total == 0) {
                continue;
            }
            final List<Cand> cands = candidatesFor(len);
            System.out.println("  -- valueLen=" + len + " (n=" + total + ") --");
            System.out.printf(Locale.ROOT, "    %-18s %10s %10s %10s %10s %10s%n",
                    "candidate", "n", "meanErrYaw", "pct30Yaw", "meanErrPitch", "pct30Pitch");
            for (final Cand c : cands) {
                final double[] acc = new double[2];
                final int[] n = new int[2];
                final int[] c30 = new int[2];
                for (final Map.Entry<Integer, List<Prop2Sample>> e : prop2ByEid.entrySet()) {
                    if (!e2a.containsKey(e.getKey())) {
                        continue;
                    }
                    final List<EventStreamReader.PositionData> poss = posByEid.get(e.getKey());
                    if (poss == null) {
                        continue;
                    }
                    for (final Prop2Sample s : e.getValue()) {
                        if (s.len() != len) {
                            continue;
                        }
                        final Double d = c.toDeg().apply(s);
                        if (d == null || !Double.isFinite(d)) {
                            continue;
                        }
                        final EventStreamReader.PositionData near = nearest(poss, s.t(), 0.5f);
                        if (near == null) {
                            continue;
                        }
                        final double yawDeg = Math.toDegrees(near.yaw);
                        final double pitchDeg = Math.toDegrees(near.pitch);
                        final double eYaw = Math.abs(angDiffDeg(d, yawDeg));
                        final double ePitch = Math.abs(angDiffDeg(d, pitchDeg));
                        acc[0] += eYaw;
                        acc[1] += ePitch;
                        n[0]++;
                        n[1]++;
                        if (eYaw < 30) {
                            c30[0]++;
                        }
                        if (ePitch < 30) {
                            c30[1]++;
                        }
                    }
                }
                if (n[0] < 20) {
                    continue;
                }
                System.out.printf(Locale.ROOT, "    %-18s %10d %10.2f %9.1f%% %10.2f %9.1f%%%n",
                        c.name(), n[0],
                        n[0] == 0 ? -1 : acc[0] / n[0], 100.0 * c30[0] / n[0],
                        n[1] == 0 ? -1 : acc[1] / n[1], 100.0 * c30[1] / n[1]);
            }
        }
    }

    private static List<Cand> candidatesFor(final int len) {
        final List<Cand> out = new ArrayList<>();
        if (len == 4) {
            out.add(new Cand("f32[rad]", s -> Math.toDegrees(f32(s.bytes(), 0))));
            out.add(new Cand("f32[deg]", s -> (double) f32(s.bytes(), 0)));
            out.add(new Cand("u32*360/2^32", s -> (s.raw() & 0xFFFFFFFFL) * 360.0 / 4294967296.0));
            out.add(new Cand("i32*360/2^32", s -> (double) (int) s.raw() * 360.0 / 4294967296.0));
        } else if (len == 2) {
            out.add(new Cand("u16*360/2^16", s -> (s.raw() & 0xFFFFL) * 360.0 / 65536.0));
            out.add(new Cand("i16*360/2^16", s -> (double) (short) s.raw() * 360.0 / 65536.0));
            out.add(new Cand("u16*2pi/2^16", s -> (s.raw() & 0xFFFFL) * 360.0 / 65536.0));
            out.add(new Cand("i16*2pi/2^16", s -> (double) (short) s.raw() * 360.0 / 65536.0));
        } else if (len == 1) {
            out.add(new Cand("u8*360/2^8", s -> (s.raw() & 0xFFL) * 360.0 / 256.0));
            out.add(new Cand("i8*360/2^8", s -> (double) (byte) s.raw() * 360.0 / 256.0));
        }
        return out;
    }

    /**
     * 默认解码：valueLen=2 -> u16*360/65536；valueLen=4 -> f32 弧度转度；valueLen=1 -> u8*360/256。
     */
    private static double defaultDeg(final Prop2Sample s) {
        if (s.len() == 4) {
            return Math.toDegrees(f32(s.bytes(), 0));
        }
        if (s.len() == 2) {
            return (s.raw() & 0xFFFFL) * 360.0 / 65536.0;
        }
        return (s.raw() & 0xFFL) * 360.0 / 256.0;
    }

    // =====================================================================
    // 检查项 2：按 entity 分发 / 队伍覆盖
    // =====================================================================

    private static void check2PerEntity(final Map<Integer, List<Prop2Sample>> prop2ByEid,
                                        final Map<Integer, List<EventStreamReader.PositionData>> posByEid,
                                        final Map<Integer, Integer> e2team, final Integer recEid) {
        System.out.println("== [2] 每 eid 的 propId=2 数量 / 时间跨度 / 队伍 ==");
        System.out.printf(Locale.ROOT, "    %-12s %8s %8s %8s %8s %6s%n",
                "eid", "n", "firstT", "lastT", "spanS", "team");
        final List<Map.Entry<Integer, List<Prop2Sample>>> rows = new ArrayList<>(prop2ByEid.entrySet());
        rows.sort(Map.Entry.<Integer, List<Prop2Sample>>comparingByValue(
                Comparator.comparingInt(List::size)).reversed());
        for (final Map.Entry<Integer, List<Prop2Sample>> e : rows) {
            final int eid = e.getKey();
            final List<Prop2Sample> l = e.getValue();
            final float first = l.get(0).t();
            final float last = l.get(l.size() - 1).t();
            final Integer team = e2team.get(eid);
            final boolean rec = recEid != null && recEid == eid;
            System.out.printf(Locale.ROOT, "    %-12d %8d %8.1f %8.1f %8.1f %6s%s%n",
                    eid, l.size(), first, last, last - first,
                    team == null ? "?" : team, rec ? "  <== recorder" : "");
        }
        final long vehicleEids = posByEid.keySet().stream().filter(prop2ByEid::containsKey).count();
        System.out.println("  eids with BOTH prop2 and type-10 positions: " + vehicleEids
                + " / positions-eids=" + posByEid.size() + " / prop2-eids=" + prop2ByEid.size());
    }

    // =====================================================================
    // 检查项 3：车体静止时 propId=2 是否独立变化
    // =====================================================================

    private static void check3Stationary(final Map<Integer, List<Prop2Sample>> prop2ByEid,
                                         final Map<Integer, List<EventStreamReader.PositionData>> posByEid,
                                         final Map<Integer, Long> e2a) {
        System.out.println("== [3] 车体静止段（|dx|,|dz|<0.05, |dyaw|<0.005rad, dt<0.5s, 时长>=3s）内 prop2 变化 ==");
        int runsTotal = 0;
        int runsVarying = 0;
        int printed = 0;
        for (final Map.Entry<Integer, List<EventStreamReader.PositionData>> e : posByEid.entrySet()) {
            final int eid = e.getKey();
            if (!e2a.containsKey(eid)) {
                continue;
            }
            final List<Prop2Sample> props = prop2ByEid.get(eid);
            if (props == null) {
                continue;
            }
            final List<EventStreamReader.PositionData> poss = e.getValue();
            // 找静止 run
            int i = 0;
            while (i < poss.size()) {
                int j = i;
                while (j + 1 < poss.size()
                        && poss.get(j + 1).clockSecs - poss.get(j).clockSecs < 0.5f
                        && Math.abs(poss.get(j + 1).x - poss.get(j).x) < 0.05
                        && Math.abs(poss.get(j + 1).z - poss.get(j).z) < 0.05
                        && Math.abs(angDiff(poss.get(j + 1).yaw, poss.get(j).yaw)) < 0.005) {
                    j++;
                }
                if (j > i) {
                    final float t0 = poss.get(i).clockSecs;
                    final float t1 = poss.get(j).clockSecs;
                    if (t1 - t0 >= 3.0f) {
                        final List<Prop2Sample> in = props.stream()
                                .filter(s -> s.t() >= t0 && s.t() <= t1)
                                .toList();
                        if (in.size() >= 2) {
                            runsTotal++;
                            double min = Double.MAX_VALUE;
                            double max = -Double.MAX_VALUE;
                            for (final Prop2Sample s : in) {
                                final double d = defaultDeg(s);
                                min = Math.min(min, d);
                                max = Math.max(max, d);
                            }
                            final double range = max - min;
                            final boolean varying = range > 8.0;
                            if (varying) {
                                runsVarying++;
                            }
                            if (printed < 12 || varying) {
                                System.out.printf(Locale.ROOT,
                                        "    eid=%-10d run=[%.1f..%.1f]s len=%.1fs nPos=%d nProp2=%d prop2Range=%.1fdeg %s%n",
                                        eid, t0, t1, t1 - t0, j - i + 1, in.size(), range,
                                        varying ? "VARYING" : "");
                                printed++;
                            }
                        }
                    }
                    i = j + 1;
                } else {
                    i++;
                }
            }
        }
        System.out.println("  stationary runs with prop2>=2: " + runsTotal
                + ", varying (range>8deg): " + runsVarying);
    }

    // =====================================================================
    // 检查项 4：连续性与 wrap-around
    // =====================================================================

    private static void check4ContinuityWrap(final Map<Integer, List<Prop2Sample>> prop2ByEid) {
        System.out.println("== [4] 相邻样本差分（dt<=0.2s）: raw diff 与 解码度 diff 直方图 ==");
        final long[] small = new long[1];
        final long[] med = new long[1];
        final long[] large = new long[1];
        final long[] wrap = new long[1];
        final long[] total = new long[1];
        double maxUnwrapStep = 0;
        int unwrapSamples = 0;
        final double[] unwrapCum = new double[1];
        for (final Map.Entry<Integer, List<Prop2Sample>> e : prop2ByEid.entrySet()) {
            final List<Prop2Sample> l = e.getValue();
            unwrapCum[0] = 0;
            int localSamples = 0;
            for (int i = 1; i < l.size(); i++) {
                final Prop2Sample a = l.get(i - 1);
                final Prop2Sample b = l.get(i);
                if (a.len() != b.len()) {
                    continue;
                }
                final float dt = b.t() - a.t();
                if (dt <= 0 || dt > 0.2f) {
                    continue;
                }
                total[0]++;
                final double dA = defaultDeg(a);
                final double dB = defaultDeg(b);
                double rawDiff = dB - dA;
                // wrap 校正（unwrapped 步长）
                while (rawDiff > 180) {
                    rawDiff -= 360;
                }
                while (rawDiff < -180) {
                    rawDiff += 360;
                }
                unwrapCum[0] += rawDiff;
                localSamples++;
                maxUnwrapStep = Math.max(maxUnwrapStep, Math.abs(rawDiff));
                final double absDiff = Math.abs(rawDiff);
                if (absDiff < 2) {
                    small[0]++;
                } else if (absDiff < 45) {
                    med[0]++;
                } else if (absDiff < 300) {
                    large[0]++;
                } else {
                    wrap[0]++;
                }
            }
            unwrapSamples += localSamples;
        }
        System.out.printf(Locale.ROOT,
                "  n=%d  |step|<2deg=%d (%.1f%%)  <45deg=%d (%.1f%%)  45..300=%d (%.1f%%)  >300(wrap)=%d (%.1f%%)%n",
                total[0], small[0], pct(small[0], total[0]), med[0], pct(med[0], total[0]),
                large[0], pct(large[0], total[0]), wrap[0], pct(wrap[0], total[0]));
        System.out.printf(Locale.ROOT, "  max unwrapped |step|=%.2fdeg over %d samples%n",
                maxUnwrapStep, unwrapSamples);
        System.out.println("  (wrap>300deg 意味着角度在 [0,360) 上回绕，是角度量的典型特征)");
    }

    // =====================================================================
    // 检查项 5：变化速率（角速度）
    // =====================================================================

    private static void check5AngularVelocity(final Map<Integer, List<Prop2Sample>> prop2ByEid,
                                              final Map<Integer, List<EventStreamReader.PositionData>> posByEid,
                                              final Map<Integer, Long> e2a) {
        System.out.println("== [5] prop2 角速度 (deg/s, unwrapped, dt<=0.2s) vs 同 eid 的 type-10 yaw 角速度 ==");
        final List<Double> propSpeeds = new ArrayList<>();
        final List<Double> yawSpeeds = new ArrayList<>();
        for (final Map.Entry<Integer, List<Prop2Sample>> e : prop2ByEid.entrySet()) {
            if (!e2a.containsKey(e.getKey())) {
                continue;
            }
            final List<Prop2Sample> l = e.getValue();
            double prev = Double.NaN;
            float prevT = -1;
            for (final Prop2Sample s : l) {
                if (s.len() != 2) {
                    continue;
                }
                final double d = defaultDeg(s);
                if (!Double.isNaN(prev)) {
                    final float dt = s.t() - prevT;
                    if (dt > 0 && dt <= 0.2f) {
                        double diff = d - prev;
                        while (diff > 180) {
                            diff -= 360;
                        }
                        while (diff < -180) {
                            diff += 360;
                        }
                        propSpeeds.add(Math.abs(diff) / dt);
                    }
                }
                prev = d;
                prevT = s.t();
            }
            final List<EventStreamReader.PositionData> poss = posByEid.get(e.getKey());
            if (poss != null) {
                for (int i = 1; i < poss.size(); i++) {
                    final float dt = poss.get(i).clockSecs - poss.get(i - 1).clockSecs;
                    if (dt > 0 && dt <= 0.5f) {
                        double diff = Math.toDegrees(poss.get(i).yaw - poss.get(i - 1).yaw);
                        while (diff > 180) {
                            diff -= 360;
                        }
                        while (diff < -180) {
                            diff += 360;
                        }
                        yawSpeeds.add(Math.abs(diff) / dt);
                    }
                }
            }
        }
        System.out.printf(Locale.ROOT,
                "  prop2: n=%d mean=%.1f med=%.1f p90=%.1f p95=%.1f max=%.1f deg/s  <=30:%.1f%% <=45:%.1f%% <=60:%.1f%%%n",
                propSpeeds.size(), mean(propSpeeds), median(propSpeeds), percentile(propSpeeds, 0.9),
                percentile(propSpeeds, 0.95), max(propSpeeds),
                pctBelow(propSpeeds, 30), pctBelow(propSpeeds, 45), pctBelow(propSpeeds, 60));
        System.out.printf(Locale.ROOT,
                "  yaw : n=%d mean=%.1f med=%.1f p90=%.1f p95=%.1f max=%.1f deg/s%n",
                yawSpeeds.size(), mean(yawSpeeds), median(yawSpeeds), percentile(yawSpeeds, 0.9),
                percentile(yawSpeeds, 0.95), max(yawSpeeds));
        System.out.println("  (Blitz 炮塔旋转约 20-40°/s; 车体转向通常更慢)");
    }

    // =====================================================================
    // 检查项 6：与同刻 type-10 yaw 的关系
    // =====================================================================

    private static void check6DeltaVsYaw(final Map<Integer, List<Prop2Sample>> prop2ByEid,
                                         final Map<Integer, List<EventStreamReader.PositionData>> posByEid,
                                         final Map<Integer, Long> e2a) {
        System.out.println("== [6] (prop2 - yaw) 差值分布（deg, 最近位置 0.5s 内; prop2 默认解码） ==");
        System.out.printf(Locale.ROOT, "    %-12s %8s %10s %10s %10s %10s%n",
                "eid", "n", "meanDelta", "stdDelta", "min", "max");
        for (final Map.Entry<Integer, List<Prop2Sample>> e : prop2ByEid.entrySet()) {
            final int eid = e.getKey();
            if (!e2a.containsKey(eid)) {
                continue;
            }
            final List<EventStreamReader.PositionData> poss = posByEid.get(eid);
            if (poss == null) {
                continue;
            }
            final List<Double> deltas = new ArrayList<>();
            for (final Prop2Sample s : e.getValue()) {
                if (s.len() != 2) {
                    continue;
                }
                final EventStreamReader.PositionData near = nearest(poss, s.t(), 0.5f);
                if (near == null) {
                    continue;
                }
                deltas.add(angDiffDeg(defaultDeg(s), Math.toDegrees(near.yaw)));
            }
            if (deltas.size() < 20) {
                continue;
            }
            final double mean = mean(deltas);
            final double std = std(deltas, mean);
            final double mn = deltas.stream().mapToDouble(Double::doubleValue).min().orElse(0);
            final double mx = deltas.stream().mapToDouble(Double::doubleValue).max().orElse(0);
            System.out.printf(Locale.ROOT, "    %-12d %8d %10.2f %10.2f %10.1f %10.1f%n",
                    eid, deltas.size(), mean, std, mn, mx);
        }
        System.out.println("  (std 小 => (prop2-yaw) 恒常数 => prop2 与车体锁定; std 大且均值非0 => prop2 独立变化, 疑炮塔)");
    }

    // =====================================================================
    // 检查项 7：录像者开火时刻 prop2 是否指向目标
    // =====================================================================

    private static void check7FireAlignment(final EventStreamReader.EventStream es,
                                            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType,
                                            final Map<Integer, List<EventStreamReader.PositionData>> posByEid,
                                            final Map<Integer, List<Prop2Sample>> prop2ByEid,
                                            final Map<Integer, Long> e2a,
                                            final Map<Long, Integer> a2e,
                                            final Integer recEid) {
        System.out.println("== [7] type23 开火时刻: 录像者 prop2 是否指向命中目标方向 ==");
        if (recEid == null) {
            System.out.println("  recorder eid unknown -> skip");
            return;
        }
        final List<EventStreamReader.DirectDamageEvent> dmg = EventStreamReader.extractDirectDamageEvents(
                es.packets, e2a);
        final List<EventStreamReader.PositionData> recPos = posByEid.getOrDefault(recEid, List.of());
        final List<Prop2Sample> recProp = prop2ByEid.getOrDefault(recEid, List.of());
        final long recAcc = e2a.getOrDefault(recEid, -1L);
        int nFire = 0;
        double sumAbs = 0, sumRel = 0, sumRelNeg = 0;
        int hits = 0;
        for (final EventStreamReader.ParsedPacket p : byType.getOrDefault(23, List.of())) {
            if (p.payload.length < 4 || readU32LE(p.payload, 0) != 0) {
                continue;
            }
            nFire++;
            final float t = p.clockSecs;
            final EventStreamReader.PositionData rp = nearest(recPos, t, 0.5f);
            final Prop2Sample ps = nearestProp(recProp, t, 0.5f);
            if (rp == null || ps == null) {
                continue;
            }
            // 找录像者开火后 2.5s 内的命中（attacker=recorder）
            final EventStreamReader.DirectDamageEvent hit = dmg.stream()
                    .filter(d -> d.attackerAccountId() == recAcc
                            && d.clockSecs() >= t - 0.1f && d.clockSecs() <= t + 2.5f)
                    .min(Comparator.comparingDouble(EventStreamReader.DirectDamageEvent::clockSecs))
                    .orElse(null);
            if (hit == null) {
                continue;
            }
            final Integer victimEid = a2e.get(hit.victimAccountId());
            if (victimEid == null) {
                continue;
            }
            final List<EventStreamReader.PositionData> vPos = posByEid.getOrDefault(victimEid, List.of());
            final EventStreamReader.PositionData vp = nearest(vPos, t, 0.5f);
            if (vp == null) {
                continue;
            }
            hits++;
            final double bearingA = Math.toDegrees(Math.atan2(vp.z - rp.z, vp.x - rp.x));
            final double bearingB = Math.toDegrees(Math.atan2(vp.x - rp.x, vp.z - rp.z));
            final double propDeg = defaultDeg(ps);
            final double yawDeg = Math.toDegrees(rp.yaw);
            // 假设1: prop2=绝对炮塔方向 -> |prop2 - bearing|
            // 假设2: prop2=相对炮塔方向 -> |yaw + prop2 - bearing| 或 |yaw - prop2 - bearing|
            final double eA = Math.abs(angDiffDeg(propDeg, bearingA));
            final double eB = Math.abs(angDiffDeg(propDeg, bearingB));
            final double eRel = Math.min(Math.abs(angDiffDeg(yawDeg + propDeg, bearingA)),
                    Math.abs(angDiffDeg(yawDeg + propDeg, bearingB)));
            final double eRelNeg = Math.min(Math.abs(angDiffDeg(yawDeg - propDeg, bearingA)),
                    Math.abs(angDiffDeg(yawDeg - propDeg, bearingB)));
            final double eAbs = Math.min(eA, eB);
            sumAbs += eAbs;
            sumRel += eRel;
            sumRelNeg += eRelNeg;
            FIRE_FIT.add(new double[]{propDeg, yawDeg, bearingA, bearingB});
            System.out.printf(Locale.ROOT,
                    "    fire@%.1fs hit@%.1fs victim=%d |prop2-bearing|=%.1f |yaw+prop2-bearing|=%.1f |yaw-prop2-bearing|=%.1f (prop2=%.1f yaw=%.1f)%n",
                    t, hit.clockSecs(), victimEid, eAbs, eRel, eRelNeg, propDeg, yawDeg);
        }
        if (hits > 0) {
            System.out.printf(Locale.ROOT,
                    "  fires=%d hits=%d mean|prop2-bearing|=%.1f mean|yaw+prop2-bearing|=%.1f mean|yaw-prop2-bearing|=%.1f%n",
                    nFire, hits, sumAbs / hits, sumRel / hits, sumRelNeg / hits);
        }
        System.out.println("  (bearing 用 atan2(dz,dx) 与 atan2(dx,dz) 两种约定取较小; 炮口应在开火时指向目标)");
    }

    // =====================================================================
    // 检查项 7b：受击时刻攻击者 prop2 是否指向录像者
    // =====================================================================

    private static void check7bHitAlignment(final EventStreamReader.EventStream es,
                                            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType,
                                            final Map<Integer, List<EventStreamReader.PositionData>> posByEid,
                                            final Map<Integer, List<Prop2Sample>> prop2ByEid,
                                            final Map<Integer, Long> e2a,
                                            final Integer recEid) {
        System.out.println("== [7b] 录像者受击时刻: 攻击者 prop2 是否指向录像者 (type 26 附近) ==");
        if (recEid == null) {
            System.out.println("  recorder eid unknown -> skip");
            return;
        }
        final List<EventStreamReader.DirectDamageEvent> dmg = EventStreamReader.extractDirectDamageEvents(
                es.packets, e2a);
        final long recAcc = e2a.getOrDefault(recEid, -1L);
        final List<EventStreamReader.PositionData> recPos = posByEid.getOrDefault(recEid, List.of());
        final List<Float> t26 = byType.getOrDefault(26, List.of()).stream()
                .map(p -> p.clockSecs).toList();
        int hits = 0;
        double sumAbs = 0, sumRel = 0, sumRelNeg = 0;
        for (final EventStreamReader.DirectDamageEvent d : dmg) {
            if (d.victimAccountId() != recAcc) {
                continue;
            }
            final Integer atkEid = e2a.entrySet().stream()
                    .filter(e -> e.getValue().equals(d.attackerAccountId()))
                    .map(Map.Entry::getKey).findFirst().orElse(null);
            if (atkEid == null) {
                continue;
            }
            final List<EventStreamReader.PositionData> atkPos = posByEid.getOrDefault(atkEid, List.of());
            final List<Prop2Sample> atkProp = prop2ByEid.getOrDefault(atkEid, List.of());
            final EventStreamReader.PositionData ap = nearest(atkPos, d.clockSecs(), 0.5f);
            final Prop2Sample as = nearestProp(atkProp, d.clockSecs(), 0.5f);
            final EventStreamReader.PositionData rp = nearest(recPos, d.clockSecs(), 0.5f);
            if (ap == null || as == null || rp == null) {
                continue;
            }
            hits++;
            final double bearingA = Math.toDegrees(Math.atan2(rp.z - ap.z, rp.x - ap.x));
            final double bearingB = Math.toDegrees(Math.atan2(rp.x - ap.x, rp.z - ap.z));
            final double propDeg = defaultDeg(as);
            final double yawDeg = Math.toDegrees(ap.yaw);
            final double eAbs = Math.min(Math.abs(angDiffDeg(propDeg, bearingA)),
                    Math.abs(angDiffDeg(propDeg, bearingB)));
            final double eRel = Math.min(Math.abs(angDiffDeg(yawDeg + propDeg, bearingA)),
                    Math.abs(angDiffDeg(yawDeg + propDeg, bearingB)));
            final double eRelNeg = Math.min(Math.abs(angDiffDeg(yawDeg - propDeg, bearingA)),
                    Math.abs(angDiffDeg(yawDeg - propDeg, bearingB)));
            sumAbs += eAbs;
            sumRel += eRel;
            sumRelNeg += eRelNeg;
            HIT_FIT.add(new double[]{propDeg, yawDeg, bearingA, bearingB});
            final boolean has26 = t26.stream().anyMatch(t -> Math.abs(t - d.clockSecs()) < 3.0f);
            System.out.printf(Locale.ROOT,
                    "    hit@%.1fs atk=%d (t26=%s) |prop2-bearing|=%.1f |yaw+prop2-bearing|=%.1f |yaw-prop2-bearing|=%.1f (prop2=%.1f yaw=%.1f)%n",
                    d.clockSecs(), atkEid, has26 ? "near" : "-",
                    eAbs, eRel, eRelNeg, propDeg, yawDeg);
        }
        if (hits > 0) {
            System.out.printf(Locale.ROOT,
                    "  hits=%d mean|prop2-bearing|=%.1f mean|yaw+prop2-bearing|=%.1f mean|yaw-prop2-bearing|=%.1f%n",
                    hits, sumAbs / hits, sumRel / hits, sumRelNeg / hits);
        }
    }

    // =====================================================================
    // 检查项 11：常数偏移 / 尺度回归拟合（决定性）——
    // 若存在 (a,b) 使 gunWorld = a*propDeg + b 在全部命中锚点上残差小,
    // 且同一 (a,b) 在独立受击集(7b)上交叉验证残差也小 => prop2 = 炮口方向(线性编码)。
    // =====================================================================

    private static void check11OffsetFit() {
        System.out.println("== [11] 炮口方向模型拟合 + 交叉验证 (跨全部样本命中锚点) ==");
        if (FIRE_FIT.isEmpty()) {
            System.out.println("  no fire-hit anchors -> skip");
            return;
        }
        // 模型（旋转实验已证 prop2 为满圈角度、与 type-10 yaw 同向）：
        //   M1 gun = prop2 + b
        //   M2 gun = yaw + prop2 + b   （prop2 = 炮塔相对车体角）
        //   M3 gun = yaw - prop2 + b
        // 拟合 b = 圆形均值(锚点 bearing - 基角)（双 bearing 约定取较小），受击集不重拟合交叉验证。
        final double[] m1 = fitOffset(FIRE_FIT, 0);
        final double[] m2 = fitOffset(FIRE_FIT, 1);
        final double[] m3 = fitOffset(FIRE_FIT, -1);
        for (final double[] m : new double[][]{m1, m2, m3}) {
            final double cv = HIT_FIT.isEmpty() ? Double.NaN : residualModel(HIT_FIT, m[0], m[1]);
            System.out.printf(Locale.ROOT,
                    "  model(k=%+.1f) b=%.1f FIT n=%d meanRes=%.1f | CROSS-VAL n=%d meanRes=%.1f%n",
                    m[0], m[1], FIRE_FIT.size(), m[2], HIT_FIT.size(), cv);
        }
        final boolean proven = m2[2] < 15.0 && !HIT_FIT.isEmpty()
                && residualModel(HIT_FIT, m2[0], m2[1]) < 15.0;
        if (proven) {
            System.out.println("  VERDICT: PROVEN（M2 yaw+prop2+偏移 拟合与交叉验证残差均 <15° => prop2=炮塔相对车体角）");
        } else {
            System.out.println("  VERDICT: NOT_PROVEN（全部模型交叉验证残差仍大；prop2 与命中方向的系统偏差待录屏 ground truth）");
        }
    }

    /**
     * gun = k*yaw + prop2 + b（k=0 纯 prop2；k=+1 世界=车体+相对；k=-1 相减变体）。
     * 返回 {k, 最优 b, FIT 平均圆形残差}。b 用圆形均值估计（双 bearing 约定取较小）。
     */
    private static double[] fitOffset(final List<double[]> fit, final double k) {
        double bestB = 0;
        double bestRes = Double.MAX_VALUE;
        for (double b = -180.0; b < 180.0; b += 1.0) {
            final double res = residualModel(fit, k, b);
            if (res < bestRes) {
                bestRes = res;
                bestB = b;
            }
        }
        return new double[]{k, bestB, bestRes};
    }

    /**
     * gun = k*yaw + prop2 + b 在锚点集上的平均圆形误差（双 bearing 约定取较小）。
     */
    private static double residualModel(final List<double[]> fit, final double k, final double b) {
        if (fit.isEmpty()) {
            return Double.NaN;
        }
        double sum = 0;
        for (final double[] s : fit) {
            final double gun = k * s[1] + s[0] + b;
            final double e = Math.min(Math.abs(angDiffDeg(gun, s[2])),
                    Math.abs(angDiffDeg(gun, s[3])));
            sum += e;
        }
        return sum / fit.size();
    }

    // =====================================================================
    // 检查项 12：旋转实验（车体静止炮塔转一圈 / 车体转一圈炮塔跟随）——
    // 打印录像者 prop2（默认解码）与 type-10 yaw 的全时序，供人工核对 360° 扫掠与 wrap。
    // =====================================================================

    private static void check12RotationDump(final Map<Integer, List<Prop2Sample>> prop2ByEid,
                                            final Map<Integer, List<EventStreamReader.PositionData>> posByEid,
                                            final Integer recEid) {
        System.out.println("== [12] 旋转实验: 录像者 prop2 / yaw 全时序 =");
        if (recEid == null) {
            System.out.println("  recorder eid unknown -> skip");
            return;
        }
        final List<Prop2Sample> props = prop2ByEid.getOrDefault(recEid, List.of());
        final List<EventStreamReader.PositionData> positions = posByEid.getOrDefault(recEid, List.of());
        System.out.printf(Locale.ROOT, "  recorder eid=%d prop2 n=%d pos n=%d%n", recEid, props.size(), positions.size());
        for (final Prop2Sample s : props) {
            System.out.printf(Locale.ROOT, "  P2 t=%.2f raw=%d deg=%.1f%n", s.t(), s.raw(), defaultDeg(s));
        }
        for (final EventStreamReader.PositionData p : positions) {
            System.out.printf(Locale.ROOT, "  YW t=%.2f yawDeg=%.1f x=%.1f z=%.1f%n",
                    p.clockSecs, Math.toDegrees(p.yaw), p.x, p.z);
        }
    }

    // =====================================================================
    // 检查项 8：随机战 vs 团队样本编码一致性
    // =====================================================================

    private static void check8EncodingConsistency(final Path f,
                                                  final Map<Integer, List<Prop2Sample>> prop2ByEid) {
        System.out.println("== [8] 样本编码一致性 ==");
        final Map<Integer, Integer> lenHist = new TreeMap<>();
        for (final List<Prop2Sample> l : prop2ByEid.values()) {
            for (final Prop2Sample s : l) {
                lenHist.merge(s.len(), 1, Integer::sum);
            }
        }
        System.out.println("  sample=" + f.getFileName() + " prop2 valueLen hist=" + lenHist
                + " (多个样本存在时可对比; 本探针发现的样本数见顶部)");
    }

    // =====================================================================
    // 检查项 9：覆盖与阵亡/观战行为
    // =====================================================================

    private static void check9Coverage(final Map<Integer, List<Prop2Sample>> prop2ByEid,
                                       final Map<Integer, List<EventStreamReader.PositionData>> posByEid,
                                       final Map<Integer, Integer> e2team,
                                       final Map<Integer, List<EventStreamReader.ParsedPacket>> byType,
                                       final Integer recEid) {
        System.out.println("== [9] 覆盖: 车辆 eid 中 prop2 覆盖比例 / 队伍分布 / 阵亡后行为 ==");
        final Set<Integer> vehicles = new java.util.HashSet<>(posByEid.keySet());
        long withProp = vehicles.stream().filter(prop2ByEid::containsKey).count();
        System.out.println("  vehicle-eids=" + vehicles.size() + " withProp2=" + withProp);
        long t1 = 0, t2 = 0, t0 = 0;
        for (final int eid : vehicles) {
            final Integer team = e2team.get(eid);
            if (team != null && team == 1) {
                t1++;
            } else if (team != null && team == 2) {
                t2++;
            } else {
                t0++;
            }
        }
        System.out.printf(Locale.ROOT, "  vehicles by team: team1=%d team2=%d unknown=%d%n", t1, t2, t0);
        // prop2 覆盖: 每个车是否有 prop2
        final Map<Integer, Long> propByTeam = new HashMap<>();
        for (final int eid : vehicles) {
            if (prop2ByEid.containsKey(eid)) {
                final Integer team = e2team.get(eid);
                propByTeam.merge(team == null ? 0 : team, 1L, Long::sum);
            }
        }
        System.out.println("  prop2-covered vehicles by team: " + propByTeam);
        // 阵亡后行为: prop2 最后时刻 vs 位置最后时刻
        System.out.println("  -- prop2 最后时刻 vs 位置最后时刻 (车) --");
        for (final int eid : vehicles) {
            if (!prop2ByEid.containsKey(eid)) {
                continue;
            }
            final List<Prop2Sample> l = prop2ByEid.get(eid);
            final List<EventStreamReader.PositionData> poss = posByEid.get(eid);
            final float lastProp = l.get(l.size() - 1).t();
            final float lastPos = poss.get(poss.size() - 1).clockSecs;
            final float firstProp = l.get(0).t();
            final boolean rec = recEid != null && eid == recEid;
            System.out.printf(Locale.ROOT,
                    "    eid=%-10d prop2[%7.1f..%7.1f] posLast=%7.1f gap=%.1fs%s%n",
                    eid, firstProp, lastProp, lastPos, lastPos - lastProp,
                    rec ? "  <== recorder" : "");
        }
        // 录像者阵亡代理: 最后 type-31 时刻（存活窗口）
        final List<EventStreamReader.ParsedPacket> t31 = byType.getOrDefault(31, List.of());
        if (!t31.isEmpty()) {
            final float last31 = (float) t31.stream().mapToDouble(p -> p.clockSecs).max().orElse(0.0);
            System.out.printf(Locale.ROOT, "  last type-31 (recorder alive window) = %.1fs; battle end ~= %n", last31);
            if (recEid != null) {
                final List<Prop2Sample> rp = prop2ByEid.get(recEid);
                if (rp != null) {
                    final long after = rp.stream().filter(s -> s.t() > last31).count();
                    System.out.println("  recorder prop2 samples AFTER last31: " + after + " / " + rp.size());
                }
            }
        }
    }

    // =====================================================================
    // 检查项 10：hull yaw 验证
    // =====================================================================

    private static void check10HullYaw(final Map<Integer, List<EventStreamReader.PositionData>> posByEid,
                                       final Map<Integer, Long> e2a) {
        System.out.println("== [10] type-10 yaw 稳定性与移动向量关系 ==");
        for (final Map.Entry<Integer, List<EventStreamReader.PositionData>> e : posByEid.entrySet()) {
            final int eid = e.getKey();
            if (!e2a.containsKey(eid)) {
                continue;
            }
            final List<EventStreamReader.PositionData> l = e.getValue();
            int nonFinite = 0;
            for (final EventStreamReader.PositionData p : l) {
                if (!Float.isFinite(p.yaw) || !Float.isFinite(p.pitch) || !Float.isFinite(p.roll)) {
                    nonFinite++;
                }
            }
            double maxStep = 0;
            int steps = 0;
            for (int i = 1; i < l.size(); i++) {
                final float dt = l.get(i).clockSecs - l.get(i - 1).clockSecs;
                if (dt > 0 && dt <= 0.5f) {
                    double diff = Math.toDegrees(l.get(i).yaw - l.get(i - 1).yaw);
                    while (diff > 180) {
                        diff -= 360;
                    }
                    while (diff < -180) {
                        diff += 360;
                    }
                    maxStep = Math.max(maxStep, Math.abs(diff));
                    steps++;
                }
            }
            // 静止时 yaw 恒定?
            double yawStd = -1;
            double yawMin = Double.MAX_VALUE, yawMax = -Double.MAX_VALUE;
            for (final EventStreamReader.PositionData p : l) {
                final double d = Math.toDegrees(p.yaw);
                yawMin = Math.min(yawMin, d);
                yawMax = Math.max(yawMax, d);
            }
            // 移动方向 vs yaw: 两种约定
            int movingPairs = 0;
            double sumErrA = 0, sumErrB = 0;
            int revCount = 0;
            for (int i = 1; i < l.size(); i++) {
                final float dt = l.get(i).clockSecs - l.get(i - 1).clockSecs;
                if (dt <= 0 || dt > 0.5f) {
                    continue;
                }
                final double dx = l.get(i).x - l.get(i - 1).x;
                final double dz = l.get(i).z - l.get(i - 1).z;
                final double dist = Math.hypot(dx, dz);
                if (dist < 0.5) {
                    continue;
                }
                movingPairs++;
                final double yawDeg = Math.toDegrees(l.get(i).yaw);
                final double hA = Math.toDegrees(Math.atan2(dz, dx));
                final double hB = Math.toDegrees(Math.atan2(dx, dz));
                final double eA = Math.abs(angDiffDeg(yawDeg, hA));
                final double eB = Math.abs(angDiffDeg(yawDeg, hB));
                sumErrA += eA;
                sumErrB += eB;
                final double best = Math.min(eA, eB);
                if (best > 90) {
                    revCount++;
                }
            }
            System.out.printf(Locale.ROOT,
                    "    eid=%-10d nPos=%d nonFinite=%d maxStep=%.1fdeg steps=%d yaw[%.1f..%.1f]deg "
                            + "movePairs=%d meanErr(atan2dz/dx)=%.1f meanErr(atan2dx/dz)=%.1f reverse>90=%d%n",
                    eid, l.size(), nonFinite, maxStep, steps, yawMin, yawMax,
                    movingPairs, movingPairs == 0 ? -1 : sumErrA / movingPairs,
                    movingPairs == 0 ? -1 : sumErrB / movingPairs, revCount);
        }
        System.out.println("  (meanErr 小的约定 = yaw 与移动方向一致的坐标系; reverse>90 样本 = 倒车/横移, "
                + "证明 yaw 是车头朝向而非速度向量)");
    }

    // =====================================================================
    // 补充：录像者 prop2 vs type-39 f5/f6（有界弧度角, 疑炮/瞄准方向）
    // =====================================================================

    private static void check39Cross(final Map<Integer, List<EventStreamReader.ParsedPacket>> byType,
                                     final Map<Integer, List<Prop2Sample>> prop2ByEid,
                                     final Map<Integer, List<EventStreamReader.PositionData>> posByEid,
                                     final Integer recEid) {
        System.out.println("== [39x] 录像者 prop2 vs type-39 f5/f6 (有界弧度, 疑炮/瞄准方向) ==");
        if (recEid == null) {
            System.out.println("  recorder eid unknown -> skip");
            return;
        }
        final List<Prop2Sample> props = prop2ByEid.getOrDefault(recEid, List.of());
        final List<EventStreamReader.PositionData> poss = posByEid.getOrDefault(recEid, List.of());
        final List<EventStreamReader.ParsedPacket> t39 = byType.getOrDefault(39, List.of());
        if (props.isEmpty() || t39.isEmpty()) {
            System.out.println("  no recorder prop2 or no type-39 -> skip");
            return;
        }
        double[] acc = new double[4];
        int n = 0;
        for (final Prop2Sample s : props) {
            if (s.len() != 2) {
                continue;
            }
            EventStreamReader.ParsedPacket near = null;
            float bestDt = 0.05f;
            for (final EventStreamReader.ParsedPacket p : t39) {
                final float dt = Math.abs(p.clockSecs - s.t());
                if (dt <= bestDt) {
                    bestDt = dt;
                    near = p;
                }
            }
            if (near == null || near.payload.length < 28) {
                continue;
            }
            final double f5 = Math.toDegrees(f32(near.payload, 20));
            final double f6 = Math.toDegrees(f32(near.payload, 24));
            final double propDeg = defaultDeg(s);
            final EventStreamReader.PositionData pos = nearest(poss, s.t(), 0.5f);
            final double yawDeg = pos == null ? 0 : Math.toDegrees(pos.yaw);
            acc[0] += Math.abs(angDiffDeg(propDeg, f5));
            acc[1] += Math.abs(angDiffDeg(propDeg - yawDeg, f5));
            acc[2] += Math.abs(angDiffDeg(propDeg, f6));
            acc[3] += Math.abs(angDiffDeg(propDeg - yawDeg, f6));
            n++;
        }
        if (n > 0) {
            System.out.printf(Locale.ROOT,
                    "  n=%d  mean|prop2-f5|=%.1f  mean|prop2-yaw-f5|=%.1f  mean|prop2-f6|=%.1f  mean|prop2-yaw-f6|=%.1f%n",
                    n, acc[0] / n, acc[1] / n, acc[2] / n, acc[3] / n);
        }
        System.out.println("  (若 |prop2-f5| 小 => 同一量纲/同物理量; 若 |prop2-yaw-f5| 小 => f5 为相对角而 prop2 为绝对角)");
    }

    /**
     * type 23 开火/落地 时间线附近录像者 prop2 变化（辅助 [7]）。
     */
    private static void type23AroundRecorder(final Map<Integer, List<EventStreamReader.ParsedPacket>> byType,
                                             final Map<Integer, List<EventStreamReader.PositionData>> posByEid,
                                             final Map<Integer, List<Prop2Sample>> prop2ByEid,
                                             final Integer recEid) {
        System.out.println("== [7c] type23 开火前后录像者 prop2 轨迹 ==");
        if (recEid == null) {
            return;
        }
        final List<Prop2Sample> props = prop2ByEid.getOrDefault(recEid, List.of());
        final List<EventStreamReader.ParsedPacket> t23 = byType.getOrDefault(23, List.of());
        int shown = 0;
        for (final EventStreamReader.ParsedPacket p : t23) {
            if (p.payload.length < 4 || readU32LE(p.payload, 0) != 0) {
                continue;
            }
            final float t0 = p.clockSecs;
            if (shown >= 6) {
                break;
            }
            shown++;
            System.out.printf(Locale.ROOT, "    fire@%.1fs: prop2[", t0);
            int cnt = 0;
            for (final Prop2Sample s : props) {
                if (s.t() >= t0 - 2.0f && s.t() <= t0 + 2.0f) {
                    if (cnt > 0) {
                        System.out.print(", ");
                    }
                    System.out.printf(Locale.ROOT, "%.1fs:%.0f", s.t(), defaultDeg(s));
                    cnt++;
                }
            }
            System.out.println("]");
        }
    }

    // =====================================================================
    // 基础数据构建
    // =====================================================================

    private static Map<Integer, List<Prop2Sample>> buildProp2(
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final Map<Integer, List<Prop2Sample>> out = new HashMap<>();
        for (final EventStreamReader.ParsedPacket p : byType.getOrDefault(7, List.of())) {
            final byte[] pl = p.payload;
            if (pl.length < 12) {
                continue;
            }
            final int eid = readU32LE(pl, 0);
            final int propId = readU32LE(pl, 4);
            if (propId != 2) {
                continue;
            }
            final int valueLen = readU32LE(pl, 8);
            if (valueLen < 1 || valueLen > 4 || 12 + valueLen > pl.length) {
                continue;
            }
            final long raw = intValue(pl, 12, valueLen);
            final byte[] bytes = Arrays.copyOfRange(pl, 12, 12 + valueLen);
            out.computeIfAbsent(eid, k -> new ArrayList<>())
                    .add(new Prop2Sample(p.clockSecs, valueLen, raw, bytes));
        }
        for (final List<Prop2Sample> l : out.values()) {
            l.sort(Comparator.comparingDouble(Prop2Sample::t));
        }
        return out;
    }

    /**
     * Type 8 sub_type 48 (updateArena2) 里 eid -> team (field 4)。
     */
    private static Map<Integer, Integer> extractTeams(
            final List<EventStreamReader.ParsedPacket> packets) {
        final Map<Integer, Integer> map = new HashMap<>();
        for (final EventStreamReader.ParsedPacket p : packets) {
            if (p.type != 8 || p.payload.length < 8) {
                continue;
            }
            if (readU32LE(p.payload, 4) != 48) {
                continue;
            }
            final byte[] body = Arrays.copyOfRange(p.payload, 8, p.payload.length);
            try {
                int off = 4;
                final long[] vr = readVarint(body, off);
                off = (int) vr[1];
                final int first = body[off] & 0xFF;
                final int msgLen = first == 0xFF ? readU16LE(body, off + 1) : first;
                off += first == 0xFF ? 4 : 1;
                if (off + msgLen > body.length) {
                    continue;
                }
                final Map<Integer, List<Object>> root = Protobuf.decode(
                        Arrays.copyOfRange(body, off, off + msgLen));
                final Object wrapperRaw = Protobuf.first(root, 1);
                if (!(wrapperRaw instanceof byte[])) {
                    continue;
                }
                final Map<Integer, List<Object>> wrapper = Protobuf.decode((byte[]) wrapperRaw);
                final List<Object> players = wrapper.get(1);
                if (players == null) {
                    continue;
                }
                for (final Object pr : players) {
                    if (!(pr instanceof byte[])) {
                        continue;
                    }
                    final Map<Integer, List<Object>> pp = Protobuf.decode((byte[]) pr);
                    final int eid = (int) Protobuf.firstLong(pp, 1, 0);
                    final int team = (int) Protobuf.firstLong(pp, 4, 0);
                    if (eid != 0 && team != 0) {
                        map.putIfAbsent(eid, team);
                    }
                }
            } catch (RuntimeException ignored) {
                // tolerate malformed packet
            }
        }
        return map;
    }

    // =====================================================================
    // 数值工具
    // =====================================================================

    private static EventStreamReader.PositionData nearest(
            final List<EventStreamReader.PositionData> sorted, final float t, final float maxDt) {
        EventStreamReader.PositionData best = null;
        float bestDt = maxDt;
        for (final EventStreamReader.PositionData p : sorted) {
            final float dt = Math.abs(p.clockSecs - t);
            if (dt <= bestDt) {
                bestDt = dt;
                best = p;
            }
        }
        return best;
    }

    private static Prop2Sample nearestProp(final List<Prop2Sample> sorted, final float t, final float maxDt) {
        Prop2Sample best = null;
        float bestDt = maxDt;
        for (final Prop2Sample s : sorted) {
            final float dt = Math.abs(s.t() - t);
            if (dt <= bestDt) {
                bestDt = dt;
                best = s;
            }
        }
        return best;
    }

    /**
     * 角度差, 归一到 [-180, 180]。
     */
    private static double angDiffDeg(final double a, final double b) {
        double d = (a - b) % 360.0;
        if (d > 180) {
            d -= 360;
        }
        if (d < -180) {
            d += 360;
        }
        return d;
    }

    private static double angDiff(final double a, final double b) {
        double d = (a - b) % PI2;
        if (d > Math.PI) {
            d -= PI2;
        }
        if (d < -Math.PI) {
            d += PI2;
        }
        return d;
    }

    private static long intValue(final byte[] b, final int off, final int len) {
        long v = 0;
        for (int i = 0; i < len; i++) {
            v |= (long) (b[off + i] & 0xFF) << (8 * i);
        }
        return v;
    }

    private static int readU32LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }

    private static int readU16LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8);
    }

    private static float f32(final byte[] b, final int off) {
        return Float.intBitsToFloat(readU32LE(b, off));
    }

    private static long[] readVarint(final byte[] buf, final int i) {
        int idx = i;
        int shift = 0;
        long result = 0;
        while (true) {
            final int b = buf[idx] & 0xFF;
            idx++;
            result |= (long) (b & 0x7F) << shift;
            if ((b & 0x80) == 0) {
                break;
            }
            shift += 7;
        }
        return new long[]{result, idx};
    }

    private static double mean(final List<Double> v) {
        if (v.isEmpty()) {
            return -1;
        }
        double s = 0;
        for (final double d : v) {
            s += d;
        }
        return s / v.size();
    }

    private static double std(final List<Double> v, final double mean) {
        if (v.size() < 2) {
            return -1;
        }
        double s = 0;
        for (final double d : v) {
            s += (d - mean) * (d - mean);
        }
        return Math.sqrt(s / (v.size() - 1));
    }

    private static double median(final List<Double> v) {
        if (v.isEmpty()) {
            return -1;
        }
        final List<Double> s = new ArrayList<>(v);
        s.sort(Double::compare);
        return s.get(s.size() / 2);
    }

    private static double percentile(final List<Double> v, final double q) {
        if (v.isEmpty()) {
            return -1;
        }
        final List<Double> s = new ArrayList<>(v);
        s.sort(Double::compare);
        final int idx = Math.min(s.size() - 1, (int) (q * s.size()));
        return s.get(idx);
    }

    private static double max(final List<Double> v) {
        double m = 0;
        for (final double d : v) {
            m = Math.max(m, d);
        }
        return m;
    }

    private static double pctBelow(final List<Double> v, final double x) {
        if (v.isEmpty()) {
            return 0;
        }
        long c = 0;
        for (final double d : v) {
            if (d <= x) {
                c++;
            }
        }
        return 100.0 * c / v.size();
    }

    private static double pct(final long a, final long b) {
        return b == 0 ? 0 : 100.0 * a / b;
    }
}
