package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.parse.ParsedReplay;
import com.wotb.core.replay.processing.DeathTimeReconciler;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PR147 settlement canonical-model regression (build-to-learn, proved on the real fixture):
 * <ul>
 *   <li>{@code battle_results.dat} 11.19/11.18 corpus 无 #104 deathTimeMillis；<b>#24 lifeTime(秒)</b> 是
 *       SETTLEMENT_SECOND 死亡时刻，<b>#25 killerID</b> 是 result/entity-id namespace（非 accountId），
 *       <b>#105 deathReason</b> (-1=幸存 sentinel)，<b>#301 outer field1</b>=result/entity-id，
 *       root2/3/4/5 = battle unix ts / winnerTeam / finishReason / duration。</li>
 *   <li>survived 由 deathReason==-1 派生；killerAccountId 由 killerID(result id) 经
 *       result/entity-id → accountId 映射解析。</li>
 *   <li>DeathTimeReconciler：无 live EXACT 时以 settlementLifeTimeSec 建立 SETTLEMENT_SECOND，而非 #104。</li>
 * </ul>
 */
class SettlementCanonicalModelTest {

    private static Path fixture() throws Exception {
        final Path dir = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays").normalize();
        assertTrue(Files.isDirectory(dir), "common/fixtures/replays 必须存在");
        try (Stream<Path> s = Files.list(dir)) {
            return s.filter(p -> p.getFileName().toString().contains("random-battle-example"))
                    .findFirst().orElseThrow();
        }
    }

    @Test
    void deadAndSurvivorSettlementEvidence() throws Exception {
        final Battle b = ReplayParser.parse(Files.readAllBytes(fixture()));
        assertEquals(1, b.players.stream().filter(p -> p.survived).count(), "幸存人数");
        final PlayerResult survivor = b.players.stream().filter(p -> p.survived).findFirst().orElseThrow();
        assertEquals(Integer.valueOf(-1), survivor.settlementDeathReasonRaw,
                "幸存者 deathReason 必须是 -1 sentinel");
        assertEquals(0L, survivor.deathTimeMillis, "幸存者无死亡时刻");
        // 幸存者 lifeTime == 整场时长（field24）
        assertTrue(survivor.settlementLifeTimeSec > 0, "幸存者 lifeTime=整场时长");

        int deadWithSettlementTime = 0;
        for (final PlayerResult p : b.players) {
            if (p.survived) {
                continue;
            }
            // 阵亡玩家：deathReason 不是 -1；无 #104；lifeTime>0 → SETTLEMENT_SECOND
            assertTrue(p.settlementDeathReasonRaw == null || p.settlementDeathReasonRaw != -1,
                    "阵亡玩家 deathReason 不得为 -1");
            assertTrue(p.settlementLifeTimeSec > 0, "阵亡玩家必须有 settlement lifeTime");
            assertEquals(DeathTimeSource.SETTLEMENT_SECOND, p.deathTimeSource,
                    "无 live EXACT 时阵亡玩家应为 SETTLEMENT_SECOND");
            deadWithSettlementTime++;
            // killerID 若指向某 #301 玩家（result/entity-id namespace），必须映射到合法 accountId
            assertTrue(p.settlementResultEntityId > 0, "阵亡玩家必须有 result/entity id");
            if (p.settlementKillerResultEntityId != null) {
                assertNotNull(p.killerAccountId,
                        "killerID(result id) 必须经 result/entity-id -> accountId 映射，绝不等同 accountId");
                assertTrue(p.killerAccountId > 0);
                assertNotEquals(p.settlementKillerResultEntityId.longValue(), p.killerAccountId.longValue(),
                        "killerID 是 result/entity-id，不是 accountId");
            }
        }
        assertTrue(deadWithSettlementTime >= 10, "大部分阵亡玩家应具有 settlement lifeTime");
        // 原始 #104 不得作为死亡时刻（11.19 corpus 无该字段）
        assertEquals(0L, b.players.get(0).raw.getOrDefault(104, List.of()).size(),
                "11.19 结算无 #104 deathTimeMillis");
    }

    @Test
    void settlementFactsRemainAuthoritativeForFutureClientVersion() throws Exception {
        final ParsedReplay parsed = ParsedReplay.read(Files.readAllBytes(fixture()));
        final ParsedReplay futureVersion = new ParsedReplay(
                parsed.entries(), "11.20.0_china", parsed.settlementFacts(), parsed.settlementError(),
                parsed.streamHeader(), parsed.meta());

        final Battle current = ReplayParser.parse(parsed);
        final Battle future = ReplayParser.parse(futureVersion);

        assertEquals(current.players.size(), future.players.size());
        assertEquals(current.players.stream().filter(p -> p.survived).count(),
                future.players.stream().filter(p -> p.survived).count(),
                "settlement survivor semantics must not depend on client version");
        for (int i = 0; i < current.players.size(); i++) {
            final PlayerResult expected = current.players.get(i);
            final PlayerResult actual = future.players.get(i);
            assertEquals(expected.survived, actual.survived);
            assertEquals(expected.settlementLifeTimeSec, actual.settlementLifeTimeSec);
            assertEquals(expected.settlementDeathReasonRaw, actual.settlementDeathReasonRaw);
            assertEquals(expected.killerAccountId, actual.killerAccountId);
        }
    }

    @Test
    void battleTopLevelSettlementFacts() throws Exception {
        final Battle b = ReplayParser.parse(Files.readAllBytes(fixture()));
        assertTrue(b.settlementStartTime != null && b.settlementStartTime > 1_400_000_000L,
                "root2 = battle unix timestamp");
        assertEquals(Integer.valueOf(2), b.winnerTeam);
        assertNotNull(b.settlementFinishReasonRaw, "root4 = finishReason raw");
        assertTrue(b.settlementDurationSec != null && b.settlementDurationSec > 0, "root5 = settlement duration");
        assertEquals(b.settlementDurationSec, b.durationS,
                "settlement root5 是 duration 主 authority（meta 只做 cross-check）");
    }

    @Test
    void reconcilerStoresSettlementFallbackAsSeparateObservation() {
        // PR147: deathTimeMillis 由 ReplayParser 从 field24 lifeTime 派生（#104 不存在）。
        // Reconciliation must expose the settlement fallback through Battle without mutating
        // the settlement compatibility projection on PlayerResult.
        final PlayerResult dead = new PlayerResult();
        dead.accountId = 1001L;
        dead.survived = false;
        dead.deathTimeMillis = 128_000L; // = field24 lifeTime 128s 派生
        dead.settlementLifeTimeSec = 128.0;
        dead.settlementDeathReasonRaw = 0;
        final PlayerResult alive = new PlayerResult();
        alive.accountId = 1002L;
        alive.survived = true;
        final Battle battle = new Battle();
        battle.durationS = 300.0;
        battle.players = List.of(dead, alive);
        DeathTimeReconciler.reconcile(battle, List.of(), null, null);
        assertEquals(DeathTimeSource.SETTLEMENT_SECOND,
                battle.liveDeathObservations.get(dead.accountId).source());
        assertEquals(128.0, battle.liveDeathObservations.get(dead.accountId).timeSec(), 0.001);
        assertNull(dead.deathTimeSource, "reconciler 不得回写 PlayerResult provenance");
        assertEquals(0.0, dead.survivalTimeSec, 0.001,
                "reconciler 不得回写 PlayerResult live projection");
        assertNull(alive.deathTimeSource, "幸存者无死亡证据");
    }

    private static void assertNotEquals(final long a, final long b, final String msg) {
        if (a == b) throw new AssertionError(msg + " (was equal)");
    }
}
