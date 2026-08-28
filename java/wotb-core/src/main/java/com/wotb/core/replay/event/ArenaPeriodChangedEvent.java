package com.wotb.core.replay.event;

/**
 * 竞技场 phase/period 变化事件（subtype48 wrapper=3 ARENA_PERIOD）。
 *
 * <p>PR147（entity-methods.md / death-and-battle-clock.md）：wrapper3 root field3 = arena period：
 * 0 IDLE / 1 WAITING / 2 PREBATTLE / 3 BATTLE / 4 AFTERBATTLE。其中 {@code period == BATTLE} 是
 * client-observed <b>battle-start anchor</b>（battle-relative 时间的权威起点）；{@code AFTERBATTLE}
 * 与 Avatar method4 {@code RoundFinishedEvent} 同一 rawClock。</p>
 *
 * <p>只保留 raw period + safe semantic；未证明的 period 值 → {@link Period#UNKNOWN}（raw 保留）。</p>
 */
public record ArenaPeriodChangedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int periodRaw,
        Period period
) implements ReplayEvent {

    /** Wargaming arena-period lifecycle（AFFIRMED：0 IDLE / 1 WAITING / 2 PREBATTLE / 3 BATTLE / 4 AFTERBATTLE）。 */
    public enum Period {
        IDLE,
        WAITING,
        PREBATTLE,
        BATTLE,
        AFTERBATTLE,
        UNKNOWN
    }

    /** periodRaw → safe semantic；未证明值 → UNKNOWN（不按序号臆测命名）。 */
    public static Period periodOf(final int raw) {
        return switch (raw) {
            case 0 -> Period.IDLE;
            case 1 -> Period.WAITING;
            case 2 -> Period.PREBATTLE;
            case 3 -> Period.BATTLE;
            case 4 -> Period.AFTERBATTLE;
            default -> Period.UNKNOWN;
        };
    }
}
