package com.wotb.core.replay.facts;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.VehicleHealthStateEvent;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;

/**
 * Field-specific method1 raw-cause validator.
 *
 * <p><b>Packet-local semantic core.</b> The semantic cause is derived from the PR147-proven
 * packet-local invariant — the preserved {@code causeFlag} plus the {@code sourceEntity} relationship
 * ({@link VehicleHealthStateEvent#deriveSemanticCause}). Cross-event / settlement evidence is <b>not</b>
 * a required gate for the semantic: intermediate FIRE / RAMMING / DIRECT events must validate from the
 * packet-local invariant regardless of the player's final settlement deathReason.</p>
 *
 * <p><b>Identity gate.</b> When a {@link TeamEntityMapping} is supplied the target entity must resolve
 * to a usable settled combatant, otherwise the semantic is absent (the event retains every raw field;
 * no UNKNOWN/PARTIAL state explosion). Settlement deathReason, when available, is only ever optional
 * corroboration for terminal death and never gates intermediate-event semantics.</p>
 */
public final class VehicleHealthCauseValidator {

    private VehicleHealthCauseValidator() {
    }

    /**
     * Validates a method1 raw cause for a settled combatant. The packet-local semantic is derived by
     * {@link VehicleHealthStateEvent#deriveSemanticCause}; this method only adds the identity gate. The semantic comes from the packet-local
     * invariant; the identity gate only confirms the target resolves to a usable settled combatant.
     * Cross-event/settlement evidence is never a required gate for intermediate-event semantics.
     *
     * @param event   the method1 event
     * @param battle  optional settlement context (corroboration only; unused as a gate)
     * @param mapping optional entity→account mapping (identity gate)
     * @return the validated semantic cause, or {@code null} when the target is not a settled combatant
     *         or the packet-local invariant is unmet
     */
    public static VehicleHealthStateEvent.Cause validate(
            final VehicleHealthStateEvent event,
            final Battle battle,
            final TeamEntityMapping mapping) {
        if (event == null) {
            return null;
        }
        if (mapping != null) {
            final TeamEntityIdentity identity = mapping.identity(event.entityId());
            if (identity == null || !identity.usable() || identity.accountId() <= 0) {
                return null;
            }
        }
        return VehicleHealthStateEvent.deriveSemanticCause(event);
    }
}
