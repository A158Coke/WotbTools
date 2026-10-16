package com.wotb.web.tournament.service;

import com.wotb.web.util.CosImageStorage;
import com.wotb.web.util.ImageValidation;
import com.wotb.web.util.apierror.ApiErrorCode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Broadcast policy around the shared, bounded private COS byte adapter. */
@Service
public class BroadcastCosStorage {
    private final CosImageStorage.Namespace namespace;
    public BroadcastCosStorage(final CosImageStorage storage,
                               @Value("${wotb.broadcast.cos.prefix:league-broadcasts/covers/}") final String prefix) {
        this.namespace = storage.namespace(prefix, ApiErrorCode.BROADCAST_STORAGE_UNAVAILABLE,
                ApiErrorCode.BROADCAST_COVER_INVALID, ApiErrorCode.BROADCAST_STORAGE_ERROR, ApiErrorCode.RESOURCE_NOT_FOUND);
    }

    public boolean configured() { return namespace.configured(); }
    public String key(final String id) { return namespace.key(id); }
    public void put(final String objectKey, final ImageValidation.Image image) { namespace.put(objectKey, image); }
    public byte[] get(final String objectKey) { return namespace.get(objectKey); }
    public void delete(final String objectKey) { namespace.delete(objectKey); }
}
