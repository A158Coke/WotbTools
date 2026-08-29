package com.wotb.core.replay.facts;

import com.wotb.core.replay.reconstruction.Vector3;

/**
 * Canonical 射击事实（计划 §C1）。
 *
 * <p>生命周期：Vehicle method0 → Avatar method29（launch）→ method20（terminal endpoint）
 * → method27（terminal/explosion）→ method38（recorder outgoing result）。
 * <b>Recorder shot 与 global projectile 必须经 shooterEntityId 过滤</b>——
 * method29 是全局弹丸流，不能把所有 method29 当 recorder 射击。</p>
 *
 * <p>未知字段保持 null（不得当 0）；packet raw clock 不是精确弹丸飞行时间，
 * 不得用 method20.rawClock - method29.rawClock 冒充飞行时长。</p>
 *
 * @param shotId             弹丸/射击 ID（method29）
 * @param shooterEntityId    射手实体 ID
 * @param shooterAccountId   映射后的射手账号；未映射 = 0
 * @param launchTimeSec      battle-relative 发射时刻
 * @param launchPosition     发射/参考点
 * @param launchVelocity     发射速度向量（量级 = 当前回放有效弹速）
 * @param terminalTimeSec    终点时刻（method20；null = 未观测到终点）
 * @param terminalPosition   终点位置（method20）
 * @param ammoSelection      Type28 发射时刻选择值（null = UNKNOWN，禁止沿用跨 arena 状态）
 * @param ammoDescriptorRaw  method17 发射时刻 descriptor（null = UNKNOWN）
 * @param resolution         method38 结果（null = 未观测/无法唯一配对，UNKNOWN）
 * @param recorderShot       是否已独立闭合为录像者射击（shooter ∈ recorder entity ids）
 */
public record ShotFact(
        int shotId,
        int shooterEntityId,
        long shooterAccountId,
        double launchTimeSec,
        Vector3 launchPosition,
        Vector3 launchVelocity,
        Double terminalTimeSec,
        Vector3 terminalPosition,
        Integer ammoSelection,
        Integer ammoDescriptorRaw,
        ShotResolution resolution,
        boolean recorderShot
) {
}
