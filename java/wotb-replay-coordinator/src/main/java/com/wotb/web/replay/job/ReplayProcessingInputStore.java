package com.wotb.web.replay.job;

import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

/**
 * 上传输入的持久化端口：决定一个 job 的输入字节落在哪里。
 *
 * <p>create 编排（校验 / operationId 幂等 / 登记 / 派发 / 失败清理）只有一份实现
 * （{@link ReplayProcessingJobService}）；本端口只替换「字节落在哪里」这一个事实：</p>
 * <ul>
 *   <li>{@code local}：进程本地 job 目录（默认，装配时不需要任何 bean）；</li>
 *   <li>{@code distributed}：对象存储 {@code temp/jobs/<jobId>/input/<index>/<name>}
 *       （键由 {@code ObjectStorageKeys} 唯一拥有）。</li>
 * </ul>
 *
 * <p>实现必须对同一 {@code (jobId, sourceIndex)} 幂等覆盖：重试的 create 不能产生两份输入。</p>
 */
public interface ReplayProcessingInputStore {

    /**
     * 持久化本次上传的全部输入。
     *
     * @return 与 {@code files} 同序、已按 {@link ReplayJobFiles#sanitizeFileName(String)} 规范化的
     *         source 名（作业后续的权威 source identity）
     * @throws IOException 存储不可用；调用方必须让 create 失败并清理已登记状态
     */
    List<String> store(String jobId, MultipartFile[] files) throws IOException;
}
