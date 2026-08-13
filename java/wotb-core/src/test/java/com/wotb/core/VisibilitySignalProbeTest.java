package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.EventStreamReader;
import com.wotb.core.parse.Protobuf;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.util.PlayerResultFormat;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 真理性门禁 A 探针：寻找「录像者客户端视角的敌方点亮/失察」的可靠事件流证据。
 *
 * <p>背景（2026-08-12）：type-10 位置流是服务器下发完整实体流，与点亮无关；
 * 敌方静止时不上报位置（首包约等于首次移动时刻）。当前 PR 用 gap≤5s 聚类构造
 * observedIntervals（OBSERVED/LOST），被判定为伪上帝视角。</p>
 *
 * <p>本探针逐项量化候选信号（禁止只靠看起来像）：</p>
 * <ul>
 *   <li>S1 type 4 EntityLeave / type 5 enterWorld / type 33 enter-confirm 语义与时间分布</li>
 *   <li>S2 type 7 propId 0/4/8 双态切换 vs 位置流出现/消失同步性</li>
 *   <li>S3 type 23（录像者开火）/type 26（敌方炮弹来袭）→ 交火锚点 + 相机朝向对照</li>
 *   <li>S4 随录像者观察状态变化的流（存活窗口/观战镜头实体 13185652）</li>
 *   <li>S5 敌方位置流 gap 结构（当前 PR 前提的量化检验）</li>
 * </ul>
 *
 * <p>运行：cd java &amp;&amp; mvn -s settings.xml test -Dtest=VisibilitySignalProbeTest
 * -Dsurefire.failIfNoSpecifiedTests=false（无样本时自动跳过并说明）。
 * 样本发现顺序：common/fixtures/replays/*.wotbreplay、common/data/*.wotbreplay
 * （gitignored 本地样本）、target/probe/*.wotbreplay（历次探针产物）。</p>
 */
@Tag("probe")
@Tag("manual")
class VisibilitySignalProbeTest {

    private static final double OBSERVED_GAP_SEC = 5.0;

    /** 探针样本：原始 zip + 解出的 data.wotreplay + 权威结算 + 映射表。 */
    private record Sample(
            String name,
            byte[] eventData,
            Battle battle,
            List<EventStreamReader.ParsedPacket> packets,
            Map<Integer, Long> e2a,
            Map<Integer, Integer> eidTeam,
            List<EventStreamReader.PositionData> positions,
            float battleStartRaw) {
    }

    @Test
    void probe() throws Exception {
        final List<Sample> samples = discoverSamples();
        Assumptions.assumeTrue(!samples.isEmpty(),
                "未发现任何回放样本（common/fixtures 缺失或 common/data 为空）——探针自动跳过");
        for (final Sample s : samples) {
            System.out.println("\n########## SAMPLE: " + s.name() + " ##########");
            try {
                runSample(s);
            } catch (final Exception e) {
                System.out.println("  [sample error] " + e);
            }
        }
    }

    // =====================================================================
    // 样本发现
    // =====================================================================

    private static List<Sample> discoverSamples() throws Exception {
        final List<Path> candidates = new ArrayList<>();
        final Path moduleDir = Path.of(System.getProperty("user.dir"));
        addIfExists(candidates, moduleDir.resolve("../../common/fixtures/replays"));
        addIfExists(candidates, moduleDir.resolve("../../common/data"));
        addIfExists(candidates, moduleDir.resolve("target/probe"));
        final List<Sample> samples = new ArrayList<>();
        final List<String> skipped = new ArrayList<>();
        for (final Path dir : candidates) {
            if (!Files.isDirectory(dir)) {
                continue;
            }
            try (Stream<Path> s = Files.list(dir)) {
                final List<Path> files = s.filter(p -> p.toString().toLowerCase().endsWith(".wotbreplay"))
                        .sorted().toList();
                for (final Path f : files) {
                    try {
                        samples.add(loadSample(f));
                    } catch (final Exception e) {
                        skipped.add(f.getFileName() + " (" + e.getMessage() + ")");
                    }
                }
            }
        }
        System.out.println("-- sample discovery --");
        for (final Sample s : samples) {
            final Battle b = s.battle();
            System.out.printf(Locale.ROOT, "  sample=%s map=%s mode=%s dur=%.1fs recorder=%s%n",
                    s.name(), b.mapName, b.arenaBonusType,
                    b.durationS == null ? -1 : b.durationS, b.recorder);
        }
        for (final String sk : skipped) {
            System.out.println("  skipped: " + sk);
        }
        return samples;
    }

    private static void addIfExists(final List<Path> out, final Path dir) {
        if (Files.isDirectory(dir)) {
            out.add(dir);
        }
    }

    private static Sample loadSample(final Path f) throws Exception {
        final byte[] zip = Files.readAllBytes(f);
        final byte[] eventData = extractEntry(zip, "data.wotreplay");
        if (eventData == null) {
            throw new IOException("missing data.wotreplay");
        }
        final Battle battle;
        try {
            battle = ReplayParser.parse(zip);
        } catch (final Exception e) {
            throw new IOException("battle_results parse failed: " + e.getMessage());
        }
        final EventStreamReader.EventStream es = EventStreamReader.read(eventData);
        final Map<Integer, Long> e2a = EventStreamReader.extractEntityToAccountMap(es.packets);
        final Map<Integer, Integer> eidTeam = new HashMap<>();
        buildTeamMap(es.packets, eidTeam);
        final List<EventStreamReader.PositionData> positions =
                EventStreamReader.extractPositions(es.packets);
        float minClock = Float.MAX_VALUE;
        for (final EventStreamReader.ParsedPacket p : es.packets) {
            minClock = Math.min(minClock, p.clockSecs);
        }
        if (minClock == Float.MAX_VALUE) {
            minClock = 0f;
        }
        return new Sample(f.getFileName().toString(), eventData, battle, es.packets,
                e2a, eidTeam, positions, minClock);
    }

    private static byte[] extractEntry(final byte[] zip, final String entryName) throws Exception {
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zip))) {
            ZipEntry e;
            while ((e = zis.getNextEntry()) != null) {
                if (entryName.equals(e.getName())) {
                    return zis.readAllBytes();
                }
            }
        }
        return null;
    }

    /** updateArena2（type 8 sub 48）→ eid→team。 */
    private static void buildTeamMap(
            final List<EventStreamReader.ParsedPacket> packets,
            final Map<Integer, Integer> eidTeam) {
        for (final EventStreamReader.ParsedPacket pkt : packets) {
            if (pkt.type != 8 || pkt.payload.length < 8) {
                continue;
            }
            if (u32(pkt.payload, 4) != 48) {
                continue;
            }
            final byte[] body = copy(pkt.payload, 8, pkt.payload.length - 8);
            try {
                int off = 4;
                final long[] vr = varint(body, off);
                off = (int) vr[1];
                final int first = body[off] & 0xFF;
                final int msgLen = first == 0xFF ? u16(body, off + 1) : first;
                final int msgLenSize = first == 0xFF ? 4 : 1;
                off += msgLenSize;
                final byte[] proto = copy(body, off, msgLen);
                final Map<Integer, List<Object>> root = Protobuf.decode(proto);
                final Object wrapperRaw = Protobuf.first(root, 1);
                if (!(wrapperRaw instanceof byte[] w)) {
                    continue;
                }
                final Map<Integer, List<Object>> wrapper = Protobuf.decode(w);
                final List<Object> players = wrapper.get(1);
                if (players == null) {
                    continue;
                }
                for (final Object pr : players) {
                    if (!(pr instanceof byte[] pb)) {
                        continue;
                    }
                    final Map<Integer, List<Object>> p = Protobuf.decode(pb);
                    final int eid = (int) Protobuf.firstLong(p, 1, 0);
                    final int t = (int) Protobuf.firstLong(p, 4, 0);
                    if (eid != 0 && t != 0) {
                        eidTeam.put(eid, t);
                    }
                }
            } catch (final RuntimeException ignored) {
                // malformed packet — skip
            }
        }
    }

    // =====================================================================
    // 主流程
    // =====================================================================

    private static void runSample(final Sample s) throws Exception {
        final Battle battle = s.battle();
        final Long recorderAcc = PlayerResultFormat.recorderAccountId(battle);
        Integer recorderEid = null;
        if (recorderAcc != null) {
            for (final Map.Entry<Integer, Long> e : s.e2a().entrySet()) {
                if (e.getValue().equals(recorderAcc)) {
                    recorderEid = e.getKey();
                    break;
                }
            }
        }
        final PlayerResult rec = battle == null ? null : battle.recorderResult();
        System.out.printf(Locale.ROOT,
                "  recorder acc=%s eid=%s team=%s survived=%s deathSec=%s%n",
                recorderAcc, recorderEid, rec == null ? "?" : rec.team,
                rec == null ? "?" : rec.survived,
                rec == null ? "?" : String.format(Locale.ROOT, "%.1f", PlayerResultFormat.deathSec(rec)));
        System.out.printf(Locale.ROOT, "  battleStartRawClock≈%.2fs (packet clock 起点)%n", s.battleStartRaw());

        globalStats(s);
        type8Subtypes(s);
        entityLifecycle(s);
        type7PropSeries(s, recorderAcc, recorderEid);
        engagementAnchors(s, recorderAcc, recorderEid);
        recorderClientStreams(s, recorderAcc, recorderEid);
        enemyPositionGaps(s, recorderAcc, recorderEid);
        spectatorEntity(s);
        rawPayloadProbes(s);
        enterLeaveDistanceAnalysis(s, recorderAcc, recorderEid);
        updateArenaRoster(s, recorderAcc);
        type8ShortAndType32(s, recorderAcc, recorderEid);
    }

    // ---------- GLOBAL ----------

    private static void globalStats(final Sample s) {
        final Map<Integer, int[]> byType = new TreeMap<>(); // type -> [count, minClockMs, maxClockMs]
        for (final EventStreamReader.ParsedPacket p : s.packets()) {
            final int[] v = byType.computeIfAbsent(p.type, k -> new int[]{0, Integer.MAX_VALUE, Integer.MIN_VALUE});
            v[0]++;
            v[1] = Math.min(v[1], (int) (p.clockSecs * 1000));
            v[2] = Math.max(v[2], (int) (p.clockSecs * 1000));
        }
        System.out.println("-- GLOBAL per-type count + clock window --");
        byType.forEach((t, v) -> System.out.printf(Locale.ROOT,
                "  type=%-3d count=%-7d window=[%.2f..%.2f]s%n",
                t, v[0], v[1] / 1000.0, v[2] / 1000.0));
    }

    private static void type8Subtypes(final Sample s) {
        final Map<Long, int[]> subs = new TreeMap<>(); // subtype -> [count, minLen, maxLen]
        final Map<Long, List<String>> samples = new TreeMap<>();
        for (final EventStreamReader.ParsedPacket p : s.packets()) {
            if (p.type != 8 || p.payload.length < 8) {
                continue;
            }
            final long sub = u32(p.payload, 4) & 0xFFFFFFFFL;
            final int[] v = subs.computeIfAbsent(sub, k -> new int[]{0, Integer.MAX_VALUE, Integer.MIN_VALUE});
            v[0]++;
            v[1] = Math.min(v[1], p.payload.length);
            v[2] = Math.max(v[2], p.payload.length);
            if (samples.computeIfAbsent(sub, k -> new ArrayList<>()).size() < 3) {
                samples.get(sub).add(String.format(Locale.ROOT, "%.1fs len=%d hex=%s",
                        p.clockSecs, p.payload.length,
                        hex(copy(p.payload, 8, Math.min(24, p.payload.length - 8)))));
            }
        }
        System.out.println("-- TYPE8 subtypes (count / payloadLen range) --");
        subs.forEach((sub, v) -> {
            System.out.printf(Locale.ROOT, "  sub=%-3d count=%-5d len[%d..%d]%n", sub, v[0], v[1], v[2]);
            for (final String x : samples.get(sub)) {
                System.out.println("      " + x);
            }
        });
    }

    // ---------- S1 ENTITY LIFECYCLE ----------

    private static void entityLifecycle(final Sample s) {
        final Map<Integer, int[]> type5 = new TreeMap<>();
        final Map<Integer, int[]> type33 = new TreeMap<>();
        final Map<Integer, int[]> type4 = new TreeMap<>();
        final Map<Integer, int[]> type7 = new TreeMap<>();
        final Map<Integer, int[]> type10 = new TreeMap<>();
        final Map<Integer, int[]> type32 = new TreeMap<>();
        for (final EventStreamReader.ParsedPacket p : s.packets()) {
            if (p.type == 5) {
                aggByEid(type5, eidFromPayload(p), p);
            } else if (p.type == 33) {
                aggByEid(type33, eidFromPayload(p), p);
            } else if (p.type == 4 && p.payload.length >= 4) {
                aggByEid(type4, i32(p.payload, 0), p);
            } else if (p.type == 7 && p.payload.length >= 4) {
                aggByEid(type7, i32(p.payload, 0), p);
            } else if (p.type == 10 && p.payload.length >= 4) {
                aggByEid(type10, i32(p.payload, 0), p);
            } else if (p.type == 32 && p.payload.length >= 4) {
                aggByEid(type32, u32(p.payload, 0), p);
            }
        }
        final Battle battle = s.battle();
        final List<PlayerResult> players = battle == null ? null : battle.players;
        System.out.println("-- S1 ENTITY LIFECYCLE: players (t5/t33/leave/pos/t7 windows) --");
        if (players != null) {
            final List<PlayerResult> sorted = new ArrayList<>(players);
            sorted.sort(Comparator.<PlayerResult>comparingInt(p -> p.team).thenComparingLong(p -> p.accountId));
            for (final PlayerResult p : sorted) {
                final Integer eid = eidOf(s, p.accountId);
                System.out.printf(Locale.ROOT,
                        "  eid=%-10s acc=%-11d team=%d t5=%s t33=%s leave=%s pos=%s t7=%s death=%s%n",
                        eid == null ? "-" : eid, p.accountId, p.team,
                        fmtAgg(type5, eid), fmtAgg(type33, eid), fmtAgg(type4, eid),
                        fmtAgg(type10, eid), fmtAgg(type7, eid),
                        p.survived ? "alive" : String.format(Locale.ROOT, "%.1f", PlayerResultFormat.deathSec(p)));
            }
        }
        System.out.println("-- S1b non-player entities (unmapped) with t5/t33/leave/pos/t32 --");
        final Set<Integer> playerEids = new HashSet<>();
        if (players != null) {
            for (final PlayerResult p : players) {
                final Integer eid = eidOf(s, p.accountId);
                if (eid != null) {
                    playerEids.add(eid);
                }
            }
        }
        final Set<Integer> allEids = new TreeSet<>();
        allEids.addAll(type5.keySet());
        allEids.addAll(type33.keySet());
        allEids.addAll(type4.keySet());
        allEids.addAll(type10.keySet());
        allEids.addAll(type32.keySet());
        int shown = 0;
        for (final int eid : allEids) {
            if (playerEids.contains(eid)) {
                continue;
            }
            if (s.e2a().containsKey(eid)) {
                continue; // mapped to an account but absent from settlement roster
            }
            if (shown >= 25) {
                System.out.println("  ... (more)");
                break;
            }
            System.out.printf(Locale.ROOT,
                    "  eid=%d t5=%s t33=%s leave=%s pos=%s t32=%s%n",
                    eid, fmtAgg(type5, eid), fmtAgg(type33, eid), fmtAgg(type4, eid),
                    fmtAgg(type10, eid), fmtAgg(type32, eid));
            shown++;
        }
        if (players != null) {
            int withT5 = 0, withT33 = 0, withT10 = 0, t5NearStart = 0;
            for (final PlayerResult p : players) {
                final Integer eid = eidOf(s, p.accountId);
                if (eid == null) {
                    continue;
                }
                final int[] t5 = type5.get(eid);
                final int[] t33 = type33.get(eid);
                if (t5 != null) {
                    withT5++;
                    if (t5[1] / 1000.0 < 15) {
                        t5NearStart++;
                    }
                }
                if (t33 != null) {
                    withT33++;
                }
                if (type10.containsKey(eid)) {
                    withT10++;
                }
            }
            System.out.printf(Locale.ROOT,
                    "  summary: players=%d withT5=%d(t5First<15s:%d) withT33=%d withPos=%d%n",
                    players.size(), withT5, t5NearStart, withT33, withT10);
        }
    }

    private static int eidFromPayload(final EventStreamReader.ParsedPacket p) {
        // type 5/33 的 eid 在负载开头（u32 无符号；type5 用 i32 有符号更贴近 entityId 语义）
        return p.payload.length >= 4 ? i32(p.payload, 0) : -1;
    }

    private static Integer eidOf(final Sample s, final long accountId) {
        for (final Map.Entry<Integer, Long> e : s.e2a().entrySet()) {
            if (e.getValue().equals(accountId)) {
                return e.getKey();
            }
        }
        return null;
    }

    private static void aggByEid(final Map<Integer, int[]> map, final int eid, final EventStreamReader.ParsedPacket p) {
        final int[] v = map.computeIfAbsent(eid, k -> new int[]{0, Integer.MAX_VALUE, Integer.MIN_VALUE});
        v[0]++;
        v[1] = Math.min(v[1], (int) (p.clockSecs * 1000));
        v[2] = Math.max(v[2], (int) (p.clockSecs * 1000));
    }

    private static String fmtAgg(final Map<Integer, int[]> map, final Integer eid) {
        if (eid == null) {
            return "-";
        }
        final int[] v = map.get(eid);
        if (v == null) {
            return "-";
        }
        return String.format(Locale.ROOT, "%d@[%.2f..%.2f]", v[0], v[1] / 1000.0, v[2] / 1000.0);
    }

    // ---------- S2 TYPE 7 PROP SERIES ----------

    private static void type7PropSeries(final Sample s, final Long recorderAcc, final Integer recorderEid) {
        final Map<Integer, Map<Integer, List<float[]>>> props = new TreeMap<>();
        for (final EventStreamReader.ParsedPacket p : s.packets()) {
            if (p.type != 7 || p.payload.length < 12) {
                continue;
            }
            final int eid = i32(p.payload, 0);
            final int propId = u32(p.payload, 4);
            final int valueLen = u32(p.payload, 8);
            if (valueLen < 1 || 12 + valueLen > p.payload.length) {
                continue;
            }
            long raw = 0;
            for (int i = 0; i < valueLen; i++) {
                raw |= (long) (p.payload[12 + i] & 0xFF) << (8 * i);
            }
            props.computeIfAbsent(eid, k -> new TreeMap<>())
                    .computeIfAbsent(propId, k -> new ArrayList<>())
                    .add(new float[]{p.clockSecs, raw});
        }
        System.out.println("-- S2 TYPE7 per entity: propId count / window / transitions --");
        final Battle battle = s.battle();
        final List<PlayerResult> players = battle == null ? null : battle.players;
        final Set<Integer> playerEids = new HashSet<>();
        if (players != null) {
            for (final PlayerResult p : players) {
                final Integer eid = eidOf(s, p.accountId);
                if (eid != null) {
                    playerEids.add(eid);
                }
            }
        }
        for (final Map.Entry<Integer, Map<Integer, List<float[]>>> e : props.entrySet()) {
            final int eid = e.getKey();
            final Long acc = s.e2a().get(eid);
            final int team = s.eidTeam().getOrDefault(eid, 0);
            final boolean isPlayer = playerEids.contains(eid);
            final boolean isRecorder = recorderEid != null && eid == recorderEid;
            if (!isPlayer && !isRecorder) {
                continue; // 只输出玩家实体，控制篇幅
            }
            for (final Map.Entry<Integer, List<float[]>> pe : e.getValue().entrySet()) {
                final int propId = pe.getKey();
                if (propId != 0 && propId != 1 && propId != 2 && propId != 3
                        && propId != 4 && propId != 7 && propId != 8 && propId != 9) {
                    continue;
                }
                final List<float[]> seq = pe.getValue();
                seq.sort(Comparator.comparingDouble(a -> a[0]));
                int transitions = 0;
                for (int i = 1; i < seq.size(); i++) {
                    if (seq.get(i)[1] != seq.get(i - 1)[1]) {
                        transitions++;
                    }
                }
                System.out.printf(Locale.ROOT,
                        "  eid=%-10d acc=%-11d team=%d %s propId=%d count=%-6d first=%.2fs last=%.2fs transitions=%d firstVal=%d lastVal=%d%n",
                        eid, acc == null ? 0 : acc, team,
                        isRecorder ? "REC" : "PLAYER",
                        propId, seq.size(), seq.get(0)[0], seq.get(seq.size() - 1)[0],
                        transitions, (long) seq.get(0)[1], (long) seq.get(seq.size() - 1)[1]);
            }
        }
        System.out.println("-- S2b propId=4 transitions vs enemy position-stream start (sync test) --");
        final Map<Integer, List<float[]>> t10 = new TreeMap<>();
        for (final EventStreamReader.PositionData p : s.positions()) {
            t10.computeIfAbsent(p.entityId, k -> new ArrayList<>()).add(new float[]{p.clockSecs, 0});
        }
        for (final Map.Entry<Integer, Map<Integer, List<float[]>>> e : props.entrySet()) {
            final int eid = e.getKey();
            final List<float[]> p4 = e.getValue().get(4);
            if (p4 == null || p4.size() < 2) {
                continue;
            }
            p4.sort(Comparator.comparingDouble(a -> a[0]));
            final List<float[]> pos = t10.getOrDefault(eid, List.of());
            final float posStart = pos.isEmpty() ? -1 : pos.get(0)[0];
            final java.util.Set<Long> distinct = new TreeSet<>();
            int toggles = 0;
            int shown = 0;
            for (int i = 1; i < p4.size(); i++) {
                if (p4.get(i)[1] != p4.get(i - 1)[1]) {
                    toggles++;
                    distinct.add((long) p4.get(i)[1]);
                    if (shown < 6) {
                        final float t = p4.get(i)[0];
                        System.out.printf(Locale.ROOT,
                                "  eid=%-10d prop4 toggle@%.2fs %d->%d posStart=%.2f dtToPosStart=%.2fs%n",
                                eid, t, (long) p4.get(i - 1)[1], (long) p4.get(i)[1],
                                posStart, posStart < 0 ? Float.NaN : (t - posStart));
                        shown++;
                    }
                }
            }
            System.out.printf(Locale.ROOT,
                    "  ... eid=%d prop4 toggles=%d distinctValues=%d (位掩码变化, 非双态)%n",
                    eid, toggles, distinct.size());
        }
    }

    // ---------- S3 ENGAGEMENT ANCHORS ----------

    private static void engagementAnchors(final Sample s, final Long recorderAcc, final Integer recorderEid) {
        final Map<Integer, Long> e2a = s.e2a();
        final List<EventStreamReader.DirectDamageEvent> dmg = EventStreamReader.extractDirectDamageEvents(
                s.packets(), e2a);
        final Integer recTeam = recorderTeam(s);
        System.out.println("-- S3.1 recorder-attacker damage (recorder fired and hit) --");
        int recDealt = 0, recDealtToEnemy = 0, recDealtWithCam = 0, recDealtCamLooking = 0, camNoData = 0;
        final List<String> anchorRows = new ArrayList<>();
        for (final EventStreamReader.DirectDamageEvent d : dmg) {
            if (recorderAcc == null || d.attackerAccountId() != recorderAcc) {
                continue;
            }
            recDealt++;
            final Integer victimEid = eidOf(s, d.victimAccountId());
            final int victimTeam = victimEid == null ? 0 : s.eidTeam().getOrDefault(victimEid, 0);
            final boolean enemy = victimTeam != 0 && recTeam != null && victimTeam != recTeam;
            if (enemy) {
                recDealtToEnemy++;
            }
            final CamCheck cam = cameraLookAt(s, recorderEid, victimEid, d.clockSecs());
            if (cam == null) {
                camNoData++;
            } else {
                recDealtWithCam++;
                if (cam.looking()) {
                    recDealtCamLooking++;
                }
            }
            anchorRows.add(String.format(Locale.ROOT,
                    "  hit t=%7.2fs victimEid=%-10s victimAcc=%-11d team=%d dmg=%d cam=%s",
                    d.clockSecs(), victimEid == null ? "-" : victimEid, d.victimAccountId(),
                    victimTeam, d.damage(), cam == null ? "NO_CAM" :
                            String.format(Locale.ROOT, "yawDiff=%.1fdeg looking=%s camYaw=%.1f",
                                    cam.yawDiff(), cam.looking(), cam.camYaw())));
        }
        for (final String row : anchorRows) {
            System.out.println(row);
        }
        System.out.printf(Locale.ROOT,
                "  summary: recorder-hit=%d toEnemy=%d camData=%d camLooking=%d camNoData=%d%n",
                recDealt, recDealtToEnemy, recDealtWithCam, recDealtCamLooking, camNoData);

        System.out.println("-- S3.2 recorder-victim damage (recorder got hit) --");
        final List<EventStreamReader.ParsedPacket> t26 = s.packets().stream()
                .filter(p -> p.type == 26).sorted(Comparator.comparingDouble(p -> p.clockSecs)).toList();
        int recRecv = 0;
        for (final EventStreamReader.DirectDamageEvent d : dmg) {
            if (recorderAcc == null || d.victimAccountId() != recorderAcc) {
                continue;
            }
            recRecv++;
            final Integer attackerEid = eidOf(s, d.attackerAccountId());
            final int attackerTeam = attackerEid == null ? 0 : s.eidTeam().getOrDefault(attackerEid, 0);
            final boolean t26near = t26.stream().anyMatch(p -> Math.abs(p.clockSecs - d.clockSecs()) < 3.0f);
            System.out.printf(Locale.ROOT,
                    "  hit t=%7.2fs attackerEid=%-10s attackerAcc=%-11d team=%d dmg=%d type26near=%s%n",
                    d.clockSecs(), attackerEid == null ? "-" : attackerEid, d.attackerAccountId(),
                    attackerTeam, d.damage(), t26near);
        }
        System.out.printf(Locale.ROOT, "  summary: recorder-received=%d type26Count=%d%n", recRecv, t26.size());

        System.out.println("-- S3.3 type23 shots -> recorder-attacker damage target --");
        final List<EventStreamReader.DirectDamageEvent> recDealtList = dmg.stream()
                .filter(d -> recorderAcc != null && d.attackerAccountId() == recorderAcc)
                .sorted(Comparator.comparingDouble(EventStreamReader.DirectDamageEvent::clockSecs))
                .toList();
        int shots = 0, shotsMatched = 0;
        for (final EventStreamReader.ParsedPacket p : s.packets()) {
            if (p.type != 23 || p.payload.length < 4 || u32(p.payload, 0) != 0) {
                continue; // 0=fire in flight, 1=impact
            }
            shots++;
            EventStreamReader.DirectDamageEvent target = null;
            for (final EventStreamReader.DirectDamageEvent d : recDealtList) {
                if (d.clockSecs() >= p.clockSecs - 0.5f && d.clockSecs() <= p.clockSecs + 2.0f) {
                    target = d;
                    break;
                }
            }
            if (target != null) {
                shotsMatched++;
                final Integer teid = eidOf(s, target.victimAccountId());
                System.out.printf(Locale.ROOT,
                        "  shot t=%7.2fs -> victim acc=%d team=%d dmg@%.2f%n",
                        p.clockSecs, target.victimAccountId(),
                        teid == null ? 0 : s.eidTeam().getOrDefault(teid, 0), target.clockSecs());
            } else {
                System.out.printf(Locale.ROOT,
                        "  shot t=%7.2fs -> no recorder-hit within window (miss/ricochet)%n", p.clockSecs);
            }
        }
        System.out.printf(Locale.ROOT, "  summary: shots=%d matchedToRecorderHit=%d%n", shots, shotsMatched);
    }

    private static Integer recorderTeam(final Sample s) {
        final Battle b = s.battle();
        if (b == null) {
            return null;
        }
        final PlayerResult rec = b.recorderResult();
        return rec == null ? null : rec.team;
    }

    /** 相机（type 39）是否在锚点时刻看向目标（yaw 夹角 < 40 度）。 */
    private record CamCheck(double yawDiff, boolean looking, double camYaw) {
    }

    private static CamCheck cameraLookAt(
            final Sample s, final Integer recorderEid, final Integer targetEid, final float atSec) {
        if (recorderEid == null || targetEid == null) {
            return null;
        }
        EventStreamReader.ParsedPacket cam = null;
        float bestDt = Float.MAX_VALUE;
        for (final EventStreamReader.ParsedPacket p : s.packets()) {
            if (p.type != 39 || p.payload.length < 28) {
                continue;
            }
            final float dt = Math.abs(p.clockSecs - atSec);
            if (dt < 0.25f && dt < bestDt) {
                bestDt = dt;
                cam = p;
            }
        }
        if (cam == null) {
            return null;
        }
        EventStreamReader.PositionData target = null;
        float bestDt2 = Float.MAX_VALUE;
        for (final EventStreamReader.PositionData pos : s.positions()) {
            if (pos.entityId != targetEid) {
                continue;
            }
            final float dt = Math.abs(pos.clockSecs - atSec);
            if (dt < 0.5f && dt < bestDt2) {
                bestDt2 = dt;
                target = pos;
            }
        }
        if (target == null) {
            return null;
        }
        final float camX = f(cam.payload, 8);
        final float camZ = f(cam.payload, 16);
        final float camYaw = f(cam.payload, 0);
        final double az = Math.toDegrees(Math.atan2(target.x - camX, target.z - camZ));
        final double azNorm = ((az % 360) + 360) % 360;
        final double diff = Math.min(Math.abs(azNorm - camYaw), 360 - Math.abs(azNorm - camYaw));
        return new CamCheck(diff, diff < 40.0, camYaw);
    }

    // ---------- S4 RECORDER-CLIENT STREAMS ----------

    private static void recorderClientStreams(final Sample s, final Long recorderAcc, final Integer recorderEid) {
        final PlayerResult rec = s.battle() == null ? null : s.battle().recorderResult();
        final double deathSec = rec == null || rec.survived ? Double.NaN : PlayerResultFormat.deathSec(rec);
        System.out.println("-- S4 recorder-client stream windows vs recorder death --");
        for (final int t : new int[]{23, 26, 31, 35, 39, 32}) {
            float first = Float.MAX_VALUE, last = -1;
            int n = 0;
            for (final EventStreamReader.ParsedPacket p : s.packets()) {
                if (p.type == t) {
                    n++;
                    first = Math.min(first, p.clockSecs);
                    last = Math.max(last, p.clockSecs);
                }
            }
            System.out.printf(Locale.ROOT, "  type=%-3d count=%-6d window=[%s..%s]%n",
                    t, n, n == 0 ? "-" : String.format(Locale.ROOT, "%.2f", first),
                    n == 0 ? "-" : String.format(Locale.ROOT, "%.2f", last));
        }
        if (!Double.isNaN(deathSec)) {
            final float deathRaw = (float) (deathSec + s.battleStartRaw());
            int t39Before = 0, t39After = 0, t31Before = 0, t31After = 0;
            for (final EventStreamReader.ParsedPacket p : s.packets()) {
                if (p.type == 39) {
                    if (p.clockSecs < deathRaw) {
                        t39Before++;
                    } else {
                        t39After++;
                    }
                }
                if (p.type == 31) {
                    if (p.clockSecs < deathRaw) {
                        t31Before++;
                    } else {
                        t31After++;
                    }
                }
            }
            System.out.printf(Locale.ROOT,
                    "  recorder death≈%.2fs: after-death type39=%d(before=%d) type31=%d(before=%d)%n",
                    deathSec, t39After, t39Before, t31After, t31Before);
        }
    }

    // ---------- S5 ENEMY POSITION GAPS ----------

    private static void enemyPositionGaps(final Sample s, final Long recorderAcc, final Integer recorderEid) {
        final Integer recTeam = recorderTeam(s);
        final Battle b = s.battle();
        if (b == null || recTeam == null) {
            return;
        }
        final Map<Integer, List<EventStreamReader.PositionData>> byEntity = new TreeMap<>();
        for (final EventStreamReader.PositionData p : s.positions()) {
            byEntity.computeIfAbsent(p.entityId, k -> new ArrayList<>()).add(p);
        }
        System.out.println("-- S5 enemy position gaps (PR premise: gap>5s => LOST) --");
        int enemies = 0, enemiesWithGap = 0, totalLosts = 0;
        final List<PlayerResult> sorted = new ArrayList<>(b.players);
        sorted.sort(Comparator.<PlayerResult>comparingInt(p -> p.team).thenComparingLong(p -> p.accountId));
        for (final PlayerResult p : sorted) {
            if (p.team == recTeam) {
                continue;
            }
            final Integer eid = eidOf(s, p.accountId);
            if (eid == null) {
                continue;
            }
            enemies++;
            final List<EventStreamReader.PositionData> pts = new ArrayList<>(byEntity.getOrDefault(eid, List.of()));
            pts.sort(Comparator.comparingDouble(x -> x.clockSecs));
            if (pts.isEmpty()) {
                System.out.printf(Locale.ROOT, "  enemy eid=%d acc=%d tank=%s: NO POSITIONS%n",
                        eid, p.accountId, p.tankName);
                continue;
            }
            final float firstPos = pts.get(0).clockSecs;
            float firstMove = -1;
            for (int i = 1; i < pts.size(); i++) {
                final double d = Math.hypot(pts.get(i).x - pts.get(0).x, pts.get(i).z - pts.get(0).z);
                if (d > 3.0) {
                    firstMove = pts.get(i).clockSecs;
                    break;
                }
            }
            final List<String> gaps = new ArrayList<>();
            for (int i = 1; i < pts.size(); i++) {
                final float gap = pts.get(i).clockSecs - pts.get(i - 1).clockSecs;
                if (gap > OBSERVED_GAP_SEC) {
                    gaps.add(String.format(Locale.ROOT, "%.1f@%.1f", gap, pts.get(i).clockSecs));
                }
            }
            if (!gaps.isEmpty()) {
                enemiesWithGap++;
                totalLosts += gaps.size();
            }
            final double deathSec = p.survived ? Double.NaN : PlayerResultFormat.deathSec(p);
            System.out.printf(Locale.ROOT,
                    "  enemy eid=%-9d acc=%-11d tank=%-22s nPos=%-4d firstPos=%.2fs firstMove=%.2fs gaps>5s=%d %s death=%s%n",
                    eid, p.accountId, trunc(p.tankName, 22), pts.size(), firstPos, firstMove,
                    gaps.size(), gaps.isEmpty() ? "" : gaps.toString(),
                    Double.isNaN(deathSec) ? "alive" : String.format(Locale.ROOT, "%.1f", deathSec));
        }
        System.out.printf(Locale.ROOT,
                "  summary: enemies=%d withGap>5s=%d totalLOSTevents(as PR would emit)=%d%n",
                enemies, enemiesWithGap, totalLosts);
        final List<EventStreamReader.DirectDamageEvent> dmg = EventStreamReader.extractDirectDamageEvents(
                s.packets(), s.e2a());
        final Map<Long, Float> firstDmgByEnemy = new HashMap<>();
        for (final EventStreamReader.DirectDamageEvent d : dmg) {
            if (recorderAcc != null && (d.attackerAccountId() == recorderAcc || d.victimAccountId() == recorderAcc)) {
                final long other = d.attackerAccountId() == recorderAcc ? d.victimAccountId() : d.attackerAccountId();
                if (!firstDmgByEnemy.containsKey(other)) {
                    firstDmgByEnemy.put(other, d.clockSecs());
                }
            }
        }
        System.out.println("  enemy firstPos vs first recorder-engagement (fire-in or fired-at):");
        for (final PlayerResult p : sorted) {
            if (p.team == recTeam) {
                continue;
            }
            final Integer eid = eidOf(s, p.accountId);
            if (eid == null) {
                continue;
            }
            final List<EventStreamReader.PositionData> pts = byEntity.getOrDefault(eid, List.of());
            final float firstPos = pts.isEmpty() ? -1 : pts.get(0).clockSecs;
            final Float firstEng = firstDmgByEnemy.get(p.accountId);
            System.out.printf(Locale.ROOT,
                    "    eid=%d acc=%d firstPos=%.2fs firstEng=%.2fs engBeforePos=%s%n",
                    eid, p.accountId, firstPos, firstEng == null ? -1 : firstEng,
                    firstEng != null && firstPos >= 0 && firstEng < firstPos);
        }
    }

    // ---------- S6 spectator entity ----------

    private static void spectatorEntity(final Sample s) {
        final int eid = 13185652;
        final List<EventStreamReader.PositionData> pts = new ArrayList<>();
        for (final EventStreamReader.PositionData p : s.positions()) {
            if (p.entityId == eid) {
                pts.add(p);
            }
        }
        System.out.println("-- S6 spectator camera entity 13185652 --");
        if (pts.isEmpty()) {
            System.out.println("  not present");
            return;
        }
        pts.sort(Comparator.comparingDouble(p -> p.clockSecs));
        final Map<String, String> states = new LinkedHashMap<>();
        float prevX = Float.NaN, prevY = Float.NaN, prevZ = Float.NaN, prevYaw = Float.NaN;
        float winStart = 0;
        for (final EventStreamReader.PositionData p : pts) {
            final boolean changed = !(Math.abs(p.x - prevX) < 0.01f && Math.abs(p.y - prevY) < 0.01f
                    && Math.abs(p.z - prevZ) < 0.01f && Math.abs(p.yaw - prevYaw) < 0.01f);
            if (changed) {
                if (!Float.isNaN(prevX)) {
                    states.put(String.format(Locale.ROOT, "%.1f-%.1f", winStart, p.clockSecs),
                            String.format(Locale.ROOT, "(%7.1f,%6.1f,%7.1f) yaw=%.1f",
                                    prevX, prevY, prevZ, Math.toDegrees(prevYaw)));
                }
                prevX = p.x;
                prevY = p.y;
                prevZ = p.z;
                prevYaw = p.yaw;
                winStart = p.clockSecs;
            }
        }
        if (!Float.isNaN(prevX)) {
            states.put(String.format(Locale.ROOT, "%.1f-end", winStart),
                    String.format(Locale.ROOT, "(%7.1f,%6.1f,%7.1f) yaw=%.1f",
                            prevX, prevY, prevZ, Math.toDegrees(prevYaw)));
        }
        System.out.printf(Locale.ROOT, "  nPos=%d distinctStates=%d window=[%.2f..%.2f]%n",
                pts.size(), states.size(), pts.get(0).clockSecs, pts.get(pts.size() - 1).clockSecs);
        int i = 0;
        for (final Map.Entry<String, String> e : states.entrySet()) {
            if (i++ >= 20) {
                System.out.println("  ...");
                break;
            }
            System.out.println("  t=" + e.getKey() + "s " + e.getValue());
        }
    }

    // ---------- RAW PAYLOAD PROBES ----------

    private static void rawPayloadProbes(final Sample s) {
        System.out.println("-- S7 type5/type33 payload samples (enterWorld semantics) --");
        int shown5 = 0, shown33 = 0;
        for (final EventStreamReader.ParsedPacket p : s.packets()) {
            if (p.type == 5 && shown5 < 4) {
                shown5++;
                System.out.printf(Locale.ROOT, "  type5 t=%.2fs len=%d eid(first4)=%d hex=%s%n",
                        p.clockSecs, p.payload.length,
                        p.payload.length >= 4 ? i32(p.payload, 0) : -1,
                        hex(copy(p.payload, 0, Math.min(48, p.payload.length))));
            }
            if (p.type == 33 && shown33 < 4) {
                shown33++;
                System.out.printf(Locale.ROOT, "  type33 t=%.2fs len=%d eid(first4)=%d hex=%s%n",
                        p.clockSecs, p.payload.length,
                        p.payload.length >= 4 ? u32(p.payload, 0) : -1,
                        hex(copy(p.payload, 0, Math.min(24, p.payload.length))));
            }
        }
        System.out.println("-- S8 type32 eid clusters (client events with client-time double) --");
        final Map<Integer, int[]> t32 = new TreeMap<>();
        for (final EventStreamReader.ParsedPacket p : s.packets()) {
            if (p.type == 32 && p.payload.length >= 4) {
                final int eid = u32(p.payload, 0);
                final int[] v = t32.computeIfAbsent(eid, k -> new int[]{0, Integer.MAX_VALUE, Integer.MIN_VALUE});
                v[0]++;
                v[1] = Math.min(v[1], (int) (p.clockSecs * 1000));
                v[2] = Math.max(v[2], (int) (p.clockSecs * 1000));
            }
        }
        t32.forEach((eid, v) -> System.out.printf(Locale.ROOT,
                "  eid=%-10d count=%-4d window=[%.2f..%.2f]%n", eid, v[0], v[1] / 1000.0, v[2] / 1000.0));
    }

    // ---------- S9 ENTER/LEAVE DISTANCE & ENGAGEMENT ----------

    /**
     * 决定性检验：type 5 enterWorld / type 4 EntityLeave 是否与录像者坦克/相机的距离
     * （AoI 半径）或交火/移动相关，还是与点亮相关。
     * 输出：每类事件的数量、距离统计、交火邻近比例、敌方移动比例。
     */
    private static void enterLeaveDistanceAnalysis(
            final Sample s, final Long recorderAcc, final Integer recorderEid) {
        System.out.println("-- S9 enterWorld(type5)/EntityLeave(type4) distance & engagement analysis --");
        if (recorderEid == null) {
            System.out.println("  recorder eid unknown — skip");
            return;
        }
        final Map<Integer, List<EventStreamReader.PositionData>> byEntity = new HashMap<>();
        for (final EventStreamReader.PositionData p : s.positions()) {
            byEntity.computeIfAbsent(p.entityId, k -> new ArrayList<>()).add(p);
        }
        byEntity.values().forEach(l -> l.sort(Comparator.comparingDouble(p -> p.clockSecs)));
        final List<EventStreamReader.ParsedPacket> cams = s.packets().stream()
                .filter(p -> p.type == 39 && p.payload.length >= 28).toList();
        final List<EventStreamReader.DirectDamageEvent> dmg = EventStreamReader.extractDirectDamageEvents(
                s.packets(), s.e2a());

        // event rows: kind(ENTER/LEAVE/CONFIRM), t, eid, team, tankDist, camDist, moving, engaged
        final List<String[]> rows = new ArrayList<>();
        for (final EventStreamReader.ParsedPacket p : s.packets()) {
            final String kind;
            final int eid;
            if (p.type == 5 && p.payload.length >= 4) {
                kind = "ENTER";
                eid = i32(p.payload, 0);
            } else if (p.type == 33 && p.payload.length >= 4) {
                kind = "CONFIRM";
                eid = i32(p.payload, 0);
            } else if (p.type == 4 && p.payload.length >= 4) {
                kind = "LEAVE";
                eid = i32(p.payload, 0);
            } else {
                continue;
            }
            final Long acc = s.e2a().get(eid);
            if (acc == null) {
                continue; // 只分析玩家实体
            }
            final int team = s.eidTeam().getOrDefault(eid, 0);
            if (team == 0) {
                continue;
            }
            final float t = p.clockSecs;
            final EventStreamReader.PositionData enemy = nearestPos(byEntity.get(eid), t, 0.5f);
            final EventStreamReader.PositionData rec = nearestPos(byEntity.get(recorderEid), t, 0.5f);
            final float[] cam = nearestCam(cams, t, 0.25f);
            double tankDist = -1, camDist = -1;
            if (enemy != null && rec != null) {
                tankDist = Math.hypot(enemy.x - rec.x, enemy.z - rec.z);
            }
            if (enemy != null && cam != null) {
                camDist = Math.hypot(enemy.x - cam[0], enemy.z - cam[1]);
            }
            final boolean moving = isMoving(byEntity.get(eid), t);
            final boolean engaged = nearEngagement(dmg, recorderAcc, acc, t, 3.0f);
            rows.add(new String[]{kind, String.format(Locale.ROOT, "%.2f", t),
                    String.valueOf(eid), String.valueOf(acc), String.valueOf(team),
                    tankDist < 0 ? "-" : String.format(Locale.ROOT, "%.0f", tankDist),
                    camDist < 0 ? "-" : String.format(Locale.ROOT, "%.0f", camDist),
                    moving ? "M" : "S", engaged ? "E" : "-"});
        }
        // stats
        for (final String kind : new String[]{"ENTER", "LEAVE", "CONFIRM"}) {
            final List<String[]> krows = rows.stream().filter(r -> r[0].equals(kind)).toList();
            if (krows.isEmpty()) {
                continue;
            }
            int friendly = 0, enemy = 0;
            final List<Double> tankDists = new ArrayList<>();
            final List<Double> camDists = new ArrayList<>();
            int moving = 0, engaged = 0;
            final Integer recTeam = recorderTeam(s);
            for (final String[] r : krows) {
                final int team = Integer.parseInt(r[4]);
                if (recTeam != null && team == recTeam) {
                    friendly++;
                } else {
                    enemy++;
                }
                if (!"-".equals(r[5])) {
                    tankDists.add(Double.parseDouble(r[5]));
                }
                if (!"-".equals(r[6])) {
                    camDists.add(Double.parseDouble(r[6]));
                }
                if ("M".equals(r[7])) {
                    moving++;
                }
                if ("E".equals(r[8])) {
                    engaged++;
                }
            }
            System.out.printf(Locale.ROOT,
                    "  %s: n=%d friendly=%d enemy=%d moving=%d/%d engaged=%d/%d tankDist[%s] camDist[%s]%n",
                    kind, krows.size(), friendly, enemy, moving, krows.size(), engaged, krows.size(),
                    distSummary(tankDists), distSummary(camDists));
        }
        System.out.println("  -- enemy enter/leave rows (distance, moving, engaged) --");
        int shown = 0;
        final Integer recTeam2 = recorderTeam(s);
        for (final String[] r : rows) {
            final int team = Integer.parseInt(r[4]);
            if ((recTeam2 == null || team != recTeam2) && shown < 60) {
                System.out.println("    " + String.join(" ", r));
                shown++;
            }
        }
    }

    private static String distSummary(final List<Double> ds) {
        if (ds.isEmpty()) {
            return "-";
        }
        double min = Double.MAX_VALUE, max = -1, sum = 0;
        for (final double d : ds) {
            min = Math.min(min, d);
            max = Math.max(max, d);
            sum += d;
        }
        final List<Double> sorted = new ArrayList<>(ds);
        sorted.sort(Double::compare);
        final double median = sorted.get(sorted.size() / 2);
        return String.format(Locale.ROOT, "n=%d min=%.0f med=%.0f max=%.0f", ds.size(), min, median, max);
    }

    private static EventStreamReader.PositionData nearestPos(
            final List<EventStreamReader.PositionData> pts, final float t, final float tol) {
        if (pts == null || pts.isEmpty()) {
            return null;
        }
        EventStreamReader.PositionData best = null;
        float bestDt = Float.MAX_VALUE;
        for (final EventStreamReader.PositionData p : pts) {
            final float dt = Math.abs(p.clockSecs - t);
            if (dt <= tol && dt < bestDt) {
                bestDt = dt;
                best = p;
            }
        }
        return best;
    }

    private static float[] nearestCam(
            final List<EventStreamReader.ParsedPacket> cams, final float t, final float tol) {
        EventStreamReader.ParsedPacket best = null;
        float bestDt = Float.MAX_VALUE;
        for (final EventStreamReader.ParsedPacket p : cams) {
            final float dt = Math.abs(p.clockSecs - t);
            if (dt <= tol && dt < bestDt) {
                bestDt = dt;
                best = p;
            }
        }
        if (best == null) {
            return null;
        }
        return new float[]{f(best.payload, 8), f(best.payload, 16)};
    }

    /** 事件时刻敌人是否在移动（前后 0.5s 位置位移 > 3m）。 */
    private static boolean isMoving(final List<EventStreamReader.PositionData> pts, final float t) {
        if (pts == null || pts.isEmpty()) {
            return false;
        }
        EventStreamReader.PositionData before = null, after = null;
        for (final EventStreamReader.PositionData p : pts) {
            if (p.clockSecs <= t) {
                before = p;
            } else if (p.clockSecs - t <= 0.6f) {
                after = p;
                break;
            }
        }
        if (before == null || after == null) {
            return false;
        }
        return Math.hypot(after.x - before.x, after.z - before.z) > 3.0;
    }

    private static boolean nearEngagement(
            final List<EventStreamReader.DirectDamageEvent> dmg, final Long recorderAcc,
            final Long otherAcc, final float t, final float tol) {
        if (recorderAcc == null || otherAcc == null) {
            return false;
        }
        for (final EventStreamReader.DirectDamageEvent d : dmg) {
            if (Math.abs(d.clockSecs() - t) > tol) {
                continue;
            }
            if ((d.attackerAccountId() == recorderAcc && d.victimAccountId() == otherAcc)
                    || (d.victimAccountId() == recorderAcc && d.attackerAccountId() == otherAcc)) {
                return true;
            }
        }
        return false;
    }

    // ---------- S10 updateArena(47) alive roster vs authoritative death ----------

    private static void updateArenaRoster(final Sample s, final Long recorderAcc) {
        System.out.println("-- S10 updateArena(sub47) alive-roster snapshots --");
        final List<EventStreamReader.ArenaSnapshot> snaps = EventStreamReader.extractArenaSnapshots(s.packets());
        System.out.printf(Locale.ROOT, "  snapshots=%d first=%.2fs last=%.2fs%n",
                snaps.size(), snaps.isEmpty() ? -1 : snaps.get(0).clockSecs,
                snaps.isEmpty() ? -1 : snaps.get(snaps.size() - 1).clockSecs);
        // per-account last time present in alive roster
        final Map<Long, Float> lastAlive = new HashMap<>();
        for (final EventStreamReader.ArenaSnapshot snap : snaps) {
            for (final long acc : snap.accountIds) {
                lastAlive.put(acc, snap.clockSecs);
            }
        }
        final Battle b = s.battle();
        if (b == null || b.players == null) {
            return;
        }
        for (final PlayerResult p : b.players) {
            final Float last = lastAlive.get(p.accountId);
            final String auth = p.survived ? "alive" : String.format(Locale.ROOT, "%.1f", PlayerResultFormat.deathSec(p));
            System.out.printf(Locale.ROOT,
                    "  acc=%-11d team=%d lastAliveInRoster=%s auth=%s%n",
                    p.accountId, p.team, last == null ? "never" : String.format(Locale.ROOT, "%.2f", last), auth);
        }
    }

    // ---------- S11 type8 short subtypes & type32 event eids ----------

    private static void type8ShortAndType32(final Sample s, final Long recorderAcc, final Integer recorderEid) {
        System.out.println("-- S11 type8 sub0/1/7 methodEid + type32 per-eid events --");
        // type 8: methodEid + subtype, then args; list sub 0/1/7 events with methodEid
        final Map<Integer, Integer> playerTeamByEid = new HashMap<>();
        for (final Map.Entry<Integer, Long> e : s.e2a().entrySet()) {
            playerTeamByEid.put(e.getKey(), s.eidTeam().getOrDefault(e.getKey(), 0));
        }
        for (final long sub : new long[]{0, 1, 7}) {
            final List<String> rows = new ArrayList<>();
            for (final EventStreamReader.ParsedPacket p : s.packets()) {
                if (p.type != 8 || p.payload.length < 8) {
                    continue;
                }
                if ((u32(p.payload, 4) & 0xFFFFFFFFL) != sub) {
                    continue;
                }
                final int meid = i32(p.payload, 0);
                final int team = playerTeamByEid.getOrDefault(meid, 0);
                rows.add(String.format(Locale.ROOT, "t=%.2fs meid=%d team=%d len=%d",
                        p.clockSecs, meid, team, p.payload.length));
            }
            System.out.printf(Locale.ROOT, "  type8 sub=%d count=%d%n", sub, rows.size());
            rows.stream().limit(12).forEach(r -> System.out.println("    " + r));
        }
        // type 32: eid + event byte(s) — dump first payloads and per-eid windows vs engagement
        final List<EventStreamReader.ParsedPacket> t32 = s.packets().stream()
                .filter(p -> p.type == 32).sorted(Comparator.comparingDouble(p -> p.clockSecs)).toList();
        System.out.printf(Locale.ROOT, "  type32 count=%d samples:%n", t32.size());
        t32.stream().limit(6).forEach(p -> System.out.printf(Locale.ROOT,
                "    t=%.2fs eid=%d len=%d hex=%s%n", p.clockSecs,
                p.payload.length >= 4 ? u32(p.payload, 0) : -1,
                p.payload.length, hex(copy(p.payload, 0, Math.min(40, p.payload.length)))));
        // per enemy eid: type32 event times vs recorder engagement times
        final List<EventStreamReader.DirectDamageEvent> dmg = EventStreamReader.extractDirectDamageEvents(
                s.packets(), s.e2a());
        System.out.println("  -- type32 events for player eids vs recorder-engagement (E mark) --");
        int shown = 0;
        for (final EventStreamReader.ParsedPacket p : t32) {
            if (p.payload.length < 4) {
                continue;
            }
            final int eid = u32(p.payload, 0);
            final Long acc = s.e2a().get(eid);
            if (acc == null || (recorderAcc != null && acc == recorderAcc)) {
                continue;
            }
            boolean engaged = false;
            for (final EventStreamReader.DirectDamageEvent d : dmg) {
                if (recorderAcc != null && Math.abs(d.clockSecs() - p.clockSecs) < 2.0f
                        && (d.attackerAccountId() == recorderAcc && d.victimAccountId() == acc
                        || d.victimAccountId() == recorderAcc && d.attackerAccountId() == acc)) {
                    engaged = true;
                    break;
                }
            }
            if (shown++ < 40) {
                System.out.printf(Locale.ROOT, "    t=%.2fs eid=%d acc=%d team=%d %s%n",
                        p.clockSecs, eid, acc, s.eidTeam().getOrDefault(eid, 0), engaged ? "E" : "-");
            }
        }
    }

    // ---------- util ----------

    private static String trunc(final String s, final int n) {
        if (s == null) {
            return "";
        }
        return s.length() <= n ? s : s.substring(0, n);
    }

    private static byte[] copy(final byte[] src, final int from, final int len) {
        final int n = Math.min(len, Math.max(0, src.length - from));
        final byte[] out = new byte[n];
        System.arraycopy(src, from, out, 0, n);
        return out;
    }

    private static int i32(final byte[] b, final int i) {
        return (b[i] & 0xFF) | ((b[i + 1] & 0xFF) << 8)
                | ((b[i + 2] & 0xFF) << 16) | (b[i + 3] << 24);
    }

    private static int u32(final byte[] b, final int i) {
        return (b[i] & 0xFF) | ((b[i + 1] & 0xFF) << 8)
                | ((b[i + 2] & 0xFF) << 16) | ((b[i + 3] & 0xFF) << 24);
    }

    private static int u16(final byte[] b, final int i) {
        return (b[i] & 0xFF) | ((b[i + 1] & 0xFF) << 8);
    }

    private static long[] varint(final byte[] buf, final int i) {
        int idx = i;
        int shift = 0;
        long result = 0;
        while (idx < buf.length && shift < 64) {
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

    private static float f(final byte[] b, final int i) {
        return Float.intBitsToFloat(u32(b, i));
    }

    private static String hex(final byte[] b) {
        final StringBuilder sb = new StringBuilder();
        for (final byte x : b) {
            sb.append(String.format("%02x", x));
        }
        return sb.toString();
    }
}
