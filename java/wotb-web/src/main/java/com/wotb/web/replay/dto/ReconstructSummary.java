package com.wotb.web.replay.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;

/**
 * 重建结果摘要（默认响应，不直接返回数万个位置事件）。
 */
public record ReconstructSummary(
        @JsonProperty("replayDurationSec") float replayDurationSec,
        @JsonProperty("battleStartRawClockSec") Float battleStartRawClockSec,
        @JsonProperty("packetCount") int packetCount,
        @JsonProperty("decodedPacketCount") int decodedPacketCount,
        @JsonProperty("participantCount") int participantCount,
        @JsonProperty("entityCount") int entityCount,
        @JsonProperty("eventCount") int eventCount,
        @JsonProperty("checkpointCount") int checkpointCount,
        @JsonProperty("finalState") BattleStateSnapshot finalState,
        @JsonProperty("coverage") ReplayCoverage coverage,
        @JsonProperty("diagnostics") ReplayStreamDiagnostics diagnostics
) {
}
