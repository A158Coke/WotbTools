package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 提交版真实回放夹具回归（CI 无条件执行，不依赖 gitignored common/data）。
 * <p>夹具为随机战斗回放（rift），按用户指示原样提交、不脱敏；本测试只断言结构与解析值。</p>
 */
class ReplayParserFixtureTest {

    /** 定位提交夹具目录（surefire 运行时 user.dir = wotb-core 模块目录）。 */
    private static Path fixturesDir() {
        return Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays")
                .normalize();
    }

    private static List<Path> fixtures() throws Exception {
        final Path dir = fixturesDir();
        assertTrue(Files.isDirectory(dir),
                "common/fixtures/replays 目录必须存在（已提交夹具，CI 无条件执行）");
        try (Stream<Path> s = Files.list(dir)) {
            return s.filter(p -> p.toString().toLowerCase().endsWith(".wotbreplay"))
                    .sorted()
                    .toList();
        }
    }

    @Test
    void randomBattleFixtureExactValues() throws Exception {
        final List<Path> files = fixtures();
        assertFalse(files.isEmpty(), "至少应提交一个夹具");
        final Path fixture = files.stream()
                .filter(p -> p.getFileName().toString().contains("random-battle-example"))
                .findFirst()
                .orElseGet(files::getFirst);
        final Battle b = ReplayParser.parse(Files.readAllBytes(fixture));

        assertEquals("1168689173149065733", b.arenaId);
        assertEquals("rift", b.mapName);
        assertEquals(Integer.valueOf(2), b.winnerTeam);
        assertEquals(14, b.players.size());
        assertTrue(Boolean.TRUE.equals(b.rosterComplete),
                "真实 7v7 夹具：名册(#201)与战绩(#301)账号集合一致时应标记结算阵容完整");

        // meta.json#playerName 可能是「军团-昵称」拼接（如 CHRD-A158布丁）：
        // 录像者必须按 roster 纯昵称解析，禁止把军团名当玩家名
        final PlayerResult recorder = b.recorderResult();
        assertNotNull(recorder, "随机战录像者必须能按纯昵称解析");
        assertEquals(recorder.nickname, b.recorder,
                "录像者必须是纯昵称，不得带军团前缀");

        final int team1 = b.players.stream().filter(p -> p.team == 1)
                .mapToInt(p -> p.damageDealt).sum();
        final int team2 = b.players.stream().filter(p -> p.team == 2)
                .mapToInt(p -> p.damageDealt).sum();
        assertEquals(12917, team1, "team1 输出");
        assertEquals(13600, team2, "team2 输出");

        assertEquals(1, b.players.stream().filter(p -> p.survived).count(),
                "幸存人数");
        assertTrue(b.players.stream().allMatch(p -> !p.nickname.isBlank()),
                "昵称非空");
    }

    @Test
    void committedFixturesAreStructurallyValid() throws Exception {
        for (final Path p : fixtures()) {
            final Battle b = ReplayParser.parse(Files.readAllBytes(p));
            assertEquals(14, b.players.size(), p.getFileName().toString());
            assertTrue(Boolean.TRUE.equals(b.rosterComplete),
                    "已提交夹具必须标记结算阵容完整（rosterComplete=true）: " + p.getFileName());
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
}
