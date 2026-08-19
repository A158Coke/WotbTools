package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.parse.PickleReader;
import com.wotb.core.parse.Protobuf;
import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.FriendlyEnemyResult;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 手动探针（不进 CI）：点数胜利回放的双队分数口径 dump。
 * 判定 victoryPointsEarned(#32) 是否包含击杀夺分（每击杀夺取对方 40 分、本方掉人损失 40 分）。
 * Run: {@code mvn -pl wotb-web -am test -Dtest=PointsVictoryProbeTest -Dprobe.replay=<file>}
 * 无 -Dprobe.replay 时回退到 common/data 的 Maus 点数胜利样本（不存在则跳过）。
 */
class PointsVictoryProbeTest {

    /** surefire 工作目录为 wotb-web 模块目录，回退样本相对它指向仓库 common/data。 */
    private static final String LOCAL_MAUS_SAMPLE =
            "../../common/data/20260808_1608__CHRD-A158布丁_Maus_13102443767740493.wotbreplay";

    @Test
    void probe() throws Exception {
        String path = System.getProperty("probe.replay");
        if (path == null) {
            path = LOCAL_MAUS_SAMPLE;
        }
        final Path file = Path.of(path);
        Assumptions.assumeTrue(Files.exists(file), "sample missing: " + file);
        final byte[] bytes = Files.readAllBytes(file);
        // 元数据与 battle_results 根字段 dump：寻找权威终局比分 / 标准时限证据
        final Map<String, byte[]> entries = ReplayArchiveReader.read(bytes);
        System.out.println("meta.json=" + new String(entries.get("meta.json"), StandardCharsets.UTF_8));
        final Object pickle = PickleReader.loads(entries.get("battle_results.dat"));
        if (pickle instanceof Object[] tuple && tuple.length == 2 && tuple[1] instanceof byte[] pb) {
            final Map<Integer, List<Object>> root = Protobuf.decode(pb);
            final StringBuilder rootsb = new StringBuilder();
            root.keySet().stream().sorted().forEach(k -> {
                final Object first = root.get(k).get(0);
                rootsb.append(' ').append(k).append('=');
                rootsb.append(first instanceof byte[] rawb ? "<bytes:" + rawb.length + ">" : String.valueOf(first));
            });
            System.out.println("root fields:" + rootsb);
        }
        final ReplayProcessingResult result = new DefaultReplayProcessingFacade()
                .process(new Source(file.getFileName().toString(), bytes), ReplayProcessingOptions.full());
        final Battle battle = result.battle();
        Assumptions.assumeTrue(battle != null && battle.players != null, "no battle parsed");
        final PlayerResult recorder = battle.recorderResult();
        final int recorderTeam = recorder != null ? recorder.team : 0;
        System.out.println("map=" + battle.mapName + " durationS=" + battle.durationS
                + " winnerTeam=" + battle.winnerTeam + " rosterComplete=" + battle.rosterComplete
                + " arenaBonusType=" + battle.arenaBonusType);
        System.out.println("recorder=" + (recorder == null ? "-" : recorder.nickname) + " team=" + recorderTeam);
        for (final int team : new int[]{1, 2}) {
            long earned = 0;
            long seized = 0;
            long kills = 0;
            long deaths = 0;
            for (final PlayerResult p : battle.players) {
                if (p == null || p.team != team) {
                    continue;
                }
                earned += p.victoryPointsEarned;
                seized += p.victoryPointsSeized;
                kills += p.kills;
                if (!p.survived) {
                    deaths++;
                }
                System.out.printf(Locale.ROOT,
                        "  team%d acc=%d %-16s earned=%d seized=%d kills=%d survived=%s deathSec=%.1f%n",
                        team, p.accountId, p.nickname, p.victoryPointsEarned, p.victoryPointsSeized,
                        p.kills, p.survived, p.deathTimeMillis / 1000.0);
            }
            System.out.printf(Locale.ROOT,
                    "team%d TOTAL earned=%d seized=%d kills=%d deaths=%d | computed(+40k-40d)=%d%n",
                    team, earned, seized, kills, deaths, earned + 40L * kills - 40L * deaths);
        }
        final FriendlyEnemyResult.TeamBattleWinner winner =
                FriendlyEnemyResult.resolveTeamBattle(battle, recorderTeam);
        System.out.println("winner=" + winner.winner() + " source=" + winner.source()
                + " pointsDecided=" + winner.pointsDecided() + " pointsEndReason=" + winner.pointsEndReason());

        // 逐人原始字段号 dump：寻找 #32/#33 之外的分数类字段（终局比分口径判定）
        for (final PlayerResult p : battle.players) {
            if (p == null || p.raw == null) {
                continue;
            }
            final StringBuilder sb = new StringBuilder();
            p.raw.keySet().stream().sorted().forEach(k -> {
                final Object v = p.raw.get(k);
                final Object first = v instanceof List<?> list && !list.isEmpty() ? list.get(0) : v;
                sb.append(' ').append(k).append('=');
                if (first instanceof byte[] raw) {
                    sb.append("<bytes:").append(raw.length).append('>');
                } else {
                    sb.append(String.valueOf(first));
                }
            });
            System.out.println("  raw acc=" + p.accountId + " team=" + p.team + " keys:" + sb);
        }
    }
}
