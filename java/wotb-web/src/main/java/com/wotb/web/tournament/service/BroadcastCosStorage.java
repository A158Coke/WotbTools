package com.wotb.web.tournament.service;

import com.qcloud.cos.COSClient;
import com.qcloud.cos.ClientConfig;
import com.wotb.web.util.BoundedCosStorage;
import com.wotb.web.util.ImageValidation;
import com.wotb.web.util.apierror.ApiErrorCode;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Broadcast namespace and errors; shared bounded SDK I/O has no business ownership. */
@Service
public class BroadcastCosStorage {
    private final BoundedCosStorage storage;

    @Autowired
    public BroadcastCosStorage(@Value("${wotb.broadcast.cos.bucket:}") final String bucket,
                               @Value("${wotb.broadcast.cos.region:}") final String region,
                               @Value("${wotb.broadcast.cos.secret-id:}") final String secretId,
                               @Value("${wotb.broadcast.cos.secret-key:}") final String secretKey,
                               @Value("${wotb.broadcast.cos.prefix:league-broadcasts/covers/}") final String prefix) {
        storage = new BoundedCosStorage(bucket, region, secretId, secretKey, prefix,
                ApiErrorCode.BROADCAST_STORAGE_UNAVAILABLE, ApiErrorCode.BROADCAST_STORAGE_ERROR,
                ApiErrorCode.BROADCAST_COVER_INVALID);
    }

    BroadcastCosStorage(final COSClient client, final String bucket, final String prefix) {
        storage = new BoundedCosStorage(client, bucket, prefix, ApiErrorCode.BROADCAST_STORAGE_UNAVAILABLE,
                ApiErrorCode.BROADCAST_STORAGE_ERROR, ApiErrorCode.BROADCAST_COVER_INVALID);
    }

    public boolean configured() { return storage.configured(); }
    public String key(final String id) { return storage.key(id); }
    public void put(final String key, final ImageValidation.Image image) { storage.put(key, image); }
    public byte[] get(final String key) { return storage.get(key); }
    public void delete(final String key) { storage.delete(key); }
    static ClientConfig clientConfig(final String region) { return BoundedCosStorage.clientConfig(region); }
    @PreDestroy public void close() { storage.close(); }
}
