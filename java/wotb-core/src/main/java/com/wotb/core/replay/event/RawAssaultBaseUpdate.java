package com.wotb.core.replay.event;

/**
 * Wire-level Assault single-base update from subtype48 wrapper8/root field8.
 *
 * <p>Only field3 on the raw-field1=2 / raw-field2=1 family has closed semantics in the current
 * controlled 11.20 China sample: realtime capture progress in the inclusive
 * range 0..100. All fields are retained raw until independent controls
 * close their exact meanings.</p>
 */
public record RawAssaultBaseUpdate(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        Integer rawField1,
        Integer rawField2,
        Integer rawField3,
        Integer rawField4
) implements ReplayEvent {
}
