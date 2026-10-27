package com.wotb.web.creator.service;

import com.wotb.web.creator.entity.CreatorAvatar;
import com.wotb.web.creator.repository.CreatorAvatarRepository;
import com.wotb.web.creator.repository.CreatorRepository;
import com.wotb.web.util.CosImageStorage;
import com.wotb.web.util.ImageValidation;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import io.micrometer.observation.annotation.Observed;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

/** Site-owned image ledger; a reservation is internal to one multipart save, never a user asset. */
@Service
public class CreatorAvatarService {
    public static final String OBSERVATION_NAME = "wotb.creator.avatar.upload";
    public static final int MAX_EDGE = 256;
    public static final int MAX_BYTES = 512 * 1024;
    private static final Logger LOG = LoggerFactory.getLogger(CreatorAvatarService.class);
    private final CreatorAvatarRepository avatars;
    private final CreatorRepository creators;
    private final CosImageStorage.Namespace storage;
    private final TransactionTemplate independent;
    private final TransactionTemplate metadataReads;

    public CreatorAvatarService(final CreatorAvatarRepository avatars, final CreatorRepository creators,
                                final CosImageStorage storage, final PlatformTransactionManager transactions,
                                @Value("${wotb.creator.cos.prefix:creator-avatars/}") final String prefix) {
        this.avatars = avatars;
        this.creators = creators;
        this.storage = storage.namespace(prefix, ApiErrorCode.CREATOR_STORAGE_UNAVAILABLE,
                ApiErrorCode.CREATOR_INVALID_REQUEST, ApiErrorCode.CREATOR_STORAGE_UNAVAILABLE,
                ApiErrorCode.CREATOR_AVATAR_NOT_FOUND);
        this.independent = new TransactionTemplate(transactions);
        this.independent.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.metadataReads = new TransactionTemplate(transactions);
        this.metadataReads.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.metadataReads.setReadOnly(true);
    }

    public record AvatarImage(byte[] bytes, String contentType, String hash) { }
    public boolean configured() { return storage.configured(); }

    @Observed(name = OBSERVATION_NAME, contextualName = "creator avatar upload")
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public String upload(final MultipartFile file) {
        if (!configured()) { throw unavailable(); }
        final ImageValidation.Image image = validate(file);
        final String id = UUID.randomUUID().toString();
        independent.executeWithoutResult(tx -> {
            final CreatorAvatar avatar = new CreatorAvatar();
            avatar.id = id; avatar.objectKey = storage.key(id);
            avatar.status = "PENDING"; avatar.contentType = image.contentType();
            avatar.size = image.bytes().length; avatar.hash = image.hash();
            avatar.createdAt = Instant.now(); avatar.unreferencedAt = avatar.createdAt;
            avatars.saveAndFlush(avatar);
        });
        // Commit the ledger first. The avatar row lock protects bounded PUT from a cleanup race,
        // while no directory/creator lock spans the network operation.
        independent.executeWithoutResult(tx -> {
            final CreatorAvatar avatar = locked(id);
            storage.put(avatar.objectKey, image);
            avatar.status = "READY";
        });
        return id;
    }

    /** Caller holds catalog -> creator, in the same transaction as the reference update. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void attach(final String id) {
        final CreatorAvatar avatar = locked(id);
        if (!"READY".equals(avatar.status)) { throw missing(); }
        if (creators.existsByAvatarId(id)) { throw conflict(); }
        avatar.unreferencedAt = null;
    }

    /** Caller flushes removal of the old reference before detaching. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void detach(final String id) {
        if (id == null) { return; }
        final CreatorAvatar avatar = locked(id);
        if (!creators.existsByAvatarId(id)) { avatar.unreferencedAt = Instant.now(); }
    }

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public AvatarImage load(final String id) {
        final CreatorAvatar avatar = metadataReads.execute(tx -> {
            if (id == null) { throw missing(); }
            final CreatorAvatar stored = avatars.findById(id).orElseThrow(CreatorAvatarService::missing);
            if (!"READY".equals(stored.status) || !creators.existsByAvatarId(id)) { throw missing(); }
            return stored;
        });
        if (avatar.size < 1 || avatar.size > MAX_BYTES
                || !("image/png".equals(avatar.contentType) || "image/jpeg".equals(avatar.contentType))) { throw unavailable(); }
        final byte[] bytes = storage.get(avatar.objectKey, MAX_BYTES);
        if (bytes.length != avatar.size || !ImageValidation.sha256(bytes).equals(avatar.hash)) { throw unavailable(); }
        return new AvatarImage(bytes, avatar.contentType, avatar.hash);
    }

    @Scheduled(cron = "0 0 4 * * *", zone = "Asia/Hong_Kong")
    public void cleanup() {
        if (!configured()) { return; }
        final Instant cutoff = Instant.now().minus(24, ChronoUnit.HOURS);
        for (final String id : avatars.findExpiredUnreferenced(cutoff)) {
            try {
                independent.executeWithoutResult(tx -> {
                    final CreatorAvatar avatar = avatars.findLocked(id).orElse(null);
                    if (avatar == null || creators.existsByAvatarId(id)) { return; }
                    final Instant detached = avatar.unreferencedAt == null ? avatar.createdAt : avatar.unreferencedAt;
                    if (!detached.isBefore(cutoff)) { return; }
                    storage.delete(avatar.objectKey);
                    avatars.delete(avatar);
                });
            } catch (final RuntimeException e) {
                LOG.warn("Creator avatar cleanup failed: avatarId={}, type={}", id, e.getClass().getSimpleName());
                try {
                    independent.executeWithoutResult(tx -> {
                        final CreatorAvatar avatar = avatars.findLocked(id).orElse(null);
                        if (avatar != null) { avatar.lastCleanupAttemptAt = Instant.now(); }
                    });
                } catch (final RuntimeException recordingFailure) {
                    LOG.warn("Creator avatar cleanup attempt recording failed: avatarId={}, type={}",
                            id, recordingFailure.getClass().getSimpleName());
                }
            }
        }
    }
    private CreatorAvatar locked(final String id) {
        if (id == null) { throw missing(); }
        return avatars.findLocked(id).orElseThrow(CreatorAvatarService::missing);
    }
    private static ImageValidation.Image validate(final MultipartFile file) {
        if (file == null || file.isEmpty()) { throw invalid(); }
        if (file.getSize() > ImageValidation.MAX_BYTES) { throw new ApiException(ApiErrorCode.FILE_TOO_LARGE); }
        try (final InputStream input = file.getInputStream()) { return ImageValidation.thumbnail(input, MAX_EDGE, MAX_BYTES); }
        catch (final IOException | IllegalArgumentException e) { throw invalid(); }
    }
    private static ApiException unavailable() { return new ApiException(ApiErrorCode.CREATOR_STORAGE_UNAVAILABLE); }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.CREATOR_INVALID_REQUEST); }
    private static ApiException missing() { return new ApiException(ApiErrorCode.CREATOR_AVATAR_NOT_FOUND); }
    private static ApiException conflict() { return new ApiException(ApiErrorCode.CREATOR_CONFIG_CONFLICT); }
}
