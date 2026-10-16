package com.wotb.web.creator.service;

import com.wotb.web.creator.dto.CreatorDtos;
import com.wotb.web.creator.entity.CreatorAvatar;
import com.wotb.web.creator.mapper.CreatorMapper;
import com.wotb.web.creator.repository.CreatorAvatarRepository;
import com.wotb.web.creator.repository.CreatorRepository;
import com.wotb.web.creator.repository.CreatorSettingsRepository;
import com.wotb.web.util.CosImageStorage;
import com.wotb.web.util.ImageValidation;
import com.wotb.web.util.JwtUtil;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
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
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.UUID;

/** Avatar reservations own their lifecycle; external I/O never takes directory or creator locks. */
@Service
public class CreatorAvatarService {
    private static final Logger LOG = LoggerFactory.getLogger(CreatorAvatarService.class);
    private final CreatorAvatarRepository avatars;
    private final CreatorRepository creators;
    private final CreatorSettingsRepository settings;
    private final CosImageStorage.Namespace storage;
    private final TransactionTemplate independent;
    private final TransactionTemplate metadataReads;

    public CreatorAvatarService(final CreatorAvatarRepository avatars, final CreatorRepository creators,
                                final CreatorSettingsRepository settings,
                                final CosImageStorage storage, final PlatformTransactionManager transactions,
                                @Value("${wotb.creator.cos.prefix:creator-avatars/}") final String prefix) {
        this.avatars = avatars; this.creators = creators;
        this.settings = settings;
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

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public CreatorDtos.Avatar upload(final MultipartFile file) {
        final String subject = subject();
        if (!configured()) { throw unavailable(); }
        final ImageValidation.Image image = validate(file);
        final String id = UUID.randomUUID().toString();
        independent.executeWithoutResult(tx -> {
            // Serialize reservation insertion with the account deletion's metadata scan.
            settings.findShared();
            final CreatorAvatar avatar = new CreatorAvatar();
            avatar.id = id; avatar.subject = subject; avatar.objectKey = storage.key(id);
            avatar.status = "PENDING"; avatar.contentType = image.contentType();
            avatar.size = image.bytes().length; avatar.hash = image.hash();
            avatar.createdAt = Instant.now(); avatar.unreferencedAt = avatar.createdAt;
            avatars.saveAndFlush(avatar);
        });
        // A committed reservation survives a failed/ambiguous PUT or a process exit.
        independent.executeWithoutResult(tx -> {
            final CreatorAvatar avatar = locked(id);
            // Account deletion can de-identify the committed reservation before PUT begins.
            if (!Objects.equals(avatar.subject, subject)) { throw missing(); }
            storage.put(avatar.objectKey, image);
            avatar.status = "READY";
        });
        return new CreatorDtos.Avatar(id, CreatorMapper.avatarUrl(id));
    }

    /** Called under settings -> creator, in the same transaction as the reference update. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void attach(final String id) {
        final CreatorAvatar avatar = locked(id);
        if (!Objects.equals(avatar.subject, subject()) || !"READY".equals(avatar.status)) { throw missing(); }
        if (creators.existsByAvatarId(id)) { throw conflict(); }
        avatar.unreferencedAt = null;
    }

    /** Caller flushes the old reference removal before detaching. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void detach(final String id) {
        if (id == null) { return; }
        final CreatorAvatar avatar = locked(id);
        if (!creators.existsByAvatarId(id)) { avatar.unreferencedAt = Instant.now(); }
    }

    /** Caller holds settings WRITE and any creator locks; no external deletes before account commit. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void removeOwnerForAccountDeletion(final String subject) {
        for (final CreatorAvatar avatar : avatars.findOwnedLocked(subject)) { avatar.subject = null; }
        avatars.flush();
    }

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void release(final String id) {
        final String subject = subject();
        independent.executeWithoutResult(tx -> {
            final CreatorAvatar avatar = locked(id);
            if (!Objects.equals(avatar.subject, subject)) { throw missing(); }
            if (creators.existsByAvatarId(id)) { throw conflict(); }
            storage.delete(avatar.objectKey);
            avatars.delete(avatar);
        });
    }

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public AvatarImage load(final String id) {
        final CreatorAvatar avatar = metadataReads.execute(tx -> {
            if (id == null) { throw missing(); }
            final CreatorAvatar stored = avatars.findById(id).orElseThrow(CreatorAvatarService::missing);
            if (!"READY".equals(stored.status) || !creators.existsByAvatarId(id)) { throw missing(); }
            return stored;
        });
        final byte[] bytes = storage.get(avatar.objectKey);
        try {
            final ImageValidation.Image image = ImageValidation.validate(bytes);
            if (bytes.length != avatar.size || !image.hash().equals(avatar.hash)
                    || !image.contentType().equals(avatar.contentType)) { throw unavailable(); }
            return new AvatarImage(bytes, avatar.contentType, avatar.hash);
        } catch (final IOException | IllegalArgumentException e) { throw unavailable(); }
    }

    @Scheduled(fixedDelayString = "PT1H", initialDelayString = "PT1H")
    public void cleanup() {
        if (!configured()) { return; }
        final Instant cutoff = Instant.now().minus(24, ChronoUnit.HOURS);
        for (final String id : avatars.findExpiredUnreferenced(cutoff)) {
            try {
                independent.executeWithoutResult(tx -> {
                    final CreatorAvatar avatar = avatars.findLocked(id).orElse(null);
                    // Plain EXISTS reads do not lock creators or reverse the business write order.
                    if (avatar == null || creators.existsByAvatarId(id)) { return; }
                    final Instant detached = avatar.unreferencedAt == null ? avatar.createdAt : avatar.unreferencedAt;
                    if (avatar.subject != null && !detached.isBefore(cutoff)) { return; }
                    storage.delete(avatar.objectKey);
                    avatars.delete(avatar);
                });
            } catch (final RuntimeException e) {
                LOG.warn("Creator avatar cleanup failed: avatarId={}, type={}", id, e.getClass().getSimpleName());
                try {
                    // The failed delete transaction rolled back. Persist rotation separately so
                    // a full batch of permanently invalid objects cannot starve later candidates.
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
    private static String subject() {
        final String subject = JwtUtil.requireUserId();
        if (!StringUtils.hasText(subject) || subject.length() > 64) { throw new ApiException(ApiErrorCode.AUTH_UNAUTHENTICATED); }
        return subject;
    }
    private static ImageValidation.Image validate(final MultipartFile file) {
        if (file == null || file.isEmpty() || file.getSize() > ImageValidation.MAX_BYTES) { throw invalid(); }
        try (final InputStream input = file.getInputStream()) { return ImageValidation.read(input); }
        catch (final IOException | IllegalArgumentException e) { throw invalid(); }
    }
    private static ApiException unavailable() { return new ApiException(ApiErrorCode.CREATOR_STORAGE_UNAVAILABLE); }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.CREATOR_INVALID_REQUEST); }
    private static ApiException missing() { return new ApiException(ApiErrorCode.CREATOR_AVATAR_NOT_FOUND); }
    private static ApiException conflict() { return new ApiException(ApiErrorCode.CREATOR_CONFIG_CONFLICT); }
}
