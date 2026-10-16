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
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

/** One private COS client; domain services retain ownership and reservation lifecycles. */
@Component
public class CosImageStorage {
    private static final int REQUEST_TIMEOUT_MS = 30_000;
    private final COSClient client;
    private final String bucket;
    private final Set<String> prefixes;
    private final ScheduledExecutorService deadlines = Executors.newSingleThreadScheduledExecutor(
            Thread.ofPlatform().daemon().name("cos-image-deadline").factory());

    @Autowired
    public CosImageStorage(@Value("${wotb.broadcast.cos.bucket:}") final String bucket,
                           @Value("${wotb.broadcast.cos.region:}") final String region,
                           @Value("${wotb.broadcast.cos.secret-id:}") final String secretId,
                           @Value("${wotb.broadcast.cos.secret-key:}") final String secretKey,
                           @Value("${wotb.broadcast.cos.prefix:league-broadcasts/covers/}") final String broadcastPrefix,
                           @Value("${wotb.creator.cos.prefix:creator-avatars/}") final String avatarPrefix) {
        this.bucket = bucket;
        this.prefixes = safePrefixes(broadcastPrefix, avatarPrefix);
        this.client = validBucket(bucket) && region != null && region.matches("[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*")
                && StringUtils.hasText(secretId) && StringUtils.hasText(secretKey) && !prefixes.isEmpty()
                ? new COSClient(new BasicCOSCredentials(secretId, secretKey), clientConfig(region)) : null;
    }

    /** Explicit client injection for loopback tests; production credentials have one configuration source. */
    public CosImageStorage(final COSClient client, final String bucket, final String... prefixes) {
        this.client = validBucket(bucket) ? client : null;
        this.bucket = bucket;
        this.prefixes = safePrefixes(prefixes);
    }

    public Namespace namespace(final String prefix, final ApiErrorCode unavailable, final ApiErrorCode invalid,
                               final ApiErrorCode failure, final ApiErrorCode missing) {
        return new Namespace(prefix, unavailable, invalid, failure, missing);
    }

    /** Only configured, safe prefixes plus canonical UUID keys can reach the SDK. */
    public final class Namespace {
        private final String prefix;
        private final ApiErrorCode unavailable;
        private final ApiErrorCode invalid;
        private final ApiErrorCode failure;
        private final ApiErrorCode missing;

        private Namespace(final String prefix, final ApiErrorCode unavailable, final ApiErrorCode invalid,
                          final ApiErrorCode failure, final ApiErrorCode missing) {
            this.prefix = prefix; this.unavailable = unavailable; this.invalid = invalid;
            this.failure = failure; this.missing = missing;
        }
        public boolean configured() { return client != null && prefix != null && prefixes.contains(prefix); }
        public String key(final String id) {
            requireConfigured();
            if (!uuid(id)) { throw new ApiException(invalid); }
            return prefix + id;
        }
        public void put(final String objectKey, final ImageValidation.Image image) {
            checkKey(objectKey);
            final ObjectMetadata metadata = new ObjectMetadata();
            metadata.setContentLength(image.bytes().length);
            metadata.setContentType(image.contentType());
            try { client.putObject(bucket, objectKey, new ByteArrayInputStream(image.bytes()), metadata); }
            catch (final CosClientException e) { throw new ApiException(failure); }
        }
        public byte[] get(final String objectKey) {
            return get(objectKey, ImageValidation.MAX_BYTES);
        }
        public byte[] get(final String objectKey, final int maxBytes) {
            if (maxBytes < 1 || maxBytes > ImageValidation.MAX_BYTES) { throw new IllegalArgumentException("Invalid image bound"); }
            checkKey(objectKey);
            // The SDK's deadline stops at streaming GET headers, so bound the body too.
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
                if (input == null) { throw new ApiException(failure); }
                stream.set(input);
                if (expired.get()) { input.abort(); throw new ApiException(failure); }
                final byte[] bytes = input.readNBytes(maxBytes + 1);
                if (expired.get() || bytes.length > maxBytes) {
                    input.abort(); throw new ApiException(failure);
                }
                return bytes;
            } catch (final CosServiceException e) {
                throw new ApiException(e.getStatusCode() == 404 ? missing : failure);
            } catch (final CosClientException | IOException e) { throw new ApiException(failure); }
            finally { deadline.cancel(false); }
        }
        public void delete(final String objectKey) {
            checkKey(objectKey);
            try { client.deleteObject(bucket, objectKey); }
            catch (final CosServiceException e) {
                if (e.getStatusCode() != 404) { throw new ApiException(failure); }
            } catch (final CosClientException e) { throw new ApiException(failure); }
        }
        private void requireConfigured() {
            if (!configured()) { throw new ApiException(unavailable); }
        }
        private void checkKey(final String objectKey) {
            requireConfigured();
            if (objectKey == null || !objectKey.startsWith(prefix)
                    || !uuid(objectKey.substring(prefix.length()))) { throw new ApiException(invalid); }
        }
    }
    private static boolean uuid(final String value) {
        try { return value != null && UUID.fromString(value).toString().equals(value); }
        catch (final IllegalArgumentException e) { return false; }
    }
    private static boolean validBucket(final String bucket) {
        return bucket != null && bucket.matches("[a-z0-9][a-z0-9-]{1,49}-[0-9]{5,20}");
    }
    private static Set<String> safePrefixes(final String... candidates) {
        // Equal namespaces would allow cross-domain deletion. Fail closed on collisions.
        final List<String> all = Arrays.asList(candidates);
        if (all.stream().distinct().count() != all.size()) { return Set.of(); }
        return all.stream().filter(prefix -> prefix != null
                        && prefix.matches("[a-z0-9][a-z0-9/_-]{0,180}/") && !prefix.contains("//"))
                .collect(Collectors.toUnmodifiableSet());
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
    @PreDestroy
    public void close() {
        deadlines.shutdownNow();
        if (client != null) { client.shutdown(); }
    }
}
