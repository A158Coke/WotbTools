package com.wotb.core.replay.facts;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.VehicleHealthStateEvent;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;

/** Field-specific method1 raw-cause validator. */
public final class VehicleHealthCauseValidator {

    private VehicleHealthCauseValidator() {
    }

    /**
     * Promotes a raw method1 flag only when the target resolves to a settled combatant and the
     * settlement deathReason agrees. Drowning additionally requires the proven self-source relation.
     * A missing/contradictory fact returns null while the event retains every raw field.
     */
    public static VehicleHealthStateEvent.Cause validate(
            final VehicleHealthStateEvent event,
            final Battle battle,
            final TeamEntityMapping mapping) {
        if (event == null || battle == null || battle.players == null || mapping == null) {
            return null;
        }
        final TeamEntityIdentity identity = mapping.identity(event.entityId());
        if (identity == null || !identity.usable() || identity.accountId() <= 0) {
            return null;
        }
        final PlayerResult player = battle.players.stream()
                .filter(p -> p != null && p.accountId == identity.accountId())
                .findFirst().orElse(null);
        if (player == null || player.survived) {
            return null;
        }
        final Integer settlementReason = player.settlementDeathReasonRaw;
        final int raw = event.causeFlag();
        if (raw == 0 && Integer.valueOf(0).equals(settlementReason)) {
            return VehicleHealthStateEvent.Cause.DIRECT;
        }
        if (settlementReason == null || settlementReason != raw) {
            return null;
        }
        return switch (raw) {
            case 1 -> VehicleHealthStateEvent.Cause.FIRE;
            case 2 -> VehicleHealthStateEvent.Cause.RAMMING;
            case 3 -> VehicleHealthStateEvent.Cause.WORLD_OR_ENVIRONMENT;
            case 5 -> event.sourceEntity() == event.entityId()
                    ? VehicleHealthStateEvent.Cause.DROWNING : null;
            default -> null;
        };
    }
}
