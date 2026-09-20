package com.wotb.storage;

import com.wotb.contracts.ObjectKey;
import com.wotb.contracts.ObjectStorage;
import io.minio.GetObjectArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import io.minio.StatObjectArgs;
import io.minio.errors.ErrorResponseException;
import io.minio.errors.MinioException;
import io.minio.messages.ErrorResponse;
import java.io.IOException;
import java.io.InputStream;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * MinIO adapter for the provider-neutral {@link ObjectStorage} port.
 *
 * <p>No {@code io.minio} type crosses the port boundary: every provider failure
 * is translated into {@link IOException}, so retry and error-code decisions
 * stay with the caller.
 *
 * <p>Objects expire with the {@code temp/jobs/} lifecycle rule owned by OpenTofu; that rule is a
 * bounded backstop, not a cleanup mechanism. The adapter therefore exposes {@code delete} for
 * exactly one key at a time (create rollback) and still exposes no list or prefix operation, so the
 * one-day lifecycle is never the only thing standing between a failed create and a leaked object.
 */
public final class MinioObjectStorage implements ObjectStorage {

    /** S3 error codes that mean "this object does not exist". */
    private static final Set<String> NOT_FOUND_CODES = Set.of("NoSuchKey", "NoSuchObject", "NotFound");

    /** Known object size with SDK auto-detected part size. */
    private static final long AUTO_PART_SIZE = -1L;

    private final String bucket;
    private final MinioClient client;

    public MinioObjectStorage(final MinioObjectStorageProperties properties) {
        final MinioObjectStorageProperties settings = Objects.requireNonNull(properties, "properties");
        this.bucket = settings.bucket();
        this.client = MinioClient.builder()
                .endpoint(httpEndpoint(settings.endpoint()))
                .credentials(settings.accessKey(), settings.secretKey())
                .build();
        this.client.setTimeout(
                TimeUnit.SECONDS.toMillis(settings.connectTimeoutSeconds()),
                TimeUnit.SECONDS.toMillis(settings.writeTimeoutSeconds()),
                TimeUnit.SECONDS.toMillis(settings.writeTimeoutSeconds()));
    }

    /**
     * {@code endpoint} is documented as either {@code host:port} or an absolute HTTP URL, but the
     * SDK accepts only a bare hostname or a full URL: a bare {@code host:port} — the production
     * form, e.g. {@code 10.20.0.2:9000} — is rejected as {@code invalid hostname}. Normalizing here
     * keeps the deployment contract (tofu {@code minio_server} = {@code host:port}) usable as-is.
     */
    private static String httpEndpoint(final String endpoint) {
        return endpoint.startsWith("http://") || endpoint.startsWith("https://")
                ? endpoint
                : "http://" + endpoint;
    }

    /**
     * {@inheritDoc}
     *
     * <p>{@code contentType} is optional: {@code null} leaves the SDK default
     * ({@code application/octet-stream}) in place.
     */
    @Override
    public void put(final ObjectKey key, final InputStream content, final long contentLength, final String contentType)
            throws IOException {
        final ObjectKey target = requireKey(key);
        if (content == null) {
            throw new IllegalArgumentException("content must not be null");
        }
        if (contentLength < 0) {
            throw new IllegalArgumentException("contentLength must not be negative");
        }
        final PutObjectArgs.Builder request = PutObjectArgs.builder()
                .bucket(bucket)
                .object(target.value())
                .stream(content, contentLength, AUTO_PART_SIZE);
        if (contentType != null) {
            request.contentType(contentType);
        }
        try {
            client.putObject(request.build());
        } catch (final MinioException | IOException | NoSuchAlgorithmException | InvalidKeyException error) {
            throw new IOException("MinIO put failed for object " + target.value(), error);
        }
    }

    /**
     * {@inheritDoc}
     *
     * <p>The caller owns the returned stream and must close it.
     */
    @Override
    public InputStream get(final ObjectKey key) throws IOException {
        final ObjectKey target = requireKey(key);
        try {
            return client.getObject(GetObjectArgs.builder().bucket(bucket).object(target.value()).build());
        } catch (final MinioException | IOException | NoSuchAlgorithmException | InvalidKeyException error) {
            throw new IOException("MinIO get failed for object " + target.value(), error);
        }
    }

    /**
     * {@inheritDoc}
     *
     * <p>A missing object reports {@code false}; every other provider failure
     * stays an {@link IOException} so an outage is never read as absence.
     */
    @Override
    public boolean exists(final ObjectKey key) throws IOException {
        final ObjectKey target = requireKey(key);
        try {
            client.statObject(StatObjectArgs.builder().bucket(bucket).object(target.value()).build());
            return true;
        } catch (final ErrorResponseException error) {
            if (isNotFound(error)) {
                return false;
            }
            throw new IOException("MinIO stat failed for object " + target.value(), error);
        } catch (final MinioException | IOException | NoSuchAlgorithmException | InvalidKeyException error) {
            throw new IOException("MinIO stat failed for object " + target.value(), error);
        }
    }

    /**
     * {@inheritDoc}
     *
     * <p>A missing object is success, not an error: the only caller rolls back a partially written
     * set, so some keys legitimately never existed. Every other provider failure — including a
     * refused {@code s3:DeleteObject} — stays an {@link IOException} rather than being reported as
     * "cleaned up".
     */
    @Override
    public void delete(final ObjectKey key) throws IOException {
        final ObjectKey target = requireKey(key);
        try {
            client.removeObject(RemoveObjectArgs.builder().bucket(bucket).object(target.value()).build());
        } catch (final ErrorResponseException error) {
            if (isNotFound(error)) {
                return;
            }
            throw new IOException("MinIO delete failed for object " + target.value(), error);
        } catch (final MinioException | IOException | NoSuchAlgorithmException | InvalidKeyException error) {
            throw new IOException("MinIO delete failed for object " + target.value(), error);
        }
    }

    private static boolean isNotFound(final ErrorResponseException error) {
        final ErrorResponse response = error.errorResponse();
        if (response == null || response.code() == null) {
            return false;
        }
        return NOT_FOUND_CODES.contains(response.code());
    }

    private static ObjectKey requireKey(final ObjectKey key) {
        if (key == null) {
            throw new IllegalArgumentException("key must not be null");
        }
        return key;
    }
}
