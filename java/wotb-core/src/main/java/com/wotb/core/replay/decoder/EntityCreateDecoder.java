package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityCreatedEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.stream.RawReplayPacket;

import java.util.List;

/**
 * Type 0/1/2 (Entity Create / Base Player Create) 解码器。
 * <p>
 * 建立玩家或控制实体，提取能够确定的实体初始化信息，
 * 保留不能理解的初始化属性，不要猜测未知字段。
 * </p>
 * <p><b>§P1-3</b>：entityId 格式未经 PR147/fixtures 证明，本 decoder 不生成 semantic entityId
 * （恒为 UNRESOLVED -1），只 raw-preserve 载荷注入 {@link EntityCreatedEvent#unknownInitData()}
 * 让后续 decoder 用 PR147 证明后再语义化；canonical timeline 对 entityId &lt;= 0 一律不消费。</p>
 */
public class EntityCreateDecoder implements ReplayPacketDecoder {

    static final int TYPE_BASE_PLAYER_CREATE = 0;
    static final int TYPE_ENTITY_CREATE_1 = 1;
    static final int TYPE_ENTITY_CREATE_2 = 2;

    @Override
    public boolean supports(ReplayDecodeContext context, RawReplayPacket packet) {
        final int t = packet.type();
        return t == TYPE_BASE_PLAYER_CREATE
                || t == TYPE_ENTITY_CREATE_1
                || t == TYPE_ENTITY_CREATE_2;
    }

    @Override
    public ReplayDecodeResult decode(ReplayDecodeContext context, RawReplayPacket packet) {
        final byte[] payload = packet.payload();

        // 从 payload 中尝试提取 entityId（格式待进一步确认）
        // 现有代码中对 Type 0 的处理不直接提取 entityId
        // 这里保守做法：记录未知初始化数据，不做猜测

        final ReplayTimestamp ts = new ReplayTimestamp(packet.rawClockSec(), null);
        // §P1-3: entityId 格式未被 PR147/fixtures 证明，不得猜测并送入 canonical timeline。这里只
        // raw-preserve 载荷，entityId 置为 UNRESOLVED(-1)（消费者对 <=0 一律视为未解析），绝不升级为
        // production truth。
        final int entityId = -1;

        final byte[] unknownData = new byte[payload.length];
        System.arraycopy(payload, 0, unknownData, 0, payload.length);

        final EntityCreatedEvent event = new EntityCreatedEvent(
                packet.sequence(), ts, packet.type(),
                DecodeConfidence.PARTIAL,
                entityId,
                unknownData);

        return new ReplayDecodeResult(DecodeStatus.PARTIAL, List.of(event),
                List.of(new ReplayDecodeWarning("INIT_DATA_NOT_PARSED",
                        "Entity create packet type " + packet.type()
                                + ": init data format not yet decoded")));
    }

}
