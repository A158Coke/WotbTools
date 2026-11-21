package com.wotb.web.tournament.service;

import com.wotb.web.tournament.entity.TournamentDay;
import com.wotb.web.tournament.entity.TournamentEvent;
import com.wotb.web.tournament.entity.TournamentEvidence;
import com.wotb.web.tournament.repository.TournamentAuditRepository;
import com.wotb.web.tournament.repository.TournamentDayRepository;
import com.wotb.web.tournament.repository.TournamentEvidenceRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Unused-evidence sweeping and after-commit hooks, extracted from TournamentService.
 * Lock and timing semantics unchanged: the caller owns the event lock and the transaction.
 */
class TournamentEvidenceCleanupSupport {
    private static final Logger LOG = LoggerFactory.getLogger(TournamentEvidenceCleanupSupport.class);
    private final TournamentDayRepository days;
    private final TournamentEvidenceRepository evidence;
    private final TournamentAuditRepository audits;
    private final TournamentEvidenceStorage storage;

    TournamentEvidenceCleanupSupport(final TournamentDayRepository days, final TournamentEvidenceRepository evidence,
                                     final TournamentAuditRepository audits, final TournamentEvidenceStorage storage) {
        this.days = days; this.evidence = evidence; this.audits = audits; this.storage = storage;
    }
    private List<TournamentDay> dayList(final long id) { return days.findByEventIdOrderByRoundNumberAscDayNumberAsc(id); }
    void removeUnusedEvidence(final TournamentEvent event, final boolean immediate) {
        final Set<String> ids = new HashSet<>();
        for (final TournamentDay day : dayList(event.id)) {
            if (day.draftGroups != null) { day.draftGroups.forEach(group -> ids.add(group.evidenceId())); }
            if (day.publishedGroups != null) { day.publishedGroups.forEach(group -> ids.add(group.evidenceId())); }
        }
        ids.addAll(audits.findEvidenceIdsByEventId(event.id));
        final Instant cutoff = Instant.now().minus(24, ChronoUnit.HOURS); final Set<String> retainedHashes = new HashSet<>();
        for (final TournamentEvidence attachment : evidence.findByEventId(event.id)) {
            if (!ids.contains(attachment.id) && (immediate || attachment.createdAt.isBefore(cutoff))) { evidence.delete(attachment); }
            else { retainedHashes.add(attachment.imageHash); }
        }
        // Grace protects rolled-back uploads; draft deletion clears DB references immediately.
        // Scheduled sweeps keep the event lock while deleting unreferenced old files, preventing an
        // upload from reusing an orphan between the reference check and physical removal.
        if (!immediate) { storage.cleanup(event.id, retainedHashes, cutoff); }
    }
    void afterCommit(final Runnable action) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) { action.run(); return; }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                try { action.run(); } catch (final RuntimeException e) { LOG.warn("Tournament evidence cleanup deferred: {}", e.getClass().getSimpleName()); }
            }
        });
    }
}
