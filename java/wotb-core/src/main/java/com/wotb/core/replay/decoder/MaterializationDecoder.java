package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.VehicleBattleLoadout;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/**
 * Type 5（EntityMaterialize / materialization）解码器。
 *
 * <p>当前 corpus 中的结构证据（docs/research/replay/entity-materialization.md、
 * actual-hp-type5-settlement.md）：
 * payload = {@code entityId(u32 LE) + entityTypeId(u16 LE) + transform/state bootstrap
 * + class-specific init}。</p>
 *
 * <p>Type5 以 entityId/entityTypeId envelope 和已有 payload shape 解码；未知 numeric
 * values 保留原始值，不臆测其类别。</p>
 *
 * <p><b>置信度</b>：{@code MaterializationEvent.confidence} 只表示「物化 presence 已证明」
 * （结构解码成功即 EXACT）；HP 是独立维度（{@code currentHp} 可 null），HP sentinel/unknown
 * 不降级 presence 置信度。</p>
 *
 * <p><b>HP 快照（类作用域）</b>：仅当 {@code entityTypeId == 2}（combat vehicle）
 * 且 payload 足够长时，{@code payload[51..53)} 按 u16 LE 解为当前 HP；特殊值保持未知。</p>
 *
 * <p><b>transform 前缀</b>：{@code payload[6..14)} == 随后首个 Type10 {@code [4..12)}
 * （1,096/1,096 精确匹配）——按 raw 保留，不由本 decoder 臆测坐标语义。</p>
 */
public class MaterializationDecoder implements ReplayPacketDecoder {

    static final int TYPE_MATERIALIZE = 5;

    /** combat vehicle entityTypeId（class-scoped wire evidence）。 */
    static final int ENTITY_TYPE_COMBAT_VEHICLE = 2;

    /** static family entityTypeId（class-scoped wire evidence）。 */
    static final int ENTITY_TYPE_STATIC_FAMILY = 3;

    /** 已证明的 HP 字段偏移（u16 LE），仅 entityTypeId=2 的类作用域 payload 有效。 */
    static final int HP_OFFSET = 51;

    /** transform/state bootstrap 前缀（payload[6..14) == Type10[4..12)，PROVEN）。 */
    static final int TRANSFORM_PREFIX_OFFSET = 6;

    @Override
    public boolean supports(ReplayDecodeContext context, RawReplayPacket packet) {
        return packet.type() == TYPE_MATERIALIZE;
    }

    /**
     * PR162/P1-1：Type5 结构 envelope 的<b>唯一</b> wire 解析点（{@code entityId(u32 LE) + entityTypeId(u16 LE)}）。
     * semantic decoder 与 {@code ReplayReconstructionService} 的 class prepass 都消费本方法，避免第二套 Type5
     * mini-parser。只解析 envelope；具体 numeric class meaning 由实体生命周期证据约束。
     */
    public static MaterializationEnvelope materializationEnvelope(final byte[] payload) {
        if (payload == null || payload.length < 6) {
            return null;
        }
        return new MaterializationEnvelope(readU32LE(payload, 0), readU16LE(payload, 4));
    }

    /** Type5 结构 envelope（entityId + raw entityTypeId）。 */
    public record MaterializationEnvelope(int entityId, int entityTypeId) {
    }

    @Override
    public ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        if (payload.length < 6) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED, List.of(),
                    List.of(new ReplayDecodeWarning("TRUNCATED_PAYLOAD",
                            "Type5 packet too short: " + payload.length)));
        }
        final MaterializationEnvelope envelope = materializationEnvelope(payload);
        final int entityId = envelope.entityId();
        final int entityTypeId = envelope.entityTypeId();
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);

        // PR162 entity-class registry：只从真实生命周期证据（entityTypeId）建立 class，不靠 method-shape 反推。
        final EntityClassRegistry classRegistry = context.entityClassRegistry();
        if (entityTypeId == ENTITY_TYPE_COMBAT_VEHICLE) {
            classRegistry.markVehicle(entityId);
        } else if (entityTypeId == ENTITY_TYPE_STATIC_FAMILY) {
            classRegistry.markOther(entityId);
        }

        Integer currentHp = null;
        final List<ReplayDecodeWarning> warnings = new java.util.ArrayList<>();
        if (entityTypeId == ENTITY_TYPE_COMBAT_VEHICLE) {
            if (payload.length < HP_OFFSET + 2) {
                warnings.add(new ReplayDecodeWarning("MATERIALIZATION_HP_TRUNCATED",
                        "Type5 vehicle payload shorter than HP offset " + HP_OFFSET
                                + ": " + payload.length));
            } else {
                final int raw = readU16LE(payload, HP_OFFSET);
                if (raw > 0 && raw < 0xFF00) {
                    currentHp = raw;
                } else {
                    // 0 / sentinel 高位值：不臆测语义（与 prop3 归一化口径一致），raw 保留
                    warnings.add(new ReplayDecodeWarning("MATERIALIZATION_HP_SENTINEL",
                            "Type5 hpRaw=0x" + Integer.toHexString(raw)
                                    + " treated as UNKNOWN at entity " + entityId));
                }
            }
        }

        final byte[] transformRaw = new byte[Math.max(0,
                Math.min(payload.length, TRANSFORM_PREFIX_OFFSET + 8) - TRANSFORM_PREFIX_OFFSET)];
        if (payload.length >= TRANSFORM_PREFIX_OFFSET + 8) {
            System.arraycopy(payload, TRANSFORM_PREFIX_OFFSET, transformRaw, 0, 8);
        }
        final byte[] initRaw = new byte[Math.max(0, payload.length - (TRANSFORM_PREFIX_OFFSET + 8))];
        if (initRaw.length > 0) {
            System.arraycopy(payload, TRANSFORM_PREFIX_OFFSET + 8, initRaw, 0, initRaw.length);
        }

        // two independent evidence dimensions. The Type5 structure proves the entity
        // materialized (presence = EXACT); HP decode is a separate field (currentHp nullable). HP
        // being unknown/sentinel must NOT downgrade the materialization presence confidence, else
        // ReplayAoiLifecycle would drop the observed segment for a proven presence.
        final DecodeConfidence confidence = DecodeConfidence.EXACT;
        // PR147/WotbTools loadout productionization (plan P0-1):
        // combat-vehicle Type5 class-specific init payload carries a battle loadout surface.
        // Decode only when: combat vehicle + full 0A06/0B09 framing validates. Any malformed/partial
        // framing stays raw-preserved (loadout=null) and never
        // falls back to guessing names. Unknown provision codes keep logicalItemId=null + raw.
        final VehicleBattleLoadout loadout =
                entityTypeId == ENTITY_TYPE_COMBAT_VEHICLE
                        ? VehicleBattleLoadout.parse(entityId, context.replayVersion(), initRaw)
                        : null;
        final MaterializationEvent event = new MaterializationEvent(
                packet.sequence(), ts, packet.type(), confidence,
                entityId, entityTypeId, currentHp, transformRaw, initRaw, loadout);
        if (warnings.isEmpty()) {
            return ReplayDecodeResult.of(event);
        }
        return new ReplayDecodeResult(DecodeStatus.PARTIAL, List.of(event), warnings);
    }

    static int readU32LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | ((buf[i + 3] & 0xFF) << 24);
    }

    static int readU16LE(byte[] buf, int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8);
    }
}
