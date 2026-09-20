package com.wotb.storage;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.contracts.ObjectKey;
import com.wotb.contracts.ObjectStorage;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.StatObjectArgs;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MinIOContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * Real-MinIO contract for the {@link ObjectStorage} adapter.
 *
 * <p>The community {@code minio/minio} repository no longer exists on Docker Hub,
 * so the maintained Quay mirror is pinned explicitly instead of relying on the
 * Testcontainers default image. {@code asCompatibleSubstituteFor} keeps
 * {@link MinIOContainer} usable with that registry.
 *
 * <p>Identity and prefix-permission isolation is deliberately not asserted here:
 * this container exposes only root credentials and MinIO's IAM policy API is not
 * part of the port. That isolation is asserted by the OpenTofu plan policy plus
 * the CI MinIO smoke against applied state.
 */
@Testcontainers(disabledWithoutDocker = true)
class MinioObjectStorageTest {

    private static final String MINIO_IMAGE = "quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z";
    private static final String BUCKET = "wotbtools-temp";
    private static final String OTHER_BUCKET = "wotbtools-temp-absent";
    private static final String ACCESS_KEY = "wotbtools-temp-ci";
    private static final String SECRET_KEY = "wotbtools-temp-ci-secret";
    private static final String JOB_ID = "0f9c2f4e-1e6a-4d0c-9f2b-7d3a5c1b8e21";

    @Container
    private static final MinIOContainer MINIO = new MinIOContainer(
            DockerImageName.parse(MINIO_IMAGE).asCompatibleSubstituteFor("minio/minio"))
            .withUserName(ACCESS_KEY)
            .withPassword(SECRET_KEY);

    private static ObjectStorage storage;

    @BeforeAll
    static void provisionBucket() throws Exception {
        try (MinioClient client = rootClient()) {
            client.makeBucket(MakeBucketArgs.builder().bucket(BUCKET).build());
        }
        storage = new MinioObjectStorage(properties(BUCKET));
    }

    @Test
    void putThenGetRoundTripsTheExactBytes() throws IOException {
        final byte[] payload = "{\"artifactId\":\"ai-facts\"}".getBytes(StandardCharsets.UTF_8);
        final ObjectKey key = ObjectStorageKeys.tempJobObject(JOB_ID, "artifacts/0/ai-facts.json");

        storage.put(key, new ByteArrayInputStream(payload), payload.length, "application/json");

        try (InputStream stored = storage.get(key)) {
            assertArrayEquals(payload, stored.readAllBytes());
        }
    }

    @Test
    void putWithoutContentTypeStillRoundTrips() throws IOException {
        final byte[] payload = "replay-input".getBytes(StandardCharsets.UTF_8);
        final ObjectKey key = ObjectStorageKeys.tempJobObject(JOB_ID, "input/0/round.wotbreplay");

        storage.put(key, new ByteArrayInputStream(payload), payload.length, null);

        try (InputStream stored = storage.get(key)) {
            assertArrayEquals(payload, stored.readAllBytes());
        }
    }

    @Test
    void explicitContentTypeIsStored() throws Exception {
        final byte[] payload = "{\"sourceIndex\":0}".getBytes(StandardCharsets.UTF_8);
        final ObjectKey key = ObjectStorageKeys.tempJobObject(JOB_ID, "result/source-0.json");

        storage.put(key, new ByteArrayInputStream(payload), payload.length, "application/json");

        try (MinioClient client = rootClient()) {
            final String contentType = client
                    .statObject(StatObjectArgs.builder().bucket(BUCKET).object(key.value()).build())
                    .contentType();
            assertTrue(contentType.startsWith("application/json"), contentType);
        }
    }

    @Test
    void existsReportsStoredObjectsAndMissingObjects() throws IOException {
        final byte[] payload = "artifact".getBytes(StandardCharsets.UTF_8);
        final ObjectKey present = ObjectStorageKeys.tempJobObject(JOB_ID, "artifacts/0/map-overview.json");
        final ObjectKey absent = ObjectStorageKeys.tempJobObject(JOB_ID, "artifacts/0/never-written.json");

        assertFalse(storage.exists(absent));

        storage.put(present, new ByteArrayInputStream(payload), payload.length, null);

        assertTrue(storage.exists(present));
        assertFalse(storage.exists(absent));
    }

    @Test
    void deleteRemovesExactlyTheGivenKeyAndIsIdempotent() throws IOException {
        final byte[] payload = "input".getBytes(StandardCharsets.UTF_8);
        final ObjectKey target = ObjectStorageKeys.tempJobObject(JOB_ID, "input/0/a.wotbreplay");
        final ObjectKey neighbour = ObjectStorageKeys.tempJobObject(JOB_ID, "input/1/b.wotbreplay");
        storage.put(target, new ByteArrayInputStream(payload), payload.length, null);
        storage.put(neighbour, new ByteArrayInputStream(payload), payload.length, null);

        storage.delete(target);

        assertFalse(storage.exists(target));
        assertTrue(storage.exists(neighbour), "delete 是键级的：绝不能碰到同一 job 的其它对象");
        // 幂等是契约的一部分：回滚一批半途写入时，部分键从未创建过。
        storage.delete(target);
    }

    @Test
    void getOfMissingObjectIsAnIoException() {
        final ObjectKey absent = ObjectStorageKeys.tempJobObject(JOB_ID, "result/never-written.json");

        assertThrows(IOException.class, () -> storage.get(absent));
    }

    @Test
    void existsOfAbsentBucketIsAnIoExceptionNotAbsence() {
        final ObjectStorage missingBucket = new MinioObjectStorage(properties(OTHER_BUCKET));

        assertThrows(IOException.class, () -> missingBucket.exists(
                ObjectStorageKeys.tempJobObject(JOB_ID, "artifacts/0/ai-facts.json")));
    }

    @Test
    void rejectsInvalidArgumentsBeforeTouchingMinio() {
        final ObjectKey key = ObjectStorageKeys.tempJobObject(JOB_ID, "artifacts/0/ai-facts.json");

        assertThrows(IllegalArgumentException.class,
                () -> storage.put(null, new ByteArrayInputStream(new byte[1]), 1, null));
        assertThrows(IllegalArgumentException.class, () -> storage.put(key, null, 1, null));
        assertThrows(IllegalArgumentException.class,
                () -> storage.put(key, new ByteArrayInputStream(new byte[1]), -1, null));
        assertThrows(IllegalArgumentException.class, () -> storage.get(null));
        assertThrows(IllegalArgumentException.class, () -> storage.exists(null));
    }

    private static MinioClient rootClient() {
        return MinioClient.builder()
                .endpoint(MINIO.getS3URL())
                .credentials(MINIO.getUserName(), MINIO.getPassword())
                .build();
    }

    private static MinioObjectStorageProperties properties(final String bucket) {
        return new MinioObjectStorageProperties(
                MINIO.getS3URL(), bucket, MINIO.getUserName(), MINIO.getPassword(), 10, 30);
    }
}
