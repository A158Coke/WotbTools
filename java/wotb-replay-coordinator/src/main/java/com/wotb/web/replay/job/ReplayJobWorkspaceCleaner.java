package com.wotb.web.replay.job;

import java.io.IOException;

/**
 * 一个 Processing Job 在对象存储里的**工作区**（{@code temp/jobs/<jobId>/}）的回收端口。
 *
 * <p><b>为什么需要它</b>：dataset 与 artifact 的权威在对象存储，因此 job 过期后只删 PostgreSQL /
 * 本地状态是不够的——{@code input/}、{@code result/source-*.json}、{@code result/finalized.json}、
 * {@code artifacts/*} 会变成没有任何引用的孤儿对象。桶上的 1 天 lifecycle 只是**兜底**，不是正常
 * 回收机制。</p>
 *
 * <p><b>只按 job 身份删除</b>：入参是 job 的权威投影（{@code jobId} + sources），实现据此用
 * {@code ObjectStorageKeys} 推导出该 job 前缀下的确定键集合，因此调用方**无法**删除任意桶前缀，
 * 也绝不可能碰到别的 job。刻意不在 {@code ObjectStorage} 上开 {@code list}/{@code deletePrefix}：
 * 那会把「删任意前缀」的能力交给应用层。</p>
 *
 * <p><b>幂等</b>：对象不存在即成功——过期回收可能因失败被重试，重试时部分键已经删掉是正常情况。</p>
 *
 * <p><b>失败语义</b>：抛 {@link IOException} 表示工作区**可能仍有残留**。调用方必须据此保留
 * PostgreSQL 权威行（顺序：先 MinIO 后 PostgreSQL），下一轮 sweep 幂等重试；反过来「MinIO 删成功、
 * PostgreSQL 删失败」也是可恢复的——权威行还在，下一轮只会重复一次无害的 MinIO 回收。</p>
 */
public interface ReplayJobWorkspaceCleaner {

    /**
     * 删除该 job 在对象存储里的整个工作区（对象不存在视为成功）。
     *
     * @param job 权威投影（至少需要 {@code jobId} 与全部 source 的 index/name）；不得插入 live registry
     * @throws IOException 删除未完成；调用方必须保留 PostgreSQL 权威行并在下一轮重试
     */
    void deleteJobWorkspace(ReplayProcessingJob job) throws IOException;
}
