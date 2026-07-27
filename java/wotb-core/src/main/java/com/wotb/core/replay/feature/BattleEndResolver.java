package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;

public final class BattleEndResolver {

    private BattleEndResolver() {}

    public record BattleEndResult(Float battleEndRelativeSec, String source, String limitation) {
        public boolean resolved() {
            return battleEndRelativeSec != null;
        }
    }

    public static final String BATTLE_RESULTS = "BATTLE_RESULTS";
    public static final String REPLAY_EVENT = "REPLAY_EVENT";
    public static final String SCOPE_LOCAL_EVIDENCE = "SCOPE_LOCAL_EVIDENCE";
    public static final String UNKNOWN = "UNKNOWN";

    public static BattleEndResult resolve(final Battle battle, final Float eventBasedEndSec, final Float scopeLocalEndSec) {
        if (battle != null && battle.durationS != null && Double.isFinite(battle.durationS) && battle.durationS > 0.0) {
            return new BattleEndResult(battle.durationS.floatValue(), BATTLE_RESULTS, null);
        }
        if (eventBasedEndSec != null && Float.isFinite(eventBasedEndSec) && eventBasedEndSec >= 0f) {
            return new BattleEndResult(eventBasedEndSec, REPLAY_EVENT, null);
        }
        if (scopeLocalEndSec != null && Float.isFinite(scopeLocalEndSec) && scopeLocalEndSec >= 0f) {
            return new BattleEndResult(scopeLocalEndSec, SCOPE_LOCAL_EVIDENCE, null);
        }
        return new BattleEndResult(null, UNKNOWN, "BATTLE_END_UNRESOLVED");
    }
}
