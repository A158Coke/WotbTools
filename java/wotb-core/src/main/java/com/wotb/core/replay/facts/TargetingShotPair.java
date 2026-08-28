package com.wotb.core.replay.facts;

/**
 * 录像者射击的瞄准态 PRE/POST 快照派生事实（计划 §C6/C7）。
 *
 * <p>所有 recorder launch 都有 method36 PRE → method29 → method36 POST 配对
 * （326/326 corpus）。{@code dispersionBloomBeforeShot} 为 PRE field6.field1，
 * {@code dispersionBloomAfterShot} 为 POST field6.field1；
 * 开火后 bloom 增量恒为正（普通射击）——但保留原始 scalar 供 AI 组合，
 * 不在此处 hardcode 判定。</p>
 *
 * @param shotId                   对应射击 ID
 * @param turretYawBeforeShotRad    PRE root.field1（null = 初始化变体缺失）
 * @param gunPitchBeforeShotRad     PRE root.field2（null = 初始化变体缺失）
 * @param aimingTimeScalarBefore    PRE root.field5
 * @param dispersionBloomBefore     PRE field6.field1
 * @param dispersionBloomAfter      POST field6.field1（null = 未观测到 POST）
 * @param bloomIncreaseAfterShot     POST - PRE（有限时；否则 null）
 */
public record TargetingShotPair(
        int shotId,
        Double turretYawBeforeShotRad,
        Double gunPitchBeforeShotRad,
        Double aimingTimeScalarBefore,
        Double dispersionBloomBefore,
        Double dispersionBloomAfter,
        Double bloomIncreaseAfterShot
) {
}
