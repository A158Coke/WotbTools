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
