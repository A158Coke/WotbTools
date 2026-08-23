package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.Collected;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.export.ExcelExporter;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.parse.Replays;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.Aggregator;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 逐字段比对真实回放, 验证解析输出与已知正确值一致 (回归基线)。
 * 期望值为人工核对真实回放后固定下来的已验证值。
 */
class ParityTest {

    /** 定位提交版夹具目录（surefire 运行时 user.dir = wotb-core 模块目录）。 */
    private static Path fixturesDir() {
        return Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays")
                .normalize();
    }

    /** 本地可选扩展样本目录 common/data（gitignored，无则跳过本地扩展样本）。 */
    private static Path localDataDir() {
        return Path.of(System.getProperty("user.dir"), "..", "..", "common", "data").normalize();
    }

    private static List<Path> replays() throws Exception {
        final List<Path> result = new ArrayList<>();
        final Path committed = fixturesDir();
        if (Files.isDirectory(committed)) {
            try (Stream<Path> s = Files.list(committed)) {
                s.filter(p -> p.toString().toLowerCase().endsWith(".wotbreplay"))
                        .sorted()
                        .forEach(result::add);
            }
        }
        final Path local = localDataDir();
        if (Files.isDirectory(local)) {
            try (Stream<Path> s = Files.list(local)) {
                s.filter(p -> p.toString().toLowerCase().endsWith(".wotbreplay"))
                        .sorted()
                        .forEach(result::add);
            }
        }
        Assumptions.assumeTrue(!result.isEmpty(),
                "无真实回放夹具（common/fixtures/replays 或 common/data）");
        return result;
    }

    private static java.util.Optional<Battle> optionalBattleByArena(final String arenaId)
            throws Exception {
        for (final Path p : replays()) {
            final Battle b = ReplayParser.parse(Files.readAllBytes(p));
            if (arenaId.equals(b.arenaId)) {
                return java.util.Optional.of(b);
            }
        }
        return java.util.Optional.empty();
    }

    private static PlayerResult byAccount(final Battle battle, final long accountId) {
        return battle.players.stream()
                .filter(player -> player.accountId == accountId)
                .findFirst()
                .orElseThrow();
    }

    @Test
    void tankopediaResolves() {
        final Tankopedia tp = Tankopedia.load();
        // WG 官方 asia 数据默认只保留 7-10 级（302 辆），断言下限放宽到 200
        assertTrue(tp.size() > 200, "车辆库应非空");
        assertEquals("Kranvagn", tp.info(4481).name());
        assertEquals("Heavy tank", tp.info(4481).type());
        // 轻坦车种回归(枚举0被省略时仍应解析)
        assertEquals("Light tank", tp.info(24321).type(), "T-100 LT(24321) 应为轻坦");
    }

    @Test
    void parsesBattleExactValues() throws Exception {
        // lagoon 样本仅在本地 common/data 时存在（gitignored）；CI 只跑提交夹具
        final java.util.Optional<Battle> lagoon = optionalBattleByArena("1161909687528274499");
        Assumptions.assumeTrue(lagoon.isPresent(), "lagoon 样本不在本地, 跳过精确值回归");
        final Battle b = lagoon.get();
        assertEquals(14, b.players.size());
        assertEquals(Integer.valueOf(2), b.winnerTeam);

        // 录像者 WHAT_HPSHARING 的精确战绩 (与 Python 输出一致)
        final PlayerResult owner = byAccount(b, 3125699886L);
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
        for (final Path p : replays()) {
            final Battle b = ReplayParser.parse(Files.readAllBytes(p));
            assertEquals(14, b.players.size(), p.getFileName().toString());
            // 发射 >= 命中 >= 击穿
            for (final PlayerResult pr : b.players) {
                assertTrue(pr.nShots >= pr.nHitsDealt && pr.nHitsDealt >= pr.nPenetrationsDealt,
                        "发射>=命中>=击穿: " + pr.nickname);
            }
            // 每队击杀数 == 敌队阵亡数
            final int[] kills = new int[3];
            final int[] deaths = new int[3];
            for (final PlayerResult pr : b.players) {
                kills[pr.team] += pr.kills;
                if (!pr.survived) deaths[pr.team]++;
            }
            assertEquals(deaths[2], kills[1], "队1击杀==队2阵亡");
            assertEquals(deaths[1], kills[2], "队2击杀==队1阵亡");
        }
    }

    @Test
    void dedupAndAggregate() throws Exception {
        final List<Path> files = replays();
        final List<Source> sources = new ArrayList<>();
        for (final Path p : files) {
            sources.add(new Source(p.getFileName().toString(), Files.readAllBytes(p)));
        }
        // 再加一份重复(同一场)
        sources.add(new Source("dup.wotbreplay", Files.readAllBytes(files.get(0))));

        final Collected c = Replays.collect(sources, null);
        assertEquals(files.size(), c.battles.size(), "唯一战斗数");
        assertEquals(1, c.duplicates.size(), "应跳过 1 个重复");
        assertEquals(0, c.failures.size());

        final var agg = Aggregator.aggregate(c.battles, Tankopedia.load());
        assertFalse(agg.isEmpty());
        agg.values().forEach(a -> {
            assertTrue(a.battles >= 1 && a.battles <= c.battles.size());
            assertTrue(a.wins <= a.battles);
        });
    }

    @Test
    void exportsXlsx() throws Exception {
        final Tankopedia tp = Tankopedia.load();
        final Battle b = ReplayParser.parse(Files.readAllBytes(replays().get(0)));
        final ByteArrayOutputStream single = new ByteArrayOutputStream();
        ExcelExporter.writeSingle(b, tp, single);
        assertTrue(single.size() > 3000, "单场 xlsx 应有内容");

        final List<Battle> battles = new ArrayList<>();
        final List<String> names = new ArrayList<>();
        for (final Path p : replays()) {
            battles.add(ReplayParser.parse(Files.readAllBytes(p)));
            names.add(p.getFileName().toString());
        }
        final ByteArrayOutputStream agg = new ByteArrayOutputStream();
        ExcelExporter.writeAggregate(battles, names, List.of(), tp, agg);
        assertTrue(agg.size() > 3000, "汇总 xlsx 应有内容");
    }
}
