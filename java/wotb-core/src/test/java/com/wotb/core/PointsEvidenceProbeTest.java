package com.wotb.core;

import com.wotb.core.model.Source;
import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.decoder.EntityMethodDecoder;
import com.wotb.core.replay.decoder.ReplayDecodeContext;
import com.wotb.core.replay.event.SupremacyPointsChangedEvent;
import com.wotb.core.replay.stream.RawReplayPacket;
import com.wotb.core.replay.stream.ReplayPacketStreamReader;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Supremacy 点数证据探针（手动维护，不进常规 CI）：
 * 扫描 common/data（递归）与 common/fixtures/replays 的全部 .wotbreplay 样本，逐样本输出：
 * 元数据/结算字段、包类型直方图、EntityMethod 子类型直方图、type 7 propId 直方图，
 * 以及候选包（实时点数/基地占领/1000 分触发/结束原因可能所在）按时间排序的样本。
 * 本探针只收集证据，不做解码断言；无样本自动跳过。
 */
class PointsEvidenceProbeTest {

    private static final Path REPO_COMMON = Path.of("../../common");

    private static String hex(final byte[] b, final int max) {
        final StringBuilder sb = new StringBuilder();
        final int n = Math.min(b.length, max);
        for (int i = 0; i < n; i++) {
            sb.append(String.format("%02x ", b[i] & 0xFF));
        }
        return sb.toString().trim();
    }

    @Test
    void probe() throws Exception {
        final List<Path> samples = new ArrayList<>();
        if (Files.isDirectory(REPO_COMMON)) {
            try (var walk = Files.walk(REPO_COMMON)) {
                walk.filter(p -> p.toString().endsWith(".wotbreplay"))
                        .filter(Files::isRegularFile)
                        .sorted()
                        .forEach(samples::add);
            }
        }
        Assumptions.assumeTrue(!samples.isEmpty(), "no replay samples under common/");
        System.out.println("samples=" + samples.size());
        for (final Path sample : samples) {
            System.out.println("===== " + sample + " =====");
            try {
                final byte[] bytes = Files.readAllBytes(sample);
                final Map<String, byte[]> entries = ReplayArchiveReader.read(bytes);
                final ReplayProcessingResult result = new DefaultReplayProcessingFacade()
                        .process(new Source(sample.getFileName().toString(), bytes),
                                ReplayProcessingOptions.full());
                final var battle = result.battle();
                if (battle == null || battle.players == null) {
                    System.out.println("  battle=null");
                    continue;
                }
                System.out.println("  meta map=" + battle.mapName + " arenaBonusType=" + battle.arenaBonusType
                        + " durationS=" + battle.durationS + " winnerTeam=" + battle.winnerTeam
                        + " rosterComplete=" + battle.rosterComplete);
                for (final int team : new int[]{1, 2}) {
                    long earned = 0;
                    long seized = 0;
                    long kills = 0;
                    long deaths = 0;
                    for (final var p : battle.players) {
                        if (p == null || p.team != team) {
                            continue;
                        }
                        earned += p.victoryPointsEarned;
                        seized += p.victoryPointsSeized;
                        kills += p.kills;
                        if (!p.survived) {
                            deaths++;
                        }
                    }
                    System.out.println("  team" + team + " earned=" + earned + " seized=" + seized
                            + " kills=" + kills + " deaths=" + deaths);
                }
                final byte[] eventData = entries.get("data.wotreplay");
                if (eventData == null) {
                    System.out.println("  data.wotreplay missing");
                    continue;
                }
                final var stream = ReplayPacketStreamReader.read(eventData);
                final Map<Integer, Integer> typeCounts = new TreeMap<>();
                final Map<Integer, Integer> methodSubs = new TreeMap<>();
                final Map<Integer, Integer> propIds = new TreeMap<>();
                final float start = stream.packets().isEmpty() ? 0f : stream.packets().get(0).rawClockSec();
                final List<String> candidates = new ArrayList<>();
                int capMethod = 0;
                int capOther = 0;
                for (final RawReplayPacket p : stream.packets()) {
                    typeCounts.merge(p.type(), 1, Integer::sum);
                    final byte[] pl = p.payload();
                    if (p.type() == 8 && pl.length >= 8) {
                        final int sub = (pl[4] & 0xFF) | (pl[5] & 0xFF) << 8
                                | (pl[6] & 0xFF) << 16 | (pl[7] & 0xFF) << 24;
                        methodSubs.merge(sub, 1, Integer::sum);
                        if (sub != 8 && sub != 47 && sub != 48 && capMethod < 5) {
                            capMethod++;
                            candidates.add(String.format("    t=%+.1f type=8 sub=%d len=%d hex=%s",
                                    p.rawClockSec() - start, sub, pl.length, hex(pl, 40)));
                        }
                    }
                    if (p.type() == 7 && pl.length >= 8) {
                        final int propId = (pl[4] & 0xFF) | (pl[5] & 0xFF) << 8
                                | (pl[6] & 0xFF) << 16 | (pl[7] & 0xFF) << 24;
                        propIds.merge(propId, 1, Integer::sum);
                    }
                    if ((p.type() == 5 || p.type() == 11 || p.type() == 13 || p.type() == 23
                            || p.type() == 26 || p.type() == 28 || p.type() == 29 || p.type() == 31
                            || p.type() == 32 || p.type() == 33 || p.type() == 35 || p.type() == 39)
                            && capOther < 3) {
                        capOther++;
                        candidates.add(String.format("    t=%+.1f type=%d len=%d hex=%s",
                                p.rawClockSec() - start, p.type(), pl.length, hex(pl, 48)));
                    }
                }
                // 已移除按未证实 tick 产分的反推计算：每据点每 tick 产分（3/5 等任何固定值）均未经回放证据或
                // 项目所有者确认（UNVERIFIED_HYPOTHESIS），且该反推同时假设「终局=1000、earned 不含
                // 击杀分」等多重未证明前提，不能作为证据。本探针只输出上面读取到的原始结算字段与包样本，
                // 等待受控回放验证后再研究点数产率。
                System.out.println("  packetTypes=" + typeCounts);
                System.out.println("  entityMethodSubtypes=" + methodSubs);
                System.out.println("  type7PropIds=" + propIds);
                System.out.println("  candidate samples (semantics UNKNOWN):");
                candidates.forEach(System.out::println);
            } catch (Exception e) {
                System.out.println("  ERROR " + e);
            }
        }
    }

    /**
     * REALTIME_SUPREMACY_POINTS + PROP3_HP_SENTINELS 交叉验证探针（走生产解码路径）：
     * 对真实样本逐包调用生产 {@code EntityMethodDecoder.decode}，并复用生产
     * {@code readWrapperFieldNumber} / {@code readUpdateArena2Root} 打印 subtype48 的
     * wrapperFieldNumber 分布与 root keys——验证只有 wrapper=13 的 subtype48 产出点数事件
     * （wrapper=1 名册 / 18 配置即使 root 结构相同也不产出，门禁回归）；
     * propId=3 扫描所有 ≥0xFF00 高位值（signed 负 sentinel 清单，确认是否还有 FFFC/FFFE 等）。
     * 手动运行，不进 CI：无样本自动跳过。
     */
    @Test
    void realtimeSupremacyAndHpSentinelProbe() throws Exception {
        final List<Path> samples = new ArrayList<>();
        if (Files.isDirectory(REPO_COMMON)) {
            try (var walk = Files.walk(REPO_COMMON)) {
                walk.filter(p -> p.toString().endsWith(".wotbreplay"))
                        .filter(Files::isRegularFile)
                        .sorted()
                        .forEach(samples::add);
            }
        }
        Assumptions.assumeTrue(!samples.isEmpty(), "no replay samples under common/");
        System.out.println("== REALTIME_SUPREMACY_POINTS + PROP3_HP_SENTINELS probe (production decode) ==");
        final EntityMethodDecoder methodDecoder = new EntityMethodDecoder();
        final ReplayDecodeContext ctx = new ReplayDecodeContext("probe");
        for (final Path sample : samples) {
            System.out.println("===== " + sample + " =====");
            try {
                final byte[] bytes = Files.readAllBytes(sample);
                final Map<String, byte[]> entries = ReplayArchiveReader.read(bytes);
                final byte[] eventData = entries.get("data.wotreplay");
                if (eventData == null) {
                    System.out.println("  data.wotreplay missing");
                    continue;
                }
                final var stream = ReplayPacketStreamReader.read(eventData);
                final float start = stream.packets().isEmpty() ? 0f : stream.packets().get(0).rawClockSec();
                final Map<Long, Integer> wrapperDist = new TreeMap<>();
                final Map<String, Integer> rootKeysDist = new TreeMap<>();
                final Map<Long, Integer> lastPoints = new TreeMap<>();
                int sub48Count = 0;
                int wrapper13Count = 0;
                int pointsEvents = 0;
                final List<String> samplesList = new ArrayList<>();
                final Map<Integer, Integer> hpSentinelCounts = new TreeMap<>();
                int hpEvents = 0;
                for (final RawReplayPacket p : stream.packets()) {
                    final byte[] pl = p.payload();
                    if (p.type() == 8 && pl.length >= 8) {
                        final int sub = (pl[4] & 0xFF) | (pl[5] & 0xFF) << 8
                                | (pl[6] & 0xFF) << 16 | (pl[7] & 0xFF) << 24;
                        if (sub != 48) { // subtype48 updateArena2
                            continue;
                        }
                        sub48Count++;
                        final long wrapper = EntityMethodDecoder.readWrapperFieldNumber(pl);
                        wrapperDist.merge(wrapper, 1, Integer::sum);
                        if (wrapper == EntityMethodDecoder.WRAPPER_SUPREMACY_POINTS) {
                            wrapper13Count++;
                            final Map<Integer, List<Object>> root =
                                    EntityMethodDecoder.readUpdateArena2Root(pl);
                            rootKeysDist.merge(String.valueOf(root == null ? "null" : root.keySet()),
                                    1, Integer::sum);
                        }
                        final var result = methodDecoder.decode(ctx, p);
                        for (final var ev : result.events()) {
                            if (ev instanceof SupremacyPointsChangedEvent sp) {
                                pointsEvents++;
                                lastPoints.put((long) sp.team(), sp.points());
                                if (samplesList.size() < 12) {
                                    samplesList.add(String.format("    t=%+.3fs team%d=%d",
                                            p.rawClockSec() - start, sp.team(), sp.points()));
                                }
                            }
                        }
                    }
                    if (p.type() == 7 && pl.length >= 14) {
                        final int propId = (pl[4] & 0xFF) | (pl[5] & 0xFF) << 8
                                | (pl[6] & 0xFF) << 16 | (pl[7] & 0xFF) << 24;
                        if (propId != 3) { // propId=3 当前血量
                            continue;
                        }
                        hpEvents++;
                        final int raw = (pl[12] & 0xFF) | ((pl[13] & 0xFF) << 8);
                        if (raw >= 0xFF00) {
                            hpSentinelCounts.merge(raw, 1, Integer::sum);
                        }
                    }
                }
                System.out.println("  subtype48 total=" + sub48Count);
                System.out.println("  wrapperFieldNumber dist=" + wrapperDist);
                System.out.println("  wrapper=13 packets=" + wrapper13Count
                        + " rootKeysDist=" + rootKeysDist);
                System.out.println("  supremacy pointsEvents(production decode)=" + pointsEvents
                        + " finalRealtime=" + lastPoints);
                samplesList.forEach(System.out::println);
                System.out.println("  propId3 hpEvents=" + hpEvents
                        + " sentinels(>=0xFF00)=" + hpSentinelCounts);
            } catch (Exception e) {
                System.out.println("  ERROR " + e);
            }
        }
    }
}
