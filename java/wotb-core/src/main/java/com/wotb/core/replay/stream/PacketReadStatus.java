package com.wotb.core.replay.stream;

/**
 * 原始包的读取状态：正常读取，或经过重同步恢复。
 */
public enum PacketReadStatus {
    /** 正常读取，包头长度和校验通过 */
    NORMAL,

    /** 经过重同步（跳过若干字节后恢复）读取的包 */
    RESYNC_RECOVERED
}
