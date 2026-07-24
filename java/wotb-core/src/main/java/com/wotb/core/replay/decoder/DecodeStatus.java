package com.wotb.core.replay.decoder;

/**
 * 解码状态。
 */
public enum DecodeStatus {
    /** 完全成功 */
    SUCCESS,

    /** 部分成功（部分字段解析，部分字段无法解析） */
    PARTIAL,

    /** 当前版本不支持此包类型 */
    UNSUPPORTED,

    /** 已知类型但 payload 格式不匹配 */
    FORMAT_MISMATCH,

    /** 原始包结构非法 */
    MALFORMED
}
