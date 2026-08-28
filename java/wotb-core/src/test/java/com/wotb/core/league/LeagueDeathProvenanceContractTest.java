package com.wotb.core.league;

import com.wotb.core.model.DeathTimeSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.facts.TradeFacts;
import com.wotb.core.util.PlayerResultFormat;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * P0-2 契约：死亡时间 provenance 必须被 League 全链（PlayerResultFormat / TradeFacts /
 * LeagueRatingValidator / LeagueRatingConflictDetector / LeagueRatingBatchAggregator）一致遵守。
 * UNKNOWN source 的 residual survivalTimeSec/deathTimeMillis 永远不得升级成 KNOWN。
 */
class LeagueDeathProvenanceContractTest {

    private static PlayerResult dead(final double survivalSec, final long deathMillis, final DeathTimeSource source) {
        final PlayerResult p = new PlayerResult();
        p.survived = false;
        p.deathTimeSource = source;
        p.survivalTimeSec = survivalSec;
        p.deathTimeMillis = deathMillis;
        return p;
    }

    @Test
    void validatorDoesNotUpgradeUnknownResidualToKnownDeath() {
        final com.wotb.core.model.Battle b =
                LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        final PlayerResult p = b.players.get(0);
        p.survived = false;
        p.deathTimeSource = DeathTimeSource.UNKNOWN;
        p.survivalTimeSec = 100.0;     // residual legacy
        p.deathTimeMillis = 100_000L;  // residual legacy
        // UNKNOWN residual 不得成为 authoritative death fact → 不得因「超过 duration」判 INVALID_STAT_FACTS
        final List<LeagueFailure> failures = LeagueRatingValidator.validate(b);
        assertTrue(failures.stream().noneMatch(f -> LeagueFailure.Code.INVALID_STAT_FACTS.equals(f.code())),
                "UNKNOWN residual 不得判为 INVALID_STAT_FACTS（不是 KNOWN death）: " + failures);
        // canonical deathSec 也必须是 0（UNKNOWN）
        assertEquals(0.0, PlayerResultFormat.deathSec(p), 1e-9);
    }

    @Test
    void validatorFlagsCanonicalKnownDeathBeyondDuration() {
        final com.wotb.core.model.Battle b =
                LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        final PlayerResult p = b.players.get(0);
        p.survived = false;
        p.deathTimeSource = DeathTimeSource.SETTLEMENT_SECOND;
        p.deathTimeMillis = 310_000L;  // deathSec = 310 > duration 300 + 1
        p.survivalTimeSec = 310.0;
        final List<LeagueFailure> failures = LeagueRatingValidator.validate(b);
        assertTrue(failures.stream().anyMatch(f -> LeagueFailure.Code.INVALID_STAT_FACTS.equals(f.code())),
                "canonical KNOWN death 超过 duration 应判 INVALID_STAT_FACTS: " + failures);
    }

    @Test
    void deathSecAndTradeFactsHonorSourceProvenance() {
        // LIVE_EXACT → survivalTimeSec（即使 settlement 数值更小也更精确）
        final PlayerResult live = dead(128.50, 128_000L, DeathTimeSource.LIVE_EXACT);
        assertEquals(128.50, PlayerResultFormat.deathSec(live), 1e-9);

        // SETTLEMENT_SECOND → deathTimeMillis / 1000（即使 survivalTimeSec 残留不同）
        final PlayerResult settlement = dead(999.0, 128_000L, DeathTimeSource.SETTLEMENT_SECOND);
        assertEquals(128.0, PlayerResultFormat.deathSec(settlement), 1e-9);

        // UNKNOWN source + residual → 0（绝不把 residual 升级成 KNOWN）
        final PlayerResult unknown = dead(100.0, 100_000L, DeathTimeSource.UNKNOWN);
        assertEquals(0.0, PlayerResultFormat.deathSec(unknown), 1e-9);
        // UNKNOWN 死亡时刻不得推断 trade
        assertEquals(0, TradeFacts.tradedDeaths(unknown, List.of(unknown)),
                "UNKNOWN 死亡时刻不得推断 trade");
    }

    @Test
    void detectorAndValidatorPreserveSourcePriority() {
        // LeagueRatingConflictDetector：LIVE_EXACT 128.50 + SETTLEMENT_SECOND 128.00 → canonical LIVE_EXACT 128.50
        final com.wotb.core.model.Battle a =
                LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        a.players.get(0).survived = false;
        a.players.get(0).deathTimeSource = DeathTimeSource.LIVE_EXACT;
        a.players.get(0).survivalTimeSec = 128.50;
        a.players.get(0).deathTimeMillis = 128_500L;
        final com.wotb.core.model.Battle b =
                LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b.players.get(0).survived = false;
        b.players.get(0).deathTimeSource = DeathTimeSource.SETTLEMENT_SECOND;
        b.players.get(0).deathTimeMillis = 128_000L;
        b.players.get(0).survivalTimeSec = 128.00;
        LeagueRatingConflictDetector.reconcileDeathTimes(a, List.of(a, b));
        assertEquals(128.50, a.players.get(0).survivalTimeSec, 1e-9,
                "LIVE_EXACT 优先于 SETTLEMENT_SECOND，即使 settlement 数值更小");
        assertEquals(DeathTimeSource.LIVE_EXACT, a.players.get(0).deathTimeSource);
    }

    @Test
    void reconcilePreservesRawDeathTimeMillisForLiveExact() {
        // P1 数据完整性：LIVE_EXACT 收口时不得把 live-derived canonical fact 写回
        // 原始 proto #104 deathTimeMillis（该字段语义 = 原始结算，不是 canonical time）。
        final com.wotb.core.model.Battle a =
                LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        a.players.get(0).survived = false;
        a.players.get(0).deathTimeSource = DeathTimeSource.LIVE_EXACT;
        a.players.get(0).survivalTimeSec = 128.543;
        a.players.get(0).deathTimeMillis = 128_000L; // 原始结算 #104
        final com.wotb.core.model.Battle b =
                LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b.players.get(0).survived = false;
        b.players.get(0).deathTimeSource = DeathTimeSource.SETTLEMENT_SECOND;
        b.players.get(0).deathTimeMillis = 128_000L;
        b.players.get(0).survivalTimeSec = 128.00;
        LeagueRatingConflictDetector.reconcileDeathTimes(a, List.of(a, b));
        assertEquals(128.543, a.players.get(0).survivalTimeSec, 1e-9);
        assertEquals(DeathTimeSource.LIVE_EXACT, a.players.get(0).deathTimeSource);
        assertEquals(128_000L, a.players.get(0).deathTimeMillis,
                "LIVE_EXACT 收口不得改写原始 #104 deathTimeMillis（保留 settlement 原始值）");
    }
}
