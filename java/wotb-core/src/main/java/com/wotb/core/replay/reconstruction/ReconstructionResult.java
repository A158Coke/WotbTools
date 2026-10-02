package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.ReplayEvent;

import java.util.List;
import java.util.Objects;

/**
 * 重建结果。所有字段非 null，列表不可变。
 */
public record ReconstructionResult(
        BattleState finalState,
        BattleStateSnapshot finalSnapshot,
        List<ReplayEvent> processedEvents,
        List<BattleStateCheckpoint> checkpoints
) {
    public ReconstructionResult {
        Objects.requireNonNull(finalState, "finalState");
        Objects.requireNonNull(finalSnapshot, "finalSnapshot");
        processedEvents = List.copyOf(Objects.requireNonNull(processedEvents, "processedEvents"));
        checkpoints = List.copyOf(Objects.requireNonNull(checkpoints, "checkpoints"));
    }
}
