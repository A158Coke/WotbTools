package com.wotb.core.replay.decoder;

/**
 * 解码上下文，包含游戏版本等信息，供 decoder 决策使用。
 *
 * @param clientVersion  客户端版本号字符串
 */
public record ReplayDecodeContext(
        String clientVersion
) {
}
