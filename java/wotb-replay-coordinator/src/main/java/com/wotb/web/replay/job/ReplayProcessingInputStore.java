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
 *
 * <p><b>失败回滚是端口的职责之一</b>：create 在成功派发之前失败（写上输入时半途失败、权威登记
 * 失败、派发失败）时，已经写入的输入必须被删除——否则对象存储里会留下没有任何 job 引用的孤儿
 * 输入。{@link #discard} 因此是「同一批上传的键」级别的操作，不是通用删除能力。</p>
 */
public interface ReplayProcessingInputStore {

    /**
     * 持久化本次上传的全部输入。
     *
     * @return 与 {@code files} 同序、已按 {@link ReplayJobFiles#sanitizeFileName(String)} 规范化的
     *         source 名（作业后续的权威 source identity）
     * @throws IOException 存储不可用；调用方必须让 create 失败并清理已登记状态与已写入输入
     */
    List<String> store(String jobId, MultipartFile[] files) throws IOException;

    /**
     * 回滚本次 create 写入的输入：删除该 job 输入前缀下由 {@code files} 推导出的对象键。
     *
     * <p>幂等——半途失败时部分键从未创建，删除不存在的对象同样成功。键的推导与 {@link #store}
     * 完全一致，并且只落在 {@code temp/jobs/<jobId>/input/} 之下，绝不触碰其它 job 或其它前缀。</p>
     *
     * @throws IOException 存储不可用；调用方**必须**只记录日志，绝不替换原始 create 失败
     */
    void discard(String jobId, MultipartFile[] files) throws IOException;
}
