package com.wotb.ai.gateway;

@FunctionalInterface
public interface StreamConsumer {

    /**
     * 收到一段流式输出增量（与上游 chunk 文本一致，非累计）。
     *
     * @param delta 文本增量，非 null；可能为空字符串（纯元数据 chunk）
     */
    void onDelta(String delta);
}
