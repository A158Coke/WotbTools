package com.wotb.core;

import com.wotb.core.parse.EventStreamReader;
import com.wotb.core.parse.Protobuf;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Packet reverse-engineering probe (manual, not in CI): per-type stats + hex samples + correlations.
 * Run: {@code mvn -pl wotb-core test -Dtest=PacketReverseProbeTest -Dprobe.replay=<file>}
 */
class PacketReverseProbeTest {

    @Test
    void diag() throws Exception {
        final String path = System.getProperty("probe.replay");
        Assumptions.assumeTrue(path != null, "set -Dprobe.replay=<file>");
        final byte[] bytes = Files.readAllBytes(Path.of(path));
        byte[] eventData = null;
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry e;
            while ((e = zis.getNextEntry()) != null) {
                if ("data.wotreplay".equals(e.getName())) {
                    eventData = zis.readAllBytes();
                }
            }
        }
        final EventStreamReader.EventStream es = EventStreamReader.read(eventData);
        final Map<Integer, List<EventStreamReader.ParsedPacket>> byType = new HashMap<>();
        for (final EventStreamReader.ParsedPacket p : es.packets) {
            byType.computeIfAbsent(p.type, k -> new ArrayList<>()).add(p);
        }
        System.out.println("== per-type stats (sorted by count desc) ==");
        final List<Map.Entry<Integer, List<EventStreamReader.ParsedPacket>>> sorted =
                byType.entrySet().stream()
                        .sorted(Comparator.comparingInt((Map.Entry<Integer, List<EventStreamReader.ParsedPacket>> e) -> e.getValue().size()).reversed())
                        .toList();
        for (final Map.Entry<Integer, List<EventStreamReader.ParsedPacket>> e : sorted) {
            final List<EventStreamReader.ParsedPacket> ps = e.getValue();
            final int min = ps.stream().mapToInt(p -> p.payload.length).min().orElse(0);
            final int max = ps.stream().mapToInt(p -> p.payload.length).max().orElse(0);
            final double avg = ps.stream().mapToInt(p -> p.payload.length).average().orElse(0);
            final double first = ps.stream().mapToDouble(p -> p.clockSecs).min().orElse(0);
            final double last = ps.stream().mapToDouble(p -> p.clockSecs).max().orElse(0);
            System.out.printf(Locale.ROOT, "type=%-3d count=%-7d len[min=%d max=%d avg=%.1f] clock[%.1f..%.1f]%n",
                    e.getKey(), ps.size(), min, max, avg, first, last);
        }
        for (final int t : new int[]{7, 31, 35, 39}) {
            final List<EventStreamReader.ParsedPacket> ps = byType.getOrDefault(t, List.of());
            System.out.println("== type " + t + " samples (first 4, up to 96 bytes) ==");
            ps.stream().limit(4).forEach(p -> {
                System.out.printf(Locale.ROOT, "t=%.1fs len=%d hex=%s%n", p.clockSecs, p.payload.length, hex(p.payload, 96));
            });
        }
        System.out.println("== type 7 length histogram ==");
        final Map<Integer, Long> hist = byType.getOrDefault(7, List.of()).stream()
                .collect(Collectors.groupingBy(p -> p.payload.length, Collectors.counting()));
        hist.entrySet().stream()
                .sorted(Map.Entry.<Integer, Long>comparingByValue().reversed())
                .limit(12)
                .forEach(e -> System.out.println("  len=" + e.getKey() + " count=" + e.getValue()));
        dumpFloats(byType, 39, 7);
        dumpFloats(byType, 31, 1);
        System.out.println("== type 7 by length: first 4 samples each ==");
        for (final int len : new int[]{13, 14, 15, 16}) {
            System.out.println("-- len " + len + " --");
            byType.getOrDefault(7, List.of()).stream()
                    .filter(p -> p.payload.length == len).limit(4)
                    .forEach(p -> System.out.printf(Locale.ROOT, "t=%.1fs hex=%s%n",
                            p.clockSecs, hex(p.payload, 32)));
        }
        correlateHp(es, byType);
        matchType39(es, byType);
        dumpPlayerProtobuf(es, 3125216420L);
        dumpCreatePackets(byType);
        transformType39(es, byType);
        type31AroundDeaths(es, byType);
        type39Stream(byType);
        type39VehicleCorrelation(es, byType);
        findRecorder(es);
        recorderAffine(es, byType);
        teamCoverage(es);
        type7YawVsPos(es, byType);
        type31VsRecorder(es, byType);
        type31HpHypothesis(es, byType);
    }

    /** type31 vs "HP%" hypothesis: match float to any tracked vehicle's HP fraction (0-100). */
    private static void type31HpHypothesis(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        // account -> maxHp (tankopedia, hardcoded for this sample's roster)
        final Map<Long, Integer> maxHp = new HashMap<>();
        maxHp.put(3101365552L, 3400); // 29985 SPHT
        maxHp.put(3105519605L, 2600); // 7297 60TP
        maxHp.put(3125216420L, 3400); // 29985
        maxHp.put(3112767868L, 2400); // 6225 FV215b
        maxHp.put(3108556254L, 2400); // 6225
        maxHp.put(3111605321L, 2600); // 7297
        maxHp.put(3116319903L, 2600); // 7297
        maxHp.put(3115055801L, 3400); // recorder SPHT
        final Map<Long, List<EventStreamReader.DirectDamageEvent>> dmg = new HashMap<>();
        for (final EventStreamReader.DirectDamageEvent d :
                EventStreamReader.extractDirectDamageEvents(es.packets,
                        EventStreamReader.extractEntityToAccountMap(es.packets))) {
            dmg.computeIfAbsent(d.victimAccountId(), k -> new ArrayList<>()).add(d);
        }
        final List<EventStreamReader.ParsedPacket> t31 = byType.getOrDefault(31, List.of());
        System.out.println("== type31 vs HP% hypothesis ==");
        double bestMean = Double.MAX_VALUE;
        Long bestAcc = null;
        for (final Long acc : maxHp.keySet()) {
            final List<EventStreamReader.DirectDamageEvent> hits = dmg.getOrDefault(acc, List.of());
            hits.sort(Comparator.comparingDouble(EventStreamReader.DirectDamageEvent::clockSecs));
            final int hp0 = maxHp.get(acc);
            double sumErr = 0;
            int count = 0;
            for (final EventStreamReader.ParsedPacket p : t31) {
                if (p.payload.length < 4) {
                    continue;
                }
                int cum = 0;
                for (final EventStreamReader.DirectDamageEvent d : hits) {
                    if (d.clockSecs() <= p.clockSecs) {
                        cum += d.damage();
                    }
                }
                final double hpPct = Math.max(0, hp0 - cum) * 100.0 / hp0;
                final double v = f(p.payload, 0);
                sumErr += Math.abs(v - hpPct);
                count++;
            }
            final double mean = count == 0 ? Double.MAX_VALUE : sumErr / count;
            System.out.printf(Locale.ROOT, "  acc=%d hp0=%d hits=%d mean|v-hpPct|=%.2f%n",
                    acc, hp0, hits.size(), mean);
            if (mean < bestMean) {
                bestMean = mean;
                bestAcc = acc;
            }
        }
        System.out.printf(Locale.ROOT, "  best: acc=%d mean=%.2f%n", bestAcc, bestMean);
    }

    /** type7 propId=2 (2-byte int) vs the same vehicle's type-10 yaw (degrees). */
    private static void type7YawVsPos(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final int eid = 12558550; // team1 victim with dense type-7 propId=2 stream
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final List<EventStreamReader.ParsedPacket> props = byType.getOrDefault(7, List.of()).stream()
                .filter(p -> p.payload.length >= 12 && readI32LE(p.payload, 0) == eid
                        && readU32LE(p.payload, 4) == 2 && readU32LE(p.payload, 8) == 2)
                .sorted(Comparator.comparingDouble(p -> p.clockSecs))
                .toList();
        System.out.println("== type7 propId=2 vs type-10 yaw (eid=" + eid + ", n=" + props.size() + ") ==");
        int printed = 0;
        double sumErr = 0;
        int count = 0;
        for (final EventStreamReader.ParsedPacket p : props) {
            EventStreamReader.PositionData near = null;
            float bestDt = Float.MAX_VALUE;
            for (final EventStreamReader.PositionData pos : positions) {
                if (pos.entityId != eid) {
                    continue;
                }
                final float dt = Math.abs(pos.clockSecs - p.clockSecs);
                if (dt < 0.5f && dt < bestDt) {
                    bestDt = dt;
                    near = pos;
                }
            }
            if (near == null) {
                continue;
            }
            final int raw = intValue(p.payload, 12, 2);
            final double propDeg = raw * 360.0 / 65536.0;
            final double pitchDeg = Math.toDegrees(near.pitch);
            double err = Math.abs(normalizeAngle(propDeg - pitchDeg));
            sumErr += err;
            count++;
            if (printed < 8) {
                System.out.printf(Locale.ROOT, "  t=%.1fs prop=%.1fdeg pitch=%.1fdeg err=%.1f%n",
                        p.clockSecs, propDeg, pitchDeg, err);
                printed++;
            }
        }
        System.out.printf(Locale.ROOT, "  mean abs err=%.2f deg (n=%d)%n",
                count == 0 ? -1 : sumErr / count, count);
    }

    private static double normalizeAngle(final double deg) {
        double a = deg % 360.0;
        if (a > 180) {
            a -= 360;
        }
        if (a < -180) {
            a += 360;
        }
        return a;
    }

    /** type31 single float vs recorder vehicle (eid 12558552) speed/yaw from type-10. */
    private static void type31VsRecorder(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final int recEid = 12558552;
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final List<EventStreamReader.PositionData> rec = positions.stream()
                .filter(p -> p.entityId == recEid)
                .sorted(Comparator.comparingDouble(p -> p.clockSecs))
                .toList();
        final List<EventStreamReader.ParsedPacket> t31 = byType.getOrDefault(31, List.of());
        System.out.println("== type31 vs recorder speed/yaw (eid=" + recEid + ") ==");
        int printed = 0;
        double sumSpeedErr = 0, sumYawErr = 0;
        int count = 0;
        for (final EventStreamReader.ParsedPacket p : t31) {
            if (p.payload.length < 4) {
                continue;
            }
            EventStreamReader.PositionData before = null;
            EventStreamReader.PositionData after = null;
            for (final EventStreamReader.PositionData pos : rec) {
                if (pos.clockSecs <= p.clockSecs) {
                    before = pos;
                } else {
                    after = pos;
                    break;
                }
            }
            if (before == null || after == null || after.clockSecs - before.clockSecs > 2f) {
                continue;
            }
            final double dt = after.clockSecs - before.clockSecs;
            final double speed = Math.hypot(after.x - before.x, after.z - before.z) / dt * 3.6;
            final float v = f(p.payload, 0);
            sumSpeedErr += Math.abs(v - speed);
            sumYawErr += Math.abs(normalizeAngle(v - Math.toDegrees(before.yaw)));
            count++;
            if (printed < 6) {
                System.out.printf(Locale.ROOT, "  t=%.1fs type31=%.2f recSpeed=%.1fkm/h recYaw=%.1fdeg%n",
                        p.clockSecs, v, speed, Math.toDegrees(before.yaw));
                printed++;
            }
        }
        System.out.printf(Locale.ROOT, "  n=%d mean|v-speed|=%.1f mean|v-yaw|=%.1fdeg%n",
                count, count == 0 ? -1 : sumSpeedErr / count, count == 0 ? -1 : sumYawErr / count);
    }

    /** Per-entity first/last position time + count + team (from updateArena2 field 4). */
    private static void teamCoverage(final EventStreamReader.EventStream es) {
        final Map<Integer, Integer> eidTeam = new HashMap<>();
        for (final EventStreamReader.ParsedPacket pkt : es.packets) {
            if (pkt.type != 8 || pkt.payload.length < 8) {
                continue;
            }
            final int subType = readU32LE(pkt.payload, 4);
            if (subType != 48) {
                continue;
            }
            final byte[] body = new byte[pkt.payload.length - 8];
            System.arraycopy(pkt.payload, 8, body, 0, body.length);
            final byte[] proto = unwrap(body);
            if (proto == null) {
                continue;
            }
            try {
                final Map<Integer, List<Object>> root = Protobuf.decode(proto);
                final Object wrapperRaw = Protobuf.first(root, 1);
                if (!(wrapperRaw instanceof byte[])) {
                    continue;
                }
                final Map<Integer, List<Object>> wrapper = Protobuf.decode((byte[]) wrapperRaw);
                final List<Object> players = wrapper.get(1);
                if (players == null) {
                    continue;
                }
                for (final Object pRaw : players) {
                    if (!(pRaw instanceof byte[])) {
                        continue;
                    }
                    final Map<Integer, List<Object>> p = Protobuf.decode((byte[]) pRaw);
                    final int eid = (int) Protobuf.firstLong(p, 1, 0);
                    final int team = (int) Protobuf.firstLong(p, 4, -1);
                    if (eid != 0) {
                        eidTeam.put(eid, team);
                    }
                }
            } catch (RuntimeException ignored) {
                // skip malformed
            }
        }
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final Map<Integer, List<EventStreamReader.PositionData>> byEntity = new TreeMap<>();
        for (final EventStreamReader.PositionData p : positions) {
            byEntity.computeIfAbsent(p.entityId, k -> new ArrayList<>()).add(p);
        }
        System.out.println("== per-entity position coverage with team ==");
        for (final Map.Entry<Integer, List<EventStreamReader.PositionData>> e : byEntity.entrySet()) {
            final List<EventStreamReader.PositionData> ps = e.getValue();
            final float first = ps.stream().min(Comparator.comparingDouble(p -> p.clockSecs))
                    .orElseThrow().clockSecs;
            final float last = ps.stream().max(Comparator.comparingDouble(p -> p.clockSecs))
                    .orElseThrow().clockSecs;
            System.out.printf(Locale.ROOT, "  eid=%d team=%d n=%d first=%.1fs last=%.1fs%n",
                    e.getKey(), eidTeam.getOrDefault(e.getKey(), -1), ps.size(), first, last);
        }
    }

    /** Find the recorder vehicle eid by nickname, then fit type39 (f0,f2) -> its (x,z). */
    private static void recorderAffine(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final int recorderEid = findEidByName(es, "CHRD-A158布丁");
        System.out.println("== recorder vehicle eid by name: " + recorderEid + " ==");
        if (recorderEid < 0) {
            return;
        }
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final List<EventStreamReader.PositionData> rec = positions.stream()
                .filter(p -> p.entityId == recorderEid)
                .sorted(Comparator.comparingDouble(p -> p.clockSecs))
                .toList();
        System.out.println("  recorder type-10 positions: " + rec.size()
                + " clock[" + (rec.isEmpty() ? "-" : String.format(Locale.ROOT, "%.1f..%.1f",
                rec.get(0).clockSecs, rec.get(rec.size() - 1).clockSecs)) + "]");
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        final java.util.List<double[]> pairs = new ArrayList<>();
        for (final EventStreamReader.ParsedPacket p : p39) {
            if (p.payload.length < 24) {
                continue;
            }
            EventStreamReader.PositionData near = null;
            float bestDt = Float.MAX_VALUE;
            for (final EventStreamReader.PositionData pos : rec) {
                final float dt = Math.abs(pos.clockSecs - p.clockSecs);
                if (dt < 0.5f && dt < bestDt) {
                    bestDt = dt;
                    near = pos;
                }
            }
            if (near == null) {
                continue;
            }
            pairs.add(new double[]{f(p.payload, 0), f(p.payload, 8), near.x, near.z, p.clockSecs});
        }
        System.out.println("  matched pairs: " + pairs.size());
        if (pairs.size() < 30) {
            return;
        }
        // least-squares affine (a,b,c,d,e,f): u = a*x + b*z + c ; v = d*x + e*z + f
        double sx = 0, sz = 0, su = 0, sv = 0, sxx = 0, szz = 0, sxz = 0, sux = 0, suz = 0, svx = 0, svz = 0;
        for (final double[] q : pairs) {
            final double u = q[0], v = q[1], x = q[2], z = q[3];
            sx += x; sz += z; su += u; sv += v;
            sxx += x * x; szz += z * z; sxz += x * z;
            sux += u * x; suz += u * z; svx += v * x; svz += v * z;
        }
        final int n = pairs.size();
        final double[][] m = {{sxx, sxz, sx}, {sxz, szz, sz}, {sx, sz, n}};
        final double[] bu = {sux, suz, su};
        final double[] bv = {svx, svz, sv};
        final double[] au = solve3(m, bu);
        final double[] av = solve3(m, bv);
        double resid = 0;
        for (final double[] q : pairs) {
            final double estU = au[0] * q[2] + au[1] * q[3] + au[2];
            final double estV = av[0] * q[2] + av[1] * q[3] + av[2];
            resid += Math.pow(estU - q[0], 2) + Math.pow(estV - q[1], 2);
        }
        final double std = Math.sqrt(resid / n);
        System.out.printf(Locale.ROOT,
                "  affine fit u=a*x+b*z+c, v=d*x+e*z+f: a=%.4f b=%.4f c=%.2f d=%.4f e=%.4f f=%.2f std=%.2fm%n",
                au[0], au[1], au[2], av[0], av[1], av[2], std);
    }

    private static int findEidByName(final EventStreamReader.EventStream es, final String name) {
        for (final EventStreamReader.ParsedPacket pkt : es.packets) {
            if (pkt.type != 8 || pkt.payload.length < 8) {
                continue;
            }
            final int subType = readU32LE(pkt.payload, 4);
            if (subType != 48) {
                continue;
            }
            final byte[] body = new byte[pkt.payload.length - 8];
            System.arraycopy(pkt.payload, 8, body, 0, body.length);
            final byte[] proto = unwrap(body);
            if (proto == null) {
                continue;
            }
            try {
                final Map<Integer, List<Object>> root = Protobuf.decode(proto);
                final Object wrapperRaw = Protobuf.first(root, 1);
                if (!(wrapperRaw instanceof byte[])) {
                    continue;
                }
                final Map<Integer, List<Object>> wrapper = Protobuf.decode((byte[]) wrapperRaw);
                final List<Object> players = wrapper.get(1);
                if (players == null) {
                    continue;
                }
                for (final Object pRaw : players) {
                    if (!(pRaw instanceof byte[])) {
                        continue;
                    }
                    final Map<Integer, List<Object>> p = Protobuf.decode((byte[]) pRaw);
                    final int eid = (int) Protobuf.firstLong(p, 1, 0);
                    final Object nameRaw = Protobuf.first(p, 3);
                    if (nameRaw instanceof byte[] b && name.equals(
                            new String(b, java.nio.charset.StandardCharsets.UTF_8))) {
                        return eid;
                    }
                }
            } catch (RuntimeException ignored) {
                // skip malformed packet
            }
        }
        return -1;
    }

    private static double[] solve3(final double[][] m, final double[] b) {
        final double[][] a = {{m[0][0], m[0][1], m[0][2]}, {m[1][0], m[1][1], m[1][2]}, {m[2][0], m[2][1], m[2][2]}};
        final double[] bb = {b[0], b[1], b[2]};
        for (int col = 0; col < 3; col++) {
            int pivot = col;
            for (int r = col + 1; r < 3; r++) {
                if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) {
                    pivot = r;
                }
            }
            final double[] tmp = a[col];
            a[col] = a[pivot];
            a[pivot] = tmp;
            final double t = bb[col];
            bb[col] = bb[pivot];
            bb[pivot] = t;
            for (int r = col + 1; r < 3; r++) {
                final double f = a[r][col] / a[col][col];
                for (int c = col; c < 3; c++) {
                    a[r][c] -= f * a[col][c];
                }
                bb[r] -= f * bb[col];
            }
        }
        final double[] x = new double[3];
        for (int r = 2; r >= 0; r--) {
            double s = bb[r];
            for (int c = r + 1; c < 3; c++) {
                s -= a[r][c] * x[c];
            }
            x[r] = s / a[r][r];
        }
        return x;
    }

    /** Find the recorder's vehicle eid by nickname in updateArena2 protobuf. */
    private static void findRecorder(final EventStreamReader.EventStream es) {
        final Map<Integer, Long> e2a = EventStreamReader.extractEntityToAccountMap(es.packets);
        System.out.println("== entity->account (first 20) ==");
        e2a.entrySet().stream().limit(20).forEach(e ->
                System.out.println("  eid=" + e.getKey() + " acc=" + e.getValue()));
    }

    /** Type 39 vs per-vehicle type-10 positions: find most stable offset mapping. */
    private static void type39VehicleCorrelation(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final Map<Integer, List<EventStreamReader.PositionData>> byEntity = new HashMap<>();
        for (final EventStreamReader.PositionData p : positions) {
            byEntity.computeIfAbsent(p.entityId, k -> new ArrayList<>()).add(p);
        }
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        System.out.println("== type39 vs vehicle position (best stable offset per entity) ==");
        final java.util.List<Map.Entry<String, Double>> best = new ArrayList<>();
        for (final Map.Entry<Integer, List<EventStreamReader.PositionData>> e : byEntity.entrySet()) {
            final List<EventStreamReader.PositionData> ps = e.getValue();
            if (ps.size() < 50) {
                continue;
            }
            for (final String[] pair : new String[][]{{"f0", "f2", "x", "z"}, {"f2", "f0", "x", "z"},
                    {"f0", "f2", "z", "x"}, {"-f0", "f2", "x", "z"}, {"f0", "-f2", "x", "z"}}) {
                final int fa = pair[0].equals("-f0") ? 0 : pair[0].equals("f0") ? 0
                        : pair[0].equals("f2") ? 8 : 0;
                final int fb = pair[1].equals("f2") ? 8 : 0;
                final int pa = pair[2].equals("x") ? 0 : 1;
                final int pb = pair[3].equals("x") ? 0 : 1;
                final boolean negA = pair[0].startsWith("-");
                final boolean negB = pair[1].startsWith("-");
                final java.util.List<double[]> deltas = new ArrayList<>();
                for (final EventStreamReader.ParsedPacket p : p39) {
                    if (p.payload.length < 24) {
                        continue;
                    }
                    EventStreamReader.PositionData near = null;
                    float bestD = Float.MAX_VALUE;
                    for (final EventStreamReader.PositionData pos : ps) {
                        final float dt = Math.abs(pos.clockSecs - p.clockSecs);
                        if (dt < 0.5f && dt < bestD) {
                            bestD = dt;
                            near = pos;
                        }
                    }
                    if (near == null) {
                        continue;
                    }
                    final float fA = f(p.payload, fa) * (negA ? -1 : 1);
                    final float fB = f(p.payload, fb) * (negB ? -1 : 1);
                    final float posA = pa == 0 ? near.x : near.z;
                    final float posB = pb == 0 ? near.x : near.z;
                    deltas.add(new double[]{fA - posA, fB - posB});
                }
                if (deltas.size() < 100) {
                    continue;
                }
                double meanA = 0, meanB = 0;
                for (final double[] d : deltas) {
                    meanA += d[0];
                    meanB += d[1];
                }
                meanA /= deltas.size();
                meanB /= deltas.size();
                double var = 0;
                for (final double[] d : deltas) {
                    var += Math.pow(d[0] - meanA, 2) + Math.pow(d[1] - meanB, 2);
                }
                var /= deltas.size();
                final double std = Math.sqrt(var);
                best.add(Map.entry("eid=" + e.getKey() + " " + pair[0] + "/" + pair[1] + "->" + pair[2] + "/" + pair[3]
                        + " offset=(" + String.format(Locale.ROOT, "%.1f,%.1f", meanA, meanB) + ") std="
                        + String.format(Locale.ROOT, "%.2f", std), std));
            }
        }
        best.sort(Map.Entry.comparingByValue());
        best.stream().limit(12).forEach(e -> System.out.println("  " + e.getKey()));
    }

    /** Type 39: inter-packet deltas + first 20 consecutive float rows + recorder-position match. */
    private static void type39Stream(
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        if (p39.isEmpty()) {
            return;
        }
        final List<EventStreamReader.ParsedPacket> sorted = new ArrayList<>(p39);
        sorted.sort(Comparator.comparingDouble(p -> p.clockSecs));
        final List<Double> deltas = new ArrayList<>();
        for (int i = 1; i < sorted.size(); i++) {
            deltas.add((double) (sorted.get(i).clockSecs - sorted.get(i - 1).clockSecs));
        }
        deltas.sort(Double::compareTo);
        final double median = deltas.get(deltas.size() / 2);
        final long near = deltas.stream().filter(d -> Math.abs(d - median) < 0.001).count();
        System.out.printf(Locale.ROOT, "== type39 stream: n=%d medianDelta=%.4fs (%.1fHz) near-median=%d/%d%n",
                sorted.size(), median, 1.0 / median, near, deltas.size());
        System.out.println("  first 20 consecutive rows:");
        for (int i = 0; i < 20 && i < sorted.size(); i++) {
            final EventStreamReader.ParsedPacket p = sorted.get(i);
            final StringBuilder sb = new StringBuilder(String.format(Locale.ROOT, "    t=%7.3fs", p.clockSecs));
            for (int f = 0; f < 7 && (f + 1) * 4 <= p.payload.length; f++) {
                sb.append(String.format(Locale.ROOT, " f%d=%9.3f", f, f(p.payload, f * 4)));
            }
            System.out.println(sb);
        }
    }

    /** Type 0/1/2/5/11/13: hex head + printable strings + account-id search. */
    private static void dumpCreatePackets(
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) throws Exception {
        for (final int t : new int[]{0, 1, 2, 5, 11, 13}) {
            final List<EventStreamReader.ParsedPacket> ps = byType.getOrDefault(t, List.of());
            System.out.println("== type " + t + " (" + ps.size() + " pkts) ==");
            for (final EventStreamReader.ParsedPacket p : ps) {
                final String h = hex(p.payload, 128);
                System.out.printf(Locale.ROOT, "  t=%.1fs len=%d%n    hex=%s%n", p.clockSecs, p.payload.length, h);
                final StringBuilder ascii = new StringBuilder();
                for (int i = 0; i < p.payload.length; i++) {
                    final int b = p.payload[i] & 0xFF;
                    ascii.append(b >= 32 && b < 127 ? (char) b : '.');
                }
                final String s = ascii.toString();
                for (final String tok : new String[]{"CHRD", "布丁", "3125216420", "12558550"}) {
                    final byte[] tb = tok.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    if (indexOf(p.payload, tb) >= 0) {
                        System.out.println("    CONTAINS: " + tok);
                    }
                }
                final StringBuilder runs = new StringBuilder();
                for (int i = 0; i < s.length(); i++) {
                    final char c = s.charAt(i);
                    if (c != '.') {
                        runs.append(c);
                    } else if (runs.length() > 0 && runs.charAt(runs.length() - 1) != ' ') {
                        runs.append(' ');
                    }
                }
                System.out.println("    ascii-runs: " + runs.toString().trim().replaceAll("\\s+", " "));
                final String outDir = System.getProperty("probe.out");
                if (outDir != null && (t <= 2 || t == 13 || t == 5 || t == 11)) {
                    final java.nio.file.Path out = java.nio.file.Path.of(outDir, "re_type" + t + ".bin");
                    java.nio.file.Files.write(out, p.payload);
                    System.out.println("    saved to " + out);
                }
            }
        }
    }

    private static int indexOf(final byte[] hay, final byte[] needle) {
        outer:
        for (int i = 0; i + needle.length <= hay.length; i++) {
            for (int j = 0; j < needle.length; j++) {
                if (hay[i + j] != needle[j]) {
                    continue outer;
                }
            }
            return i;
        }
        return -1;
    }

    /** Type 39: try axis swaps/negations to match type-10 positions. */
    private static void transformType39(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        final java.util.List<java.util.function.BiFunction<Float, Float, float[]>> axes = java.util.List.of(
                (Float a, Float b) -> new float[]{a, b},
                (Float a, Float b) -> new float[]{b, a},
                (Float a, Float b) -> new float[]{-a, b},
                (Float a, Float b) -> new float[]{a, -b},
                (Float a, Float b) -> new float[]{-b, a},
                (Float a, Float b) -> new float[]{b, -a});
        final String[] names = {"(f0,f2)", "(f2,f0)", "(-f0,f2)", "(f0,-f2)", "(-f2,f0)", "(f2,-f0)"};
        for (int ai = 0; ai < axes.size(); ai++) {
            final java.util.function.BiFunction<Float, Float, float[]> ax = axes.get(ai);
            int matched = 0;
            int checked = 0;
            for (final EventStreamReader.ParsedPacket p : p39) {
                if (p.payload.length < 24) {
                    continue;
                }
                final float[] xy = ax.apply(f(p.payload, 0), f(p.payload, 8));
                float best = Float.MAX_VALUE;
                for (final EventStreamReader.PositionData pos : positions) {
                    if (Math.abs(pos.clockSecs - p.clockSecs) > 0.5f) {
                        continue;
                    }
                    final float d = (float) Math.hypot(pos.x - xy[0], pos.z - xy[1]);
                    best = Math.min(best, d);
                }
                checked++;
                if (best < 10f) {
                    matched++;
                }
            }
            System.out.println("  type39 transform " + names[ai] + ": " + matched + " / " + checked);
        }
    }

    /** Type 31: print values around EntityLeave times (death correlation). */
    private static void type31AroundDeaths(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.ParsedPacket> t31 = byType.getOrDefault(31, List.of());
        final List<EventStreamReader.EntityLeaveEvent> leaves = EventStreamReader.extractEntityLeaves(es.packets);
        System.out.println("== type31 around EntityLeave times (leaves=" + leaves.size() + ") ==");
        for (final EventStreamReader.EntityLeaveEvent leave : leaves) {
            final List<String> vals = new ArrayList<>();
            for (final EventStreamReader.ParsedPacket p : t31) {
                if (Math.abs(p.clockSecs - leave.clockSecs) < 2.5f && p.payload.length >= 4) {
                    vals.add(String.format(Locale.ROOT, "%.2f", f(p.payload, 0)));
                }
            }
            System.out.printf(Locale.ROOT, "  leave t=%.1fs eid=%d t31 values: %s%n",
                    leave.clockSecs, leave.entityId, String.join(", ", vals));
        }
        if (leaves.isEmpty()) {
            System.out.println("  (no leaves)");
        }
    }

    /** Dump ALL protobuf fields of updateArena player entries for one account over time. */
    private static void dumpPlayerProtobuf(final EventStreamReader.EventStream es, final long accountId) {
        System.out.println("== updateArena protobuf player fields for account=" + accountId + " ==");
        int printed = 0;
        for (final EventStreamReader.ParsedPacket pkt : es.packets) {
            if (pkt.type != 8 || pkt.payload.length < 8) {
                continue;
            }
            final int subType = readU32LE(pkt.payload, 4);
            if (subType != 47 && subType != 48) {
                continue;
            }
            final byte[] body = new byte[pkt.payload.length - 8];
            System.arraycopy(pkt.payload, 8, body, 0, body.length);
            final byte[] proto = unwrap(body);
            if (proto == null) {
                continue;
            }
            final Map<Integer, List<Object>> root = Protobuf.decode(proto);
            final Object wrapperRaw = Protobuf.first(root, 1);
            if (!(wrapperRaw instanceof byte[])) {
                continue;
            }
            final Map<Integer, List<Object>> wrapper = Protobuf.decode((byte[]) wrapperRaw);
            final List<Object> playerList = wrapper.get(1);
            if (playerList == null) {
                continue;
            }
            for (final Object pRaw : playerList) {
                if (!(pRaw instanceof byte[])) {
                    continue;
                }
                final Map<Integer, List<Object>> p = Protobuf.decode((byte[]) pRaw);
                final long acc = Protobuf.firstLong(p, 7, 0);
                if (acc != accountId) {
                    continue;
                }
                final StringBuilder sb = new StringBuilder();
                sb.append(String.format(Locale.ROOT, "t=%7.1fs fields={", pkt.clockSecs));
                final List<Integer> keys = new ArrayList<>(p.keySet());
                keys.sort(Integer::compareTo);
                for (final int k : keys) {
                    sb.append(k).append("=").append(p.get(k)).append(" ");
                }
                sb.append("}");
                System.out.println(sb);
                printed++;
                if (printed >= 8) {
                    return;
                }
            }
        }
        if (printed == 0) {
            System.out.println("  no updateArena packets with this account");
        }
    }

    private static byte[] unwrap(final byte[] body) {
        if (body.length < 8) {
            return null;
        }
        int off = 4;
        final long[] varRes = readVarint(body, off);
        off = (int) varRes[1];
        final int first = body[off] & 0xFF;
        final int msgLen = first == 0xFF ? readU16LE(body, off + 1) : first;
        final int msgLenSize = first == 0xFF ? 4 : 1;
        off += msgLenSize;
        if (off + msgLen > body.length) {
            return null;
        }
        final byte[] proto = new byte[msgLen];
        System.arraycopy(body, off, proto, 0, msgLen);
        return proto;
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

    private static int readU16LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8);
    }


    /** type 7: find the propId whose value drops match damage events for the most-hit victim. */
    private static void correlateHp(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final Map<Integer, Long> e2a = EventStreamReader.extractEntityToAccountMap(es.packets);
        final List<EventStreamReader.DirectDamageEvent> damages =
                EventStreamReader.extractDirectDamageEvents(es.packets, e2a);
        final Map<Long, List<EventStreamReader.DirectDamageEvent>> byVictim = new HashMap<>();
        for (final EventStreamReader.DirectDamageEvent d : damages) {
            byVictim.computeIfAbsent(d.victimAccountId(), k -> new ArrayList<>()).add(d);
        }
        final Long victim = byVictim.entrySet().stream()
                .max(Comparator.comparingInt(e -> e.getValue().size()))
                .map(Map.Entry::getKey).orElse(null);
        if (victim == null) {
            System.out.println("no damage events");
            return;
        }
        final int victimEid = e2a.entrySet().stream()
                .filter(e -> e.getValue().equals(victim)).map(Map.Entry::getKey)
                .findFirst().orElse(-1);
        System.out.println("== HP correlation: victim account=" + victim + " eid=" + victimEid
                + " hits=" + byVictim.get(victim).size() + " ==");
        byVictim.get(victim).forEach(d -> System.out.printf(Locale.ROOT, "  dmg t=%.1fs dmg=%d%n",
                d.clockSecs(), d.damage()));
        System.out.println("  type7 propId timeline for eid=" + victimEid + ":");
        final List<EventStreamReader.ParsedPacket> props = byType.getOrDefault(7, List.of()).stream()
                .filter(p -> p.payload.length >= 12
                        && readI32LE(p.payload, 0) == victimEid)
                .sorted(Comparator.comparingDouble(p -> p.clockSecs))
                .toList();
        final Map<Integer, Long> propCounts = new HashMap<>();
        for (final EventStreamReader.ParsedPacket p : props) {
            final int propId = readU32LE(p.payload, 4);
            propCounts.merge(propId, 1L, Long::sum);
        }
        System.out.println("  distinct propIds: " + propCounts);
        for (final EventStreamReader.ParsedPacket p : props) {
            final int propId = readU32LE(p.payload, 4);
            final int len = readU32LE(p.payload, 8);
            final int valInt = intValue(p.payload, 12, len);
            final float valFloat = floatValue(p.payload, 12, len);
            final boolean nearDamage = byVictim.get(victim).stream()
                    .anyMatch(d -> Math.abs(d.clockSecs() - p.clockSecs) < 0.6f);
            if (nearDamage || propId == 1 || propId == 5 || propId == 6 || propId == 7) {
                System.out.printf(Locale.ROOT, "    t=%7.1fs prop=%d len=%d int=%d float=%.3f%s%n",
                        p.clockSecs, propId, len, valInt, valFloat, nearDamage ? " <-- near dmg" : "");
            }
        }
    }

    /** type 39: match f0/f1/f2 to nearest type-10 position to identify the entity. */
    private static void matchType39(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        int matched = 0;
        int checked = 0;
        for (final EventStreamReader.ParsedPacket p : p39) {
            if (p.payload.length < 24) {
                continue;
            }
            final float x = f(p.payload, 0);
            final float z = f(p.payload, 8);
            final float time = p.clockSecs;
            float bestDist = Float.MAX_VALUE;
            int bestEid = -1;
            for (final EventStreamReader.PositionData pos : positions) {
                if (Math.abs(pos.clockSecs - time) > 0.5f) {
                    continue;
                }
                final float d = (float) Math.hypot(pos.x - x, pos.z - z);
                if (d < bestDist) {
                    bestDist = d;
                    bestEid = pos.entityId;
                }
            }
            checked++;
            if (bestDist < 10f) {
                matched++;
            }
            if (checked <= 6) {
                System.out.printf(Locale.ROOT, "  t39 t=%.1fs pos=(%.1f,%.1f) nearest eid=%d dist=%.1f%n",
                        time, x, z, bestEid, bestDist);
            }
        }
        System.out.println("  type39 position-match: " + matched + " / " + checked
                + " (within 10m of a type-10 position within 0.5s)");
    }

    private static float f(final byte[] b, final int off) {
        return Float.intBitsToFloat(readU32LE(b, off));
    }

    private static int intValue(final byte[] b, final int off, final int len) {
        int v = 0;
        for (int i = 0; i < len; i++) {
            v |= (b[off + i] & 0xFF) << (8 * i);
        }
        return v;
    }

    private static float floatValue(final byte[] b, final int off, final int len) {
        if (len != 4) {
            return Float.NaN;
        }
        return Float.intBitsToFloat(readU32LE(b, off));
    }

    private static int readU32LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }

    private static int readI32LE(final byte[] buf, final int i) {
        return readU32LE(buf, i);
    }

    private static void dumpFloats(
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType,
            final int type, final int floatCount) {
        final List<EventStreamReader.ParsedPacket> ps = byType.getOrDefault(type, List.of());
        System.out.println("== type " + type + " float view (sample every " + Math.max(1, ps.size() / 10) + "th, first "
                + floatCount + " floats) ==");
        for (int i = 0; i < ps.size(); i += Math.max(1, ps.size() / 12)) {
            final EventStreamReader.ParsedPacket p = ps.get(i);
            final StringBuilder sb = new StringBuilder();
            sb.append(String.format(Locale.ROOT, "t=%7.1fs ", p.clockSecs));
            for (int f = 0; f < floatCount && (f + 1) * 4 <= p.payload.length; f++) {
                final float v = Float.intBitsToFloat(
                        ((p.payload[f * 4] & 0xFF)) | ((p.payload[f * 4 + 1] & 0xFF) << 8)
                                | ((p.payload[f * 4 + 2] & 0xFF) << 16) | ((p.payload[f * 4 + 3] & 0xFF) << 24));
                sb.append(String.format(Locale.ROOT, "f%d=%9.3f ", f, v));
            }
            System.out.println(sb);
        }
        final long distinct = ps.stream().map(p -> hex(p.payload, 64)).distinct().count();
        System.out.println("  distinct payloads: " + distinct + " / " + ps.size());
    }

    private static String hex(final byte[] b, final int limit) {
        final StringBuilder sb = new StringBuilder();
        final int n = Math.min(b.length, limit);
        for (int i = 0; i < n; i++) {
            sb.append(String.format(Locale.ROOT, "%02x", b[i]));
        }
        return sb.toString();
    }
}
