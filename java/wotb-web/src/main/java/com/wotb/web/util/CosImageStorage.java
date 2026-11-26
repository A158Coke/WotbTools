package com.wotb.web.util;

import com.qcloud.cos.COSClient;
import com.qcloud.cos.ClientConfig;
import com.qcloud.cos.auth.BasicCOSCredentials;
import com.qcloud.cos.exception.CosServiceException;
import com.qcloud.cos.exception.CosClientException;
import com.qcloud.cos.http.HttpProtocol;
import com.qcloud.cos.model.COSObject;
import com.qcloud.cos.model.COSObjectInputStream;
import com.qcloud.cos.model.ObjectMetadata;
import com.qcloud.cos.region.Region;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/** One private COS client; domain services retain ownership and reservation lifecycles. */
@Component
@ConditionalOnProperty(name = "wotb.images.provider", havingValue = "cos", matchIfMissing = true)
public class CosImageStorage extends PrivateImageStorage {
    private static final int REQUEST_TIMEOUT_MS = 30_000;
    private final COSClient client;
    private final String bucket;
    private final ScheduledExecutorService deadlines = Executors.newSingleThreadScheduledExecutor(
            Thread.ofPlatform().daemon().name("cos-image-deadline").factory());

    @Autowired
    public CosImageStorage(@Value("${wotb.broadcast.cos.bucket:}") final String bucket,
                           @Value("${wotb.broadcast.cos.region:}") final String region,
                           @Value("${wotb.broadcast.cos.secret-id:}") final String secretId,
                           @Value("${wotb.broadcast.cos.secret-key:}") final String secretKey,
                           @Value("${wotb.images.cover-prefix:league-broadcasts/covers/}") final String broadcastPrefix,
                           @Value("${wotb.images.avatar-prefix:creator-avatars/}") final String avatarPrefix) {
        super(broadcastPrefix, avatarPrefix);
        this.bucket = bucket;
        this.client = validBucket(bucket) && region != null && region.matches("[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*")
                && StringUtils.hasText(secretId) && StringUtils.hasText(secretKey)
                ? new COSClient(new BasicCOSCredentials(secretId, secretKey), clientConfig(region)) : null;
        org.slf4j.LoggerFactory.getLogger(CosImageStorage.class).info("Business image storage provider=cos, clientConfigured={}", client != null);
    }

    /** Explicit client injection for loopback tests; production credentials have one configuration source. */
    public CosImageStorage(final COSClient client, final String bucket, final String... prefixes) {
        super(prefixes);
        this.client = validBucket(bucket) ? client : null;
        this.bucket = bucket;
    }

    @Override boolean available() { return client != null; }

    @Override void putObject(final String key, final ImageValidation.Image image) throws IOException {
        final ObjectMetadata metadata = new ObjectMetadata();
        metadata.setContentLength(image.bytes().length);
        metadata.setContentType(image.contentType());
        try { client.putObject(bucket, key, new ByteArrayInputStream(image.bytes()), metadata); }
        catch (CosClientException e) { throw new IOException("COS PUT failed"); }
    }

    @Override byte[] readObject(final String key, final int maxBytes) throws IOException {
        // The COS request timeout ends at headers, so also abort a stalled response body.
        final AtomicBoolean expired = new AtomicBoolean();
        final AtomicReference<COSObjectInputStream> stream = new AtomicReference<>();
        final var deadline = deadlines.schedule(() -> {
            expired.set(true);
            final COSObjectInputStream input = stream.get();
            if (input != null) { input.abort(); }
        }, REQUEST_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        try (final COSObject object = client.getObject(bucket, key)) {
            if (object == null || object.getObjectContent() == null) { throw new IOException("Empty COS response"); }
            final COSObjectInputStream input = object.getObjectContent();
            stream.set(input);
            if (expired.get()) { input.abort(); throw new IOException("COS read timed out"); }
            final byte[] bytes = input.readNBytes(maxBytes + 1);
            if (expired.get() || bytes.length > maxBytes) { input.abort(); throw new IOException("Invalid COS read"); }
            return bytes;
        } catch (CosServiceException e) {
            if (e.getStatusCode() == 404) { return null; }
            throw new IOException("COS GET failed");
        } catch (CosClientException e) { throw new IOException("COS GET failed"); }
        finally { deadline.cancel(false); }
    }

    @Override void deleteObject(final String key) throws IOException {
        try { client.deleteObject(bucket, key); }
        catch (CosServiceException e) { if (e.getStatusCode() != 404) { throw new IOException("COS DELETE failed"); } }
        catch (CosClientException e) { throw new IOException("COS DELETE failed"); }
    }
    private static boolean validBucket(final String bucket) {
        return bucket != null && bucket.matches("[a-z0-9][a-z0-9-]{1,49}-[0-9]{5,20}");
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
