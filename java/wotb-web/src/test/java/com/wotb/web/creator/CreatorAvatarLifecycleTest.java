package com.wotb.web.creator;

import com.wotb.web.creator.entity.CreatorAvatar;
import com.wotb.web.creator.repository.CreatorAvatarRepository;
import com.wotb.web.creator.repository.CreatorRepository;
import com.wotb.web.creator.service.CreatorAvatarService;
import com.wotb.web.util.CosImageStorage;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Avatar ledger state machine without Docker: attach/detach reference bookkeeping and the
 * cleanup invariant that a referenced avatar is never physically deleted. */
class CreatorAvatarLifecycleTest {
    private final CreatorAvatarRepository avatars = mock(CreatorAvatarRepository.class);
    private final CreatorRepository creators = mock(CreatorRepository.class);
    private final CosImageStorage storage = mock(CosImageStorage.class);
    private final CosImageStorage.Namespace namespace = mock(CosImageStorage.Namespace.class);
    private final PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
    private final Map<String, CreatorAvatar> rows = new HashMap<>();
    private CreatorAvatarService service;

    @BeforeEach
    void setup() {
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(storage.namespace(anyString(), any(), any(), any(), any())).thenReturn(namespace);
        when(namespace.configured()).thenReturn(true);
        when(avatars.findLocked(anyString())).thenAnswer(call -> Optional.ofNullable(rows.get(call.getArgument(0))));
        when(avatars.findById(anyString())).thenAnswer(call -> Optional.ofNullable(rows.get(call.getArgument(0))));
        doAnswer(call -> rows.remove(((CreatorAvatar) call.getArgument(0)).id)).when(avatars).delete(any(CreatorAvatar.class));
        service = new CreatorAvatarService(avatars, creators, storage, transactions, "creator-avatars/");
    }

    private CreatorAvatar avatar(final String id, final String status, final Instant createdAt, final Instant unreferencedAt) {
        final CreatorAvatar row = new CreatorAvatar();
        row.id = id; row.objectKey = "creator-avatars/" + id; row.status = status; row.contentType = "image/png";
        row.size = 10; row.hash = "h".repeat(64); row.createdAt = createdAt; row.unreferencedAt = unreferencedAt;
        rows.put(id, row);
        return row;
    }

    @Test
    void attachRejectsAvatarsThatNeverReachedReady() {
        avatar("pending", "PENDING", Instant.now(), Instant.now());
        final ApiException error = assertThrows(ApiException.class, () -> service.attach("pending"));
        assertEquals(ApiErrorCode.CREATOR_AVATAR_NOT_FOUND, error.errorCode());
        assertNotNull(rows.get("pending").unreferencedAt);
    }

    @Test
    void attachClearsTheUnreferencedMarkerButRejectsAnAvatarAlreadyInUse() {
        final CreatorAvatar ready = avatar("ready", "READY", Instant.now(), Instant.now());
        when(creators.existsByAvatarId("ready")).thenReturn(false);
        service.attach("ready");
        assertNull(ready.unreferencedAt);
        when(creators.existsByAvatarId("ready")).thenReturn(true);
        final ApiException error = assertThrows(ApiException.class, () -> service.attach("ready"));
        assertEquals(ApiErrorCode.CREATOR_CONFIG_CONFLICT, error.errorCode());
    }

    @Test
    void detachOnlyMarksAvatarsNoLongerReferencedByAnyCreator() {
        final CreatorAvatar referenced = avatar("ref", "READY", Instant.now(), null);
        when(creators.existsByAvatarId("ref")).thenReturn(true);
        service.detach("ref");
        assertNull(referenced.unreferencedAt);
        final CreatorAvatar orphan = avatar("orphan", "READY", Instant.now(), null);
        when(creators.existsByAvatarId("orphan")).thenReturn(false);
        service.detach("orphan");
        assertNotNull(orphan.unreferencedAt);
        service.detach(null);
    }

    @Test
    void cleanupNeverDeletesAnAvatarThatIsStillReferenced() {
        final CreatorAvatar referenced = avatar("in-use", "READY", Instant.now().minusSeconds(90_000), Instant.now().minusSeconds(90_000));
        when(avatars.findExpiredUnreferenced(any(Instant.class))).thenReturn(List.of("in-use"));
        when(creators.existsByAvatarId("in-use")).thenReturn(true);
        service.cleanup();
        assertTrue(rows.containsKey("in-use"));
        verify(namespace, never()).delete(anyString());
        verify(avatars, never()).delete(any(CreatorAvatar.class));
        assertNull(referenced.lastCleanupAttemptAt);
    }

    @Test
    void cleanupDeletesOnlyUnreferencedAvatarsDetachedBeforeTheCutoff() {
        final CreatorAvatar expired = avatar("expired", "READY", Instant.now().minusSeconds(90_000), Instant.now().minusSeconds(90_000));
        final CreatorAvatar recent = avatar("recent", "READY", Instant.now().minusSeconds(90_000), Instant.now().minusSeconds(3_600));
        when(avatars.findExpiredUnreferenced(any(Instant.class))).thenReturn(List.of("expired", "recent"));
        when(creators.existsByAvatarId(anyString())).thenReturn(false);
        service.cleanup();
        assertEquals("creator-avatars/expired", verifyDeleted(expired));
        assertNotNull(rows.get("recent"));
        verify(namespace, never()).delete(eq("creator-avatars/recent"));
        verify(avatars, never()).delete(recent);
    }

    private String verifyDeleted(final CreatorAvatar avatar) {
        verify(namespace).delete(avatar.objectKey);
        verify(avatars).delete(avatar);
        return avatar.objectKey;
    }

    @Test
    void uploadReturnsThePersistedLedgerIdAndRespectsTheConfiguredGate() throws Exception {
        final byte[] png = png(16, 16);
        final org.springframework.mock.web.MockMultipartFile file =
                new org.springframework.mock.web.MockMultipartFile("image", "a.png", "image/png", png);
        when(namespace.key(anyString())).thenAnswer(call -> "creator-avatars/" + call.getArgument(0));
        when(avatars.saveAndFlush(any(CreatorAvatar.class))).thenAnswer(call -> {
            final CreatorAvatar saved = call.getArgument(0);
            rows.put(saved.id, saved);
            return saved;
        });
        final String id = service.upload(file);
        assertNotNull(id);
        assertEquals("READY", rows.get(id).status);
        assertNotNull(rows.get(id).hash);
        when(namespace.configured()).thenReturn(false);
        final ApiException error = assertThrows(ApiException.class, () -> service.upload(file));
        assertEquals(ApiErrorCode.CREATOR_STORAGE_UNAVAILABLE, error.errorCode());
    }

    private static byte[] png(final int width, final int height) throws Exception {
        final java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(width, height, java.awt.image.BufferedImage.TYPE_INT_RGB), "png", bytes);
        return bytes.toByteArray();
    }
}
