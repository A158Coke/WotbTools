package com.wotb.core.replay.processing;

import java.util.Objects;

/**
 * 精确重复关系：original 是保留的原始文件，duplicate 是被去重的副本。
 * <p>构造时校验不变量：非 FAILED、有非空 contentHash、hash 相等。</p>
 */
public record ExactReplayDuplicate(
        ReplayProcessingResult original,
        ReplayProcessingResult duplicate
) {

    public ExactReplayDuplicate {
        Objects.requireNonNull(original, "original");
        Objects.requireNonNull(duplicate, "duplicate");
        if (original == duplicate) {
            throw new IllegalArgumentException("Duplicate cannot reference itself");
        }
        if (original.status() == ReplayProcessingStatus.FAILED
                || duplicate.status() == ReplayProcessingStatus.FAILED) {
            throw new IllegalArgumentException("Failed results cannot be exact duplicates");
        }
        final String oh = contentHash(original);
        final String dh = contentHash(duplicate);
        if (oh == null || dh == null || !oh.equals(dh)) {
            throw new IllegalArgumentException("Exact duplicates must have identical non-empty hashes");
        }
    }

    private static String contentHash(final ReplayProcessingResult result) {
        if (result.identity() == null) return null;
        final String h = result.identity().contentHash();
        return (h == null || h.isBlank()) ? null : h;
    }
}
