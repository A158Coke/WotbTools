package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.Collected;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 逐字段比对真实回放, 验证解析输出与已知正确值一致 (回归基线)。
 * 期望值为人工核对真实回放后固定下来的已验证值。
 */
class ParityTest {

    /** 定位共享样本目录 common/data (surefire 运行时 user.dir = wotb-core 模块目录)。 */
    private static Path dataDir() {
        return Path.of(System.getProperty("user.dir"), "..", "..", "common", "data").normalize();
    }

    private static List<Path> replays() throws Exception {
        try (Stream<Path> s = Files.list(dataDir())) {
            return s.filter(p -> p.toString().toLowerCase().endsWith(".wotbreplay")).sorted().toList();
        }
    }

    private static Battle battleByArena(final String arenaId) throws Exception {
        for (Path p : replays()) {
            Battle b = ReplayParser.parse(p);
            if (arenaId.equals(b.arenaId)) {
                return b;
            }
        }
        throw new AssertionError("找不到 arenaId=" + arenaId + " 的回放");
    }

    private static PlayerResult byAccount(final Battle b, final long acc) {
        return b.players.stream().filter(p -> p.accountId == acc).findFirst().orElseThrow();
    }

    @Test
    void tankopediaResolves() {
        Tankopedia tp = Tankopedia.load();
        assertTrue(tp.size() > 600, "车辆库应非空");
        assertEquals("Kranvagn", tp.info(4481).name);
        assertEquals("重坦", tp.info(4481).type);
        // 轻坦车种回归(枚举0被省略时仍应解析)
        assertEquals("轻坦", tp.info(24321).type, "T-100 LT(24321) 应为轻坦");
    }

    @Test
    void parsesBattleExactValues() throws Exception {
        Battle b = battleByArena("1161909687528274499");   // lagoon 那场
        assertEquals(14, b.players.size());
        assertEquals(Integer.valueOf(2), b.winnerTeam);

        // 录像者 WHAT_HPSHARING 的精确战绩 (与 Python 输出一致)
        PlayerResult owner = byAccount(b, 3125699886L);
        assertEquals("WHAT_HPSHARING", owner.nickname);
        assertEquals(2, owner.team);
        assertEquals(4481, owner.tankId);
        assertEquals(2717, owner.damageDealt);
        assertEquals(1, owner.kills);
        assertEquals(10, owner.nShots);
        assertEquals(7, owner.nHitsDealt);
        assertEquals(7, owner.nPenetrationsDealt);
        assertEquals(763, owner.damageReceived);
        assertEquals(1060, owner.damageBlocked);
        assertEquals(4, owner.nEnemiesDamaged);
        assertEquals(381, owner.damageAssisted);
        assertTrue(owner.survived);

        // 最高伤害 jasminetea_
        assertEquals(4571, byAccount(b, 3101692714L).damageDealt);
    }

    @Test
    void battleInvariants() throws Exception {
        for (Path p : replays()) {
            Battle b = ReplayParser.parse(p);
            assertEquals(14, b.players.size(), p.getFileName().toString());
            // 发射 >= 命中 >= 击穿
            for (PlayerResult pr : b.players) {
                assertTrue(pr.nShots >= pr.nHitsDealt && pr.nHitsDealt >= pr.nPenetrationsDealt,
                        "发射>=命中>=击穿: " + pr.nickname);
            }
            // 每队击杀数 == 敌队阵亡数
            int[] kills = new int[3], deaths = new int[3];
            for (PlayerResult pr : b.players) {
                kills[pr.team] += pr.kills;
                if (!pr.survived) deaths[pr.team]++;
            }
            assertEquals(deaths[2], kills[1], "队1击杀==队2阵亡");
            assertEquals(deaths[1], kills[2], "队2击杀==队1阵亡");
        }
    }

    @Test
    void dedupAndAggregate() throws Exception {
        List<Path> files = replays();
        List<Source> sources = new ArrayList<>();
        for (Path p : files) {
            sources.add(new Source(p.getFileName().toString(), Files.readAllBytes(p)));
        }
        // 再加一份重复(同一场)
        sources.add(new Source("dup.wotbreplay", Files.readAllBytes(files.get(0))));

        Collected c = Replays.collect(sources, null);
        assertEquals(files.size(), c.battles.size(), "唯一战斗数");
        assertEquals(1, c.duplicates.size(), "应跳过 1 个重复");
        assertEquals(0, c.failures.size());

        var agg = Aggregator.aggregate(c.battles, Tankopedia.load());
        assertFalse(agg.isEmpty());
        agg.values().forEach(a -> {
            assertTrue(a.battles >= 1 && a.battles <= c.battles.size());
            assertTrue(a.wins <= a.battles);
        });
    }

    @Test
    void ratingComputedAndCentered() throws Exception {
        List<Battle> battles = new ArrayList<>();
        for (Path p : replays()) {
            battles.add(ReplayParser.parse(p));
        }
        Rating.compute(battles, Tankopedia.load());
        List<PlayerResult> all = new ArrayList<>();
        battles.forEach(b -> all.addAll(b.players));
        assertTrue(all.stream().allMatch(p -> p.rating != null), "每位玩家都应有评分");
        double avg = all.stream().mapToInt(p -> p.rating).average().orElse(0);
        assertTrue(avg > 850 && avg < 1150, "评分均值应接近 1000, 实际 " + avg);
    }

    @Test
    void exportsXlsx() throws Exception {
        Tankopedia tp = Tankopedia.load();
        Battle b = ReplayParser.parse(replays().get(0));
        ByteArrayOutputStream single = new ByteArrayOutputStream();
        ExcelExporter.writeSingle(b, tp, single);
        assertTrue(single.size() > 3000, "单场 xlsx 应有内容");

        List<Battle> battles = new ArrayList<>();
        List<String> names = new ArrayList<>();
        for (Path p : replays()) {
            battles.add(ReplayParser.parse(p));
            names.add(p.getFileName().toString());
        }
        ByteArrayOutputStream agg = new ByteArrayOutputStream();
        ExcelExporter.writeAggregate(battles, names, List.of(), tp, agg);
        assertTrue(agg.size() > 3000, "汇总 xlsx 应有内容");
    }
}
