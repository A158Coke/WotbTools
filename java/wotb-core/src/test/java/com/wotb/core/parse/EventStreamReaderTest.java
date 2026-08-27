package com.wotb.core.parse;


import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EventStreamReaderTest {

    @Test
    void extractsKillVictimsFromDirectDamageThreshold() {
        final Map<Integer, Long> entityToAccount = Map.of(10, 1L, 20, 2L, 30, 3L);
        final List<EventStreamReader.ParsedPacket> packets = List.of(
                directDamagePacket(1.0f, 10, 20, 300),
                directDamagePacket(2.0f, 30, 20, 100),
                directDamagePacket(3.0f, 10, 20, 200));

        final List<EventStreamReader.DirectDamageEvent> damageEvents =
                EventStreamReader.extractDirectDamageEvents(packets, entityToAccount);
        assertEquals(3, damageEvents.size());
        assertEquals(1L, damageEvents.get(0).attackerAccountId());
        assertEquals(2L, damageEvents.get(0).victimAccountId());
        assertEquals(300, damageEvents.get(0).damage());

        final Map<Long, Double> deathTimes = EventStreamReader.estimateDeathTimesByDamage(
                packets, entityToAccount, Map.of(2L, 600), 420.0);
        assertEquals(3.0, deathTimes.get(2L));

        final Map<Long, List<EventStreamReader.KillVictimDamage>> victims =
                EventStreamReader.extractKillVictims(packets, entityToAccount, Map.of(2L, 600));
        final List<EventStreamReader.KillVictimDamage> kills = victims.get(1L);
        assertNotNull(kills);
        assertEquals(1, kills.size());
        final EventStreamReader.KillVictimDamage kill = kills.get(0);
        assertEquals(2L, kill.victimAccountId());
        assertEquals(500, kill.damage());
        assertEquals(2, kill.penetrations());

    }

    @Test
    void rejectsTooManyPackets() {
        final byte[] header = eventStreamHeader();
        final byte[] data = new byte[header.length + (EventStreamReader.MAX_PACKETS + 1) * 13];
        System.arraycopy(header, 0, data, 0, header.length);
        int offset = header.length;
        for (int index = 0; index <= EventStreamReader.MAX_PACKETS; index++) {
            writeI32LE(data, offset, 1);
            writeI32LE(data, offset + 4, 4);
            writeI32LE(data, offset + 8, Float.floatToIntBits(1.0f));
            offset += 13;
        }

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> EventStreamReader.read(data));

        assertEquals("Event stream packet limit exceeded", error.getMessage());
    }

    @Test
    void acceptsZeroLengthPayload() {
        // PR147：payloadLen == 0 合法（Type 17）
        final byte[] header = eventStreamHeader();
        final byte[] data = concat(header, packetBytes(0, 17, 5.0f));
        final EventStreamReader.EventStream stream = EventStreamReader.read(data);
        assertEquals(1, stream.packets.size());
        assertEquals(17, stream.packets.get(0).type);
        assertEquals(0, stream.packets.get(0).payload.length);
    }

    @Test
    void stopsAtTerminator() {
        final byte[] header = eventStreamHeader();
        final byte[] data = concat(header,
                packetBytes(4, 4, 5.0f),
                packetBytes(16, 0xFFFFFFFF, 0.0f));
        final EventStreamReader.EventStream stream = EventStreamReader.read(data);
        assertEquals(2, stream.packets.size());
        assertEquals(0xFFFFFFFF, stream.packets.get(1).type);
        assertEquals(16, stream.packets.get(1).payload.length);
    }

    @Test
    void rejectsTrailingDataAfterTerminator() {
        final byte[] header = eventStreamHeader();
        final byte[] data = concat(header,
                packetBytes(16, 0xFFFFFFFF, 0.0f),
                new byte[]{1, 2, 3, 4});
        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> EventStreamReader.read(data));
        assertTrue(error.getMessage().contains("Trailing data"));
    }

    @Test
    void rejectsTruncatedPacket() {
        final byte[] header = eventStreamHeader();
        final byte[] full = packetBytes(10, 4, 5.0f);
        final byte[] truncated = new byte[full.length - 5];
        System.arraycopy(full, 0, truncated, 0, truncated.length);
        final byte[] data = concat(header, truncated);

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> EventStreamReader.read(data));
        assertTrue(error.getMessage().contains("extends beyond stream end"));
    }

    @Test
    void rejectsOversizedPayload() {
        final byte[] header = eventStreamHeader();
        final byte[] data = concat(header, packetBytes(200_001, 4, 5.0f));
        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> EventStreamReader.read(data));
        assertTrue(error.getMessage().contains("Invalid payloadLen"));
    }

    private static EventStreamReader.ParsedPacket directDamagePacket(
            final float clockSecs,
            final int attackerEid,
            final int victimEid,
            final int damage) {
        final byte[] payload = new byte[33];
        writeI32LE(payload, 4, 8);
        writeI32LE(payload, 8, 21);
        writeI32LE(payload, 12, attackerEid);
        writeI32LE(payload, 16, victimEid);
        payload[21] = 3;
        payload[22] = (byte) ((damage >>> 8) & 0xFF);
        payload[23] = (byte) (damage & 0xFF);
        return new EventStreamReader.ParsedPacket(8, clockSecs, payload);
    }

    private static void writeI32LE(final byte[] data, final int offset, final int value) {
        data[offset] = (byte) (value & 0xFF);
        data[offset + 1] = (byte) ((value >>> 8) & 0xFF);
        data[offset + 2] = (byte) ((value >>> 16) & 0xFF);
        data[offset + 3] = (byte) ((value >>> 24) & 0xFF);
    }

    private static byte[] packetBytes(int payloadLen, int type, float clockSec) {
        final byte[] pkt = new byte[12 + payloadLen];
        writeI32LE(pkt, 0, payloadLen);
        writeI32LE(pkt, 4, type);
        writeI32LE(pkt, 8, Float.floatToIntBits(clockSec));
        return pkt;
    }

    private static byte[] concat(byte[]... arrays) {
        int total = 0;
        for (final byte[] a : arrays) total += a.length;
        final byte[] result = new byte[total];
        int off = 0;
        for (final byte[] a : arrays) {
            System.arraycopy(a, 0, result, off, a.length);
            off += a.length;
        }
        return result;
    }

    private static byte[] eventStreamHeader() {
        final byte[] header = new byte[15];
        writeI32LE(header, 0, 0x12345678);
        return header;
    }
}
