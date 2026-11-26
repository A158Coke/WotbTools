package com.wotb.web.util;

import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** The domain selects a namespace and its existing API errors; only validated keys reach a provider. */
public abstract class PrivateImageStorage {
    private final Set<String> prefixes;

    PrivateImageStorage(final String... candidates) {
        final List<String> safe = Arrays.stream(candidates).filter(p -> p != null
                && p.matches("[a-z0-9][a-z0-9/_-]{0,180}/") && !p.contains("//")).toList();
        // An invalid prefix disables its own namespace. Overlapping valid namespaces disable both.
        final boolean overlap = safe.stream().anyMatch(p -> safe.stream().filter(other -> other.startsWith(p)).count() > 1);
        prefixes = overlap ? Set.of() : Set.copyOf(safe);
    }

    abstract boolean available();
    abstract void putObject(String key, ImageValidation.Image image) throws IOException;
    /** A confirmed missing key returns null. All storage failures throw. */
    abstract byte[] readObject(String key, int maxBytes) throws IOException;
    abstract void deleteObject(String key) throws IOException;

    public Namespace namespace(final String prefix, final ApiErrorCode unavailable, final ApiErrorCode invalid,
                               final ApiErrorCode failure, final ApiErrorCode missing) {
        return new Namespace(prefix, unavailable, invalid, failure, missing);
    }

    public final class Namespace {
        private final String prefix;
        private final ApiErrorCode unavailable;
        private final ApiErrorCode invalid;
        private final ApiErrorCode failure;
        private final ApiErrorCode missing;

        private Namespace(final String prefix, final ApiErrorCode unavailable, final ApiErrorCode invalid,
                          final ApiErrorCode failure, final ApiErrorCode missing) {
            this.prefix = prefix;
            this.unavailable = unavailable;
            this.invalid = invalid;
            this.failure = failure;
            this.missing = missing;
        }
        public boolean configured() { return available() && prefix != null && prefixes.contains(prefix); }

        public String key(final String id) {
            requireConfigured();
            if (!canonicalUuid(id)) { throw new ApiException(invalid); }
            return prefix + id;
        }
        public void put(final String objectKey, final ImageValidation.Image image) {
            checkKey(objectKey);
            try { putObject(objectKey, image); }
            catch (IOException e) { throw new ApiException(failure); }
        }
        public byte[] get(final String objectKey) { return get(objectKey, ImageValidation.MAX_BYTES); }
        public byte[] get(final String objectKey, final int maxBytes) {
            if (maxBytes < 1 || maxBytes > ImageValidation.MAX_BYTES) { throw new IllegalArgumentException("Invalid image bound"); }
            checkKey(objectKey);
            final byte[] bytes;
            try { bytes = readObject(objectKey, maxBytes); }
            catch (IOException e) { throw new ApiException(failure); }
            if (bytes == null) { throw new ApiException(missing); }
            return bytes;
        }
        public void delete(final String objectKey) {
            checkKey(objectKey);
            try { deleteObject(objectKey); }
            catch (IOException e) { throw new ApiException(failure); }
        }
        private void requireConfigured() {
            if (!configured()) { throw new ApiException(unavailable); }
        }
        private void checkKey(final String objectKey) {
            requireConfigured();
            if (objectKey == null || !objectKey.startsWith(prefix) || !canonicalUuid(objectKey.substring(prefix.length()))) {
                throw new ApiException(invalid);
            }
        }
    }

    private static boolean canonicalUuid(final String value) {
        try { return value != null && UUID.fromString(value).toString().equals(value); }
        catch (IllegalArgumentException e) { return false; }
    }
}
