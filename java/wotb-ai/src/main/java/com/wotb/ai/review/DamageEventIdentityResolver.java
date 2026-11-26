package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

final class DamageEventIdentityResolver {

    private DamageEventIdentityResolver() {
    }

    static TeamEntityMapping mapping(final Battle battle, final ReplayReconstruction recon) {
        return TeamEntityMapper.resolve(battle, recon);
    }

    static long victimAccount(final DamageEvent damage, final TeamEntityMapping mapping) {
        if (damage.victimAccountId() != null && damage.victimAccountId() > 0) {
            return damage.victimAccountId();
        }
        return accountOf(damage.victimEid(), mapping);
    }

    static long attackerAccount(final DamageEvent damage, final TeamEntityMapping mapping) {
        if (damage.attackerAccountId() != null && damage.attackerAccountId() > 0) {
            return damage.attackerAccountId();
        }
        return accountOf(damage.attackerEid(), mapping);
    }

    private static long accountOf(final int entityId, final TeamEntityMapping mapping) {
        if (entityId <= 0) {
            return 0L;
        }
        final TeamEntityIdentity identity = mapping.identity(entityId);
        return identity != null ? identity.accountId() : 0L;
    }
}
