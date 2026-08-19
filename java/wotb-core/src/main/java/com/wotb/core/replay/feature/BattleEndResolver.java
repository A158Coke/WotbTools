package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;

public final class BattleEndResolver {

    private BattleEndResolver() {
    }

    public enum BattleEndSource {
        BATTLE_RESULTS, REPLAY_EVENT, SCOPE_LOCAL_EVIDENCE, UNKNOWN
    }

    public record BattleEndResult(Float battleEndRelativeSec, BattleEndSource source, String limitation) {
        public boolean resolved() {
            return battleEndRelativeSec != null;
        }
    }

    public static BattleEndResult resolve(final Battle battle, final Float eventBasedEndSec, final Float scopeLocalEndSec) {
        if (battle != null && battle.durationS != null && Double.isFinite(battle.durationS) && battle.durationS > 0.0) {
            return new BattleEndResult(battle.durationS.floatValue(), BattleEndSource.BATTLE_RESULTS, null);
        }
        if (eventBasedEndSec != null && Float.isFinite(eventBasedEndSec) && eventBasedEndSec >= 0f) {
            return new BattleEndResult(eventBasedEndSec, BattleEndSource.REPLAY_EVENT, null);
        }
        if (scopeLocalEndSec != null && Float.isFinite(scopeLocalEndSec) && scopeLocalEndSec >= 0f) {
            return new BattleEndResult(scopeLocalEndSec, BattleEndSource.SCOPE_LOCAL_EVIDENCE, null);
        }
        return new BattleEndResult(null, BattleEndSource.UNKNOWN, "BATTLE_END_UNRESOLVED");
    }
}
