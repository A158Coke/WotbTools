package com.wotb.core.replay.facts;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.feature.PlaybackCombatReconstruction;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** KillerEvidence resolver (settlement authority + live cross-check, fail-closed on conflict. */
class KillerEvidenceResolverTest {

    private static PlayerResult victim(final long accountId, final Long settlementKiller) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.killerAccountId = settlementKiller;
        return p;
    }

    private static PlaybackCombatReconstruction.Result combat(final long victimAcc, final Long liveKiller) {
        final var destroyed = liveKiller == null
                ? List.<PlaybackCombatReconstruction.Destroyed>of()
                : List.of(new PlaybackCombatReconstruction.Destroyed(100.0, victimAcc, liveKiller));
        return new PlaybackCombatReconstruction.Result(Map.of(), destroyed);
    }

    @Test
    void settlementIsAuthoritativeWhenLiveAgrees() {
        final var e = KillerEvidenceResolver.resolve(victim(1001, 2002L), combat(1001, 2002L));
        assertEquals(KillerEvidenceResolver.Source.SETTLEMENT, e.source());
        assertEquals(Long.valueOf(2002L), e.killerAccountId());
        assertEquals(true, e.confirmed());
    }

    @Test
    void settlementUsedWhenLiveUnknown() {
        final var e = KillerEvidenceResolver.resolve(victim(1001, 2002L), combat(1001, null));
        assertEquals(KillerEvidenceResolver.Source.SETTLEMENT, e.source());
        assertEquals(Long.valueOf(2002L), e.killerAccountId());
    }

    @Test
    void liveUsedWhenSettlementUnknown() {
        final var e = KillerEvidenceResolver.resolve(victim(1001, null), combat(1001, 2002L));
        assertEquals(KillerEvidenceResolver.Source.LIVE, e.source());
        assertEquals(Long.valueOf(2002L), e.killerAccountId());
    }

    @Test
    void conflictFailsClosed() {
        final var e = KillerEvidenceResolver.resolve(victim(1001, 2002L), combat(1001, 3003L));
        assertEquals(KillerEvidenceResolver.Source.CONFLICT, e.source());
        assertNull(e.killerAccountId(), "settlement vs live conflict -> fail closed, never pick one");
        assertEquals(false, e.confirmed());
    }

    @Test
    void unknownWhenNoEvidence() {
        final var e = KillerEvidenceResolver.resolve(victim(1001, null), combat(1001, null));
        assertEquals(KillerEvidenceResolver.Source.UNKNOWN, e.source());
        assertNull(e.killerAccountId());
    }
}
