package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.util.PlayerResultFormat;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 提交版真实回放夹具回归（CI 无条件执行，不再依赖 gitignored common/data）。
 * <p>夹具经 {@code common/fixtures/mask_replay.py} 脱敏：昵称/军团名全部替换为占位符
 * （x / © / 隐 / 😀），账号 ID 保留；本测试只断言结构与解析值，不包含真实昵称。</p>
 */
class ReplayParserFixtureTest {

    /** 定位提交夹具目录（surefire 运行时 user.dir = wotb-core 模块目录）。 */
    private static Path fixturesDir() {
        return Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays")
                .normalize();
    }

    private static List<Path> fixtures() throws Exception {
        final Path dir = fixturesDir();
        Assumptions.assumeTrue(Files.isDirectory(dir),
                "common/fixtures/replays 目录不存在");
        try (Stream<Path> s = Files.list(dir)) {
            return s.filter(p -> p.toString().toLowerCase().endsWith(".wotbreplay"))
                    .sorted()
                    .toList();
        }
    }

    private static Battle fixtureByArena(final String arenaId) throws Exception {
        for (final Path p : fixtures()) {
            final Battle b = ReplayParser.parse(Files.readAllBytes(p));
            if (arenaId.equals(b.arenaId)) {
                return b;
            }
        }
        throw new AssertionError("夹具中找不到 arenaId=" + arenaId);
    }

    @Test
    void committedFixturesAreMaskedAndStructurallyValid() throws Exception {
        final List<Path> files = fixtures();
        assertFalse(files.isEmpty(), "至少应提交一个脱敏夹具");
        for (final Path p : files) {
            final Battle b = ReplayParser.parse(Files.readAllBytes(p));
            assertEquals(14, b.players.size(), p.getFileName().toString());
            // 昵称非空且全部为掩码占位符（x/©/隐/😀），保证无真实昵称泄漏
            assertTrue(b.players.stream().allMatch(pr ->
                            !pr.nickname.isBlank() && pr.nickname.matches("[x©隐😀]+")),
                    "夹具昵称必须是掩码占位符: " + p.getFileName());
            // 发射 >= 命中 >= 击穿
            b.players.forEach(pr -> assertTrue(
                    pr.nShots >= pr.nHitsDealt && pr.nHitsDealt >= pr.nPenetrationsDealt,
                    "发射>=命中>=击穿: " + p.getFileName()));
            // 每队击杀数 == 敌队阵亡数
            final int[] kills = new int[3];
            final int[] deaths = new int[3];
            b.players.forEach(pr -> {
                kills[pr.team] += pr.kills;
                if (!pr.survived) {
                    deaths[pr.team]++;
                }
            });
            assertEquals(deaths[2], kills[1], "队1击杀==队2阵亡");
            assertEquals(deaths[1], kills[2], "队2击杀==队1阵亡");
        }
    }

    @Test
    void neptuneTeamFixtureExactValues() throws Exception {
        final Battle b = fixtureByArena("9034890693886323");
        assertEquals("neptune", b.mapName);
        assertEquals(Integer.valueOf(2), b.winnerTeam);
        assertEquals(14, b.players.size());

        final int team1 = b.players.stream().filter(p -> p.team == 1)
                .mapToInt(p -> p.damageDealt).sum();
        final int team2 = b.players.stream().filter(p -> p.team == 2)
                .mapToInt(p -> p.damageDealt).sum();
        assertEquals(20360, team2, "CHRD 团队输出");
        assertEquals(13608, team1, "对方团队输出");

        assertEquals(3, b.players.stream().filter(p -> p.team == 2 && !p.survived).count());
        assertEquals(7, b.players.stream().filter(p -> p.team == 1 && !p.survived).count());
        assertTrue(b.players.stream().filter(p -> !p.survived)
                        .allMatch(p -> PlayerResultFormat.deathSec(p) > 0),
                "阵亡时刻必须已知");

        final double[] friendlyDead = b.players.stream()
                .filter(p -> p.team == 2 && !p.survived)
                .mapToDouble(PlayerResultFormat::deathSec)
                .sorted()
                .toArray();
        assertEquals(66.74, friendlyDead[0], 0.5);
        assertEquals(95.05, friendlyDead[1], 0.5);
        assertEquals(114.96, friendlyDead[2], 0.5);

        final double enemyLast = b.players.stream()
                .filter(p -> p.team == 1 && !p.survived)
                .mapToDouble(PlayerResultFormat::deathSec)
                .max()
                .orElse(0);
        assertEquals(139.25, enemyLast, 0.5, "对方最后一辆阵亡时刻");
    }
}
