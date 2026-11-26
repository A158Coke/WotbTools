package com.wotb.web.hundred.service;

import com.wotb.web.hundred.dto.HundredReplayEvidenceDto;
import com.wotb.web.hundred.entity.HundredBattleReplayEvidence;
import com.wotb.web.hundred.repository.HundredBattleReplayEvidenceRepository;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import com.wotb.web.replayfile.HallOfFameReplayStorage;
import com.wotb.web.replayfile.HofReplayReferenceCounter;
import com.wotb.web.replayfile.HundredReplayReferenceCounter;
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
public class HundredReplayEvidenceService implements HundredReplayReferenceCounter {

    private static final Logger log = LoggerFactory.getLogger(HundredReplayEvidenceService.class);

    private static final int APPROVAL_EVIDENCE_COUNT = 5;

    private final HallOfFameReplayStorage storage;
    private final HundredBattleReplayEvidenceRepository repository;
    private final HundredBattleSubmissionRepository submissionRepository;
    private final HundredBattleMapper mapper;
    private final HofReplayReferenceCounter hofReplayReferenceCounter;
    private final ReplayHashLock replayHashLock;

    public HundredReplayEvidenceService(final HallOfFameReplayStorage storage,
                                        final HundredBattleReplayEvidenceRepository repository,
                                        final HundredBattleSubmissionRepository submissionRepository,
                                        final HundredBattleMapper mapper,
                                        final HofReplayReferenceCounter hofReplayReferenceCounter,
                                        final ReplayHashLock replayHashLock) {
        this.storage = storage;
        this.repository = repository;
        this.submissionRepository = submissionRepository;
        this.mapper = mapper;
        this.hofReplayReferenceCounter = hofReplayReferenceCounter;
        this.replayHashLock = replayHashLock;
    }

    public record PendingReplay(int slot, String originalFilename, String sha256, long fileSize,
                                String arenaId, byte[] data) {
    }

    public void storeAll(final List<PendingReplay> replays) {
        final List<String> stored = new ArrayList<>();
        try {
            for (final PendingReplay r : replays) {
                storage.store(r.data(), r.sha256());
                stored.add(r.sha256());
            }
        } catch (final RuntimeException e) {
            cleanupFilesUnlocked(stored);
            throw e;
        }
    }

    @Transactional
    public void attach(final long submissionId, final List<PendingReplay> replays) {
        for (final PendingReplay r : replays) {
            final HundredBattleReplayEvidence row = new HundredBattleReplayEvidence();
            row.setSubmissionId(submissionId);
            row.setSlot(r.slot());
            row.setOriginalFilename(r.originalFilename());
            row.setSha256(r.sha256());
            row.setFileSize(r.fileSize());
            row.setArenaId(r.arenaId());
            repository.save(row);
        }
        repository.flush();
    }

    @Transactional
    public void discardForSubmission(final long submissionId) {
        final List<String> hashes = repository.findBySubmissionId(submissionId).stream()
                .map(HundredBattleReplayEvidence::getSha256)
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
    public List<HundredReplayEvidenceDto> adminListEvidence(final long submissionId) {
        requireSubmission(submissionId);
        return repository.findBySubmissionIdOrderBySlotAsc(submissionId).stream()
                .map(mapper::toReplayEvidenceDto)
                .toList();
    }

    @Transactional(readOnly = true)
    public ReplayDownload downloadEvidence(final long submissionId, final long replayId) {
        requireSubmission(submissionId);
        final HundredBattleReplayEvidence row = repository.findBySubmissionIdAndId(submissionId, replayId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "HUNDRED_REPLAY_EVIDENCE_NOT_FOUND"));
        final Path file = storage.load(row.getSha256())
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "HUNDRED_REPLAY_FILE_NOT_FOUND"));
        try {
            return new ReplayDownload(Files.readAllBytes(file), row.getOriginalFilename());
        } catch (final IOException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "HUNDRED_REPLAY_FILE_NOT_FOUND");
        }
    }


    private void requireSubmission(final long submissionId) {
        if (!submissionRepository.existsById(submissionId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "HUNDRED_SUBMISSION_NOT_FOUND");
        }
    }

    @Override
    public long countHundredReferences(final String sha256) {
        return repository.countBySha256(sha256);
    }

    @Transactional(readOnly = true)
    public void requireCompleteEvidenceForApproval(final long submissionId, final String proofScreenshot) {
        final List<HundredBattleReplayEvidence> rows = repository.findBySubmissionIdOrderBySlotAsc(submissionId);
        final boolean slotsComplete = rows.size() == APPROVAL_EVIDENCE_COUNT
                && rows.stream().map(HundredBattleReplayEvidence::getSlot).sorted().toList()
                .equals(List.of(1, 2, 3, 4, 5));
        if (!slotsComplete) {
            throw new IllegalStateException("HUNDRED_INCOMPLETE_REVIEW_EVIDENCE");
        }
        for (final HundredBattleReplayEvidence row : rows) {
            if (storage.load(row.getSha256()).isEmpty()) {
                throw new IllegalStateException("HUNDRED_REPLAY_FILE_NOT_FOUND");
            }
        }
        if (!StringUtils.hasText(proofScreenshot) || !proofScreenshot.trim().startsWith("data:image/")) {
            throw new IllegalStateException("HUNDRED_INCOMPLETE_REVIEW_EVIDENCE");
        }
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
        if (hofReplayReferenceCounter.countHofReferences(hash) > 0) {
            return;
        }
        try {
            storage.delete(hash);
            log.info("hundred evidence: replay file {} removed (no remaining reference)", hash);
        } catch (final RuntimeException e) {
            log.warn("hundred evidence: replay file {} cleanup failed, orphan retained: {}",
                    hash, e.getMessage());
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
