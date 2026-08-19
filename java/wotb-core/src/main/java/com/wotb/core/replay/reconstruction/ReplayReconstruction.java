package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import com.wotb.core.replay.stream.ReplayStreamHeader;

import java.util.List;

/**
 * 回放重建的完整输出结果。
 *
 * @param metadata            回放元数据（来自 meta.json 和 battle_results.dat）
 * @param streamHeader        data.wotreplay 头部
 * @param replayDurationSec   最后一个合法事件包的实际时钟（不是截断后的 meta.json#battleDuration）
 * @param battleStartRawClockSec 战斗开始时刻的原始时钟（可以识别时不为 null）
 * @param participants        战斗参与者列表
 * @param events              全部领域事件列表
 * @param checkpoints         战场状态检查点列表
 * @param finalState          最终战场状态快照
 * @param coverage            解析覆盖率
 * @param diagnostics         数据流诊断信息
 */
public record ReplayReconstruction(
        ReplayMetadata metadata,
        ReplayStreamHeader streamHeader,
        float replayDurationSec,
        Float battleStartRawClockSec,
        List<BattleParticipant> participants,
        List<ReplayEvent> events,
        List<BattleStateCheckpoint> checkpoints,
        BattleStateSnapshot finalState,
        ReplayCoverage coverage,
        ReplayStreamDiagnostics diagnostics
) {
}
