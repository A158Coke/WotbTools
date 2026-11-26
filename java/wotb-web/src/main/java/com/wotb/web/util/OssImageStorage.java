package com.wotb.web.util;

import com.aliyun.sdk.service.oss2.OSSClient;
import com.aliyun.sdk.service.oss2.credentials.StaticCredentialsProvider;
import com.aliyun.sdk.service.oss2.exceptions.OperationException;
import com.aliyun.sdk.service.oss2.exceptions.ServiceException;
import com.aliyun.sdk.service.oss2.models.DeleteObjectRequest;
import com.aliyun.sdk.service.oss2.models.GetObjectRequest;
import com.aliyun.sdk.service.oss2.models.PutObjectRequest;
import com.aliyun.sdk.service.oss2.retry.NopRetryer;
import com.aliyun.sdk.service.oss2.transport.BinaryData;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.io.IOException;

@Component
@ConditionalOnProperty(name = "wotb.images.provider", havingValue = "oss")
public class OssImageStorage extends PrivateImageStorage {
    private final OSSClient client;
    private final String bucket;

    @Autowired
    public OssImageStorage(@Value("${wotb.images.oss.bucket:}") final String bucket,
                           @Value("${wotb.images.oss.region:}") final String region,
                           @Value("${wotb.images.oss.key-id:}") final String keyId,
                           @Value("${wotb.images.oss.key-secret:}") final String keySecret,
                           @Value("${wotb.images.oss.security-token:}") final String token,
                           @Value("${wotb.images.cover-prefix:league-broadcasts/covers/}") final String covers,
                           @Value("${wotb.images.avatar-prefix:creator-avatars/}") final String avatars) {
        super(covers, avatars);
        this.bucket = bucket;
        client = bucket.matches("[a-z0-9][a-z0-9-]{1,61}[a-z0-9]") && region.matches("[a-z0-9]+(?:-[a-z0-9]+)+")
                && StringUtils.hasText(keyId) && StringUtils.hasText(keySecret)
                ? build(region, keyId, keySecret, token, "https://oss-" + region + ".aliyuncs.com", false, 8, 30_000)
                : null;
        org.slf4j.LoggerFactory.getLogger(OssImageStorage.class).info("Business image storage provider=oss, clientConfigured={}", client != null);
    }

    OssImageStorage(final OSSClient client, final String bucket, final String... prefixes) {
        super(prefixes);
        this.client = client;
        this.bucket = bucket;
    }

    static OSSClient build(final String region, final String keyId, final String keySecret, final String token,
                           final String endpoint, final boolean pathStyle, final int connections, final int deadlineMs) {
        final var credentials = StringUtils.hasText(token) ? new StaticCredentialsProvider(keyId, keySecret, token)
                : new StaticCredentialsProvider(keyId, keySecret);
        return OSSClient.newBuilder().region(region).endpoint(endpoint).usePathStyle(pathStyle)
                .credentialsProvider(credentials).retryer(new NopRetryer())
                .httpClient(new OssImageTransport(connections, deadlineMs)).build();
    }

    @Override boolean available() { return client != null; }

    @Override void putObject(final String key, final ImageValidation.Image image) throws IOException {
        try {
            client.putObject(PutObjectRequest.newBuilder().bucket(bucket).key(key).objectAcl("private")
                    .contentType(image.contentType()).body(BinaryData.fromBytes(image.bytes())).build());
        } catch (OperationException e) { throw new IOException("OSS PUT failed"); }
    }

    @Override byte[] readObject(final String key, final int maxBytes) throws IOException {
        try {
            final var object = ScopedValue.where(OssImageTransport.READ_LIMIT, maxBytes).call(() ->
                    client.getObject(GetObjectRequest.newBuilder().bucket(bucket).key(key).build()));
            try (var body = object.body()) {
                if (body == null) { throw new IOException("Empty OSS response"); }
                final byte[] bytes = body.readAllBytes(); // Transport already enforced the namespace's byte bound.
                if (!ImageValidation.matchesContentType(bytes, object.contentType())) {
                    throw new IOException("OSS image content type mismatch");
                }
                return bytes;
            }
        } catch (OperationException e) {
            if (missingKey(e)) { return null; }
            throw new IOException("OSS GET failed");
        }
    }

    @Override void deleteObject(final String key) throws IOException {
        try { client.deleteObject(DeleteObjectRequest.newBuilder().bucket(bucket).key(key).build()); }
        catch (OperationException e) { if (!missingKey(e)) { throw new IOException("OSS DELETE failed"); } }
    }

    private static boolean missingKey(final RuntimeException e) {
        final ServiceException service = ServiceException.asCause(e);
        return service != null && service.statusCode() == 404 && "NoSuchKey".equals(service.errorCode());
    }

    @PreDestroy public void close() throws Exception {
        if (client != null) { client.close(); }
    }
}
