package com.wotb.core;

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
 * 开炮/未命中/点亮证据探针（手动维护，不进常规 CI）：
 * 运行方式 {@code mvn -pl wotb-core test -Dtest=ShotSpottingStreamProbeTest -Dprobe.replay=<file>}。
 * 输出：包类型直方图、type 8 subtype 8（伤害方法）body[13] 子类型直方图与样本、
 * type 5（Spotting）结构样本、type 8 其它 subtype 直方图。
 */
class ShotSpottingStreamProbeTest {

    private static String hex(final byte[] b) {
        final StringBuilder sb = new StringBuilder();
        for (final byte x : b) {
            sb.append(String.format("%02x ", x & 0xFF));
        }
        return sb.toString().trim();
    }

    /** surefire 工作目录为 wotb-core 模块目录，回退样本相对它指向仓库 common/data。 */
    private static final String LOCAL_MAUS_SAMPLE =
            "../../common/data/20260808_1608__CHRD-A158布丁_Maus_13102443767740493.wotbreplay";

    @Test
    void probe() throws Exception {
        String path = System.getProperty("probe.replay");
        if (path == null) {
            path = LOCAL_MAUS_SAMPLE;
        }
        final Path sample = Path.of(path);
        Assumptions.assumeTrue(Files.exists(sample), "sample missing: " + sample);
        final byte[] bytes = Files.readAllBytes(sample);
        byte[] eventData = null;
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry e;
            while ((e = zis.getNextEntry()) != null) {
                if ("data.wotreplay".equals(e.getName())) {
                    eventData = zis.readAllBytes();
                }
            }
        }
        Assumptions.assumeTrue(eventData != null, "data.wotreplay missing");
        final var stream = ReplayPacketStreamReader.read(eventData);
        final Map<Integer, Integer> typeCounts = new TreeMap<>();
        final Map<Integer, Integer> methodSubtypes = new TreeMap<>();
        final Map<Integer, Integer> damageSubs = new TreeMap<>();
        final Map<Integer, Integer> type5Lens = new TreeMap<>();
        final List<String> damageSamples = new ArrayList<>();
        final List<String> type5Samples = new ArrayList<>();
        int type8Sub8Count = 0;
        for (final RawReplayPacket p : stream.packets()) {
            typeCounts.merge(p.type(), 1, Integer::sum);
            final byte[] pl = p.payload();
            if (p.type() == 8 && pl.length >= 8) {
                final int sub = (pl[4] & 0xFF) | (pl[5] & 0xFF) << 8 | (pl[6] & 0xFF) << 16 | (pl[7] & 0xFF) << 24;
                methodSubtypes.merge(sub, 1, Integer::sum);
                if (sub == 8 && pl.length >= 22) {
                    type8Sub8Count++;
                    // body = payload[8..]; body[13] = payload[21]（伤害子类型）
                    final int dmgSub = pl[21] & 0xFF;
                    damageSubs.merge(dmgSub, 1, Integer::sum);
                    if (damageSamples.size() < 12) {
                        final int attacker = (pl[12] & 0xFF) | (pl[13] & 0xFF) << 8 | (pl[14] & 0xFF) << 16 | (pl[15] & 0xFF) << 24;
                        final int victim = (pl[16] & 0xFF) | (pl[17] & 0xFF) << 8 | (pl[18] & 0xFF) << 16 | (pl[19] & 0xFF) << 24;
                        final int dmg = (pl[22] & 0xFF) << 8 | (pl[23] & 0xFF);
                        damageSamples.add("len=" + pl.length + " sub=" + dmgSub + " att=" + attacker
                                + " vic=" + victim + " dmg=" + dmg + " hex=" + hex(pl));
                    }
                }
            }
            if (p.type() == 5) {
                type5Lens.merge(pl.length, 1, Integer::sum);
                if (type5Samples.size() < 10) {
                    type5Samples.add("len=" + pl.length + " hex=" + hex(pl));
                }
            }
        }
        System.out.println("-- packet type counts --");
        typeCounts.forEach((t, c) -> System.out.println("  type=" + t + " count=" + c));
        System.out.println("-- EntityMethod subtype counts --");
        methodSubtypes.forEach((s, c) -> System.out.println("  sub=" + s + " count=" + c));
        System.out.println("-- type8/sub8 body[13] damage-sub counts (total=" + type8Sub8Count + ") --");
        damageSubs.forEach((s, c) -> System.out.println("  dmgSub=" + s + " count=" + c));
        System.out.println("-- type8/sub8 samples --");
        damageSamples.forEach(System.out::println);
        System.out.println("-- type 5 spotting len histogram --");
        type5Lens.forEach((l, c) -> System.out.println("  len=" + l + " count=" + c));
        System.out.println("-- type 5 samples --");
        type5Samples.forEach(System.out::println);
    }
}
