package com.wotb.web.replay.job;

import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.facts.AiReplayFacts;
import com.wotb.core.replay.facts.ReplayFactsCodec;
import com.wotb.web.replay.dto.MapOverview;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * Derived Artifact 读写：
 * <ul>
 *   <li>路径固定 {@code <jobDir>/derived/{sourceId}/ai-facts.json} 与
 *       {@code map-overview.json}（sourceId = r{sourceIndex}，sourceName 不入路径）；</li>
 *   <li>写：临时文件 + atomic move，先写 artifact 后置 source READY；</li>
 *   <li>MapOverview 不可用（builder 返回 null）→ 不写伪 artifact，不判 parse failure；</li>
 *   <li>immutable JSON（Jackson），TTL 由 job 目录清理接管。</li>
 * </ul>
 */
public final class ReplayArtifactWriter {

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();

    private ReplayArtifactWriter() {
    }

    public static Path aiFactsPath(final Path jobDir, final int sourceIndex) {
        return derivedDir(jobDir, sourceIndex).resolve("ai-facts.json");
    }

    public static Path mapOverviewPath(final Path jobDir, final int sourceIndex) {
        return derivedDir(jobDir, sourceIndex).resolve("map-overview.json");
    }

    /** 写 ai-facts.json（worker 内调用，先写后 READY）。 */
    public static void writeAiFacts(final Path jobDir, final int sourceIndex,
                                    final ReplayProcessingResult result) throws IOException {
        writeAtomic(aiFactsPath(jobDir, sourceIndex),
                ReplayFactsCodec.toBytes(AiReplayFacts.fromResult(result)));
    }

    /** 写 map-overview.json；overview == null（capability unavailable）时跳过。 */
    public static void writeMapOverview(final Path jobDir, final int sourceIndex,
                                        final MapOverview overview) throws IOException {
        if (overview == null) {
            return;
        }
        writeAtomic(mapOverviewPath(jobDir, sourceIndex), MAPPER.writeValueAsBytes(overview));
    }

    /** 读取 ai-facts（AI Dataset 迁移 Phase 6 用）。 */
    public static AiReplayFacts readAiFacts(final Path jobDir, final int sourceIndex) throws IOException {
        return ReplayFactsCodec.fromBytes(Files.readAllBytes(aiFactsPath(jobDir, sourceIndex)));
    }

    /** 读取 map-overview；文件不存在（unavailable）返回 null（Playback 204 语义，Phase 7）。 */
    public static MapOverview readMapOverview(final Path jobDir, final int sourceIndex) throws IOException {
        final Path path = mapOverviewPath(jobDir, sourceIndex);
        if (!Files.exists(path)) {
            return null;
        }
        return MAPPER.readValue(Files.readAllBytes(path), MapOverview.class);
    }

    private static Path derivedDir(final Path jobDir, final int sourceIndex) {
        return jobDir.resolve("derived").resolve("r" + sourceIndex);
    }

    private static void writeAtomic(final Path target, final byte[] data) throws IOException {
        Files.createDirectories(target.getParent());
        final Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
        Files.write(tmp, data);
        try {
            Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (final AtomicMoveNotSupportedException e) {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
