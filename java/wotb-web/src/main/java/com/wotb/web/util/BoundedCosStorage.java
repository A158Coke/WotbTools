package com.wotb.web.util;

import com.qcloud.cos.COSClient;
import com.qcloud.cos.ClientConfig;
import com.qcloud.cos.auth.BasicCOSCredentials;
import com.qcloud.cos.exception.CosClientException;
import com.qcloud.cos.exception.CosServiceException;
import com.qcloud.cos.http.HttpProtocol;
import com.qcloud.cos.model.COSObject;
import com.qcloud.cos.model.COSObjectInputStream;
import com.qcloud.cos.model.ObjectMetadata;
import com.qcloud.cos.region.Region;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.springframework.util.StringUtils;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/** Private, non-versioned COS namespace. No listing, arbitrary URLs, or client-provided object keys. */
public class BoundedCosStorage {
    private static final int REQUEST_TIMEOUT_MS = 30_000;
    private final COSClient client;
    private final String bucket;
    private final String prefix;
    private final ScheduledExecutorService deadlines = Executors.newSingleThreadScheduledExecutor(
            Thread.ofPlatform().daemon().name("cos-image-deadline").factory());

    private final ApiErrorCode unavailable;
    private final ApiErrorCode failure;
    private final ApiErrorCode invalid;

    public BoundedCosStorage(final String bucket, final String region, final String secretId,
                             final String secretKey, final String prefix, final ApiErrorCode unavailable,
                             final ApiErrorCode failure, final ApiErrorCode invalid) {
        this(validNamespace(bucket, region, prefix) && StringUtils.hasText(secretId) && StringUtils.hasText(secretKey)
                ? new COSClient(new BasicCOSCredentials(secretId, secretKey), clientConfig(region)) : null,
                bucket, prefix, unavailable, failure, invalid);
    }

    public BoundedCosStorage(final COSClient client, final String bucket, final String prefix,
                             final ApiErrorCode unavailable, final ApiErrorCode failure, final ApiErrorCode invalid) {
        this.client = client;
        this.bucket = bucket;
        this.prefix = prefix;
        this.unavailable = unavailable;
        this.failure = failure;
        this.invalid = invalid;
    }

    public boolean configured() { return client != null; }

    public String key(final String id) {
        requireConfigured();
        try {
            if (id != null && UUID.fromString(id).toString().equals(id)) { return prefix + id; }
        } catch (final IllegalArgumentException e) {
            throw new ApiException(invalid);
        }
        throw new ApiException(invalid);
    }

    public void put(final String objectKey, final ImageValidation.Image image) {
        checkKey(objectKey);
        final ObjectMetadata metadata = new ObjectMetadata();
        metadata.setContentLength(image.bytes().length);
        metadata.setContentType(image.contentType());
        try {
            client.putObject(bucket, objectKey, new ByteArrayInputStream(image.bytes()), metadata);
        } catch (final CosClientException e) {
            throw new ApiException(failure);
        }
    }

    public byte[] get(final String objectKey) {
        checkKey(objectKey);
        // The SDK deadline ends at response headers for streaming GET. Abort its body as well.
        final AtomicBoolean expired = new AtomicBoolean();
        final AtomicReference<COSObjectInputStream> stream = new AtomicReference<>();
        final var deadline = deadlines.schedule(() -> {
            expired.set(true);
            final COSObjectInputStream input = stream.get();
            if (input != null) { input.abort(); }
        }, REQUEST_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        try (final COSObject object = client.getObject(bucket, objectKey)) {
            if (object == null) { throw new ApiException(failure); }
            final COSObjectInputStream input = object.getObjectContent();
            stream.set(input);
            if (expired.get()) { input.abort(); throw new ApiException(failure); }
            final byte[] bytes = input.readNBytes(ImageValidation.MAX_BYTES + 1);
            if (expired.get() || bytes.length > ImageValidation.MAX_BYTES) {
                input.abort();
                throw new ApiException(failure);
            }
            return bytes;
        } catch (final CosServiceException e) {
            throw new ApiException(e.getStatusCode() == 404
                    ? ApiErrorCode.RESOURCE_NOT_FOUND : failure);
        } catch (final CosClientException | IOException e) {
            throw new ApiException(failure);
        } finally { deadline.cancel(false); }
    }

    public void delete(final String objectKey) {
        checkKey(objectKey);
        try {
            client.deleteObject(bucket, objectKey);
        } catch (final CosServiceException e) {
            if (e.getStatusCode() != 404) { throw new ApiException(failure); }
        } catch (final CosClientException e) {
            throw new ApiException(failure);
        }
    }

    private void requireConfigured() {
        if (!configured()) { throw new ApiException(unavailable); }
    }

    private void checkKey(final String objectKey) {
        requireConfigured();
        if (objectKey == null || !objectKey.startsWith(prefix)) {
            throw new ApiException(invalid);
        }
        final String id = objectKey.substring(prefix.length());
        try {
            if (!UUID.fromString(id).toString().equals(id)) {
                throw new ApiException(invalid);
            }
        } catch (final IllegalArgumentException e) {
            throw new ApiException(invalid);
        }
    }

    private static boolean validNamespace(final String bucket, final String region, final String prefix) {
        return bucket != null && bucket.matches("[a-z0-9][a-z0-9-]{1,49}-[0-9]{5,20}")
                && region != null && region.matches("[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*")
                && prefix != null && prefix.matches("[a-z0-9][a-z0-9/_-]{0,180}/") && !prefix.contains("//");
    }

    public static ClientConfig clientConfig(final String region) {
        final ClientConfig config = new ClientConfig(new Region(region));
        config.setHttpProtocol(HttpProtocol.https);
        config.setConnectionTimeout(5_000);
        config.setConnectionRequestTimeout(5_000);
        config.setSocketTimeout(15_000);
        config.setRequestTimeout(REQUEST_TIMEOUT_MS);
        config.setRequestTimeOutEnable(true);
        config.setMaxErrorRetry(1);
        config.setMaxConnectionsCount(8);
        config.setPrintShutdownStackTrace(false);
        return config;
    }

    public void close() {
        deadlines.shutdownNow();
        if (client != null) { client.shutdown(); }
    }
}
