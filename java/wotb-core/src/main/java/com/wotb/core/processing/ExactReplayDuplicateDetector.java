package com.wotb.core.processing;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 精确重复检测器，独立于 scope/recorder 验证。
 * <p>
 * 即使 scope 混合或录像者不同，也能正确检测 content-hash 完全相同的文件。
 * 无 contentHash 时不得将同名文件猜测为精确重复。
 * </p>
 */
public final class ExactReplayDuplicateDetector {

    private ExactReplayDuplicateDetector() {}

    /** 分成 unique + duplicates，unique 保留完全有序。 */
    public static ExactDuplicatePartition partition(final List<ReplayProcessingResult> results) {
        final Map<String, ReplayProcessingResult> originalByHash = new LinkedHashMap<>();
        final List<ReplayProcessingResult> unique = new ArrayList<>();
        final List<BatchAnalyzer.ExactDuplicate> duplicates = new ArrayList<>();

        for (final ReplayProcessingResult result : results) {
            if (result.status() == ReplayProcessingStatus.FAILED) {
                unique.add(result);
                continue;
            }
            final var identity = result.identity();
            final String hash = identity != null ? identity.contentHash() : null;
            if (hash == null || hash.isBlank()) {
                unique.add(result);
                continue;
            }
            final ReplayProcessingResult original = originalByHash.putIfAbsent(hash, result);
            if (original == null) {
                unique.add(result);
            } else {
                duplicates.add(new BatchAnalyzer.ExactDuplicate(original, result));
            }
        }

        return new ExactDuplicatePartition(List.copyOf(unique), List.copyOf(duplicates));
    }

    public record ExactDuplicatePartition(
            List<ReplayProcessingResult> uniqueResults,
            List<BatchAnalyzer.ExactDuplicate> duplicates
    ) {
        public int count() { return duplicates.size(); }
        public List<String> duplicateFileNames() {
            return duplicates.stream().map(d -> d.duplicate().fileName()).toList();
        }
    }
}
