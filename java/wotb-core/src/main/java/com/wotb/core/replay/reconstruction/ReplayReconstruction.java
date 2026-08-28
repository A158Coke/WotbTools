package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import com.wotb.core.replay.stream.ReplayStreamHeader;

import java.util.List;

/**
 * 回放重建的完整输出结果。
 *
 * <p>PR147 时钟域拆分：{@code battleDurationSec} 是<b>战斗时长</b>（battle-relative 跨度，来自
 * settlement root5 或 {@code lastClock - battleStartRawClockSec}），<b>不是</b> 原始 session 时钟。
 * 原始流最后一个事件包的时钟在 {@link #streamLastRawClockSec()}（即 {@code diagnostics().lastClockSec()}）。
 * 需要 battle-relative 真相的 consumer 必须消费 {@code battleDurationSec} + {@code battleStartRawClockSec}
 * （start 未解析时 fail-closed），绝不能把 {@code streamLastRawClockSec()} 当战斗时长。</p>
 *
 * @param metadata            回放元数据（来自 meta.json 和 battle_results.dat）
 * @param streamHeader        data.wotreplay 头部
 * @param battleDurationSec   战斗时长（battle-relative 跨度；非 raw session 时钟）
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
        float battleDurationSec,
        Float battleStartRawClockSec,
        List<BattleParticipant> participants,
        List<ReplayEvent> events,
        List<BattleStateCheckpoint> checkpoints,
        BattleStateSnapshot finalState,
        ReplayCoverage coverage,
        ReplayStreamDiagnostics diagnostics
) {
    /** 原始流最后一个合法事件包的实际时钟（raw session clock；非战斗时长）。 */
    public float streamLastRawClockSec() {
        return diagnostics == null ? Float.NaN : diagnostics.lastClockSec();
    }
}
