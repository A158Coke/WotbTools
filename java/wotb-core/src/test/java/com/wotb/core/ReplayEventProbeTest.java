package com.wotb.core;

import com.wotb.core.model.Source;
import com.wotb.core.parse.EventStreamReader;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.stream.RawReplayPacket;
import com.wotb.core.replay.stream.ReplayPacketStreamReader;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 事件流逆向探针（手动维护，不进常规 CI）：
 * 运行方式 {@code mvn -pl wotb-core test -Dtest=ReplayEventProbeTest -Dprobe.replay=<file>}。
 * 输出：包类型直方图、type 7 逐 propId 伤害相关性、type 39/31/35/32 结构样本。
 *
 * <p>当前逆向结论（2026-08-09，基于 4 个训练房样本交叉验证）：type 7 propId=3 为当前血量
 * （u16 LE，含装备加成；受击时同步、阵亡到 0、存活不到 0）；type 31 为
 * 4 字节 float（疑似速度），type 39 为 28 字节 float 密集（疑似位置+状态），待客户端
 * 资源对照。</p>
 */
class ReplayEventProbeTest {

    @Test
    void probe() throws Exception {
        final String path = System.getProperty("probe.replay");
        Assumptions.assumeTrue(path != null, "set -Dprobe.replay=<path> to run");
        final Path f = Path.of(path);
        final byte[] bytes = Files.readAllBytes(f);
        byte[] eventData = null;
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry e;
            while ((e = zis.getNextEntry()) != null) {
                if ("data.wotreplay".equals(e.getName())) {
                    eventData = zis.readAllBytes();
                }
            }
        }
        System.out.println("===== " + f.getFileName() + " =====");
        if (eventData == null) {
            System.out.println("data.wotreplay missing");
            return;
        }
        final var stream = ReplayPacketStreamReader.read(eventData);
        final Map<Integer, Integer> counts = new TreeMap<>();
        final Map<Integer, Integer> lenHist = new TreeMap<>();
        final Map<Integer, List<String>> type39Samples = new TreeMap<>();
        for (final RawReplayPacket p : stream.packets()) {
            counts.merge(p.type(), 1, Integer::sum);
            lenHist.merge(p.type(), p.payload().length, Integer::max);
            if (p.type() == 39 || p.type() == 31 || p.type() == 35 || p.type() == 32) {
                final List<String> samples = type39Samples.computeIfAbsent(p.type(), k -> new ArrayList<>());
                if (samples.size() < 8) {
                    samples.add(hex(slice(p.payload(), 0, 48)));
                }
            }
        }
        System.out.println("-- packet type counts / maxLen --");
        counts.forEach((t, c) -> System.out.println("  type=" + t + " count=" + c + " maxLen=" + lenHist.get(t)));
        System.out.println("-- type 39/31/35/32 samples (first 48B) --");
        type39Samples.forEach((t, samples) -> {
            System.out.println("  type=" + t);
            samples.forEach(s -> System.out.println("    " + s));
        });

        final var es = EventStreamReader.read(eventData);
        final Map<Integer, Long> e2a = EventStreamReader.extractEntityToAccountMap(es.packets);
        final ReplayProcessingResult result = new DefaultReplayProcessingFacade()
                .process(new Source(f.getFileName().toString(), bytes), ReplayProcessingOptions.full());
        if (result.reconstruction() != null) {
            System.out.println("-- reconstruction currentHealth sample (per damaged entity) --");
            final int[] targets = {12_529_749, 12_529_750, 12_529_751, 12_529_753};
            for (final int eid : targets) {
                int hits = 0;
                String sample = "none";
                for (final var cp : result.reconstruction().checkpoints()) {
                    final var vs = cp.stateSnapshot().vehiclesByEntityId().get(eid);
                    if (vs != null && vs.currentHealth() != null) {
                        hits++;
                        if (hits == 1 || hits % 20 == 0) {
                            sample = String.format("%.1fs hp=%d", cp.rawClockSec(), vs.currentHealth());
                            System.out.println("    eid=" + eid + " @" + sample);
                        }
                    }
                }
                System.out.println("    eid=" + eid + " hpSyncs=" + hits);
            }
        }

        // ---- winner / supremacy / destruction probe ----
        System.out.println("-- winner / supremacy probe --");
        if (result.battle() != null) {
            final var b = result.battle();
            System.out.println("  winnerTeam=" + b.winnerTeam
                    + " arenaBonusType=" + b.arenaBonusType
                    + " durationS=" + b.durationS
                    + " map=" + b.mapName
                    + " recorder=" + b.recorder);
            final long[] teamAlive = new long[3];
            final long[] teamTotal = new long[3];
            final long[] teamPts32 = new long[3];
            final long[] teamPts33 = new long[3];
            final long[] teamDamage = new long[3];
            for (final var p : b.players) {
                final int t = p.team >= 1 && p.team <= 2 ? p.team : 0;
                if (p.survived) teamAlive[t]++;
                teamTotal[t]++;
                teamDamage[t] += p.damageDealt;
                if (p.raw != null) {
                    teamPts32[t] += firstInt(p.raw, 32);
                    teamPts33[t] += firstInt(p.raw, 33);
                }
            }
            for (final int t : new int[]{1, 2}) {
                System.out.println("  team=" + t + " survived=" + teamAlive[t]
                        + "/" + teamTotal[t] + " damage=" + teamDamage[t]
                        + " pts32(sum)=" + teamPts32[t] + " pts33(sum)=" + teamPts33[t]);
            }
        }
        final List<String> type14 = new ArrayList<>();
        for (final RawReplayPacket p : stream.packets()) {
            if (p.type() == 14 && type14.size() < 6) {
                type14.add(String.format("%.1fs len=%d first16=%s",
                        p.rawClockSec(), p.payload().length, hex(slice(p.payload(), 0, 16))));
            }
        }
        System.out.println("-- type14 samples --");
        type14.forEach(s -> System.out.println("  " + s));

        // type 7 per-propId damage correlation
        final Map<Integer, List<String[]>> props = new TreeMap<>(); // eid -> [clock, propId, valueHex]
        final Map<Integer, List<String[]>> damages = new TreeMap<>(); // eid -> [clock, damage]
        for (final RawReplayPacket p : stream.packets()) {
            final byte[] b = p.payload();
            if (p.type() == 7 && b.length >= 12) {
                final int eid = readI32(b, 0);
                final int propId = readU32(b, 4);
                props.computeIfAbsent(eid, k -> new ArrayList<>())
                        .add(new String[]{String.format("%.1f", p.rawClockSec()), String.valueOf(propId),
                                hex(slice(b, 12, 6))});
            } else if (p.type() == 8 && b.length >= 25) {
                final byte[] body = slice(b, 8, b.length - 8);
                if (body.length >= 18 && (body[13] & 0xFF) == 3) {
                    final int victim = readI32(body, 8);
                    final int damage = (body[14] & 0xFF) << 8 | (body[15] & 0xFF);
                    if (damage > 0) {
                        damages.computeIfAbsent(victim, k -> new ArrayList<>())
                                .add(new String[]{String.format("%.1f", p.rawClockSec()), String.valueOf(damage)});
                    }
                }
            }
        }
        System.out.println("-- propId=3 HP validation (p3 start/min vs maxHp/damageReceived/survived) --");
        props.entrySet().stream()
                .filter(e -> e.getValue().stream().anyMatch(r -> "3".equals(r[1])))
                .forEach(e -> {
                    final int eid = e.getKey();
                    final Long acc = e2a.get(eid);
                    final List<String[]> p3 = e.getValue().stream()
                            .filter(r -> "3".equals(r[1]))
                            .toList();
                    int start = -1;
                    int min = Integer.MAX_VALUE;
                    float firstClock = -1;
                    for (final String[] r : p3) {
                        if (firstClock < 0) firstClock = Float.parseFloat(r[0]);
                        final int v = le16(r[2].substring(0, Math.min(4, r[2].length())));
                        if (start < 0) start = v;
                        min = Math.min(min, v);
                    }
                    final String tank = tankName(result, acc);
                    final String hp = maxHp(result, acc);
                    final String recv = damageReceived(result, acc);
                    final String survived = survived(result, acc);
                    System.out.println("  eid=" + eid + " tank=" + tank + " maxHp=" + hp
                            + " p3Start=0x" + Integer.toHexString(start) + "(" + start + ")"
                            + " p3Min=0x" + Integer.toHexString(min) + "(" + min + ")"
                            + " firstP3@=" + String.format("%.1f", firstClock)
                            + " dmgReceived=" + recv + " survived=" + survived);
                });
        System.out.println("-- type7 propId vs damage (per entity, per propId) --");
        damages.entrySet().stream()
                .sorted((x, y) -> Integer.compare(y.getValue().size(), x.getValue().size()))
                .limit(3)
                .forEach(entry -> {
                    final int eid = entry.getKey();
                    final Long acc = e2a.get(eid);
                    final String tank = tankName(result, acc);
                    System.out.println("  eid=" + eid + " acc=" + acc + " tank=" + tank
                            + " maxHp=" + maxHp(result, acc) + " damages=" + entry.getValue().size());
                    for (final int propId : new int[]{2, 3, 4}) {
                        final List<String[]> seq = props.getOrDefault(eid, List.of()).stream()
                                .filter(r -> Integer.parseInt(r[1]) == propId)
                                .toList();
                        if (seq.isEmpty()) continue;
                        for (final String[] dmg : entry.getValue()) {
                            final float dc = Float.parseFloat(dmg[0]);
                            String before = "?";
                            String after = "?";
                            for (int i = 0; i < seq.size(); i++) {
                                final float pc = Float.parseFloat(seq.get(i)[0]);
                                if (pc <= dc + 0.05f) before = seq.get(i)[2];
                                if (pc > dc + 0.05f && "?".equals(after)) after = seq.get(i)[2];
                            }
                            final int b = before.equals("?") ? -1 : le16(before.substring(0, 4));
                            final int a = after.equals("?") ? -1 : le16(after.substring(0, 4));
                            final int drop = (b >= 0 && a >= 0) ? (b - a) : Integer.MIN_VALUE;
                            System.out.println("    p" + propId + " dmg@" + dmg[0] + "(" + dmg[1] + ")"
                                    + " before=" + before + " after=" + after
                                    + " drop=" + (drop == Integer.MIN_VALUE ? "?" : drop));
                        }
                    }
                });
    }

    private static String tankName(final ReplayProcessingResult r, final Long acc) {
        if (r == null || r.battle() == null || r.battle().players == null || acc == null) return "?";
        return r.battle().players.stream()
                .filter(p -> p.accountId == acc)
                .findFirst()
                .map(p -> ReplayDisplayNames.tankName(p.tankId, p.tankName))
                .orElse("?");
    }

    private static String maxHp(final ReplayProcessingResult r, final Long acc) {
        if (r == null || r.battle() == null || r.battle().players == null || acc == null) return "?";
        return r.battle().players.stream()
                .filter(p -> p.accountId == acc)
                .findFirst()
                .map(p -> String.valueOf(ReplayDisplayNames.tankMaxHp(p.tankId)))
                .orElse("?");
    }

    private static String damageReceived(final ReplayProcessingResult r, final Long acc) {
        if (r == null || r.battle() == null || r.battle().players == null || acc == null) return "?";
        return r.battle().players.stream()
                .filter(p -> p.accountId == acc)
                .findFirst()
                .map(p -> String.valueOf(p.damageReceived))
                .orElse("?");
    }

    private static String survived(final ReplayProcessingResult r, final Long acc) {
        if (r == null || r.battle() == null || r.battle().players == null || acc == null) return "?";
        return r.battle().players.stream()
                .filter(p -> p.accountId == acc)
                .findFirst()
                .map(p -> String.valueOf(p.survived))
                .orElse("?");
    }

    private static long firstInt(final Map<Integer, List<Object>> raw, final int field) {
        final List<Object> values = raw.get(field);
        if (values == null || values.isEmpty()) return 0;
        return values.get(0) instanceof Number n ? n.longValue() : 0;
    }

    private static byte[] slice(final byte[] src, final int from, final int len) {
        final int n = Math.min(len, Math.max(0, src.length - from));
        final byte[] out = new byte[n];
        System.arraycopy(src, from, out, 0, n);
        return out;
    }

    private static int readI32(final byte[] buf, final int i) {
        if (buf == null || i + 4 > buf.length) return 0;
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }

    private static int readU32(final byte[] buf, final int i) {
        if (buf == null || i + 4 > buf.length) return 0;
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }

    private static String hex(final byte[] b) {
        if (b == null) return "";
        final StringBuilder sb = new StringBuilder();
        for (final byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    /** 前 4 个 hex 字符按 LE u16 解析（两个字节）。 */
    private static int le16(final String hex4) {
        final int lo = Integer.parseInt(hex4.substring(0, 2), 16);
        final int hi = Integer.parseInt(hex4.substring(2, 4), 16);
        return lo | (hi << 8);
    }
}
