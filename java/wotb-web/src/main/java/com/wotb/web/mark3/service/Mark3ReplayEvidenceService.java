package com.wotb.web.mark3.service;

import com.wotb.web.mark3.dto.Mark3ReplayEvidenceDto;
import com.wotb.web.mark3.entity.Mark3ReplayEvidence;
import com.wotb.web.mark3.repository.Mark3ReplayEvidenceRepository;
import com.wotb.web.mark3.repository.Mark3SubmissionRepository;
import com.wotb.web.replayfile.ReplayDownload;
import com.wotb.web.replayfile.ReplayHashLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

@Service
public class Mark3ReplayEvidenceService {

    private static final Logger log = LoggerFactory.getLogger(Mark3ReplayEvidenceService.class);
    private static final int EVIDENCE_COUNT = 5;

    private final Mark3ReplayStorage storage;
    private final Mark3ReplayEvidenceRepository repository;
    private final Mark3SubmissionRepository submissionRepository;
    private final Mark3Mapper mapper;
    private final ReplayHashLock replayHashLock;

    public Mark3ReplayEvidenceService(
            final Mark3ReplayStorage storage,
            final Mark3ReplayEvidenceRepository repository,
            final Mark3SubmissionRepository submissionRepository,
            final Mark3Mapper mapper,
            final ReplayHashLock replayHashLock) {
        this.storage = storage;
        this.repository = repository;
        this.submissionRepository = submissionRepository;
        this.mapper = mapper;
        this.replayHashLock = replayHashLock;
    }

    public record PendingReplay(
            int slot,
            String originalFilename,
            String sha256,
            long fileSize,
            String arenaId,
            byte[] data
    ) {
    }

    public void storeAll(final List<PendingReplay> replays) {
        final List<String> stored = new ArrayList<>();
        try {
            for (final PendingReplay replay : replays) {
                storage.store(replay.data(), replay.sha256());
                stored.add(replay.sha256());
            }
        } catch (final RuntimeException e) {
            cleanupFilesUnlocked(stored);
            throw e;
        }
    }

    @Transactional
    public void attach(final long submissionId, final List<PendingReplay> replays) {
        for (final PendingReplay replay : replays) {
            final Mark3ReplayEvidence row = new Mark3ReplayEvidence();
            row.setSubmissionId(submissionId);
            row.setSlot(replay.slot());
            row.setOriginalFilename(replay.originalFilename());
            row.setSha256(replay.sha256());
            row.setFileSize(replay.fileSize());
            row.setArenaId(replay.arenaId());
            repository.save(row);
        }
        repository.flush();
    }

    @Transactional
    public void discardForSubmission(final long submissionId) {
        final List<String> hashes = repository.findBySubmissionId(submissionId).stream()
                .map(Mark3ReplayEvidence::getSha256)
                .distinct()
                .toList();
        if (hashes.isEmpty()) {
            return;
        }
        repository.deleteBySubmissionId(submissionId);
        scheduleAfterCommit(() -> cleanupFilesLocked(hashes));
    }

    public void cleanupStoredFiles(final List<String> sha256s) {
        cleanupFilesUnlocked(sha256s);
    }

    @Transactional(readOnly = true)
    public List<Mark3ReplayEvidenceDto> adminListEvidence(final long submissionId) {
        requireSubmission(submissionId);
        return repository.findBySubmissionIdOrderBySlotAsc(submissionId).stream()
                .map(mapper::toReplayEvidenceDto)
                .toList();
    }

    @Transactional(readOnly = true)
    public ReplayDownload downloadEvidence(final long submissionId, final long replayId) {
        requireSubmission(submissionId);
        final Mark3ReplayEvidence row = repository.findBySubmissionIdAndId(submissionId, replayId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "MARK3_REPLAY_EVIDENCE_NOT_FOUND"));
        final Path file = storage.load(row.getSha256())
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "MARK3_REPLAY_FILE_NOT_FOUND"));
        try {
            return new ReplayDownload(Files.readAllBytes(file), row.getOriginalFilename());
        } catch (final IOException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "MARK3_REPLAY_FILE_NOT_FOUND");
        }
    }

    @Transactional(readOnly = true)
    public void requireCompleteEvidenceForApproval(
            final long submissionId,
            final List<String> proofScreenshots) {
        final List<Mark3ReplayEvidence> rows = repository.findBySubmissionIdOrderBySlotAsc(submissionId);
        final boolean slotsComplete = rows.size() == EVIDENCE_COUNT
                && rows.stream().map(Mark3ReplayEvidence::getSlot).sorted().toList()
                .equals(List.of(1, 2, 3, 4, 5));
        if (!slotsComplete || !validScreenshots(proofScreenshots)) {
            throw new IllegalStateException("MARK3_INCOMPLETE_REVIEW_EVIDENCE");
        }
        for (final Mark3ReplayEvidence row : rows) {
            if (storage.load(row.getSha256()).isEmpty()) {
                throw new IllegalStateException("MARK3_REPLAY_FILE_NOT_FOUND");
            }
        }
    }

    private void requireSubmission(final long submissionId) {
        if (!submissionRepository.existsById(submissionId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "MARK3_SUBMISSION_NOT_FOUND");
        }
    }

    private static boolean validScreenshots(final List<String> proofScreenshots) {
        return proofScreenshots != null
                && proofScreenshots.size() >= 1
                && proofScreenshots.size() <= 2
                && proofScreenshots.stream().allMatch(
                        value -> StringUtils.hasText(value) && value.trim().startsWith("data:image/"));
    }

    private void cleanupFilesUnlocked(final List<String> sha256s) {
        for (final String hash : sha256s) {
            cleanupSingle(hash);
        }
    }

    private void cleanupFilesLocked(final List<String> sha256s) {
        for (final String hash : sha256s) {
            replayHashLock.runWithLock(hash, () -> cleanupSingle(hash));
        }
    }

    private void cleanupSingle(final String hash) {
        if (repository.countBySha256(hash) > 0) {
            return;
        }
        try {
            storage.delete(hash);
            log.info("mark3 evidence: replay file {} removed (no remaining reference)", hash);
        } catch (final RuntimeException e) {
            log.warn("mark3 evidence: replay file {} cleanup failed, orphan retained: {}", hash, e.getMessage());
        }
    }

    private static void scheduleAfterCommit(final Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
        } else {
            action.run();
        }
    }
}
