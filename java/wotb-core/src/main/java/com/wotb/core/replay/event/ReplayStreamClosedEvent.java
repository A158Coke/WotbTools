package com.wotb.core.replay.event;

/**
 * 回放数据流关闭事件（Packet Type 14）。PR147：Type14 = packet-stream end / stop marker —— 只表达
 * stream closed，绝不表示 battle finished / winner / finishReason / battle start，也不作为 battle-start
 * clock 锚点。战斗结束 / 胜方 / finishReason 来自 RoundFinishedEvent（Avatar method4 /
 * wrapper3 AFTERBATTLE）与 settlement root3/4。payload 未证明，raw 保留。
 */
public record ReplayStreamClosedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence
) implements ReplayEvent {
}