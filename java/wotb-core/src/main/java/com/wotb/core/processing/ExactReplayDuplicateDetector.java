package com.wotb.core.processing;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;

/**
 * 精确重复检测器，独立于 scope/recorder 验证。
 * <p>
 * 即使 scope 混合或录像者不同，也能正确检测 content-hash 完全相同的文件。
 * </p>
 */
public final class ExactReplayDuplicateDetector {

    private ExactReplayDuplicateDetector() {}

    public static ExactDuplicateSummary detect(final List<ReplayProcessingResult> results) {
        final LinkedHashMap<String, ReplayProcessingResult> originalByHash = new LinkedHashMap<>();
        final List<BatchAnalyzer.ExactDuplicate> duplicates = new ArrayList<>();

        for (final ReplayProcessingResult result : results) {
            if (result.status() == ReplayProcessingStatus.FAILED) continue;
            final var identity = result.identity();
            final String hash = identity != null ? identity.contentHash() : null;
            if (hash == null || hash.isBlank()) continue;
            final ReplayProcessingResult original = originalByHash.putIfAbsent(hash, result);
            if (original != null) {
                duplicates.add(new BatchAnalyzer.ExactDuplicate(original, result));
            }
        }

        return new ExactDuplicateSummary(List.copyOf(duplicates));
    }

    public record ExactDuplicateSummary(List<BatchAnalyzer.ExactDuplicate> duplicates) {
        public int count() { return duplicates.size(); }
        public List<String> duplicateFileNames() {
            return duplicates.stream().map(d -> d.duplicate().fileName()).toList();
        }
    }
}
