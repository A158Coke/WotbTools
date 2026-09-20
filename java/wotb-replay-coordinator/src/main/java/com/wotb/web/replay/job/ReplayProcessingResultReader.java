package com.wotb.web.replay.job;

import java.io.IOException;

/**
 * READY dataset 与 derived artifact 的**唯一**读取端口。
 *
 * <p>job 状态权威（{@code QUEUED/PROCESSING/READY/FAILED/CANCELLED} 与 source 状态）永远来自
 * 状态机；本端口只回答「READY 之后数据从哪里读」：</p>
 * <ul>
 *   <li>{@code local}：进程内存 {@link ReplayProcessingJob#result()} + job 目录里的 derived
 *       artifact（同进程、同一次执行）；</li>
 *   <li>{@code distributed}：对象存储里的 finalized batch dataset
 *       （{@code temp/jobs/<jobId>/result/finalized.json}）与 worker 写的 derived artifact
 *       （{@code temp/jobs/<jobId>/artifacts/<i>/*.json}）。</li>
 * </ul>
 *
 * <p>实现不得读取或推断 job 状态：调用方已经确认 job 是 READY、source 是 READY。</p>
 *
 * <p><b>derived artifact 也走这里</b>：AI Review（{@code ai-facts.json}）、Map Overview 与
 * Battle Playback V2（{@code map-overview.json} / {@code battle-playback-v2.json}）同样只通过本端口
 * 取字节，因此「distributed 下 TX 本地磁盘不参与 dataset/artifact 读取」是结构约束，而不是每个
 * feature 各自遵守的纪律。字节 → DTO 的解码由
 * {@code ReplayArtifactWriter.decode*(...)} 唯一拥有（本地文件与对象存储共用同一份语义）。</p>
 */
public interface ReplayProcessingResultReader {

    /**
     * @return job 的 READY dataset；{@code null} 表示当前不可用（调用方返回 409 JOB_NOT_READY）
     */
    ProcessedDataset readReadyDataset(ReplayProcessingJob job);

    /**
     * {@code ai-facts.json} 字节。
     *
     * @return {@code null} = 不存在（AI 路径按 DATASET_UNAVAILABLE 503 处理）
     * @throws IOException 存储 I/O / 权限故障——与「不存在」必须可区分
     */
    byte[] aiFacts(String jobId, int sourceIndex) throws IOException;

    /** {@code map-overview.json} 字节；{@code null} = capability unavailable（204 语义）。 */
    byte[] mapOverview(String jobId, int sourceIndex) throws IOException;

    /** {@code battle-playback-v2.json} 字节；{@code null} = capability unavailable（204 语义）。 */
    byte[] battlePlaybackV2(String jobId, int sourceIndex) throws IOException;
}
