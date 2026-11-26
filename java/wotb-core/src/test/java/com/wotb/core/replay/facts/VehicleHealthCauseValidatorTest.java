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
        assertNull(VehicleHealthCauseValidator.validate(event(5, 99), null, mapping()));
        assertEquals(VehicleHealthStateEvent.Cause.DROWNING,
                VehicleHealthCauseValidator.validate(event(5, EID), null, mapping()));
    }

    @Test
    void intermediateFireAndRammingNotDroppedByDifferentSettlementReason() {
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
        final Battle battle = battle(-1, true);
        assertEquals(VehicleHealthStateEvent.Cause.FIRE,
                VehicleHealthCauseValidator.validate(event(1, 99), battle, mapping()));
        assertEquals(VehicleHealthStateEvent.Cause.RAMMING,
                VehicleHealthCauseValidator.validate(event(2, 99), battle, mapping()));
    }

    @Test
    void unvalidatableCauseWithholdsSemantic() {
        assertNull(VehicleHealthCauseValidator.validate(event(9, 99), null, mapping()));
        final TeamEntityMapping empty = new TeamEntityMapping(Map.of(), Map.of(), 0, List.of());
        assertNull(VehicleHealthCauseValidator.validate(event(5, EID), null, empty));
    }

    @Test
    void packetLocalSemanticMatchesDerivation() {
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
        final VehicleHealthStateEvent e = event(5, 99);
        assertNull(e.cause());
        assertEquals(5, e.causeFlag());
        assertEquals(99, e.sourceEntity());
        assertNull(VehicleHealthCauseValidator.validate(e, null, mapping()));
    }
}
