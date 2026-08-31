package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.ConsumableLifecycleEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityAuxiliaryBlobEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.UnknownReplayEvent;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.ArrayList;
import java.util.List;

/**
 * Type32（entity auxiliary length-prefixed blob）decoder（P0-2）。
 *
 * <p>有两个层面：</p>
 * <ol>
 *   <li><b>Generic envelope</b>（P0-2/P0-3）：{@code entityId(u32 LE) + flag(u8) + bodyLength(u32 LE) + body}，
 *       校验 {@code bodyLength == payload.length - 9}。任何 malformed framing fail-closed → raw-preserve + 诊断；
 *       之后总是产出 {@link EntityAuxiliaryBlobEvent}（结构事实，不解释 body 语义）。</li>
 *   <li><b>Semantic routing</b>（P0-4/P0-5）：仅当 {@code supported replay version} + {@code VEHICLE} +
 *       {@code flag==0} + {@code bodyLength==16} 时，额外产出 {@link ConsumableLifecycleEvent}。</li>
 * </ol>
 *
 * <p><b>禁止</b>用 {@code switch(bodyLength)} 当语义路由；语义路由至少依据 client version + entity class +
 * flag + body length。class 只能来自真实生命周期证据（{@link EntityClassRegistry}），不靠 method-shape 反推。</p>
 */
public final class EntityAuxiliaryBlobDecoder implements ReplayPacketDecoder {

    static final int TYPE_ENTITY_AUXILIARY = 32;

    // envelope 前缀长度：entityId(4) + flag(1) + bodyLength(4)
    static final int ENVELOPE_PREFIX_LEN = 9;
    // mobile flag=0 16-byte consumable body 的 proven semantic 组合
    static final int CONSUMABLE_BODY_LENGTH = 16;
    static final int CONSUMABLE_FLAG = 0;
    static final int WIRE_CODE_OFFSET = 2;
    static final int STATE_OFFSET = 3;
    static final int EVENT_CLOCK_OFFSET = 4;
    static final int EVENT_CLOCK_LEN = 8;
    static final int PARAM_OFFSET = 12;
    static final int PARAM_LEN = 4;

    @Override
    public boolean supports(final ReplayDecodeContext context, final RawReplayPacket packet) {
        return packet.type() == TYPE_ENTITY_AUXILIARY;
    }

    @Override
    public ReplayDecodeResult decode(final ReplayDecodeContext context, final RawReplayPacket packet) {
        final byte[] payload = packet.payload();
        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        if (payload.length < ENVELOPE_PREFIX_LEN) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED,
                    List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(), payload.length,
                            "TYPE32_ENVELOPE_TRUNCATED", DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("TYPE32_ENVELOPE_TRUNCATED",
                            "Type32 payload too short (" + payload.length + " < " + ENVELOPE_PREFIX_LEN + ")")));
        }
        final int entityId = readI32LE(payload, 0);
        final int flag = payload[4] & 0xFF;
        final int bodyLength = readU32LE(payload, 5);
        // 严格 framing 校验：bodyLength 必须等于 payload.length - 9（type32-entity-effects.md 16,850/16,850）。
        if (bodyLength < 0 || bodyLength != payload.length - ENVELOPE_PREFIX_LEN) {
            return new ReplayDecodeResult(DecodeStatus.MALFORMED,
                    List.of(new UnknownReplayEvent(packet.sequence(), ts, packet.type(), payload.length,
                            "TYPE32_BODY_LENGTH_MISMATCH", DecodeConfidence.UNKNOWN)),
                    List.of(new ReplayDecodeWarning("TYPE32_BODY_LENGTH_MISMATCH",
                            "Type32 bodyLength=" + bodyLength + " but payload.length-9="
                                    + (payload.length - ENVELOPE_PREFIX_LEN) + " entity=" + entityId)));
        }
        final byte[] body = new byte[bodyLength];
        System.arraycopy(payload, ENVELOPE_PREFIX_LEN, body, 0, bodyLength);

        final List<ReplayEvent> events = new ArrayList<>();
        // Generic envelope（结构事实，仅表明 framing 合法，不解释 body 语义）。
        events.add(new EntityAuxiliaryBlobEvent(packet.sequence(), ts, packet.type(),
                DecodeConfidence.EXACT, entityId, flag, bodyLength, body));

        // Semantic routing：只在真实生命周期证明的 VEHICLE 上启用 consumable 语义。
        final EntityClass entityClass = context.entityClassRegistry().resolve(entityId);
        final boolean consumableSemanticAllowed =
                ReplayProtocolProfile.type32ConsumableLifecycleAllowed(context.clientVersion());
        if (consumableSemanticAllowed
                && entityClass == EntityClass.VEHICLE
                && flag == CONSUMABLE_FLAG
                && bodyLength == CONSUMABLE_BODY_LENGTH) {
            final int wireCode = body[WIRE_CODE_OFFSET] & 0xFF;
            final int wireState = body[STATE_OFFSET] & 0xFF;
            final ConsumableLifecycleEvent.ConsumableLifecycleState state =
                    ConsumableLifecycleEvent.stateOf(wireState);
            final String logicalItemId = ConsumableLifecycleEvent.logicalItemIdOf(wireCode);
            final double eventClockRaw = readF64LE(body, EVENT_CLOCK_OFFSET);
            final float paramSec = Float.intBitsToFloat(readI32LE(body, PARAM_OFFSET));
            final boolean allProven = logicalItemId != null && state != ConsumableLifecycleEvent.ConsumableLifecycleState.UNKNOWN;
            final DecodeConfidence conf = allProven ? DecodeConfidence.EXACT : DecodeConfidence.PARTIAL;
            events.add(new ConsumableLifecycleEvent(packet.sequence(), ts, packet.type(), conf,
                    entityId, packet.rawClockSec(), wireCode, logicalItemId, state,
                    eventClockRaw, paramSec));
        }
        return ReplayDecodeResult.of(events);
    }

    private static int readI32LE(final byte[] buf, final int i) {
        return (buf[i] & 0xFF) | ((buf[i + 1] & 0xFF) << 8)
                | ((buf[i + 2] & 0xFF) << 16) | (buf[i + 3] << 24);
    }

    private static int readU32LE(final byte[] buf, final int i) {
        return readI32LE(buf, i);
    }

    private static double readF64LE(final byte[] buf, final int i) {
        long bits = 0;
        for (int k = 0; k < 8; k++) {
            bits |= ((long) (buf[i + k] & 0xFF)) << (8 * k);
        }
        return Double.longBitsToDouble(bits);
    }
}
