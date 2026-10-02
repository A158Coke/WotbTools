package com.wotb.core.replay.reconstruction;

/**
 * data.wotreplay 的文件头（客户端投影里的数据形状；服务器没有 parser，不在这里解码字节）。
 * <p>
 * 格式：魔数(4B) + 未知(8B) + hash(1B长度+内容) + version(1B长度+内容) + 1B填充。
 * </p>
 *
 * @param magic              魔数，应为 0x12345678
 * @param unknownHeaderBytes 魔数后的 8 字节未知头部
 * @param clientHash         客户端 hash 字符串
 * @param clientVersion      客户端版本字符串
 * @param packetStreamOffset packet stream 起始偏移（头部总长度）
 */
public record ReplayStreamHeader(
        long magic,
        byte[] unknownHeaderBytes,
        String clientHash,
        String clientVersion,
        int packetStreamOffset
) {
}
