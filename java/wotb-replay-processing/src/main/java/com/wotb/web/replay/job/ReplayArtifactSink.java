package com.wotb.web.replay.job;

/**
 * 派生 artifact 的落地目标（"写到哪里"）。
 *
 * <p>{@link ReplayArtifactWriter} 是 artifact <b>内容</b>的唯一来源：这个接口只承载字节，调用方
 * 先拿到 {@code byte[]}，再由 sink 决定落到哪个后端（生产 sink 写对象存储，运行在 parser worker）。
 * 不允许出现第二条 artifact 生成路径。</p>
 *
 * <p>sink 实现按 {@code (sourceIndex, artifactName)} 覆盖写。{@code artifactName} 固定为
 * {@link ReplayArtifactWriter#AI_FACTS_NAME} /
 * {@link ReplayArtifactWriter#MAP_OVERVIEW_NAME} /
 * {@link ReplayArtifactWriter#BATTLE_PLAYBACK_V2_NAME}。</p>
 */
public interface ReplayArtifactSink {

    /**
     * 写一个派生 artifact。
     *
     * @param sourceIndex  源下标（调用方固定的 {@code r<index>} 语义）
     * @param artifactName artifact 文件名，见本接口 javadoc
     * @param content      完整 artifact 字节
     * @throws Exception 落地失败（存储不可用等）；调用方决定 error code 与重试语义
     */
    void write(int sourceIndex, String artifactName, byte[] content) throws Exception;
}
