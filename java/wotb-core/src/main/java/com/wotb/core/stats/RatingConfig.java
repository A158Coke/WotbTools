package com.wotb.core.stats;

import java.util.Map;

/**
 * 评分参数的不可变快照 (供 API / 前端「评分规则」展示)。
 * 取自 common/rating.json 当前生效值; 与 {@link Rating} 内部私有 Config 解耦。
 */
public record RatingConfig(double assist, double block, double killValue, double winBonus,
                           int minSamples, int scale, Map<String, Double> classFactor) {
}
