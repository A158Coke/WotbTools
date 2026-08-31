package com.wotb.core.replay.event;

import java.util.Arrays;
import java.util.List;

/**
 * 一次 combat-vehicle {@code Type5} materialization 携带的 battle loadout
 * （PR147 current corpus / loadout-materialization.md）。
 *
 * <p>这是 canonical battle-loadout 表面：{@code 3 consumables + 3 provisions + 9 equipment}。
 * 字节结构（位于 Type5 class-specific init payload 内，offset 可变，必须扫描）：</p>
 *
 * <pre>
 * 0A 06
 *   6 × 14-byte item descriptor   (itemWireCode u8 + state u8 + 12-byte payload)
 * 0B 09
 *   9 raw equipment-ID bytes
 * </pre>
 *
 * <p>item[0..2] = consumable slots；item[3..5] = provision slots。
 * {@code equipmentId = unsignedByte(rawEquipmentBytes[slot])}（byte=ID 编码，PROVEN）。</p>
 *
 * <p><b>结构边界</b>：仅 {@code entityTypeId == combat vehicle} +
 * {@code full combat loadout framing validates} 时 decode semantic loadout。unknown provision
 * wire code / 未装填 slot 保持 {@code logicalItemId = null} + raw 保留，绝不按国家/坦克/数值猜名。</p>
 *
 * @param entityId      车辆 entity id
 * @param replayVersion 兼容元数据字段（不参与语义门禁）
 * @param consumables   三个 consumable slot（{@link LoadoutItemSlot}，位置序）
 * @param provisions    三个 provision slot（{@link LoadoutItemSlot}，位置序）
 * @param equipment     九个 equipment selection（{@link EquipmentSelection}，位置序）
 * @param confidence    loadout 解码置信度（EXACT=完整 framing + 全描述符可读；PARTIAL=仅 framing 可读但有个别未知符号）
 */
public record VehicleBattleLoadout(
        int entityId,
        String replayVersion,
        List<LoadoutItemSlot> consumables,
        List<LoadoutItemSlot> provisions,
        List<EquipmentSelection> equipment,
        DecodeConfidence confidence
) {

    public VehicleBattleLoadout {
        consumables = consumables == null ? List.of() : List.copyOf(consumables);
        provisions = provisions == null ? List.of() : List.copyOf(provisions);
        equipment = equipment == null ? List.of() : List.copyOf(equipment);
    }

    /** 一个 consumable/provision item slot（wire 原值 + raw 保留）。 */
    public record LoadoutItemSlot(
            int slot,
            int wireCode,
            int stateRaw,
            byte[] payloadRaw,
            String logicalItemId,
            DecodeConfidence confidence
    ) {
        public LoadoutItemSlot {
            payloadRaw = payloadRaw == null ? new byte[0] : Arrays.copyOf(payloadRaw, payloadRaw.length);
        }

        @Override
        public byte[] payloadRaw() {
            return Arrays.copyOf(payloadRaw, payloadRaw.length);
        }
    }

    /** 一个 equipment selection slot（直接 equipment numeric ID）。 */
    public record EquipmentSelection(int slot, int equipmentId, byte rawByte) {
    }

    /**
     * 从 Type5 class-specific init payload 扫描并解析 combat loadout。
     *
     * @return 解析成功返回 {@link VehicleBattleLoadout}；framing 不完整 / 非完整 0A06 family 返回 null（raw-preserve）。
     */
    public static VehicleBattleLoadout parse(
            final int entityId,
            final String replayVersion,
            final byte[] initPayloadRaw) {
        if (initPayloadRaw == null || initPayloadRaw.length == 0) {
            return null;
        }
        final int marker0A = indexOf(initPayloadRaw, MARKER_0A_06);
        if (marker0A < 0) {
            return null;
        }
        final int descriptorsStart = marker0A + 2; // 0A 06
        if (descriptorsStart + ITEM_COUNT * ITEM_BYTES > initPayloadRaw.length) {
            return null;
        }
        // 6 × 14-byte descriptors 之后必须是 0B 09
        final int equipMarker = descriptorsStart + ITEM_COUNT * ITEM_BYTES;
        if (equipMarker + 2 + EQUIPMENT_COUNT > initPayloadRaw.length) {
            return null;
        }
        if ((initPayloadRaw[equipMarker] & 0xFF) != 0x0B
                || (initPayloadRaw[equipMarker + 1] & 0xFF) != 0x09) {
            return null;
        }
        final int equipStart = equipMarker + 2;
        final java.util.List<LoadoutItemSlot> items = new java.util.ArrayList<>(ITEM_COUNT);
        boolean anyUnknownSymbol = false;
        for (int i = 0; i < ITEM_COUNT; i++) {
            final int base = descriptorsStart + i * ITEM_BYTES;
            final int wireCode = initPayloadRaw[base] & 0xFF;
            final int stateRaw = initPayloadRaw[base + 1] & 0xFF;
            final byte[] payload = Arrays.copyOfRange(initPayloadRaw, base + 2, base + 2 + ITEM_PAYLOAD_BYTES);
            final boolean consumableSlot = i < CONSUMABLE_COUNT;
            final String logicalItemId = resolveLogicalItemId(wireCode, consumableSlot);
            if (logicalItemId == null && wireCode != 0) {
                anyUnknownSymbol = true;
            }
            items.add(new LoadoutItemSlot(i, wireCode, stateRaw, payload, logicalItemId,
                    logicalItemId == null ? DecodeConfidence.PARTIAL : DecodeConfidence.EXACT));
        }
        final java.util.List<EquipmentSelection> equipment = new java.util.ArrayList<>(EQUIPMENT_COUNT);
        for (int i = 0; i < EQUIPMENT_COUNT; i++) {
            final int raw = initPayloadRaw[equipStart + i] & 0xFF;
            equipment.add(new EquipmentSelection(i, raw, (byte) raw));
        }
        final DecodeConfidence confidence = anyUnknownSymbol ? DecodeConfidence.PARTIAL : DecodeConfidence.EXACT;
        return new VehicleBattleLoadout(entityId, replayVersion,
                items.subList(0, CONSUMABLE_COUNT),
                items.subList(CONSUMABLE_COUNT, ITEM_COUNT),
                equipment, confidence);
    }

    private static final byte[] MARKER_0A_06 = new byte[]{(byte) 0x0A, 0x06};
    private static final int ITEM_COUNT = 6;
    private static final int CONSUMABLE_COUNT = 3;
    private static final int ITEM_BYTES = 14;
    private static final int ITEM_PAYLOAD_BYTES = 12;
    private static final int EQUIPMENT_COUNT = 9;

    /**
     * consumable wire code → logicalItemId（PR147 current corpus 已闭合，consumable-lifecycle.md）。
     * provision 仅映射 PROVEN 项；其余返回 null（wire/raw 保留，不猜名）。
     */
    private static String resolveLogicalItemId(final int wireCode, final boolean consumableSlot) {
        if (consumableSlot) {
            return switch (wireCode) {
                case 0x09 -> "ADRENALINE";
                case 0x0A -> "ENGINE_POWER_BOOST";
                case 0x0B -> "MULTI_PURPOSE_RESTORATION_PACK";
                case 0x0C -> "FIRST_AID_KIT";
                case 0x0D -> "REPAIR_KIT";
                case 0x3D -> "IMPROVED_ENGINE_POWER_BOOST";
                case 0x3E -> "RETICLE_CALIBRATION";
                case 0x42 -> "REACTIVE_ARMOR";
                case 0x69 -> "TUNGSTEN_SHELLS";
                default -> null;
            };
        }
        return switch (wireCode) {
            case 0x44 -> "SANDBAG_ARMOR";
            case 0x45 -> "ENHANCED_SANDBAG_ARMOR";
            case 0x6C -> "IMPROVED_GUNPOWDER";
            default -> null;
        };
    }

    private static int indexOf(final byte[] hay, final byte[] needle) {
        for (int i = 0; i <= hay.length - needle.length; i++) {
            boolean matched = true;
            for (int j = 0; j < needle.length; j++) {
                if (hay[i + j] != needle[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) {
                return i;
            }
        }
        return -1;
    }
}
