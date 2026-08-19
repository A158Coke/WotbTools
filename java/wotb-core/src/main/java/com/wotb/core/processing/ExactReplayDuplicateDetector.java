package com.wotb.core.processing;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public final class ExactReplayDuplicateDetector {

    private ExactReplayDuplicateDetector() {
    }

    public static ExactDuplicatePartition partition(final List<ReplayProcessingResult> results) {
        Objects.requireNonNull(results, "results");
        for (final ReplayProcessingResult r : results) {
            Objects.requireNonNull(r, "results contains null");
        }

        final Map<String, ReplayProcessingResult> originalByHash = new LinkedHashMap<>();
        final List<ReplayProcessingResult> unique = new ArrayList<>();
        final List<ExactReplayDuplicate> duplicates = new ArrayList<>();

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
                duplicates.add(new ExactReplayDuplicate(original, result));
            }
        }

        return new ExactDuplicatePartition(List.copyOf(unique), List.copyOf(duplicates));
    }

    public record ExactDuplicatePartition(
            List<ReplayProcessingResult> uniqueResults,
            List<ExactReplayDuplicate> duplicates
    ) {
        public ExactDuplicatePartition {
            uniqueResults = List.copyOf(Objects.requireNonNull(uniqueResults, "uniqueResults"));
            duplicates = List.copyOf(Objects.requireNonNull(duplicates, "duplicates"));
        }

        public int count() {
            return duplicates.size();
        }

        public List<String> duplicateFileNames() {
            return duplicates.stream().map(d -> d.duplicate().fileName()).toList();
        }
    }
}
