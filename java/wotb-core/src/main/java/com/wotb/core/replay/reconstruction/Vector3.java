package com.wotb.core.replay.reconstruction;

/**
 * 三维坐标向量。
 *
 * @param x X 坐标
 * @param y Y 坐标
 * @param z Z 坐标
 */
public record Vector3(float x, float y, float z) {

    /** 零向量 */
    public static final Vector3 ZERO = new Vector3(0, 0, 0);

    public Vector3 {
        if (Float.isNaN(x) || Float.isInfinite(x)
                || Float.isNaN(y) || Float.isInfinite(y)
                || Float.isNaN(z) || Float.isInfinite(z)) {
            throw new IllegalArgumentException("Vector components must be finite");
        }
    }
}
