package com.wotb.core.replay.event;

/**
 * 车辆击毁事件。
 * <p>
 * 可以由 Type 8 致命伤害推断产生，也可以由 Type 7 血量归零产生。
 * 设置 lifeState=DESTROYED，保存确定或推断的阵亡时间。
 * 不能被后续低置信度事件覆盖。
 * </p>
 *
 * @param sequence      事件顺序号
 * @param timestamp     时间戳
 * @param packetType    来源原始 packet type
 * @param confidence    解码置信度
 * @param entityId      被击毁实体 ID
 * @param killerEid     击毁者实体 ID（可为 null）
 * @param inferred      是否为推断的击毁（而非精确事件）
 */
public record VehicleDestroyedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        Integer killerEid,
        boolean inferred
) implements ReplayEvent {
}
