package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/**
 * Type 5（EntityMaterialize / materialization）解码器。
 *
 * <p>当前 11.19 corpus（docs/research/replay/entity-materialization.md、
 * actual-hp-type5-settlement.md）：
 * payload = {@code entityId(u32 LE) + entityTypeId(u16 LE) + transform/state bootstrap
 * + class-specific init}。</p>
 *
 * <p><b>版本门禁（§P0-2）</b>：仅当前 canonical + 显式证明的 11.18 legacy
 * （{@link ReplayVersionGate#entityLifecycleLayoutAllowed}）允许把 type=5 解为物化；未知/未来版本
 * raw-preserve（UNKNOWN + 诊断），绝不静默进入 canonical AoI。</p>
 *
 * <p><b>置信度（§P0-1）</b>：{@code MaterializationEvent.confidence} 只表示「物化 presence 已证明」
 * （结构解码成功即 EXACT）；HP 是独立维度（{@code currentHp} 可 null），HP sentinel/unknown
 * 不降级 presence 置信度。</p>
 *
 * <p><b>HP 快照（版本/类作用域）</b>：仅当 {@code entityTypeId == 2}（combat vehicle）
 * 且 {@link ReplayVersionGate#closedSemanticsAllowed} 时，{@code payload[51..53)} 才按
 * u16 LE 解为当前 HP（PROVEN current corpus）；其它情况 currentHp=null，raw 保留。</p>
 *
 * <p><b>transform 前缀</b>：{@code payload[6..14)} == 随后首个 Type10 {@code [4..12)}
 * （1,096/1,096 精确匹配）——按 raw 保留，不由本 decoder 臆测坐标语义。</p>
 */
public class MaterializationDecoder implements ReplayPacketDecoder {

    static final int TYPE_MATERIALIZE = 5;

    /** combat vehicle entityTypeId（当前 11.19 corpus，version/class scoped）。 */
    static final int ENTITY_TYPE_COMBAT_VEHICLE = 2;

    /** static family entityTypeId（当前 11.19 corpus，version/class scoped）。 */
    static final int ENTITY_TYPE_STATIC_FAMILY = 3;

    /** 当前 HP 字段偏移（u16 LE），仅 entityTypeId=2 有效（11.19/类作用域）。 */
    static final int HP_OFFSET = 51;

    /** transform/state bootstrap 前缀（payload[6..14) == Type10[4..12)，PROVEN）。 */
    static final int TRANSFORM_PREFIX_OFFSET = 6;

    @Override
    public boolean supports(ReplayDecodeContext context, RawReplayPacket packet) {
        return packet.type() == TYPE_MATERIALIZE;
    }

    @Override
    public ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        if (payload.length < 6) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED, List.of(),
                    List.of(new ReplayDecodeWarning("TRUNCATED_PAYLOAD",
                            "Type5 packet too short: " + payload.length)));
        }
        // §P0-2: Type5 materialization semantics are version-scoped. Unknown/future versions must
        // raw-preserve (UNKNOWN + diagnostic), never unconditionally decode into a semantic event.
        if (!ReplayVersionGate.entityLifecycleLayoutAllowed(context.clientVersion())) {
            final ReplayTimestamp tsUnsupported = new ReplayTimestamp(packet.rawClockSec(), null);
            return new ReplayDecodeResult(DecodeStatus.UNSUPPORTED,
                    List.of(new UnknownReplayEvent(packet.sequence(), tsUnsupported, packet.type(),
                            packet.payloadLength(), "VERSION_UNSUPPORTED_TYPE5",
                            DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("VERSION_UNSUPPORTED",
                            "Type5 materialization layout not affirmed: " + context.clientVersion())));
        }
        final int entityId = readU32LE(payload, 0);
        final int entityTypeId = readU16LE(payload, 4);
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);

        // PR162 entity-class registry：只从真实生命周期证据（entityTypeId）建立 class，不靠 method-shape 反推。
        // P1-5：entityTypeId numeric meaning (2/3) 是 closed/version-scoped —— 仅 capability VERIFIED 才 Assign
        // Vehicle/Other；future 版本保留 Type5 结构 + raw entityTypeId，class 保持 UNKNOWN。
        final EntityClassRegistry classRegistry = context.entityClassRegistry();
        final boolean entityTypeIdSemanticAffirmed = ReplayProtocolProfile.levelOf(context.clientVersion(),
                ReplayProtocolProfile.Capability.ENTITY_TYPE_ID_SEMANTIC)
                == ReplayProtocolProfile.Level.VERIFIED;
        if (entityTypeIdSemanticAffirmed && entityTypeId == ENTITY_TYPE_COMBAT_VEHICLE) {
            classRegistry.markVehicle(entityId);
        } else if (entityTypeIdSemanticAffirmed && entityTypeId == ENTITY_TYPE_STATIC_FAMILY) {
            classRegistry.markOther(entityId);
        }

        Integer currentHp = null;
        final List<ReplayDecodeWarning> warnings = new java.util.ArrayList<>();
        if (entityTypeId == ENTITY_TYPE_COMBAT_VEHICLE
                && ReplayVersionGate.closedSemanticsAllowed(context.clientVersion())) {
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

        // §P0-1: two independent evidence dimensions. The Type5 structure proves the entity
        // materialized (presence = EXACT); HP decode is a separate field (currentHp nullable). HP
        // being unknown/sentinel must NOT downgrade the materialization presence confidence, else
        // ReplayAoiLifecycle would drop the observed segment for a proven presence.
        final DecodeConfidence confidence = DecodeConfidence.EXACT;
        final MaterializationEvent event = new MaterializationEvent(
                packet.sequence(), ts, packet.type(), confidence,
                entityId, entityTypeId, currentHp, transformRaw, initRaw);
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
