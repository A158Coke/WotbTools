package com.wotb.core.replay.facts;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.VehicleHealthStateEvent;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;

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
