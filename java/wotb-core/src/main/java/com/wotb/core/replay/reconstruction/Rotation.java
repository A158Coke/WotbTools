package com.wotb.core.replay.reconstruction;

/**
 * 三维旋转（欧拉角）。
 *
 * @param yaw   偏航角
 * @param pitch 俯仰角
 * @param roll  翻滚角
 */
public record Rotation(float yaw, float pitch, float roll) {

    public static final Rotation ZERO = new Rotation(0, 0, 0);

    public Rotation {
        if (Float.isNaN(yaw) || Float.isInfinite(yaw)
                || Float.isNaN(pitch) || Float.isInfinite(pitch)
                || Float.isNaN(roll) || Float.isInfinite(roll)) {
            throw new IllegalArgumentException("Rotation components must be finite");
        }
    }
}
