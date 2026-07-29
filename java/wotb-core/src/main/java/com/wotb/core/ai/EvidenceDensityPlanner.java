package com.wotb.core.ai;

/**
 * 证据密度级别，用于控制单场回放分析中附加证据的详细程度。
 *
 * <p>每一级都在前一级的基础上增加更多证据数据，
 * 前提是上下文窗口有足够余量。</p>
 */
enum EvidenceDensity {
    /** 仅包含压缩 features（当前默认）：移动段、交火段、阶段摘要、关键事件） */
    LEVEL_1_COMPRESSED,
    /** 录像者位置采样（每约 2 秒一个采样点） */
    LEVEL_2_POSITION_SAMPLE,
    /** 已观察对象的去重位置时间线 */
    LEVEL_3_OBSERVED_TIMELINE,
    /** 关键窗口高精度采样 */
    LEVEL_4_KEY_WINDOW_HIGH_PRECISION,
    /** 事件级证据 */
    LEVEL_5_EVENT_LEVEL
}
