package com.wotb.web.tournament.service;

import com.wotb.web.tournament.entity.BroadcastCover;
import com.wotb.web.tournament.repository.BroadcastCoverRepository;
import com.wotb.web.tournament.repository.BroadcastReplayRepository;
import com.wotb.web.util.ImageValidation;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
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
import java.sql.SQLException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.UUID;

/** Durable reservations survive failed PUTs, process exits, or later replay transaction rollbacks. */
@Service
public class BroadcastCoverService {
    private static final Logger LOG = LoggerFactory.getLogger(BroadcastCoverService.class);
    private final BroadcastCoverRepository covers;
    private final BroadcastReplayRepository replays;
    private final BroadcastCosStorage storage;
    private final TransactionTemplate independent;
    private final TransactionTemplate metadataReads;

    public BroadcastCoverService(final BroadcastCoverRepository covers, final BroadcastReplayRepository replays,
                                 final BroadcastCosStorage storage, final PlatformTransactionManager transactions) {
        this.covers = covers;
        this.replays = replays;
        this.storage = storage;
        this.independent = new TransactionTemplate(transactions);
        this.independent.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.metadataReads = new TransactionTemplate(transactions);
        this.metadataReads.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.metadataReads.setReadOnly(true);
    }

    public record CoverImage(byte[] bytes, String contentType, String hash) { }

    public boolean configured() { return storage.configured(); }

    public String upload(final long seasonId, final MultipartFile file) {
        if (!configured()) { throw new ApiException(ApiErrorCode.BROADCAST_STORAGE_UNAVAILABLE); }
        final ImageValidation.Image image = validate(file);
        final String id = UUID.randomUUID().toString();
        // Commit before any external write. Even an ambiguous successful PUT remains discoverable.
        try {
            independent.executeWithoutResult(tx -> {
                final BroadcastCover cover = new BroadcastCover();
                cover.id = id;
                cover.seasonId = seasonId;
                cover.objectKey = storage.key(id);
                cover.status = "PENDING";
                cover.contentType = image.contentType();
                cover.size = image.bytes().length;
                cover.hash = image.hash();
                cover.createdAt = Instant.now();
                cover.unreferencedAt = cover.createdAt;
                covers.saveAndFlush(cover);
            });
        } catch (final DataIntegrityViolationException e) {
            // The reservation insert has one FK: its season may have been deleted after preflight.
            if (e.getMostSpecificCause() instanceof SQLException sql && "23503".equals(sql.getSQLState())) {
                throw new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND);
            }
            throw e;
        }
        independent.executeWithoutResult(tx -> {
            final BroadcastCover cover = locked(id);
            // No season lock may be acquired while waiting for this bounded COS operation.
            storage.put(cover.objectKey, image);
            cover.status = "READY";
        });
        return id;
    }

    /** Caller holds season first, in the same transaction as the replay insert/update. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void attach(final long seasonId, final String coverId) {
        final BroadcastCover cover = locked(coverId);
        if (!Objects.equals(cover.seasonId, seasonId) || !"READY".equals(cover.status)
                || replays.existsByCoverId(coverId)) {
            throw new ApiException(ApiErrorCode.BROADCAST_COVER_INVALID);
        }
        cover.unreferencedAt = null;
    }

    /** Caller flushes removal of replay references first, still holding its season lock. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void detach(final String coverId) {
        if (coverId == null) { return; }
        final BroadcastCover cover = locked(coverId);
        if (!replays.existsByCoverId(coverId)) { cover.unreferencedAt = Instant.now(); }
    }

    public CoverImage load(final String coverId) {
        final BroadcastCover cover = metadataReads.execute(tx -> {
            if (coverId == null) { throw new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND); }
            final BroadcastCover stored = covers.findById(coverId)
                    .orElseThrow(() -> new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND));
            if (!"READY".equals(stored.status) || !replays.existsByCoverId(coverId)) {
                throw new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND);
            }
            return stored;
        });
        // Only immutable metadata leaves the short read transaction. Public I/O and
        // decoding must never retain a connection or block maintenance on this row.
        final byte[] bytes = storage.get(cover.objectKey);
        try {
            final ImageValidation.Image image = ImageValidation.validate(bytes);
            if (bytes.length != cover.size || !image.hash().equals(cover.hash)
                    || !image.contentType().equals(cover.contentType)) {
                throw new ApiException(ApiErrorCode.BROADCAST_STORAGE_ERROR);
            }
            return new CoverImage(bytes, cover.contentType, cover.hash);
        } catch (final IOException | IllegalArgumentException e) {
            throw new ApiException(ApiErrorCode.BROADCAST_STORAGE_ERROR);
        }
    }

    @Scheduled(fixedDelayString = "PT1H", initialDelayString = "PT1H")
    public void cleanup() {
        if (!configured()) { return; }
        final Instant cutoff = Instant.now().minus(24, ChronoUnit.HOURS);
        for (final String id : covers.findExpiredUnreferenced(cutoff)) {
            try {
                independent.executeWithoutResult(tx -> {
                    final BroadcastCover cover = covers.findLocked(id).orElse(null);
                    if (cover == null || replays.existsByCoverId(id)) { return; }
                    final Instant unreferenced = cover.unreferencedAt == null ? cover.createdAt : cover.unreferencedAt;
                    if (!unreferenced.isBefore(cutoff)) { return; }
                    storage.delete(cover.objectKey);
                    covers.delete(cover);
                });
            } catch (final RuntimeException e) {
                // No SDK message/object path/credentials in diagnostics. Metadata remains for retry.
                LOG.warn("Broadcast cover cleanup failed: coverId={}, type={}", id, e.getClass().getSimpleName());
            }
        }
    }

    private BroadcastCover locked(final String id) {
        if (id == null) { throw new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND); }
        return covers.findLocked(id).orElseThrow(() -> new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND));
    }

    private static ImageValidation.Image validate(final MultipartFile file) {
        if (file == null || file.isEmpty() || file.getSize() > ImageValidation.MAX_BYTES) {
            throw new ApiException(ApiErrorCode.BROADCAST_COVER_INVALID);
        }
        try (final InputStream input = file.getInputStream()) {
            return ImageValidation.read(input);
        } catch (final IOException | IllegalArgumentException e) {
            throw new ApiException(ApiErrorCode.BROADCAST_COVER_INVALID);
        }
    }
}
