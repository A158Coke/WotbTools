package com.wotb.web.replay.job;

import com.wotb.contracts.ObjectKey;
import com.wotb.contracts.ObjectStorage;
import com.wotb.storage.ObjectStorageKeys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * 分布式模式的 {@link ReplayProcessingInputStore}：上传输入写对象存储
 * {@code temp/jobs/<jobId>/input/<sourceIndex>/<sourceName>}。
 *
 * <p>键**只**由 {@link ObjectStorageKeys} 生成（键布局唯一事实源），本类不拼路径。该布局与
 * parser-worker 读输入的布局是同一份契约；文件名沿用同一
 * {@link ReplayJobFiles#sanitizeFileName(String)} 规范化结果，因此 worker 能从
 * {@code (jobId, sourceIndex, sourceName)} 反解出对象键。</p>
 *
 * <p>同一 {@code (jobId, sourceIndex)} 是幂等覆盖：create 重试不会留下两份输入。上传失败抛
 * {@link IOException}，让 create 失败（绝不登记一个没有输入的 job）。</p>
 *
 * <p>{@link #discard} 用**同一套键推导**删除这批上传的对象：create 在派发成功之前失败时，
 * 对象存储里不能留下没有任何 job 引用的输入。</p>
 */
public final class MinioReplayProcessingInputStore implements ReplayProcessingInputStore {

    private static final Logger LOGGER = LoggerFactory.getLogger(MinioReplayProcessingInputStore.class);

    /** 无 content type 的输入按二进制流存储（回放文件不是文本）。 */
    private static final String DEFAULT_CONTENT_TYPE = "application/octet-stream";

    private final ObjectStorage storage;

    public MinioReplayProcessingInputStore(final ObjectStorage storage) {
        this.storage = Objects.requireNonNull(storage, "storage");
    }

    @Override
    public List<String> store(final String jobId, final MultipartFile[] files) throws IOException {
        final List<String> sourceNames = new ArrayList<>(files.length);
        for (int i = 0; i < files.length; i++) {
            final MultipartFile file = files[i];
            final String safe = safeNameOf(file);
            final ObjectKey key = ObjectStorageKeys.tempJobObject(jobId, inputPath(i, safe));
            try (InputStream content = file.getInputStream()) {
                storage.put(key, content, file.getSize(), contentTypeOf(file));
            }
            sourceNames.add(safe);
            LOGGER.info("event=replay_processing_input_stored jobId={} sourceIndex={} key={} bytes={}",
                    jobId, i, key.value(), file.getSize());
        }
        return sourceNames;
    }

    @Override
    public void discard(final String jobId, final MultipartFile[] files) throws IOException {
        for (int i = 0; i < files.length; i++) {
            // 与 store 同一推导：半途失败时后面的键可能从未创建，delete 对不存在的对象是成功。
            final ObjectKey key = ObjectStorageKeys.tempJobObject(jobId, inputPath(i, safeNameOf(files[i])));
            storage.delete(key);
            LOGGER.info("event=replay_processing_input_discarded jobId={} sourceIndex={} key={}",
                    jobId, i, key.value());
        }
    }

    /** {@code input/<sourceIndex>/<sourceName>}：与 parser-worker 的读键逐字一致。 */
    private static String inputPath(final int sourceIndex, final String sourceName) {
        return "input/" + sourceIndex + "/" + sourceName;
    }

    /** 与本地路径共用同一文件名规范化，保证 worker 能从 identity 反解出对象键。 */
    private static String safeNameOf(final MultipartFile file) {
        final String raw = file.getOriginalFilename();
        return ReplayJobFiles.sanitizeFileName(raw == null ? "replay.wotbreplay" : raw);
    }

    private static String contentTypeOf(final MultipartFile file) {
        return StringUtils.hasText(file.getContentType()) ? file.getContentType() : DEFAULT_CONTENT_TYPE;
    }
}
