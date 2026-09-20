package com.wotb.storage;

import com.wotb.contracts.ObjectKey;

/**
 * Single source of truth for the object-key layout of MinIO application
 * storage.
 *
 * <p>The only layout is the distributed replay-processing workspace
 * {@code temp/jobs/<jobId>/<relativePath>}. OpenTofu owns that prefix's
 * one-day lifecycle and the prefix-scoped identity policy, so there is exactly
 * one key helper here; callers own everything below the job directory
 * ({@code input/}, {@code artifacts/}, {@code result/}).
 */
public final class ObjectStorageKeys {

    private static final String TEMP_JOB_PREFIX = "temp/jobs/";

    private ObjectStorageKeys() {
    }

    /**
     * Builds the key of one temp-workspace object below {@code temp/jobs/<jobId>/}.
     *
     * @param jobId        job identity; a single path segment
     * @param relativePath caller-owned path below the job directory, such as
     *                     {@code artifacts/0/ai-facts.json}; may contain {@code /}
     * @return traversal-safe key rooted at the fixed {@code temp/jobs/} prefix
     * @throws IllegalArgumentException if a part is blank or could escape or
     *                                  disfigure the fixed prefix
     */
    public static ObjectKey tempJobObject(final String jobId, final String relativePath) {
        return new ObjectKey(TEMP_JOB_PREFIX + jobSegment(jobId) + "/" + requireSafePathPart("relativePath", relativePath));
    }

    private static String jobSegment(final String jobId) {
        final String segment = requireSafePathPart("jobId", jobId);
        if (segment.indexOf('/') >= 0) {
            throw new IllegalArgumentException("jobId must be a single path segment: " + segment);
        }
        return segment;
    }

    /**
     * Rejects every part shape that could escape or disfigure the fixed prefix:
     * blank, backslash, absolute, {@code ..} anywhere, and control characters.
     */
    private static String requireSafePathPart(final String name, final String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        if (value.indexOf('\\') >= 0) {
            throw new IllegalArgumentException(name + " must not contain a backslash: " + value);
        }
        if (value.startsWith("/")) {
            throw new IllegalArgumentException(name + " must not start with '/': " + value);
        }
        if (value.contains("..")) {
            throw new IllegalArgumentException(name + " must not contain '..': " + value);
        }
        if (value.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException(name + " must not contain control characters");
        }
        return value;
    }
}
