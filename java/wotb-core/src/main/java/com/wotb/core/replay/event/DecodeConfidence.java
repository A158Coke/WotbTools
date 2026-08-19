package com.wotb.core.replay.event;

/**
 * 事件解码的置信度。
 */
public enum DecodeConfidence {
    /** 所有已知字段精确解析 */
    EXACT,

    /** 部分字段从上下文中推断 */
    INFERRED,

    /** 仅部分字段成功解析 */
    PARTIAL,

    /** 完全未知或无法解码 */
    UNKNOWN
}
