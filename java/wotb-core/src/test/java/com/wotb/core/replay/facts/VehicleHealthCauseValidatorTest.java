package com.wotb.core.replay.facts;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HpRawState;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.VehicleHealthStateEvent;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Field-specific method1 raw-cause validator contract.
 *
 * <p>Semantic comes from the packet-local invariant (causeFlag + sourceEntity relationship); settlement
 * deathReason must never gate intermediate FIRE / RAMMING / DIRECT events. The raw event keeps
 * {@code cause=null} while unvalidated (decoder-like), and the semantic is absent when the entity is not
 * a settled combatant.</p>
 */
class VehicleHealthCauseValidatorTest {

    private static final int EID = 7;
    private static final long ACC = 1001L;

    private static VehicleHealthStateEvent event(final int causeFlag, final int sourceEntity) {
        return new VehicleHealthStateEvent(1, new ReplayTimestamp(10f, null), 8,
                DecodeConfidence.EXACT, EID, 1500, sourceEntity, causeFlag, null, HpRawState.CURRENT_HP);
    }

    private static TeamEntityMapping mapping() {
        return new TeamEntityMapping(
                Map.of(EID, new TeamEntityIdentity(EID, ACC, "A", 1, "T72", 1, DecodeConfidence.EXACT)),
                Map.of(ACC, List.of(EID)), 0, List.of());
    }

    private static Battle battle(final int deathReasonRaw, final boolean survived) {
        final Battle b = new Battle();
        final PlayerResult p = new PlayerResult();
        p.accountId = ACC;
        p.survived = survived;
        p.settlementDeathReasonRaw = deathReasonRaw;
        b.players = new java.util.ArrayList<>(List.of(p));
        return b;
    }

    @Test
    void drowningRequiresProvenSelfSource() {
        // flag5 without the self/environment source relation is not a proven drowning.
        assertNull(VehicleHealthCauseValidator.validate(event(5, 99), null, mapping()));
        assertEquals(VehicleHealthStateEvent.Cause.DROWNING,
                VehicleHealthCauseValidator.validate(event(5, EID), null, mapping()));
    }

    @Test
    void intermediateFireAndRammingNotDroppedByDifferentSettlementReason() {
        // Final settlement deathReason = 5 (drowning), but intermediate FIRE (flag=1) / RAMMING (flag=2)
        // must still validate from the packet-local invariant, not be dropped by cross-evidence.
        final Battle battle = battle(5, false);
        assertEquals(VehicleHealthStateEvent.Cause.FIRE,
                VehicleHealthCauseValidator.validate(event(1, 99), battle, mapping()));
        assertEquals(VehicleHealthStateEvent.Cause.RAMMING,
                VehicleHealthCauseValidator.validate(event(2, 99), battle, mapping()));
        assertEquals(VehicleHealthStateEvent.Cause.DIRECT,
                VehicleHealthCauseValidator.validate(event(0, 99), battle, mapping()));
    }

    @Test
    void survivorIntermediateCauseStillValidates() {
        // A survivor (settlement deathReason = -1 sentinel) must not cause the validator to drop a
        // packet-local proven intermediate cause.
        final Battle battle = battle(-1, true);
        assertEquals(VehicleHealthStateEvent.Cause.FIRE,
                VehicleHealthCauseValidator.validate(event(1, 99), battle, mapping()));
        assertEquals(VehicleHealthStateEvent.Cause.RAMMING,
                VehicleHealthCauseValidator.validate(event(2, 99), battle, mapping()));
    }

    @Test
    void unvalidatableCauseWithholdsSemantic() {
        // Unknown flag (no packet-local invariant) -> semantic absent, raw retained.
        assertNull(VehicleHealthCauseValidator.validate(event(9, 99), null, mapping()));
        // Entity not resolvable to a settled combatant -> semantic absent.
        final TeamEntityMapping empty = new TeamEntityMapping(Map.of(), Map.of(), 0, List.of());
        assertNull(VehicleHealthCauseValidator.validate(event(5, EID), null, empty));
    }

    @Test
    void packetLocalSemanticMatchesDerivation() {
        // The packet-local derivation (consumed by reconstruction) is the same semantic the identity
        // gate wraps; it is not decoder promotion (cause field stays null on the raw event).
        assertEquals(VehicleHealthStateEvent.Cause.DIRECT,
                VehicleHealthStateEvent.deriveSemanticCause(event(0, 99)));
        assertEquals(VehicleHealthStateEvent.Cause.FIRE,
                VehicleHealthStateEvent.deriveSemanticCause(event(1, 99)));
        assertEquals(VehicleHealthStateEvent.Cause.RAMMING,
                VehicleHealthStateEvent.deriveSemanticCause(event(2, 99)));
        assertEquals(VehicleHealthStateEvent.Cause.WORLD_OR_ENVIRONMENT,
                VehicleHealthStateEvent.deriveSemanticCause(event(3, EID)));
        assertNull(VehicleHealthStateEvent.deriveSemanticCause(event(5, 99)));
        assertEquals(VehicleHealthStateEvent.Cause.DROWNING,
                VehicleHealthStateEvent.deriveSemanticCause(event(5, EID)));
        assertNull(VehicleHealthStateEvent.deriveSemanticCause(event(9, 99)));
    }

    @Test
    void sourceRelationshipIsThePacketLocalInvariant() {
        // flag1/flag2 require an external source; flag3/flag5 require the self/environment source.
        // An unmet relation withholds the semantic (absent), never guesses a cause.
        assertNull(VehicleHealthStateEvent.deriveSemanticCause(event(1, EID)), "flag1 self -> absent");
        assertNull(VehicleHealthStateEvent.deriveSemanticCause(event(2, EID)), "flag2 self -> absent");
        assertNull(VehicleHealthStateEvent.deriveSemanticCause(event(3, 99)), "flag3 external -> absent");
        assertNull(VehicleHealthStateEvent.deriveSemanticCause(event(5, 99)), "flag5 external -> absent");
        assertEquals(VehicleHealthStateEvent.Cause.FIRE,
                VehicleHealthStateEvent.deriveSemanticCause(event(1, 99)));
        assertEquals(VehicleHealthStateEvent.Cause.RAMMING,
                VehicleHealthStateEvent.deriveSemanticCause(event(2, 99)));
        assertEquals(VehicleHealthStateEvent.Cause.WORLD_OR_ENVIRONMENT,
                VehicleHealthStateEvent.deriveSemanticCause(event(3, EID)));
        assertEquals(VehicleHealthStateEvent.Cause.DROWNING,
                VehicleHealthStateEvent.deriveSemanticCause(event(5, EID)));
    }

    @Test
    void rawCauseAlwaysRetainedWhenSemanticAbsent() {
        // When the invariant is unmet the raw fields (causeFlag/sourceEntity) are retained and the
        // decoder keeps the semantic cause=null (raw is never overwritten by a guessed semantic).
        final VehicleHealthStateEvent e = event(5, 99); // flag5 + external source -> semantic absent
        assertNull(e.cause());
        assertEquals(5, e.causeFlag());
        assertEquals(99, e.sourceEntity());
        assertNull(VehicleHealthCauseValidator.validate(e, null, mapping()));
    }
}
