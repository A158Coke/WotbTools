package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.decoder.EntityMethodDecoder;
import com.wotb.core.replay.decoder.ProtobufDecoder;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.stream.RawReplayPacket;
import com.wotb.core.replay.stream.ReplayPacketStreamReader;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Initial/Max HP Protocol Probe（PR #107 附加任务 A1，非 CI 手动探针）：
 * 对每个真实回放样本，逐车辆输出与初始/最大 HP 可能相关的全部协议证据：
 * - Type-7 EntityProperty 全部 propId/valueLen/首次出现时间/值域统计（不只 propId=3）；
 * - Type 0/1/2 Entity Create 原始初始化 payload（hex 摘要 + 候选字段扫描）；
 * - Type 5 / 33 实体进入世界相关包（payload 摘要 + 候选字段扫描）；
 * - Type-8 subtype48 wrapper=18 赛前配置（wrapper field 统计）；
 * - 每辆车：Tankopedia base、全部 Type-7 propId=3 sample、首个 sample 时间/值、
 *   首个 DAMAGE 时间、首个可证明 HP loss、结算 damageReceived、当前 entryHpSource/entryHp。
 *
 * <p>证据分级输出：只有跨多样本、跨车型、反例验证通过才可标 PROVEN；
 * 单样本相关只标 CANDIDATE/PARTIAL；本探针只输出证据，不修改生产语义。</p>
 */
class InitialHpProtocolProbeTest {

    private static final List<String> SAMPLES = List.of(
            "fixtures/replays/random-battle-example.wotbreplay",
            "data/20260725_1535__CHRD-A158布丁_A178_SPHT_9036183479040937(2).wotbreplay",
            "data/20260725_1600__CHRD-A158布丁_A178_SPHT_9034890693886323.wotbreplay",
            "data/20260725_1555__CHRD-A158布丁_A178_SPHT_12142703259467849.wotbreplay",
            "data/20260725_1604__CHRD-A158布丁_A178_SPHT_12142600180253313.wotbreplay",
            "data/20260808_1608__CHRD-A158布丁_Maus_13102443767740493.wotbreplay",
            "data/test/test.wotbreplay");

    @Test
    void probeInitialHpEvidenceAcrossRealSamples() throws Exception {
        final Path common = Path.of(System.getProperty("user.dir"), "..", "..", "common");
        int analyzed = 0;
        for (final String rel : SAMPLES) {
            final Path file = common.resolve(rel);
            if (!Files.exists(file)) {
                System.out.println("\n===== SKIP（样本缺失）: " + rel);
                continue;
            }
            final byte[] bytes = Files.readAllBytes(file);
            final ReplayProcessingResult result;
            try {
                result = new DefaultReplayProcessingFacade().process(
                        new Source(file.getFileName().toString(), bytes), ReplayProcessingOptions.full());
            } catch (final Exception e) {
                System.out.println("\n===== PARSE_FAIL " + rel + " : " + e.getMessage());
                continue;
            }
            final Battle battle = result.battle();
            final ReplayReconstruction recon = result.reconstruction();
            if (battle == null || battle.players == null || recon == null || recon.events() == null) {
                System.out.println("\n===== NO_DATA " + rel);
                continue;
            }
            analyzed++;
            System.out.println("\n==================================================================");
            System.out.println("===== 样本: " + rel);
            System.out.println("map=" + battle.mapName + " arenaBonusType=" + battle.arenaBonusType
                    + " recorder=" + battle.recorder + " players=" + battle.players.size()
                    + " events=" + recon.events().size() + " battleStart=" + recon.battleStartRawClockSec());
            // 1) 全局 packet type 分布 + Type-7 全 propId 统计（从归档解包 data.wotreplay）
            probePacketTypes(bytes);
            // 2) 逐车辆证据
            final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
            final List<PlayerResult> players = new ArrayList<>(battle.players);
            players.sort(Comparator.comparingInt((PlayerResult p) -> p.team).thenComparingLong(p -> p.accountId));
            for (final PlayerResult p : players) {
                probePlayer(battle, recon, mapping, p);
            }
            // 3) Entity Create / Type 5 / 33 payload 摘要（全局，按 entityId 聚合）
            probeEntityCreateAndWorld(bytes, recon, mapping, battle);
        }
        System.out.println("\n===== 汇总: 成功解析样本数=" + analyzed + " / " + SAMPLES.size());
    }

    /** packet type 分布 + Type-7 全部 propId（含 valueLen/首次时间/值域）统计。 */
    private static void probePacketTypes(final byte[] archiveBytes) {
        final byte[] eventData;
        try {
            eventData = com.wotb.core.parse.ReplayArchiveReader.read(archiveBytes)
                    .getOrDefault("data.wotreplay", new byte[0]);
        } catch (final Exception e) {
            System.out.println("  [archive read failed: " + e.getMessage() + "]");
            return;
        }
        final ReplayPacketStreamReader.ReplayStreamResult stream;
        try {
            stream = ReplayPacketStreamReader.read(eventData);
        } catch (final Exception e) {
            System.out.println("  [stream read failed: " + e.getMessage() + "]");
            return;
        }
        final Map<Integer, Integer> typeCounts = new LinkedHashMap<>();
        final Map<Integer, int[]> prop7Stats = new LinkedHashMap<>(); // propId -> [count, minLen, maxLen, firstSeq]
        final Map<Integer, Long> prop7FirstClock = new LinkedHashMap<>();
        int prop7Total = 0;
        for (final RawReplayPacket p : stream.packets()) {
            typeCounts.merge(p.type(), 1, Integer::sum);
            if (p.type() == 7 && p.payloadLength() >= 12) {
                final byte[] pl = p.payload();
                final int propId = (pl[4] & 0xFF) | ((pl[5] & 0xFF) << 8)
                        | ((pl[6] & 0xFF) << 16) | ((pl[7] & 0xFF) << 24);
                final int valueLen = (pl[8] & 0xFF) | ((pl[9] & 0xFF) << 8)
                        | ((pl[10] & 0xFF) << 16) | ((pl[11] & 0xFF) << 24);
                final int[] st = prop7Stats.computeIfAbsent(propId, k -> new int[]{0, Integer.MAX_VALUE, 0, p.sequence()});
                st[0]++;
                st[1] = Math.min(st[1], valueLen);
                st[2] = Math.max(st[2], valueLen);
                prop7FirstClock.putIfAbsent(propId, (long) (p.rawClockSec() * 1000));
                prop7Total++;
            }
        }
        final StringBuilder sb = new StringBuilder();
        sb.append("  [packet types] ");
        typeCounts.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .forEach(e -> sb.append("type").append(e.getKey()).append("=").append(e.getValue()).append(" "));
        sb.append("\n  [Type-7 props] total=").append(prop7Total).append(" ");
        prop7Stats.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(e -> {
            final int[] st = e.getValue();
            sb.append("prop").append(e.getKey()).append("(n=").append(st[0])
                    .append(",len=").append(st[1]).append("..").append(st[2])
                    .append(",firstT=").append(prop7FirstClock.get(e.getKey())).append("ms) ");
        });
        System.out.println(sb);
        // 值域摘要：prop0/prop4/prop9（len=1..4 的候选属性）u16/u32 值域
        for (final int propId : new int[]{0, 1, 4, 9}) {
            int min = Integer.MAX_VALUE, max = -1, n = 0;
            long sum = 0;
            final java.util.TreeSet<Integer> distinct = new java.util.TreeSet<>();
            for (final RawReplayPacket p : stream.packets()) {
                if (p.type() != 7 || p.payloadLength() < 12) continue;
                final byte[] pl = p.payload();
                final int id = (pl[4] & 0xFF) | ((pl[5] & 0xFF) << 8)
                        | ((pl[6] & 0xFF) << 16) | ((pl[7] & 0xFF) << 24);
                if (id != propId) continue;
                final int valueLen = (pl[8] & 0xFF) | ((pl[9] & 0xFF) << 8)
                        | ((pl[10] & 0xFF) << 16) | ((pl[11] & 0xFF) << 24);
                if (valueLen < 1 || 12 + valueLen > pl.length) continue;
                final int v = valueLen == 1 ? (pl[12] & 0xFF)
                        : valueLen == 2 ? ((pl[12] & 0xFF) | ((pl[13] & 0xFF) << 8))
                        : valueLen == 4 ? ((pl[12] & 0xFF) | ((pl[13] & 0xFF) << 8)
                        | ((pl[14] & 0xFF) << 16) | ((pl[15] & 0xFF) << 24)) : -1;
                if (v < 0) continue;
                min = Math.min(min, v);
                max = Math.max(max, v);
                sum += v;
                n++;
                if (distinct.size() < 20) distinct.add(v);
            }
            if (n > 0) {
                System.out.println("    [prop" + propId + " 值域] n=" + n + " min=" + min
                        + " max=" + max + " avg=" + (n > 0 ? sum / n : 0)
                        + " distinct=" + distinct);
            }
        }
    }

    /** 逐车辆：base / 全部 prop3 sample / 首 sample / 首 DAMAGE / 首 loss / 结算 / entryHpSource。 */
    private static void probePlayer(final Battle battle, final ReplayReconstruction recon,
                                    final TeamEntityMapping mapping, final PlayerResult p) {
        final long accountId = p.accountId;
        final Integer base = ReplayDisplayNames.tankMaxHpValue(p.tankId);
        final Float battleStart = recon.battleStartRawClockSec();
        final List<double[]> hpSamples = new ArrayList<>();
        if (recon.events() != null) {
            for (final ReplayEvent event : recon.events()) {
                if (!(event instanceof HealthChangedEvent hp)
                        || hp.confidence() != DecodeConfidence.EXACT
                        || hp.currentHealth() == null
                        || !HealthChangedEvent.isPlausibleHp(hp.currentHealth())) {
                    continue;
                }
                final var identity = mapping.identity(hp.entityId());
                if (identity == null || identity.accountId() != accountId) {
                    continue;
                }
                hpSamples.add(new double[]{relSec(event, battleStart), hp.currentHealth()});
            }
        }
        hpSamples.sort(Comparator.comparingDouble(a -> a[0]));
        Double firstDamageSec = null;
        final com.wotb.core.replay.processing.TeamEntityMapping dmgMapping = DamageEventIdentityResolver.mapping(battle, recon);
        if (recon.events() != null) {
            for (final ReplayEvent event : recon.events()) {
                if (event instanceof DamageEvent d && d.damage() > 0
                        && DamageEventIdentityResolver.victimAccount(d, dmgMapping) == accountId) {
                    final double t = relSec(event, battleStart);
                    if (firstDamageSec == null || t < firstDamageSec) {
                        firstDamageSec = t;
                    }
                }
            }
        }
        final StringBuilder sb = new StringBuilder();
        sb.append("\n  ").append(p.team == 1 ? "己方" : "敌方")
                .append(" accountId=").append(accountId)
                .append(" tankId=").append(p.tankId)
                .append(" tank=").append(ReplayDisplayNames.tankName(p.tankId, p.tankName))
                .append(" baseHp=").append(base == null ? "null" : base)
                .append(" survived=").append(p.survived)
                .append(" damageReceived=").append(p.damageReceived);
        // 任务 C：循环门禁验证——derived observed received vs 结算 damageReceived
        final int observedReceived = observedReceivedOf(recon, mapping, accountId);
        final boolean coverageExact = p.damageReceived <= 0
                ? observedReceived == 0
                : observedReceived == p.damageReceived;
        sb.append("\n    entryHpSource=").append(p.entryHpSource).append(" entryHp=").append(p.entryHp)
                .append(" damageReceived=").append(p.damageReceived)
                .append(" observedReceived=").append(observedReceived)
                .append(" coverageExact=").append(coverageExact);
        sb.append("\n    hpSamples(").append(hpSamples.size()).append("):");
        int shown = 0;
        for (final double[] s : hpSamples) {
            if (shown++ < 30) {
                sb.append(" [").append(String.format("%.1f", s[0])).append("s,").append((int) s[1]).append("]");
            }
        }
        if (hpSamples.size() > 30) {
            sb.append(" ...(+").append(hpSamples.size() - 30).append(")");
        }
        sb.append("\n    firstSample=").append(hpSamples.isEmpty() ? "none"
                : "[" + String.format("%.1f", hpSamples.get(0)[0]) + "s," + (int) hpSamples.get(0)[1] + "]")
                .append(" firstDamageSec=").append(firstDamageSec == null ? "none" : String.format("%.1f", firstDamageSec));
        System.out.println(sb);
    }

    /** Entity Create (type 0/1/2) 与 type 5/33 payload 摘要：hex 前 64 字节 + 候选 u16 字段扫描。 */
    private static void probeEntityCreateAndWorld(final byte[] archiveBytes, final ReplayReconstruction recon,
                                                  final TeamEntityMapping mapping, final Battle battle) {
        final byte[] eventData;
        try {
            eventData = com.wotb.core.parse.ReplayArchiveReader.read(archiveBytes)
                    .getOrDefault("data.wotreplay", new byte[0]);
        } catch (final Exception e) {
            return;
        }
        final ReplayPacketStreamReader.ReplayStreamResult stream;
        try {
            stream = ReplayPacketStreamReader.read(eventData);
        } catch (final Exception e) {
            return;
        }
        final Map<Integer, byte[]> createPayloads = new LinkedHashMap<>();
        final Map<Integer, Integer> createTypes = new LinkedHashMap<>();
        int type5 = 0, type33 = 0;
        for (final RawReplayPacket p : stream.packets()) {
            if (p.type() == 0 || p.type() == 1 || p.type() == 2) {
                final byte[] pl = p.payload();
                final int eid = pl.length >= 4
                        ? (pl[0] & 0xFF) | ((pl[1] & 0xFF) << 8) | ((pl[2] & 0xFF) << 16) | (pl[3] << 24) : -1;
                createPayloads.putIfAbsent(eid, pl);
                createTypes.putIfAbsent(eid, p.type());
            } else if (p.type() == 5) {
                type5++;
            } else if (p.type() == 33) {
                type33++;
            }
        }
        System.out.println("  [Type5=" + type5 + " Type33=" + type33 + " EntityCreate count=" + createPayloads.size() + "]");
        // Type 5/33 结构分析：提取前 4 字节 entityId + 长度分布 + hex 前 32 字节
        final Map<Integer, Integer> type5Len = new LinkedHashMap<>();
        final Map<Integer, Integer> type33Len = new LinkedHashMap<>();
        int shown5 = 0;
        for (final RawReplayPacket p : stream.packets()) {
            if (p.type() == 5) {
                type5Len.merge(p.payloadLength(), 1, Integer::sum);
                if (shown5++ < 3 && p.payloadLength() >= 4) {
                    final byte[] pl = p.payload();
                    final int eid = (pl[0] & 0xFF) | ((pl[1] & 0xFF) << 8)
                            | ((pl[2] & 0xFF) << 16) | (pl[3] << 24);
                    System.out.println("    [type5 eid=" + eid + " len=" + pl.length + "] hex=" + hexPrefix(pl, 48));
                }
            } else if (p.type() == 33) {
                type33Len.merge(p.payloadLength(), 1, Integer::sum);
                if (p.payloadLength() >= 4) {
                    final byte[] pl = p.payload();
                    final int eid = (pl[0] & 0xFF) | ((pl[1] & 0xFF) << 8)
                            | ((pl[2] & 0xFF) << 16) | (pl[3] << 24);
                    System.out.println("    [type33 eid=" + eid + " len=" + pl.length + "] hex=" + hexPrefix(pl, 48));
                    break;
                }
            }
        }
        System.out.println("    [type5 长度分布] " + type5Len + " [type33 长度分布] " + type33Len);
        // Type 8 subtype48 wrapper field 分布（找 wrapper=18 赛前配置）
        final Map<Long, Integer> wrapperCounts = new LinkedHashMap<>();
        int subtype48Total = 0;
        for (final RawReplayPacket p : stream.packets()) {
            if (p.type() != 8 || p.payloadLength() < 8) continue;
            final byte[] pl = p.payload();
            // 生产语义：entityId(payload[0..4]) + subType(payload[4..8])；subtype48 = updateArena2
            final int subType = (pl[4] & 0xFF) | ((pl[5] & 0xFF) << 8)
                    | ((pl[6] & 0xFF) << 16) | ((pl[7] & 0xFF) << 24);
            if (subType != 48) continue;
            subtype48Total++;
            final long wrapper = EntityMethodDecoder.readWrapperFieldNumber(pl);
            if (wrapper >= 0) {
                wrapperCounts.merge(wrapper, 1, Integer::sum);
            }
        }
        System.out.println("    [Type8 subtype48] total=" + subtype48Total + " wrapper分布=" + wrapperCounts);
        // battle_results.dat 字段枚举（找初始/最大 HP 候选）：对第一名玩家输出全部 info 字段号+值
        try {
            final Map<String, byte[]> entries = com.wotb.core.parse.ReplayArchiveReader.read(archiveBytes);
            final byte[] dat = entries.get("battle_results.dat");
            if (dat != null) {
                final Object pickle = com.wotb.core.parse.PickleReader.loads(dat);
                if (pickle instanceof Object[] tuple && tuple.length == 2 && tuple[1] instanceof byte[] pb) {
                    final var root = com.wotb.core.replay.decoder.ProtobufDecoder.decode(pb);
                    System.out.println("    [battle_results root fields] " + root.keySet());
                    // 枚举所有 root 字段中可能的车辆/玩家列表容器（field 4/150/181-186）
                    int shownPlayers = 0;
                    for (final int field : new int[]{4, 150, 181, 182, 183, 184, 185, 186}) {
                        final List<Object> list = root.get(field);
                        if (list == null || list.isEmpty()) continue;
                        final Object first = list.get(0);
                        if (!(first instanceof byte[] b0)) continue;
                        final var info = com.wotb.core.replay.decoder.ProtobufDecoder.decode(b0);
                        final StringBuilder fb = new StringBuilder();
                        fb.append("    [root field ").append(field).append(" first 条目字段] ");
                        info.forEach((k, v) -> {
                            final Object val = v.get(0);
                            fb.append("f").append(k).append("=")
                                    .append(val instanceof byte[] b2 ? "bytes[" + b2.length + "]" : val).append(" ");
                        });
                        System.out.println(fb);
                        if (++shownPlayers >= 4) break;
                    }
                }
            }
        } catch (final Exception e) {
            System.out.println("    [battle_results parse failed: " + e.getMessage() + "]");
        }
        // 只对映射到玩家的 entity 输出 create payload 摘要（控制输出量）
        int shown = 0;
        for (final Map.Entry<Integer, byte[]> e : createPayloads.entrySet()) {
            final int eid = e.getKey();
            if (eid <= 0) {
                continue;
            }
            final var identity = mapping.identity(eid);
            if (identity == null || identity.accountId() <= 0) {
                continue; // 非玩家实体（炮台/装饰）跳过
            }
            if (shown++ >= 8) {
                System.out.println("    ...(更多 EntityCreate 省略，仅映射玩家前 8 个)");
                break;
            }
            final byte[] pl = e.getValue();
            final Integer base = ReplayDisplayNames.tankMaxHpValue(identity.tankId());
            System.out.println("    [create type=" + createTypes.get(eid) + " eid=" + eid
                    + " acc=" + identity.accountId() + " tank=" + ReplayDisplayNames.tankName(identity.tankId(), null)
                    + " baseHp=" + base + " len=" + pl.length + "]");
            System.out.println("      hex=" + hexPrefix(pl, 96));
            // 候选扫描：找与 baseHp 相近的 u16 LE 位置（±15%）
            if (base != null) {
                final List<Integer> hits = new ArrayList<>();
                for (int i = 0; i + 1 < pl.length; i++) {
                    final int u16 = (pl[i] & 0xFF) | ((pl[i + 1] & 0xFF) << 8);
                    if (u16 > 0 && Math.abs(u16 - base) * 100 <= base * 15) {
                        hits.add(i);
                        if (hits.size() >= 6) {
                            break;
                        }
                    }
                }
                if (!hits.isEmpty()) {
                    System.out.println("      [u16≈baseHp 候选 offset] " + hits);
                }
            }
        }
    }

    private static String hexPrefix(final byte[] b, final int maxLen) {
        final StringBuilder sb = new StringBuilder();
        final int n = Math.min(b.length, maxLen);
        for (int i = 0; i < n; i++) {
            sb.append(String.format("%02x", b[i] & 0xFF));
        }
        if (b.length > maxLen) {
            sb.append("...(+").append(b.length - maxLen).append(" bytes)");
        }
        return sb.toString();
    }

    /** 每账号 derived observed received（§12/§13 权威 HP loss 口径，任务 C）。 */
    private static int observedReceivedOf(final ReplayReconstruction recon,
                                          final TeamEntityMapping mapping, final long accountId) {
        int total = 0;
        final Float start = recon.battleStartRawClockSec();
        final double duration = recon.replayDurationSec() > 0 ? recon.replayDurationSec() : 0.0;
        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat =
                com.wotb.core.replay.feature.PlaybackCombatReconstruction.derive(
                        recon.events(), mapping,
                        start == null ? 0.0 : start.doubleValue(), duration);
        for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss l
                : combat.lossesOf(accountId)) {
            total += l.hpLoss();
        }
        return total;
    }

    private static double relSec(final ReplayEvent e, final Float battleStart) {
        if (e.timestamp() == null) {
            return 0;
        }
        final Float battle = e.timestamp().battleClockSec();
        if (battle != null) {
            return battle;
        }
        if (battleStart != null && Float.isFinite(battleStart)) {
            return e.timestamp().rawClockSec() - battleStart;
        }
        return e.timestamp().rawClockSec();
    }
}