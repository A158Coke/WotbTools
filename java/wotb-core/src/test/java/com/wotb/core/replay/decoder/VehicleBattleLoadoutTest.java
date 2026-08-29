package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.VehicleBattleLoadout;
import org.junit.jupiter.api.Test;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Type5 combat-loadout parser（P0-1）。byte=ID 编码 / 3+3 描述符 / version-门禁 framing 校验。 */
class VehicleBattleLoadoutTest {

    /** 构造一个带 prefix（模拟 variable offset）+ 完整 0A06/0B09 combat loadout 的 init payload。 */
    private static byte[] initPayload(final byte[] prefix,
                                      final int[] itemWireCodes,
                                      final boolean provisionTail,
                                      final byte[] equipmentBytes) {
        final int descriptorCount = itemWireCodes.length;
        final int equipLen = equipmentBytes.length;
        final byte[] payload = new byte[prefix.length + 2 + descriptorCount * 14 + 2 + equipLen];
        int p = 0;
        System.arraycopy(prefix, 0, payload, 0, prefix.length);
        p = prefix.length;
        payload[p++] = (byte) 0x0A;
        payload[p++] = (byte) descriptorCount;
        for (int w : itemWireCodes) {
            payload[p++] = (byte) w;
            payload[p++] = 0x01; // state
            for (int k = 0; k < 12; k++) {
                payload[p++] = 0;
            }
            if (provisionTail) {
                // provision descriptors end with f32 -1.0 in the last 4 bytes (80 BF)
                final int tail = p - 4;
                payload[tail] = (byte) 0x00;
                payload[tail + 1] = (byte) 0x00;
                payload[tail + 2] = (byte) 0x80;
                payload[tail + 3] = (byte) 0xBF;
            }
        }
        payload[p++] = (byte) 0x0B;
        payload[p++] = (byte) equipLen;
        System.arraycopy(equipmentBytes, 0, payload, p, equipLen);
        return payload;
    }

    private static byte[] prefix(final int len) {
        final byte[] b = new byte[len];
        for (int i = 0; i < len; i++) {
            b[i] = (byte) (0x40 + i);
        }
        return b;
    }

    @Test
    void parsesFullCombatLoadoutWithVariableOffsetPrefix() {
        // consumable slots: Adrenaline(09), Engine Power Boost(0A), Repair Kit(0D)
        // provision slots:  0x44(Sandbag Armor PROVEN), 0x45(Enhanced Sandbag PROVEN), 0x6C(Improved Gunpowder PROVEN)
        final int[] wires = {0x09, 0x0A, 0x0D, 0x44, 0x45, 0x6C};
        // equipment bytes: 64 6C 72 68 6F 75 6A 70 76 = ids 100,108,114,104,111,117,106,112,118
        final byte[] equip = new byte[]{
                (byte) 100, (byte) 108, (byte) 114, (byte) 104,
                (byte) 111, (byte) 117, (byte) 106, (byte) 112, (byte) 118};
        final byte[] init = initPayload(prefix(37), wires, true, equip);

        final VehicleBattleLoadout l = VehicleBattleLoadout.parse(1234, "11.19.0_china", init);
        assertNotNull(l);
        assertEquals(1234, l.entityId());
        assertEquals(3, l.consumables().size());
        assertEquals(3, l.provisions().size());
        assertEquals(9, l.equipment().size());
        assertEquals("ADRENALINE", l.consumables().get(0).logicalItemId());
        assertEquals("ENGINE_POWER_BOOST", l.consumables().get(1).logicalItemId());
        assertEquals("REPAIR_KIT", l.consumables().get(2).logicalItemId());
        assertEquals("SANDBAG_ARMOR", l.provisions().get(0).logicalItemId());
        assertEquals("ENHANCED_SANDBAG_ARMOR", l.provisions().get(1).logicalItemId());
        assertEquals("IMPROVED_GUNPOWDER", l.provisions().get(2).logicalItemId());
        // equipment byte=ID
        for (int i = 0; i < 9; i++) {
            assertEquals(equip[i] & 0xFF, l.equipment().get(i).equipmentId(),
                    "equipment slot " + i + " must decode by unsigned byte=ID");
        }
        assertEquals(DecodeConfidence.EXACT, l.confidence());
    }

    @Test
    void unknownProvisionKeepsNullableLogicalIdAndRawPreserve() {
        final int[] wires = {0x09, 0x0A, 0x0D, 0x10, 0x11, 0x12}; // 0x10/0x11/0x12 PARTIAL provision
        final byte[] equip = new byte[]{103, 109, 114, 104, 111, 117, 106, 113, 101};
        final VehicleBattleLoadout l = VehicleBattleLoadout.parse(7, "11.19.0_china",
                initPayload(prefix(5), wires, true, equip));
        assertNotNull(l);
        assertNull(l.provisions().get(0).logicalItemId(), "unknown provision must not be guessed");
        assertEquals(0x10, l.provisions().get(0).wireCode(), "raw wireCode preserved");
        assertEquals(DecodeConfidence.PARTIAL, l.confidence());
    }

    @Test
    void nonNineEquipmentFamilyFailsClosed() {
        // 0B 04 (4 equipment bytes) => non-combat/observer family => raw-preserve (null)
        final byte[] equip = new byte[]{103, 109, 114, 104};
        final VehicleBattleLoadout l = VehicleBattleLoadout.parse(9, "11.19.0_china",
                initPayload(prefix(8), new int[]{0x09, 0x0A, 0x0D, 0x44, 0x45, 0x6C}, true, equip));
        assertNull(l, "non-9 family must fail closed, never coerce to 3+3+9 player loadout");
    }

    @Test
    void truncatedOrMissingMarkerReturnsNull() {
        assertNull(VehicleBattleLoadout.parse(1, "11.19.0_china", new byte[]{0x01, 0x02, 0x03}));
        assertNull(VehicleBattleLoadout.parse(1, "11.19.0_china", new byte[0]));
        assertNull(VehicleBattleLoadout.parse(1, "11.19.0_china", null));
    }

    @Test
    void markerAtNonZeroOffsetIsScannedNotFoundFromZero() {
        // ensure parser scans, not assumes offset 0
        final int[] wires = {0x09, 0x0A, 0x0D, 0x44, 0x45, 0x6C};
        final byte[] equip = new byte[]{100, 108, 114, 104, 111, 117, 106, 112, 118};
        final byte[] init = initPayload(prefix(60), wires, true, equip);
        final VehicleBattleLoadout l = VehicleBattleLoadout.parse(5, "11.19.0_china", init);
        assertNotNull(l);
        assertEquals(3, l.consumables().size());
    }
}
