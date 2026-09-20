package com.wotb.web.replay.job;

/**
 * READY 结果数据集的读取端口。
 *
 * <p>job 状态权威（{@code QUEUED/PROCESSING/READY/FAILED/CANCELLED} 与 source 状态）永远来自
 * 状态机；本端口只回答「READY 的 dataset 从哪里读」：</p>
 * <ul>
 *   <li>{@code local}：进程内存 {@link ReplayProcessingJob#result()}（默认）；</li>
 *   <li>{@code distributed}：对象存储里的 canonical per-source dataset
 *       （{@code temp/jobs/<jobId>/result/source-<i>.json}）。</li>
 * </ul>
 *
 * <p>实现不得读取或推断 job 状态：调用方已经确认 job 是 READY。</p>
 */
@FunctionalInterface
public interface ReplayProcessingResultReader {

    /**
     * @return job 的 READY dataset；{@code null} 表示当前不可用（调用方返回 409 JOB_NOT_READY）
     */
    ProcessedDataset readReadyDataset(ReplayProcessingJob job);
}
