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
        type39AimingHypothesis(es, byType);
        type39CameraVsRecorder(es, byType);
        type39ChangeEvents(byType);
        type39Histograms(byType);
        type39Lengths(byType);
        type39AngleChangeContext(byType);
        type39Endgame(es, byType);
        type31DistanceMatch(es, byType);
        type39LateRaw(byType);
        type39TargetMatch(es, byType);
        mysteryEntitiesVsType39(es, byType);
        alliesVsType39Late(es, byType);
        enemiesVsType39Late(es, byType);
        type39FullAffine(es, byType);
        eid13185652VsType39(es, byType);
        cameraTupleTest(es, byType);
        entity13185652Timeline(es);
        type39LastSeconds(byType, "team");
        type39AimRayGeometry(es, byType);
        type31DetailWindows(es, byType);
        randomRecorderVsType39(es, byType);
        dumpType1String(byType);
    }

    /** type1: hex + printable strings (recorder nickname). */
    private static void dumpType1String(
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.ParsedPacket> t1 = byType.getOrDefault(1, List.of());
        System.out.println("== type1 payload strings ==");
        for (final EventStreamReader.ParsedPacket p : t1) {
            final StringBuilder ascii = new StringBuilder();
            for (int i = 0; i < p.payload.length; i++) {
                final int b = p.payload[i] & 0xFF;
                ascii.append(b >= 32 && b < 127 ? (char) b : '.');
            }
            final String s = ascii.toString();
            final StringBuilder runs = new StringBuilder();
            for (int i = 0; i < s.length(); i++) {
                final char c = s.charAt(i);
                if (c != '.') {
                    runs.append(c);
                } else if (runs.length() > 0 && runs.charAt(runs.length() - 1) != ' ') {
                    runs.append(' ');
                }
            }
            System.out.println("  len=" + p.payload.length + " t=" + p.clockSecs
                    + " ascii-runs: " + runs.toString().trim().replaceAll("\\s+", " "));
        }
    }

    /** For the random battle: find the recorder vehicle (one whose positions hug type39 f2/f3/f4). */
    private static void randomRecorderVsType39(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final Map<Integer, List<EventStreamReader.PositionData>> byEntity = new TreeMap<>();
        for (final EventStreamReader.PositionData p : positions) {
            byEntity.computeIfAbsent(p.entityId, k -> new ArrayList<>()).add(p);
        }
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        System.out.println("== random battle: entities near type39 (f2,f3,f4) ==");
        final List<Map.Entry<String, Double>> best = new ArrayList<>();
        for (final Map.Entry<Integer, List<EventStreamReader.PositionData>> e : byEntity.entrySet()) {
            double sum = 0;
            int n = 0;
            for (final EventStreamReader.ParsedPacket p : p39) {
                if (p.payload.length < 28) {
                    continue;
                }
                EventStreamReader.PositionData near = null;
                float bestDt = Float.MAX_VALUE;
                for (final EventStreamReader.PositionData pos : e.getValue()) {
                    final float dt = Math.abs(pos.clockSecs - p.clockSecs);
                    if (dt < 0.5f && dt < bestDt) {
                        bestDt = dt;
                        near = pos;
                    }
                }
                if (near != null) {
                    sum += Math.hypot(f(p.payload, 8) - near.x,
                            Math.hypot(f(p.payload, 12) - near.y, f(p.payload, 16) - near.z));
                    n++;
                }
            }
            if (n > 100) {
                best.add(Map.entry("eid=" + e.getKey() + " n=" + n, sum / n));
            }
        }
        best.sort(Map.Entry.comparingByValue());
        best.stream().limit(6).forEach(x -> System.out.println("  " + x.getKey() + " meanD="
                + String.format(Locale.ROOT, "%.1fm", x.getValue())));
    }

    /** type31 raw values at battle start/end of the stream + recorder->enemy distances. */
    private static void type31DetailWindows(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final int recEid = 12558552;
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final Map<Integer, List<EventStreamReader.PositionData>> byEntity = new TreeMap<>();
        for (final EventStreamReader.PositionData p : positions) {
            byEntity.computeIfAbsent(p.entityId, k -> new ArrayList<>()).add(p);
        }
        final Map<Integer, Integer> eidTeam = new HashMap<>();
        for (final EventStreamReader.ParsedPacket pkt : es.packets) {
            if (pkt.type != 8 || pkt.payload.length < 8) {
                continue;
            }
            if (readU32LE(pkt.payload, 4) != 48) {
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
        final List<EventStreamReader.ParsedPacket> t31 = byType.getOrDefault(31, List.of());
        System.out.println("== type31 detail: first/last 3s of stream + rec->enemy distances ==");
        for (final String which : new String[]{"first", "last"}) {
            System.out.println("-- " + which + " 3s --");
            final List<EventStreamReader.ParsedPacket> sorted = new ArrayList<>(t31);
            sorted.sort(Comparator.comparingDouble(p -> p.clockSecs));
            final List<EventStreamReader.ParsedPacket> win = "first".equals(which)
                    ? sorted.stream().limit(90).toList()
                    : sorted.stream().skip(Math.max(0, sorted.size() - 90)).toList();
            for (final EventStreamReader.ParsedPacket p : win) {
                if (p.payload.length < 4) {
                    continue;
                }
                EventStreamReader.PositionData recPos = null;
                for (final EventStreamReader.PositionData pos : byEntity.getOrDefault(recEid, List.of())) {
                    if (pos.clockSecs <= p.clockSecs) {
                        recPos = pos;
                    } else {
                        break;
                    }
                }
                final StringBuilder sb = new StringBuilder(
                        String.format(Locale.ROOT, "  t=%7.1fs v=%6.2f", p.clockSecs, f(p.payload, 0)));
                if (recPos != null) {
                    for (final Map.Entry<Integer, List<EventStreamReader.PositionData>> e : byEntity.entrySet()) {
                        if (eidTeam.getOrDefault(e.getKey(), -1) != 1) {
                            continue;
                        }
                        EventStreamReader.PositionData near = null;
                        float bestDt = Float.MAX_VALUE;
                        for (final EventStreamReader.PositionData pos : e.getValue()) {
                            final float dt = Math.abs(pos.clockSecs - p.clockSecs);
                            if (dt < 0.5f && dt < bestDt) {
                                bestDt = dt;
                                near = pos;
                            }
                        }
                        if (near != null) {
                            final float d = (float) Math.hypot(recPos.x - near.x, recPos.z - near.z);
                            sb.append(String.format(Locale.ROOT, " e%d=%.0f", e.getKey(), d));
                        }
                    }
                }
                System.out.println(sb);
            }
        }
    }

    /**
     * If (f0,f1)=aim(x,z), (f2,f3,f4)=camera(x,y,z), f5=gun yaw: the azimuth from
     * camera to aim minus f5 should be nearly constant (parallax/calibration offset).
     */
    private static void type39AimRayGeometry(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        System.out.println("== type39 aim-ray geometry ==");
        double sumOff = 0, sumOffSq = 0;
        int n = 0;
        double minOff = 999, maxOff = -999;
        int printed = 0;
        for (final EventStreamReader.ParsedPacket p : p39) {
            if (p.payload.length < 28) {
                continue;
            }
            final float aimX = f(p.payload, 0);
            final float aimZ = f(p.payload, 1 * 4);
            final float camX = f(p.payload, 2 * 4);
            final float camZ = f(p.payload, 4 * 4);
            final float yaw = f(p.payload, 5 * 4);
            final float dX = aimX - camX;
            final float dZ = aimZ - camZ;
            if (Math.abs(dX) < 1e-3f && Math.abs(dZ) < 1e-3f) {
                continue;
            }
            final double az = Math.atan2(dZ, dX);
            final double off = normalizeAngle(Math.toDegrees(az - yaw));
            sumOff += off;
            sumOffSq += off * off;
            n++;
            minOff = Math.min(minOff, off);
            maxOff = Math.max(maxOff, off);
            if (printed < 10) {
                System.out.printf(Locale.ROOT,
                        "  t=%7.1fs az=%.1fdeg yaw(f5)=%.2frad(%.1fdeg) off=%.1fdeg%n",
                        p.clockSecs, Math.toDegrees(az), yaw, Math.toDegrees(yaw), off);
                printed++;
            }
        }
        final double mean = n == 0 ? 0 : sumOff / n;
        final double var = n == 0 ? 0 : Math.max(0, sumOffSq / n - mean * mean);
        System.out.printf(Locale.ROOT,
                "  n=%d offset mean=%.2fdeg std=%.2fdeg min=%.2f max=%.2f%n",
                n, mean, Math.sqrt(var), minOff, maxOff);
    }

    /** Print type39 floats every 0.5s for the last 40s of the stream. */
    private static void type39LastSeconds(
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType, final String label) {
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        if (p39.isEmpty()) {
            return;
        }
        final float last = (float) p39.stream().mapToDouble(p -> p.clockSecs).max().orElse(0);
        final float start = Math.max(0f, last - 40f);
        System.out.println("== type39 last 40s (" + label + ") ==");
        final List<EventStreamReader.ParsedPacket> sorted = new ArrayList<>(p39);
        sorted.sort(Comparator.comparingDouble(p -> p.clockSecs));
        float next = start;
        for (final EventStreamReader.ParsedPacket p : sorted) {
            if (p.clockSecs < next || p.payload.length < 28) {
                continue;
            }
            next = p.clockSecs + 0.5f;
            final StringBuilder sb = new StringBuilder(
                    String.format(Locale.ROOT, "  t=%7.3fs", p.clockSecs));
            for (int f = 0; f < 7; f++) {
                sb.append(String.format(Locale.ROOT, " f%d=%9.3f", f, f(p.payload, f * 4)));
            }
            System.out.println(sb);
        }
    }

    /** Full timeline of entity 13185652: distinct (x,y,z,yaw) states and their time windows. */
    private static void entity13185652Timeline(final EventStreamReader.EventStream es) {
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final List<EventStreamReader.PositionData> e = positions.stream()
                .filter(p -> p.entityId == 13185652)
                .sorted(Comparator.comparingDouble(p -> p.clockSecs))
                .toList();
        System.out.println("== entity 13185652 timeline ==");
        int changes = 0;
        float prevX = Float.NaN, prevY = Float.NaN, prevZ = Float.NaN, prevYaw = Float.NaN;
        float windowStart = 0;
        int printed = 0;
        for (final EventStreamReader.PositionData p : e) {
            final boolean changed = !(Math.abs(p.x - prevX) < 0.01f && Math.abs(p.y - prevY) < 0.01f
                    && Math.abs(p.z - prevZ) < 0.01f && Math.abs(p.yaw - prevYaw) < 0.01f);
            if (changed) {
                if (printed < 60) {
                    System.out.printf(Locale.ROOT, "  t=%7.1fs..%7.1fs pos=(%7.1f,%6.1f,%7.1f) yaw=%7.1fdeg%n",
                            windowStart, p.clockSecs, prevX, prevY, prevZ, Math.toDegrees(prevYaw));
                    printed++;
                }
                prevX = p.x;
                prevY = p.y;
                prevZ = p.z;
                prevYaw = p.yaw;
                windowStart = p.clockSecs;
                changes++;
            }
        }
        System.out.printf(Locale.ROOT, "  distinct states: %d of %d positions%n", changes + 1, e.size());
    }

    /**
     * Test whether (f2,f3,f4) is the camera position: distance to recorder tank
     * across the battle, and whether (f0,f1) is the aim point at distance f4+? no.
     */
    private static void cameraTupleTest(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final int recEid = 12558552;
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final List<EventStreamReader.PositionData> rec = positions.stream()
                .filter(p -> p.entityId == recEid)
                .sorted(Comparator.comparingDouble(p -> p.clockSecs))
                .toList();
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        System.out.println("== camera tuple test: (f2,f3,f4) vs recorder tank ==");
        double sum = 0, sumFlat = 0, sumF4 = 0;
        int n = 0;
        int close10 = 0, close30 = 0, close60 = 0;
        double maxD = 0;
        int printed = 0;
        for (final EventStreamReader.ParsedPacket p : p39) {
            if (p.payload.length < 28) {
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
            final float cx = f(p.payload, 8);
            final float cy = f(p.payload, 12);
            final float cz = f(p.payload, 16);
            final double d = Math.hypot(cx - near.x, Math.hypot(cy - near.y, cz - near.z));
            final double dFlat = Math.hypot(cx - near.x, cz - near.z);
            sum += d;
            sumFlat += dFlat;
            sumF4 += Math.abs(f(p.payload, 16) - near.z);
            n++;
            maxD = Math.max(maxD, d);
            if (d < 10) {
                close10++;
            }
            if (d < 30) {
                close30++;
            }
            if (d < 60) {
                close60++;
            }
            if (printed < 8) {
                System.out.printf(Locale.ROOT,
                        "  t=%7.1fs cam=(%7.1f,%6.1f,%7.1f) rec=(%7.1f,%6.1f,%7.1f) d=%6.1fm%n",
                        p.clockSecs, cx, cy, cz, near.x, near.y, near.z, d);
                printed++;
            }
        }
        System.out.printf(Locale.ROOT,
                "  n=%d meanD=%.1fm meanFlat=%.1fm maxD=%.1fm close10=%.1f%% close30=%.1f%% close60=%.1f%%%n",
                n, n == 0 ? -1 : sum / n, n == 0 ? -1 : sumFlat / n, maxD,
                n == 0 ? 0 : 100.0 * close10 / n, n == 0 ? 0 : 100.0 * close30 / n,
                n == 0 ? 0 : 100.0 * close60 / n);
    }

    /** Print entity 13185652 type-10 trajectory alongside type39 (f0,f1,f2) at 2s steps. */
    private static void eid13185652VsType39(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final List<EventStreamReader.PositionData> e = positions.stream()
                .filter(p -> p.entityId == 13185652)
                .sorted(Comparator.comparingDouble(p -> p.clockSecs))
                .toList();
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        System.out.println("== eid 13185652 vs type39 (2s samples) ==");
        float next = 0f;
        int ei = 0;
        for (final EventStreamReader.ParsedPacket p : p39) {
            if (p.clockSecs < next || p.payload.length < 28) {
                continue;
            }
            next = p.clockSecs + 2f;
            EventStreamReader.PositionData near = null;
            float bestDt = Float.MAX_VALUE;
            for (final EventStreamReader.PositionData pos : e) {
                final float dt = Math.abs(pos.clockSecs - p.clockSecs);
                if (dt < 0.5f && dt < bestDt) {
                    bestDt = dt;
                    near = pos;
                }
            }
            if (near == null) {
                continue;
            }
            final float d = (float) Math.hypot(f(p.payload, 0) - near.x,
                    Math.hypot(f(p.payload, 4) - near.y, f(p.payload, 8) - near.z));
            System.out.printf(Locale.ROOT,
                    "  t=%7.1fs e=(%7.1f,%6.1f,%7.1f) yaw=%6.1f t39=(%7.1f,%6.1f,%7.1f) d3D=%6.1fm%n",
                    p.clockSecs, near.x, near.y, near.z, Math.toDegrees(near.yaw),
                    f(p.payload, 0), f(p.payload, 4), f(p.payload, 8), d);
        }
        System.out.println("  eid 13185652 positions: " + e.size()
                + " clock[" + (e.isEmpty() ? "-" : String.format(Locale.ROOT, "%.1f..%.1f",
                e.get(0).clockSecs, e.get(e.size() - 1).clockSecs)) + "]");
        for (int i = 0; i < Math.min(6, e.size()); i++) {
            final EventStreamReader.PositionData q = e.get(i);
            System.out.printf(Locale.ROOT, "  first pos t=%7.1fs (%7.1f,%6.1f,%7.1f)%n",
                    q.clockSecs, q.x, q.y, q.z);
        }
    }

    /** Full least-squares affine fit of type39 (f0,f1,f2) -> each entity (x,y,z). */
    private static void type39FullAffine(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final Map<Integer, List<EventStreamReader.PositionData>> byEntity = new TreeMap<>();
        for (final EventStreamReader.PositionData p : positions) {
            byEntity.computeIfAbsent(p.entityId, k -> new ArrayList<>()).add(p);
        }
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        System.out.println("== type39 full affine fit -> each entity (std of residual) ==");
        final List<Map.Entry<String, Double>> best = new ArrayList<>();
        for (final Map.Entry<Integer, List<EventStreamReader.PositionData>> e : byEntity.entrySet()) {
            final List<double[]> pairs = new ArrayList<>();
            for (final EventStreamReader.ParsedPacket p : p39) {
                if (p.payload.length < 28) {
                    continue;
                }
                EventStreamReader.PositionData near = null;
                float bestDt = Float.MAX_VALUE;
                for (final EventStreamReader.PositionData pos : e.getValue()) {
                    final float dt = Math.abs(pos.clockSecs - p.clockSecs);
                    if (dt < 0.5f && dt < bestDt) {
                        bestDt = dt;
                        near = pos;
                    }
                }
                if (near != null) {
                    pairs.add(new double[]{f(p.payload, 0), f(p.payload, 4), f(p.payload, 8),
                            near.x, near.y, near.z});
                }
            }
            if (pairs.size() < 50) {
                continue;
            }
            // fit T: target = A * source + b  (least squares via normal equations)
            final double[][] ata = new double[4][4];
            final double[][] atb = new double[4][3];
            for (final double[] d : pairs) {
                final double[] row = {d[0], d[1], d[2], 1.0};
                for (int i = 0; i < 4; i++) {
                    for (int j = 0; j < 4; j++) {
                        ata[i][j] += row[i] * row[j];
                    }
                    for (int k = 0; k < 3; k++) {
                        atb[i][k] += row[i] * d[3 + k];
                    }
                }
            }
            final double[][] inv = invert4(ata);
            if (inv == null) {
                continue;
            }
            final double[][] m = new double[4][3];
            for (int i = 0; i < 4; i++) {
                for (int k = 0; k < 3; k++) {
                    for (int j = 0; j < 4; j++) {
                        m[i][k] += inv[i][j] * atb[j][k];
                    }
                }
            }
            double ss = 0;
            for (final double[] d : pairs) {
                final double px = m[0][0] * d[0] + m[1][0] * d[1] + m[2][0] * d[2] + m[3][0];
                final double py = m[0][1] * d[0] + m[1][1] * d[1] + m[2][1] * d[2] + m[3][1];
                final double pz = m[0][2] * d[0] + m[1][2] * d[1] + m[2][2] * d[2] + m[3][2];
                ss += Math.pow(px - d[3], 2) + Math.pow(py - d[4], 2) + Math.pow(pz - d[5], 2);
            }
            final double std = Math.sqrt(ss / pairs.size());
            best.add(Map.entry("eid=" + e.getKey() + " n=" + pairs.size(), std));
        }
        best.sort(Map.Entry.comparingByValue());
        best.stream().limit(12).forEach(x -> System.out.println("  " + x.getKey() + " std="
                + String.format(Locale.ROOT, "%.2f", x.getValue())));
    }

    private static double[][] invert4(final double[][] a) {
        final double[][] m = new double[4][8];
        for (int i = 0; i < 4; i++) {
            System.arraycopy(a[i], 0, m[i], 0, 4);
            m[i][4 + i] = 1;
        }
        for (int col = 0; col < 4; col++) {
            int pivot = col;
            for (int r = col + 1; r < 4; r++) {
                if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) {
                    pivot = r;
                }
            }
            if (Math.abs(m[pivot][col]) < 1e-12) {
                return null;
            }
            final double[] tmp = m[col];
            m[col] = m[pivot];
            m[pivot] = tmp;
            final double d = m[col][col];
            for (int j = 0; j < 8; j++) {
                m[col][j] /= d;
            }
            for (int r = 0; r < 4; r++) {
                if (r == col) {
                    continue;
                }
                final double f = m[r][col];
                for (int j = 0; j < 8; j++) {
                    m[r][j] -= f * m[col][j];
                }
            }
        }
        final double[][] inv = new double[4][4];
        for (int i = 0; i < 4; i++) {
            System.arraycopy(m[i], 4, inv[i], 0, 4);
        }
        return inv;
    }

    /** Print team-1 (enemy) positions at 115..147s alongside type39 (f0,f1,f2). */
    private static void enemiesVsType39Late(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
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
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        System.out.println("== type39 vs ENEMIES (team=1) t=115..147s ==");
        float next = 115f;
        for (final EventStreamReader.ParsedPacket p : p39) {
            if (p.clockSecs < next || p.payload.length < 28) {
                continue;
            }
            next = p.clockSecs + 1f;
            final StringBuilder sb = new StringBuilder(
                    String.format(Locale.ROOT, "  t=%7.1fs t39=(%7.1f,%6.1f,%7.1f) enemies:", p.clockSecs,
                            f(p.payload, 0), f(p.payload, 4), f(p.payload, 8)));
            for (final Map.Entry<Integer, List<EventStreamReader.PositionData>> e : byEntity.entrySet()) {
                if (eidTeam.getOrDefault(e.getKey(), -1) != 1) {
                    continue;
                }
                EventStreamReader.PositionData near = null;
                float bestDt = Float.MAX_VALUE;
                for (final EventStreamReader.PositionData pos : e.getValue()) {
                    final float dt = Math.abs(pos.clockSecs - p.clockSecs);
                    if (dt < 0.4f && dt < bestDt) {
                        bestDt = dt;
                        near = pos;
                    }
                }
                if (near != null) {
                    sb.append(String.format(Locale.ROOT, " e%d=(%7.1f,%6.1f,%7.1f)", e.getKey(), near.x, near.y, near.z));
                }
            }
            System.out.println(sb);
        }
    }

    /** Print team-2 (ally) positions at 115..147s alongside type39 (f0,f1,f2). */
    private static void alliesVsType39Late(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
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
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        System.out.println("== type39 vs ALLIES (team=2) t=115..147s ==");
        float next = 115f;
        for (final EventStreamReader.ParsedPacket p : p39) {
            if (p.clockSecs < next || p.payload.length < 28) {
                continue;
            }
            next = p.clockSecs + 1f;
            final StringBuilder sb = new StringBuilder(
                    String.format(Locale.ROOT, "  t=%7.1fs t39=(%7.1f,%6.1f,%7.1f) allies:", p.clockSecs,
                            f(p.payload, 0), f(p.payload, 4), f(p.payload, 8)));
            for (final Map.Entry<Integer, List<EventStreamReader.PositionData>> e : byEntity.entrySet()) {
                if (eidTeam.getOrDefault(e.getKey(), -1) != 2) {
                    continue;
                }
                EventStreamReader.PositionData near = null;
                float bestDt = Float.MAX_VALUE;
                for (final EventStreamReader.PositionData pos : e.getValue()) {
                    final float dt = Math.abs(pos.clockSecs - p.clockSecs);
                    if (dt < 0.4f && dt < bestDt) {
                        bestDt = dt;
                        near = pos;
                    }
                }
                if (near != null) {
                    sb.append(String.format(Locale.ROOT, " e%d=(%7.1f,%6.1f,%7.1f)", e.getKey(), near.x, near.y, near.z));
                }
            }
            System.out.println(sb);
        }
    }

    /** Print trajectories of team=-1 mystery entities alongside type39 (f0,f1,f2). */
    private static void mysteryEntitiesVsType39(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final Map<Integer, List<EventStreamReader.PositionData>> byEntity = new TreeMap<>();
        for (final EventStreamReader.PositionData p : positions) {
            byEntity.computeIfAbsent(p.entityId, k -> new ArrayList<>()).add(p);
        }
        final int[] mystery = {12558633, 12558634, 12558649};
        System.out.println("== mystery entities (team=-1) trajectories vs type39 ==");
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        float next39 = 6f;
        for (final EventStreamReader.ParsedPacket p : p39) {
            if (p.clockSecs < next39 || p.payload.length < 28) {
                continue;
            }
            next39 = p.clockSecs + 3f;
            final StringBuilder sb = new StringBuilder(
                    String.format(Locale.ROOT, "  t=%7.1fs", p.clockSecs));
            for (final int eid : mystery) {
                EventStreamReader.PositionData near = null;
                float bestDt = Float.MAX_VALUE;
                for (final EventStreamReader.PositionData pos : byEntity.getOrDefault(eid, List.of())) {
                    final float dt = Math.abs(pos.clockSecs - p.clockSecs);
                    if (dt < 0.3f && dt < bestDt) {
                        bestDt = dt;
                        near = pos;
                    }
                }
                if (near != null) {
                    sb.append(String.format(Locale.ROOT, " e%d=(%7.1f,%6.1f,%7.1f)", eid, near.x, near.y, near.z));
                }
            }
            sb.append(String.format(Locale.ROOT, " t39=(%7.1f,%6.1f,%7.1f)", f(p.payload, 0), f(p.payload, 4), f(p.payload, 8)));
            System.out.println(sb);
        }
    }

    /**
     * type39 = target/spectated entity position? For each sample, find the team-1
     * (enemy) vehicle whose (x,y,z) is nearest to (f0,f1,f2); report min-distance stats.
     */
    private static void type39TargetMatch(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
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
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        System.out.println("== type39 = enemy target position? (nearest team-1 entity per sample) ==");
        double sumBest = 0, sumBestFlat = 0;
        int n = 0;
        int within5 = 0, within15 = 0;
        final Map<Integer, Integer> bestByEid = new HashMap<>();
        for (final EventStreamReader.ParsedPacket p : p39) {
            if (p.payload.length < 28) {
                continue;
            }
            final float tx = f(p.payload, 0);
            final float ty = f(p.payload, 4);
            final float tz = f(p.payload, 8);
            double best = Double.MAX_VALUE;
            double bestFlat = Double.MAX_VALUE;
            int bestEid = -1;
            for (final Map.Entry<Integer, List<EventStreamReader.PositionData>> e : byEntity.entrySet()) {
                if (eidTeam.getOrDefault(e.getKey(), -1) != 1) {
                    continue;
                }
                EventStreamReader.PositionData near = null;
                float bestDt = Float.MAX_VALUE;
                for (final EventStreamReader.PositionData pos : e.getValue()) {
                    final float dt = Math.abs(pos.clockSecs - p.clockSecs);
                    if (dt < 0.5f && dt < bestDt) {
                        bestDt = dt;
                        near = pos;
                    }
                }
                if (near == null) {
                    continue;
                }
                final double d = Math.hypot(tx - near.x, Math.hypot(ty - near.y, tz - near.z));
                final double dFlat = Math.hypot(tx - near.x, tz - near.z);
                if (d < best) {
                    best = d;
                    bestFlat = dFlat;
                    bestEid = e.getKey();
                }
            }
            if (bestEid < 0) {
                continue;
            }
            sumBest += best;
            sumBestFlat += bestFlat;
            n++;
            if (best < 5) {
                within5++;
            }
            if (best < 15) {
                within15++;
            }
            bestByEid.merge(bestEid, 1, Integer::sum);
        }
        System.out.printf(Locale.ROOT,
                "  n=%d meanBest=%.2fm meanBestFlat=%.2fm within5=%.1f%% within15=%.1f%%%n",
                n, n == 0 ? -1 : sumBest / n, n == 0 ? -1 : sumBestFlat / n,
                n == 0 ? 0 : 100.0 * within5 / n, n == 0 ? 0 : 100.0 * within15 / n);
        bestByEid.entrySet().stream()
                .sorted(Map.Entry.<Integer, Integer>comparingByValue().reversed())
                .limit(8)
                .forEach(e -> System.out.println("  bestEid=" + e.getKey() + " samples=" + e.getValue()));
    }

    /** type39: raw hex + floats at 0.25s resolution for t in [100..147]. */
    private static void type39LateRaw(
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        System.out.println("== type39 late window t=100..147s (0.25s samples) ==");
        final List<EventStreamReader.ParsedPacket> sorted = new ArrayList<>(p39);
        sorted.sort(Comparator.comparingDouble(p -> p.clockSecs));
        float lastPrinted = -1f;
        for (final EventStreamReader.ParsedPacket p : sorted) {
            if (p.clockSecs < 100f || p.payload.length < 28) {
                continue;
            }
            if (p.clockSecs - lastPrinted < 0.25f) {
                continue;
            }
            lastPrinted = p.clockSecs;
            final StringBuilder sb = new StringBuilder(
                    String.format(Locale.ROOT, "  t=%7.3fs", p.clockSecs));
            for (int f = 0; f < 7; f++) {
                sb.append(String.format(Locale.ROOT, " f%d=%9.3f", f, f(p.payload, f * 4)));
            }
            sb.append(" hex=").append(hex(p.payload, 28));
            System.out.println(sb);
        }
    }

    /**
     * type31 = distance from recorder to a specific (target) entity?
     * For each type31 sample, compute distance recorder->every other entity and
     * check whether one entity's distance consistently equals the type31 value.
     */
    private static void type31DistanceMatch(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final int recEid = 12558552;
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final Map<Integer, List<EventStreamReader.PositionData>> byEntity = new TreeMap<>();
        for (final EventStreamReader.PositionData p : positions) {
            byEntity.computeIfAbsent(p.entityId, k -> new ArrayList<>()).add(p);
        }
        final List<EventStreamReader.ParsedPacket> t31 = byType.getOrDefault(31, List.of());
        System.out.println("== type31 = distance to a target entity? (rec eid=" + recEid + ") ==");
        // entity -> count of samples where |v - dist(rec, entity)| < 2m and entity has pos near t
        final Map<Integer, Integer> matchCount = new HashMap<>();
        final Map<Integer, List<String>> samples = new HashMap<>();
        int checked = 0;
        for (final EventStreamReader.ParsedPacket p : t31) {
            if (p.payload.length < 4) {
                continue;
            }
            final float v = f(p.payload, 0);
            EventStreamReader.PositionData recPos = null;
            for (final EventStreamReader.PositionData pos : byEntity.getOrDefault(recEid, List.of())) {
                if (pos.clockSecs <= p.clockSecs) {
                    recPos = pos;
                } else {
                    break;
                }
            }
            if (recPos == null || p.clockSecs - recPos.clockSecs > 1f) {
                continue;
            }
            checked++;
            for (final Map.Entry<Integer, List<EventStreamReader.PositionData>> e : byEntity.entrySet()) {
                if (e.getKey() == recEid) {
                    continue;
                }
                EventStreamReader.PositionData near = null;
                float bestDt = Float.MAX_VALUE;
                for (final EventStreamReader.PositionData pos : e.getValue()) {
                    final float dt = Math.abs(pos.clockSecs - p.clockSecs);
                    if (dt < 0.5f && dt < bestDt) {
                        bestDt = dt;
                        near = pos;
                    }
                }
                if (near == null) {
                    continue;
                }
                final float d = (float) Math.hypot(recPos.x - near.x, recPos.z - near.z);
                if (Math.abs(d - v) < 2f) {
                    matchCount.merge(e.getKey(), 1, Integer::sum);
                    samples.computeIfAbsent(e.getKey(), k -> new ArrayList<>())
                            .add(String.format(Locale.ROOT, "t=%.1fs v=%.1f d=%.1f", p.clockSecs, v, d));
                }
            }
        }
        final int totalChecked = checked;
        matchCount.entrySet().stream()
                .sorted(Map.Entry.<Integer, Integer>comparingByValue().reversed())
                .limit(8)
                .forEach(e -> {
                    System.out.println("  eid=" + e.getKey() + " matches=" + e.getValue() + "/" + totalChecked
                            + " firstSamples=" + samples.get(e.getKey()).stream().limit(3).toList());
                });
        System.out.println("  checked=" + checked);
    }

    /** type39 vs recorder position at endgame (110..147s) — does camera track vehicle? */
    private static void type39Endgame(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final int recEid = 12558552;
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final List<EventStreamReader.PositionData> rec = positions.stream()
                .filter(p -> p.entityId == recEid)
                .sorted(Comparator.comparingDouble(p -> p.clockSecs))
                .toList();
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        System.out.println("== type39 vs recorder pos, endgame t=110..147s ==");
        EventStreamReader.PositionData lastRec = null;
        float lastPrinted = -10f;
        for (final EventStreamReader.ParsedPacket p : p39) {
            if (p.clockSecs < 110f || p.clockSecs > 147.5f || p.payload.length < 28) {
                continue;
            }
            for (final EventStreamReader.PositionData pos : rec) {
                if (pos.clockSecs <= p.clockSecs) {
                    lastRec = pos;
                } else {
                    break;
                }
            }
            if (lastRec == null || p.clockSecs - lastRec.clockSecs > 2f) {
                continue;
            }
            if (p.clockSecs - lastPrinted < 2f) {
                continue;
            }
            lastPrinted = p.clockSecs;
            final float dFlat = (float) Math.hypot(f(p.payload, 0) - lastRec.x, f(p.payload, 8) - lastRec.z);
            System.out.printf(Locale.ROOT,
                    "  t=%7.1fs t39=(%8.1f,%6.1f,%8.1f) f3=%6.1f f4=%7.1f f5=%6.3f f6=%6.3f | rec=(%8.1f,%6.1f,%8.1f) dFlat=%6.1fm%n",
                    p.clockSecs, f(p.payload, 0), f(p.payload, 4), f(p.payload, 8),
                    f(p.payload, 12), f(p.payload, 16), f(p.payload, 20), f(p.payload, 24),
                    lastRec.x, lastRec.y, lastRec.z, dFlat);
        }
    }

    /** type39: payload length distribution + trailing bytes beyond 7 floats. */
    private static void type39Lengths(
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        final Map<Integer, Long> lens = new TreeMap<>();
        for (final EventStreamReader.ParsedPacket p : p39) {
            lens.merge(p.payload.length, 1L, Long::sum);
        }
        System.out.println("== type39 payload lengths ==");
        lens.forEach((k, v) -> System.out.println("  len=" + k + " count=" + v));
        final EventStreamReader.ParsedPacket sample = p39.stream()
                .filter(p -> p.payload.length > 28)
                .findFirst().orElse(null);
        if (sample != null) {
            System.out.println("  first >28B sample t=" + sample.clockSecs + " len=" + sample.payload.length
                    + " hex=" + hex(sample.payload, 96));
        }
    }

    /** type39: find rows where f5/f6 change materially; print 3 rows before/after for context. */
    private static void type39AngleChangeContext(
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        final List<EventStreamReader.ParsedPacket> sorted = new ArrayList<>(p39);
        sorted.sort(Comparator.comparingDouble(p -> p.clockSecs));
        System.out.println("== type39 rows where f5 or f6 changes by >0.02 rad (context) ==");
        float prev5 = Float.NaN, prev6 = Float.NaN;
        int events = 0;
        int printed = 0;
        for (int i = 0; i < sorted.size(); i++) {
            final EventStreamReader.ParsedPacket p = sorted.get(i);
            if (p.payload.length < 28) {
                continue;
            }
            final float v5 = f(p.payload, 20);
            final float v6 = f(p.payload, 24);
            if (!Float.isNaN(prev5) && (Math.abs(v5 - prev5) > 0.02f || Math.abs(v6 - prev6) > 0.02f)) {
                events++;
                if (printed < 24) {
                    for (int j = Math.max(0, i - 3); j <= Math.min(sorted.size() - 1, i + 3); j++) {
                        final EventStreamReader.ParsedPacket q = sorted.get(j);
                        if (q.payload.length < 28) {
                            continue;
                        }
                        final StringBuilder sb = new StringBuilder(
                                String.format(Locale.ROOT, "    t=%7.3fs", q.clockSecs));
                        for (int f = 0; f < 7 && (f + 1) * 4 <= q.payload.length; f++) {
                            sb.append(String.format(Locale.ROOT, " f%d=%9.3f", f, f(q.payload, f * 4)));
                        }
                        sb.append(j == i ? "  <-- change" : "");
                        System.out.println(sb);
                    }
                    printed++;
                }
            }
            prev5 = v5;
            prev6 = v6;
        }
        System.out.println("  total f5/f6 change events: " + events);
    }

    /**
     * type39 = recorder camera/aim state? Correlate f5/f6 (radians) with recorder
     * vehicle yaw/pitch, and f0/f1/f2 with recorder position + typical third-person
     * camera offsets (height above turret, offset behind along -yaw).
     */
    private static void type39CameraVsRecorder(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final int recEid = 12558552;
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final List<EventStreamReader.PositionData> rec = positions.stream()
                .filter(p -> p.entityId == recEid)
                .sorted(Comparator.comparingDouble(p -> p.clockSecs))
                .toList();
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        System.out.println("== type39 camera-vs-recorder hypothesis (eid=" + recEid + ") ==");
        double sumYawErr = 0, sumPitchErr = 0;
        int yawN = 0, pitchN = 0;
        double sumPosErr = 0, sumPosErrH = 0;
        int posN = 0, posNH = 0;
        int printed = 0;
        for (final EventStreamReader.ParsedPacket p : p39) {
            if (p.payload.length < 28) {
                continue;
            }
            EventStreamReader.PositionData before = null, after = null;
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
            final float yawDeg = (float) Math.toDegrees(before.yaw);
            final float pitchDeg = (float) Math.toDegrees(before.pitch);
            final float yawErr = (float) Math.abs(normalizeAngle(Math.toDegrees(f(p.payload, 20)) - yawDeg));
            final float pitchErr = (float) Math.abs(normalizeAngle(Math.toDegrees(f(p.payload, 24)) - pitchDeg));
            sumYawErr += yawErr;
            yawN++;
            sumPitchErr += pitchErr;
            pitchN++;
            // camera above vehicle (y + 5/10/15) and horizontal offset behind (-yaw dir)
            final float camX = f(p.payload, 0);
            final float camY = f(p.payload, 4);
            final float camZ = f(p.payload, 8);
            final double dFlat = Math.hypot(camX - before.x, camZ - before.z);
            final double dAll = Math.hypot(camX - before.x, Math.hypot(camY - before.y, camZ - before.z));
            sumPosErr += dAll;
            posN++;
            final double dFlatH = Math.hypot(camX - before.x, Math.hypot(camY - (before.y + 10f), camZ - before.z));
            sumPosErrH += dFlatH;
            posNH++;
            if (printed < 6) {
                System.out.printf(Locale.ROOT,
                        "  t=%.1fs cam=(%.1f,%.1f,%.1f) yaw=%.1fdeg pitch=%.1fdeg | rec pos=(%.1f,%.1f,%.1f) yaw=%.1fdeg pitch=%.1fdeg dFlat=%.1fm dYaw=%.1f dPitch=%.1f%n",
                        p.clockSecs, camX, camY, camZ, Math.toDegrees(f(p.payload, 20)),
                        Math.toDegrees(f(p.payload, 24)), before.x, before.y, before.z,
                        yawDeg, pitchDeg, dFlat, yawErr, pitchErr);
                printed++;
            }
        }
        System.out.printf(Locale.ROOT,
                "  yaw: n=%d mean|f5-yaw|=%.1fdeg  pitch: n=%d mean|f6-pitch|=%.1fdeg%n",
                yawN, yawN == 0 ? -1 : sumYawErr / yawN, pitchN, pitchN == 0 ? -1 : sumPitchErr / pitchN);
        System.out.printf(Locale.ROOT,
                "  cam pos: n=%d mean|f0..f2-recPos|=%.1fm  mean|f0..f2-(recPos+y10)|=%.1fm%n",
                posN, posN == 0 ? -1 : sumPosErr / posN, posNH == 0 ? -1 : sumPosErrH / posNH);
    }

    /** type39: print only rows whose payload differs from the previous (evolution of values). */
    private static void type39ChangeEvents(
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        final List<EventStreamReader.ParsedPacket> sorted = new ArrayList<>(p39);
        sorted.sort(Comparator.comparingDouble(p -> p.clockSecs));
        System.out.println("== type39 change events (first 160 payload changes) ==");
        byte[] prev = null;
        int changes = 0;
        for (final EventStreamReader.ParsedPacket p : sorted) {
            if (prev == null || !java.util.Arrays.equals(prev, p.payload)) {
                final StringBuilder sb = new StringBuilder(
                        String.format(Locale.ROOT, "  t=%7.3fs", p.clockSecs));
                for (int f = 0; f < 7 && (f + 1) * 4 <= p.payload.length; f++) {
                    sb.append(String.format(Locale.ROOT, " f%d=%9.3f", f, f(p.payload, f * 4)));
                }
                System.out.println(sb);
                changes++;
                if (changes >= 160) {
                    break;
                }
            }
            prev = p.payload;
        }
        System.out.println("  (total changes: " + changes + "+ shown)");
    }

    /** type39: histograms of f3/f4 (discrete modes?) and f5/f6 distributions. */
    private static void type39Histograms(
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        System.out.println("== type39 f3/f4 histograms (rounded) ==");
        final Map<Integer, Long> h3 = new TreeMap<>();
        final Map<Integer, Long> h4 = new TreeMap<>();
        for (final EventStreamReader.ParsedPacket p : p39) {
            if (p.payload.length < 28) {
                continue;
            }
            h3.merge(Math.round(f(p.payload, 12)), 1L, Long::sum);
            h4.merge(Math.round(f(p.payload, 16)), 1L, Long::sum);
        }
        System.out.print("  f3: ");
        h3.forEach((k, v) -> System.out.print(k + "=" + v + " "));
        System.out.println();
        System.out.print("  f4: ");
        h4.forEach((k, v) -> System.out.print(k + "=" + v + " "));
        System.out.println();
        final double[] f5 = new double[p39.size()];
        final double[] f6 = new double[p39.size()];
        for (int i = 0; i < p39.size(); i++) {
            final EventStreamReader.ParsedPacket p = p39.get(i);
            if (p.payload.length >= 28) {
                f5[i] = f(p.payload, 20);
                f6[i] = f(p.payload, 24);
            }
        }
        System.out.printf(Locale.ROOT, "  f5: min=%.3f max=%.3f mean=%.3f | f6: min=%.3f max=%.3f mean=%.3f%n",
                java.util.Arrays.stream(f5).min().orElse(0), java.util.Arrays.stream(f5).max().orElse(0),
                java.util.Arrays.stream(f5).average().orElse(0),
                java.util.Arrays.stream(f6).min().orElse(0), java.util.Arrays.stream(f6).max().orElse(0),
                java.util.Arrays.stream(f6).average().orElse(0));
    }

    /** type39 = recorder aiming info? f0/f1/f2 aim point, f3/f4/f5 gun pos (~vehicle pos). */
    private static void type39AimingHypothesis(
            final EventStreamReader.EventStream es,
            final Map<Integer, List<EventStreamReader.ParsedPacket>> byType) {
        final int recEid = 12558552;
        final List<EventStreamReader.PositionData> positions = EventStreamReader.extractPositions(es.packets);
        final List<EventStreamReader.PositionData> rec = positions.stream()
                .filter(p -> p.entityId == recEid)
                .sorted(Comparator.comparingDouble(p -> p.clockSecs))
                .toList();
        final List<EventStreamReader.ParsedPacket> p39 = byType.getOrDefault(39, List.of());
        System.out.println("== type39 aiming hypothesis (recorder eid=" + recEid + ") ==");
        double sumD0 = 0, sumD34 = 0;
        int n = 0;
        int close0 = 0, close34 = 0;
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
            final float aimX = f(p.payload, 0);
            final float aimZ = f(p.payload, 8);
            final float gunX = f(p.payload, 12);
            final float gunZ = f(p.payload, 16);
            final double d0 = Math.hypot(aimX - near.x, aimZ - near.z);
            final double d34 = Math.hypot(gunX - near.x, gunZ - near.z);
            sumD0 += d0;
            sumD34 += d34;
            if (d0 < 15) {
                close0++;
            }
            if (d34 < 15) {
                close34++;
            }
            n++;
        }
        System.out.printf(Locale.ROOT,
                "  n=%d meanDist(f0,f2 -> rec pos)=%.1fm (close<15m: %d) meanDist(f3,f4 -> rec pos)=%.1fm (close: %d)%n",
                n, n == 0 ? -1 : sumD0 / n, close0, n == 0 ? -1 : sumD34 / n, close34);
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
            final List<EventStreamReader.DirectDamageEvent> hits =
                    new ArrayList<>(dmg.getOrDefault(acc, List.of()));
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
