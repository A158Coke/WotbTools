package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.ReplayEvent;
import java.util.List;

/**
 * 重建结果。
 */
public record ReconstructionResult(
        BattleState finalState,
        BattleStateSnapshot finalSnapshot,
        List<ReplayEvent> processedEvents,
        List<BattleStateCheckpoint> checkpoints
) {
}
