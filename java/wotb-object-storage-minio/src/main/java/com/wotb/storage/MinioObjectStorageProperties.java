package com.wotb.storage;

/**
 * Connection settings for the MinIO adapter.
 *
 * <p>Every value is supplied by the deployment helper from the process
 * environment. These are runtime-only credentials: they must never be written
 * to the database, to a file, or to a log.
 *
 * <p>The record's implicit {@code toString()} would print the credentials, so this type
 * overrides it and redacts <b>both</b> the access key and the secret key: OpenTofu marks both
 * {@code worker_access_key} and {@code control_api_access_key} as sensitive, and production
 * values come from GitHub Secrets, so neither may appear in a rendered string.
 *
 * @param endpoint              MinIO S3 API as {@code host:port} or an absolute
 *                              HTTP URL, e.g. {@code 10.20.0.2:9000}
 * @param bucket                bucket holding every object this adapter touches
 * @param accessKey             identity access key; MinIO uses it as the IAM user name, and it
 *                              is a runtime credential like the secret, so it is redacted too
 * @param secretKey             identity secret key; never logged
 * @param connectTimeoutSeconds HTTP connect timeout, in whole seconds
 * @param writeTimeoutSeconds   HTTP write timeout, in whole seconds; the read
 *                              timeout reuses this value
 */
public record MinioObjectStorageProperties(
        String endpoint,
        String bucket,
        String accessKey,
        String secretKey,
        int connectTimeoutSeconds,
        int writeTimeoutSeconds) {

    public MinioObjectStorageProperties {
        requireText("endpoint", endpoint);
        requireText("bucket", bucket);
        requireText("accessKey", accessKey);
        requireText("secretKey", secretKey);
        if (connectTimeoutSeconds < 1) {
            throw new IllegalArgumentException("connectTimeoutSeconds must be positive");
        }
        if (writeTimeoutSeconds < 1) {
            throw new IllegalArgumentException("writeTimeoutSeconds must be positive");
        }
    }

    /** Redacts both credentials; the record default would print them in cleartext. */
    @Override
    public String toString() {
        return ("MinioObjectStorageProperties[endpoint=%s, bucket=%s, accessKey=***, secretKey=***,"
                + " connectTimeoutSeconds=%d, writeTimeoutSeconds=%d]")
                .formatted(endpoint, bucket, connectTimeoutSeconds, writeTimeoutSeconds);
    }

    private static void requireText(final String name, final String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
    }
}
