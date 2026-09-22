package com.wotb.web.replay.job;

import java.util.HashMap;
import java.util.Map;

/**
 * 测试用 {@link ReplayProcessingResultReader}：READY dataset 取进程内存 {@code job.result()}，
 * derived artifact 取本替身显式放入的字节。
 *
 * <p><b>只服务测试</b>：生产读取端口只有一个实现（对象存储，
 * {@code ObjectStorageReplayDatasetRepository}）。本替身不做任何解码——它只回答「字节是什么」，
 * 与生产 reader 的契约完全相同（{@code null} = 不存在，解码失败由调用方按 IOException 处理）。</p>
 */
public final class InMemoryReplayDatasetRepository implements ReplayProcessingResultReader {

    private final Map<String, byte[]> aiFacts = new HashMap<>();
    private final Map<String, byte[]> mapOverview = new HashMap<>();
    private final Map<String, byte[]> battlePlaybackV2 = new HashMap<>();

    @Override
    public ProcessedDataset readReadyDataset(final ReplayProcessingJob job) {
        return job.result();
    }

    @Override
    public byte[] aiFacts(final String jobId, final int sourceIndex) {
        return aiFacts.get(key(jobId, sourceIndex));
    }

    @Override
    public byte[] mapOverview(final String jobId, final int sourceIndex) {
        return mapOverview.get(key(jobId, sourceIndex));
    }

    @Override
    public byte[] battlePlaybackV2(final String jobId, final int sourceIndex) {
        return battlePlaybackV2.get(key(jobId, sourceIndex));
    }

    /** {@code null} = 该 artifact 不存在（capability unavailable）。 */
    public void putAiFacts(final String jobId, final int sourceIndex, final byte[] content) {
        putOrRemove(aiFacts, key(jobId, sourceIndex), content);
    }

    /** {@code null} = 该 artifact 不存在（capability unavailable）。 */
    public void putMapOverview(final String jobId, final int sourceIndex, final byte[] content) {
        putOrRemove(mapOverview, key(jobId, sourceIndex), content);
    }

    /** {@code null} = 该 artifact 不存在（capability unavailable）。 */
    public void putBattlePlaybackV2(final String jobId, final int sourceIndex, final byte[] content) {
        putOrRemove(battlePlaybackV2, key(jobId, sourceIndex), content);
    }

    private static void putOrRemove(final Map<String, byte[]> target, final String key, final byte[] content) {
        if (content == null) {
            target.remove(key);
            return;
        }
        target.put(key, content);
    }

    private static String key(final String jobId, final int sourceIndex) {
        return jobId + "/" + sourceIndex;
    }
}
