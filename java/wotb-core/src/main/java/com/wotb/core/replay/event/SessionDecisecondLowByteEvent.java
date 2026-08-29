package com.wotb.core.replay.event;

/**
 * Session decisecond counter low-byte event (Packet Type 35).
 *
 * <p><b>PR147 corpus</b>: payload = 1 byte (90,318 records), value is the rolling low 8 bits of the
 * client/session monotonic decisecond counter: <code>next == (current + 1) mod 256</code>
 * (90,284/90,284; counterexamples = 0) and <code>Type35.value == Type36.sessionClockDeciseconds &amp; 0xFF</code>.
 * Closed as the low 8 bits of the session monotonic decisecond counter.</p>
 *
 * <p><b>Do not over-interpret</b>: this is NOT battle time / Unix time, nor position/decisive semantics.
 * It only carries the raw low-bit counter for relative-clock observation / monotonicity checks; no
 * absolute-time interpretation.</p>
 *
 * <p><b>Version gate</b>: only the current canonical 11.19 family may decode this semantic;
 * unknown/future versions raw-preserve (UNKNOWN + diagnostic), never generalized.</p>
 *
 * @param sequence    event sequence number
 * @param timestamp   timestamp (carries packet rawClock)
 * @param packetType  source raw packet type (=35)
 * @param confidence  decode confidence (struct EXACT; version not allowed / layout mismatch = UNKNOWN)
 * @param low8        low 8 bits of the current session decisecond counter (0..255)
 */
public record SessionDecisecondLowByteEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int low8
) implements ReplayEvent {
}
