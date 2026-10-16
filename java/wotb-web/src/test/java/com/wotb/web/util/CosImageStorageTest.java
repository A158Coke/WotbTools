package com.wotb.web.util;

import com.qcloud.cos.COSClient;
import com.qcloud.cos.model.COSObject;
import com.qcloud.cos.model.COSObjectInputStream;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.Test;
import org.apache.http.client.methods.HttpRequestBase;
import java.io.ByteArrayInputStream;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verifyNoInteractions;

class CosImageStorageTest {
    @Test void onlyConfiguredSafeNamespacesAndTheirOwnCanonicalKeysReachCos() {
        final COSClient client = mock(COSClient.class);
        final CosImageStorage storage = new CosImageStorage(client, "images-1251234567", "covers/", "avatars/");
        try {
            final var covers = namespace(storage, "covers/");
            final var avatars = namespace(storage, "avatars/");
            assertTrue(covers.configured()); assertTrue(avatars.configured());
            final String cover = covers.key(UUID.randomUUID().toString());
            assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST,
                    assertThrows(ApiException.class, () -> avatars.delete(cover)).errorCode());
            assertThrows(ApiException.class, () -> avatars.delete("avatars/../covers/"));
            assertThrows(ApiException.class, () -> avatars.key("00000000-0-0-0-0"));
            assertFalse(namespace(storage, "not-configured/").configured());
            assertFalse(namespace(storage, "../unsafe/").configured());
            verifyNoInteractions(client);
        } finally { storage.close(); }
    }
    @Test void collidingNamespacesDisableStorageRatherThanPermitCrossDomainDeletion() {
        final CosImageStorage storage = new CosImageStorage(mock(COSClient.class), "images-1251234567", "same/", "same/");
        try { assertFalse(namespace(storage, "same/").configured()); }
        finally { storage.close(); }
    }
    @Test void avatarReadsAreBoundedIndependentlyOfTheUnchangedCoverLimit() {
        final COSClient client = mock(COSClient.class);
        final CosImageStorage storage = new CosImageStorage(client, "images-1251234567", "covers/", "avatars/");
        final byte[] bytes = new byte[512 * 1024 + 1];
        try {
            when(client.getObject(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenAnswer(call -> {
                final COSObject object = new COSObject();
                object.setObjectContent(new COSObjectInputStream(new ByteArrayInputStream(bytes), mock(HttpRequestBase.class)));
                return object;
            });
            final var avatars = namespace(storage, "avatars/");
            assertEquals(ApiErrorCode.CREATOR_STORAGE_UNAVAILABLE, assertThrows(ApiException.class,
                    () -> avatars.get(avatars.key(UUID.randomUUID().toString()), 512 * 1024)).errorCode());
            final var covers = namespace(storage, "covers/");
            assertArrayEquals(bytes, covers.get(covers.key(UUID.randomUUID().toString())));
        } finally { storage.close(); }
    }
    private static CosImageStorage.Namespace namespace(final CosImageStorage storage, final String prefix) {
        return storage.namespace(prefix, ApiErrorCode.CREATOR_STORAGE_UNAVAILABLE, ApiErrorCode.CREATOR_INVALID_REQUEST,
                ApiErrorCode.CREATOR_STORAGE_UNAVAILABLE, ApiErrorCode.CREATOR_AVATAR_NOT_FOUND);
    }
}
