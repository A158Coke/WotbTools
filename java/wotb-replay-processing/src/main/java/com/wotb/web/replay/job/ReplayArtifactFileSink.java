package com.wotb.web.replay.job;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * 本地文件系统的 {@link ReplayArtifactSink}：保持既有 worker job 目录布局与写语义
 * （{@code <jobDir>/derived/r<sourceIndex>/<artifactName>}，临时文件 + atomic move）。
 *
 * <p>字节由 {@link ReplayArtifactWriter} 的 {@code *Content(...)} 唯一生成；本类只决定写到哪里，
 * 因此同一份解析在对象存储 sink 下得到逐字节相同的对象。</p>
 */
public final class ReplayArtifactFileSink implements ReplayArtifactSink {

    private final Path jobDir;

    public ReplayArtifactFileSink(final Path jobDir) {
        if (jobDir == null) {
            throw new IllegalArgumentException("jobDir must not be null");
        }
        this.jobDir = jobDir;
    }

    /** 本地 artifact 目录：{@code <jobDir>/derived/r<sourceIndex>}。 */
    public Path artifactDir(final int sourceIndex) {
        return ReplayArtifactWriter.derivedDir(jobDir, sourceIndex);
    }

    @Override
    public void write(final int sourceIndex, final String artifactName, final byte[] content) throws IOException {
        if (content == null) {
            throw new IllegalArgumentException("content must not be null");
        }
        writeAtomic(artifactDir(sourceIndex).resolve(artifactName), content);
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
