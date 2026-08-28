package com.wotb.core.replay.event;

/**
 * 战斗结束 / round finished 事件（Avatar method4，2-byte args：{@code winnerTeam(u8) + finishReason(u8)}）。
 *
 * <p>PR147（avatar-method4-round-finished.md）：method4.rawClock == subtype48 wrapper3
 * ARENA_PERIOD.AFTERBATTLE rawClock（30/30）。finishReason 1=elimination（losing team destroyed）、
 * 6=supremacy-1000 cap；未证明值 → {@link FinishCause#UNKNOWN}（raw 保留）。</p>
 *
 * <p>此事件是 <b>round-finished</b> 的 canonical 消费者来源；Type14 只表达 stream-close，不得当作
 * battle-end / winner / finish-reason 来源（见 {@code ReplayStreamClosedEvent}）。</p>
 */
public record RoundFinishedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int winnerTeam,
        int finishReasonRaw,
        FinishCause finishCause
) implements ReplayEvent {

    /** finishReason 安全语义（PR147 current corpus：1=ELIMINATION / 6=SUPREMACY_1000；其它 UNKNOWN）。 */
    public enum FinishCause {
        ELIMINATION,
        SUPREMACY_1000,
        UNKNOWN
    }

    /** 便捷工厂（合成/测试场景）：默认 finishReason=1（ELIMINATION）。生产必须用主构造器携带原始 finishReason。 */
    public static RoundFinishedEvent of(
            final int sequence,
            final ReplayTimestamp timestamp,
            final int packetType,
            final DecodeConfidence confidence,
            final int winnerTeam) {
        return new RoundFinishedEvent(sequence, timestamp, packetType, confidence,
                winnerTeam, 1, FinishCause.ELIMINATION);
    }

    /** finishReasonRaw → safe semantic；未证明值 → UNKNOWN（不按序号臆测命名）。 */
    public static FinishCause causeOf(final int raw) {
        return switch (raw) {
            case 1 -> FinishCause.ELIMINATION;
            case 6 -> FinishCause.SUPREMACY_1000;
            default -> FinishCause.UNKNOWN;
        };
    }
}
