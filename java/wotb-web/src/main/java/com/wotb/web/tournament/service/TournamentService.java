package com.wotb.web.tournament.service;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.entity.TournamentAudit;
import com.wotb.web.tournament.entity.TournamentClan;
import com.wotb.web.tournament.entity.TournamentDay;
import com.wotb.web.tournament.entity.TournamentEvent;
import com.wotb.web.tournament.entity.TournamentEvidence;
import com.wotb.web.tournament.entity.TournamentRule;
import com.wotb.web.tournament.entity.TournamentSnapshot;
import com.wotb.web.tournament.mapper.TournamentMapper;
import com.wotb.web.tournament.repository.TournamentAuditRepository;
import com.wotb.web.tournament.repository.TournamentClanRepository;
import com.wotb.web.tournament.repository.TournamentDayRepository;
import com.wotb.web.tournament.repository.TournamentEventRepository;
import com.wotb.web.tournament.repository.TournamentEvidenceRepository;
import com.wotb.web.tournament.repository.TournamentRuleRepository;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/** Every mutation locks the event first. Totals are recomputed from ranks, never incremented. */
@Service
@Transactional
public class TournamentService {
    private static final Logger LOG = LoggerFactory.getLogger(TournamentService.class);
    private final TournamentEventRepository events;
    private final TournamentRuleRepository rules;
    private final TournamentDayRepository days;
    private final TournamentClanRepository clans;
    private final TournamentEvidenceRepository evidence;
    private final TournamentAuditRepository audits;
    private final TournamentMapper mapper;
    private final TournamentEvidenceStorage storage;
    private final byte[] signingKey;

    public TournamentService(final TournamentEventRepository events, final TournamentRuleRepository rules,
                             final TournamentDayRepository days, final TournamentClanRepository clans,
                             final TournamentEvidenceRepository evidence, final TournamentAuditRepository audits,
                             final TournamentMapper mapper, final TournamentEvidenceStorage storage,
                             @Value("${wotb.tournament.recognition-signing-key:}") final String signingKey) {
        this.events = events; this.rules = rules; this.days = days; this.clans = clans;
        this.evidence = evidence; this.audits = audits; this.mapper = mapper; this.storage = storage;
        this.signingKey = signingKey.getBytes(StandardCharsets.UTF_8);
    }
    @Transactional(readOnly = true)
    public List<TournamentDtos.Event> listEvents() {
        return events.findAllByOrderByYearDescIdDesc().stream().map(mapper::toDto).toList();
    }
    @Transactional(readOnly = true)
    public TournamentDtos.Config config(final long id) { return configView(event(id)); }
    public TournamentDtos.Config create(final String actor, final TournamentDtos.CreateRequest request) {
        validateEvent(request.year(), request.region(), request.season(), request.roundCount(), request.daysPerRound(), request.dayLabels());
        if (events.existsByYearAndRegionAndSeason(request.year(), request.region(), request.season())) { throw error(ApiErrorCode.TOURNAMENT_ALREADY_EXISTS); }
        final TournamentEvent event = new TournamentEvent();
        event.year = request.year(); event.region = request.region(); event.season = request.season();
        event.roundCount = request.roundCount(); event.daysPerRound = request.daysPerRound(); event.dayLabels = List.copyOf(request.dayLabels());
        try { events.saveAndFlush(event); }
        catch (final DataIntegrityViolationException e) { throw error(ApiErrorCode.TOURNAMENT_ALREADY_EXISTS); }
        for (int round = 1; round <= event.roundCount; round++) {
            final TournamentRule rule = new TournamentRule(); rule.eventId = event.id; rule.roundNumber = round; rule.days = List.of(); rules.save(rule);
        }
        audit(event, null, null, "CREATE", actor, null, Map.of(), Map.of("year", event.year, "region", event.region, "season", event.season));
        return configView(event);
    }
    public TournamentDtos.Config update(final String actor, final long id, final TournamentDtos.UpdateRequest request) {
        final TournamentEvent event = locked(id, request.expectedVersion());
        validateEvent(request.year(), request.region(), request.season(), request.roundCount(), request.daysPerRound(), request.dayLabels());
        final boolean structureChanged = event.roundCount != request.roundCount() || event.daysPerRound != request.daysPerRound();
        final boolean identityChanged = event.year != request.year() || !event.region.equals(request.region()) || !event.season.equals(request.season());
        if (event.configLocked && (structureChanged || identityChanged)) { throw error(ApiErrorCode.TOURNAMENT_LOCKED); }
        if (identityChanged && events.existsByYearAndRegionAndSeason(request.year(), request.region(), request.season())) { throw error(ApiErrorCode.TOURNAMENT_ALREADY_EXISTS); }
        final Map<String, Object> before = Map.of("event", mapper.toDto(event));
        event.year = request.year(); event.region = request.region(); event.season = request.season(); event.dayLabels = List.copyOf(request.dayLabels());
        if (structureChanged) {
            rules.deleteByEventId(id); rules.flush(); event.roundCount = request.roundCount(); event.daysPerRound = request.daysPerRound();
            for (int round = 1; round <= event.roundCount; round++) {
                final TournamentRule rule = new TournamentRule(); rule.eventId = id; rule.roundNumber = round; rule.days = List.of(); rules.save(rule);
            }
        }
        event.version++;
        audit(event, null, null, "CONFIG_UPDATED", actor, null, before, Map.of("event", mapper.toDto(event)));
        return configView(event);
    }
    public TournamentDtos.Config saveRules(final String actor, final long id, final int round, final TournamentDtos.RuleRequest request) {
        final TournamentEvent event = locked(id, request.expectedEventVersion()); dimension(event, round, 1);
        final TournamentRule rule = rule(id, round); version(rule.rulesVersion, request.expectedRulesVersion());
        if (roundLocked(id, round)) { throw error(ApiErrorCode.TOURNAMENT_LOCKED); }
        final List<TournamentSnapshot.RuleDay> next = normalizeRules(event, request.days());
        final Map<String, Object> before = Map.of("rules", rule.days);
        rule.days = next; rule.rulesVersion++; event.version++;
        for (final TournamentDay day : dayList(id)) {
            if (day.roundNumber == round && day.draftGroups != null) { validateRanksAgainstRules(day.draftGroups, rule, day.dayNumber); day.version++; }
        }
        audit(event, round, null, "RULES_UPDATED", actor, null, before, Map.of("rules", next)); return configView(event);
    }
    @Transactional(readOnly = true)
    public TournamentDtos.Standings publicStandings(final long id) { return standings(event(id), dayList(id), null, null, false); }
    @Transactional(readOnly = true)
    public TournamentDtos.DayView day(final long id, final int round, final int number) {
        final TournamentEvent event = event(id); dimension(event, round, number);
        return dayView(event, existingDay(id, round, number).orElseGet(() -> newDay(id, round, number)), null);
    }
    public TournamentDtos.DayView expectedGroups(final long id, final int round, final int number, final TournamentDtos.ExpectedGroupsRequest request) {
        final TournamentEvent event = locked(id, request.expectedEventVersion()); dimension(event, round, number);
        final TournamentDay day = writableDay(id, round, number, request.expectedDayVersion()); groupCount(request.expectedGroupCount());
        if (day.draftGroups != null && day.draftGroups.size() > request.expectedGroupCount()) { throw error(ApiErrorCode.TOURNAMENT_GROUP_COUNT_MISMATCH); }
        day.expectedGroupCount = request.expectedGroupCount(); event.configLocked = true; changed(event, day); return dayView(event, day, null);
    }
    public TournamentDtos.RecognitionPermit recognitionPermit(final String actor, final long id, final int round, final int number,
                                                              final long eventVersion, final long dayVersion, final long rulesVersion, final MultipartFile file) {
        if (signingKey.length < 32) { throw error(ApiErrorCode.TOURNAMENT_RECOGNITION_UNAVAILABLE); }
        final TournamentEvent event = locked(id, eventVersion); dimension(event, round, number);
        final TournamentDay day = writableDay(id, round, number, dayVersion);
        final TournamentRule rule = readyRule(event, round, rulesVersion); requireExpectedGroups(day);
        final TournamentEvidenceStorage.Image image = storage.validate(file);
        final TournamentEvidence attachment = new TournamentEvidence(); attachment.id = UUID.randomUUID().toString(); attachment.eventId = id;
        attachment.roundNumber = round; attachment.dayNumber = number; attachment.imageHash = image.imageHash(); attachment.contentType = image.contentType(); attachment.createdAt = Instant.now();
        storage.store(id, image); evidence.save(attachment);
        final Instant now = Instant.now(); final Instant expires = now.plus(5, ChronoUnit.MINUTES);
        final JWTClaimsSet claims = new JWTClaimsSet.Builder().issuer("wotbtools-tournament").audience("tournament-recognition")
                .subject(actor).issueTime(Date.from(now)).expirationTime(Date.from(expires)).claim("event_id", id)
                .claim("round_number", round).claim("day_number", number).claim("rules_version", rule.rulesVersion).claim("image_hash", image.imageHash()).build();
        final SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
        try { jwt.sign(new MACSigner(signingKey)); } catch (final JOSEException e) { throw error(ApiErrorCode.TOURNAMENT_RECOGNITION_UNAVAILABLE); }
        return new TournamentDtos.RecognitionPermit(jwt.serialize(), expires, attachment.id, attachment.imageHash);
    }
    public TournamentDtos.DayView preview(final long id, final int round, final int number, final TournamentDtos.DraftRequest request) {
        final TournamentEvent event = locked(id, request.expectedEventVersion()); dimension(event, round, number);
        final TournamentDay day = writableDay(id, round, number, request.expectedDayVersion()); final TournamentRule rule = readyRule(event, round, request.expectedRulesVersion());
        requireExpectedGroups(day); return dayView(event, day, merge(event, day, rule, request));
    }
    public TournamentDtos.DayView saveDraft(final long id, final int round, final int number, final TournamentDtos.DraftRequest request) {
        final TournamentEvent event = locked(id, request.expectedEventVersion()); dimension(event, round, number);
        final TournamentDay day = writableDay(id, round, number, request.expectedDayVersion()); final TournamentRule rule = readyRule(event, round, request.expectedRulesVersion()); requireExpectedGroups(day);
        day.draftGroups = merge(event, day, rule, request);
        for (final String tag : tags(day.draftGroups)) {
            if (!clans.existsByEventIdAndClanTag(id, tag)) { final TournamentClan clan = new TournamentClan(); clan.eventId = id; clan.clanTag = tag; clans.save(clan); }
        }
        event.configLocked = true; changed(event, day); return dayView(event, day, null);
    }
    public TournamentDtos.DayView finalizeDay(final String actor, final long id, final int round, final int number, final TournamentDtos.FinalizeRequest request) {
        final TournamentEvent event = events.findLocked(id).orElseThrow(() -> error(ApiErrorCode.RESOURCE_NOT_FOUND)); dimension(event, round, number);
        final TournamentDay day = existingDay(id, round, number).orElseThrow(() -> error(ApiErrorCode.TOURNAMENT_GROUP_COUNT_MISMATCH));
        if (!StringUtils.hasText(request.idempotencyKey()) || request.idempotencyKey().length() > 64) { throw invalid(); }
        if (day.publicationKeys.contains(request.idempotencyKey())) {
            if (day.draftGroups != null) { throw error(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT); }
            return dayView(event, day, null);
        }
        version(event.version, request.expectedEventVersion()); version(day.version, request.expectedDayVersion()); final TournamentRule rule = readyRule(event, round, request.expectedRulesVersion());
        if (day.publishedGroups != null && !day.correction) { throw error(ApiErrorCode.TOURNAMENT_LOCKED); }
        requireExpectedGroups(day);
        if (day.draftGroups == null || day.draftGroups.size() != day.expectedGroupCount) { throw error(ApiErrorCode.TOURNAMENT_GROUP_COUNT_MISMATCH); }
        validateSnapshot(day.draftGroups); validateRanksAgainstRules(day.draftGroups, rule, number);
        final Map<String, Object> before = Map.of("groups", day.publishedGroups == null ? List.of() : day.publishedGroups); final String reason = day.correctionReason;
        day.publishedGroups = List.copyOf(day.draftGroups); day.draftGroups = null;
        day.publicationKeys = new LinkedHashSet<>(day.publicationKeys); day.publicationKeys.add(request.idempotencyKey()); final String action = day.correction ? "CORRECTION_PUBLISHED" : "DAY_PUBLISHED";
        day.correction = false; day.correctionReason = null; day.correctionStartedAt = null; event.configLocked = true; changed(event, day);
        audit(event, round, number, action, actor, reason, before, Map.of("groups", day.publishedGroups)); return dayView(event, day, null);
    }
    public TournamentDtos.DayView correction(final String actor, final long id, final int round, final int number, final TournamentDtos.CorrectionRequest request) {
        final TournamentEvent event = locked(id, request.expectedEventVersion()); dimension(event, round, number);
        final TournamentDay day = existingDay(id, round, number).orElseThrow(() -> error(ApiErrorCode.RESOURCE_NOT_FOUND));
        version(day.version, request.expectedDayVersion()); reason(request.reason()); groupCount(request.expectedGroupCount());
        if (day.publishedGroups == null || day.correction) { throw error(ApiErrorCode.TOURNAMENT_LOCKED); }
        day.correction = true; day.correctionReason = request.reason().strip(); day.correctionStartedAt = Instant.now(); day.draftGroups = List.of(); day.expectedGroupCount = request.expectedGroupCount(); changed(event, day);
        audit(event, round, number, "CORRECTION_STARTED", actor, request.reason(), Map.of(), Map.of()); return dayView(event, day, null);
    }
    public TournamentDtos.DayView deleteDraft(final long id, final int round, final int number, final TournamentDtos.Versions request) {
        final TournamentEvent event = locked(id, request.expectedEventVersion()); dimension(event, round, number);
        final TournamentDay day = existingDay(id, round, number).orElseThrow(() -> error(ApiErrorCode.RESOURCE_NOT_FOUND)); version(day.version, request.expectedDayVersion());
        day.draftGroups = null; day.correction = false; day.correctionReason = null; day.correctionStartedAt = null;
        if (day.publishedGroups != null) { day.expectedGroupCount = day.publishedGroups.size(); }
        changed(event, day); removeUnusedEvidence(event, true); return dayView(event, day, null);
    }
    public TournamentDtos.Standings clearPoints(final String actor, final long id, final TournamentDtos.ClearRequest request) {
        final TournamentEvent event = locked(id, request.expectedEventVersion());
        dimension(event, request.roundNumber(), request.dayNumber() == null ? 1 : request.dayNumber()); reason(request.reason()); final String tag = clanTag(request.clanTag());
        if (!clans.existsByEventIdAndClanTag(id, tag)) { throw error(ApiErrorCode.RESOURCE_NOT_FOUND); }
        final List<TournamentDay> affected = dayList(id).stream().filter(day -> day.roundNumber == request.roundNumber() && (request.dayNumber() == null || day.dayNumber == request.dayNumber())).toList();
        final int required = request.dayNumber() == null ? event.daysPerRound : 1;
        if (affected.size() != required || affected.stream().anyMatch(day -> day.publishedGroups == null || day.correction)) { throw error(ApiErrorCode.TOURNAMENT_LOCKED); }
        if (affected.stream().noneMatch(day -> day.clearedClans.contains(tag) || tags(day.publishedGroups).contains(tag))) {
            // A draft-only clan must never be exposed by sanctioning an unrelated published day.
            throw error(ApiErrorCode.RESOURCE_NOT_FOUND);
        }
        for (final TournamentDay day : affected) {
            final Set<String> before = Set.copyOf(day.clearedClans); day.clearedClans = new LinkedHashSet<>(day.clearedClans);
            if (request.restore()) { day.clearedClans.remove(tag); } else { day.clearedClans.add(tag); }
            day.version++;
            audit(event, day.roundNumber, day.dayNumber, request.restore() ? "POINTS_RESTORED" : "POINTS_CLEARED", actor, request.reason(), Map.of("clearedClans", before), Map.of("clearedClans", day.clearedClans));
        }
        event.version++; return standings(event, dayList(id), null, null, true);
    }
    @Transactional(readOnly = true)
    public List<TournamentDtos.Audit> auditList(final long id) { event(id); return audits.findByEventIdOrderByIdDesc(id).stream().map(mapper::audit).toList(); }
    @Transactional(readOnly = true)
    public TournamentDtos.EvidenceDownload download(final long id, final String evidenceId) {
        event(id); final TournamentEvidence attachment = evidence.findByIdAndEventId(evidenceId, id).orElseThrow(() -> error(ApiErrorCode.RESOURCE_NOT_FOUND));
        return new TournamentDtos.EvidenceDownload(storage.load(id, attachment.imageHash), attachment.contentType);
    }
    public void deleteEvent(final long id, final TournamentDtos.DeleteRequest request) {
        locked(id, request.expectedVersion()); if (!request.confirm()) { throw invalid(); }
        // Explicit FK order. No cascading into shared replay/user data.
        audits.deleteByEventId(id); evidence.deleteByEventId(id); days.deleteByEventId(id); clans.deleteByEventId(id); rules.deleteByEventId(id); events.deleteById(id);
        afterCommit(() -> storage.deleteEvent(id));
    }
    @Scheduled(fixedDelayString = "PT1H", initialDelayString = "PT1H")
    public void cleanupOrphans() {
        for (final TournamentEvent listed : events.findAllByOrderByYearDescIdDesc()) {
            events.findLocked(listed.id).ifPresent(event -> removeUnusedEvidence(event, false));
        }
        // A failed post-commit event deletion has no remaining DB row to sweep. IDs are never reused;
        // only old directories without an event are retried, inside this feature's own root.
        final Instant cutoff = Instant.now().minus(24, ChronoUnit.HOURS);
        for (final long id : storage.eventDirectories()) {
            if (events.findById(id).isEmpty()) { storage.deleteOldOrphanEvent(id, cutoff); }
        }
    }
    private List<TournamentSnapshot.Group> merge(final TournamentEvent event, final TournamentDay day, final TournamentRule rule, final TournamentDtos.DraftRequest request) {
        if (request.groups() == null || request.confirmedNewClans() == null || request.groups().size() > 10000) { throw invalid(); }
        final Map<Integer, TournamentSnapshot.Group> merged = new LinkedHashMap<>();
        if (day.draftGroups != null) { day.draftGroups.forEach(group -> merged.put(group.groupNumber(), group)); }
        final Set<Integer> incomingNumbers = new HashSet<>();
        for (final TournamentDtos.IncomingGroup incoming : request.groups()) {
            if (incoming == null || incoming.groupNumber() < 1 || incoming.groupNumber() > 10000 || !incomingNumbers.add(incoming.groupNumber()) || incoming.duplicateAction() == null || !Set.of("ERROR", "REPLACE", "SKIP").contains(incoming.duplicateAction())) { throw invalid(); }
            if (merged.containsKey(incoming.groupNumber())) {
                if ("SKIP".equals(incoming.duplicateAction())) { continue; }
                if ("ERROR".equals(incoming.duplicateAction())) { throw new ApiException(ApiErrorCode.TOURNAMENT_DUPLICATE_GROUP, null, Map.of("groupNumber", incoming.groupNumber())); }
            }
            if (!incoming.complete() || incoming.teams() == null || incoming.teams().size() < 3 || incoming.teams().size() > 5 || incoming.evidenceId() == null) { throw invalid(); }
            final TournamentEvidence attachment = evidence.findByIdAndEventId(incoming.evidenceId(), event.id).orElseThrow(() -> error(ApiErrorCode.TOURNAMENT_EVIDENCE_INVALID));
            if (attachment.roundNumber != day.roundNumber || attachment.dayNumber != day.dayNumber || !Objects.equals(attachment.imageHash, incoming.imageHash()) || (day.correction && attachment.createdAt.isBefore(day.correctionStartedAt))) { throw error(ApiErrorCode.TOURNAMENT_EVIDENCE_INVALID); }
            final List<TournamentSnapshot.Team> teams = incoming.teams().stream().map(team -> {
                if (team == null) { throw invalid(); } return new TournamentSnapshot.Team(clanTag(team.clanTag()), team.rank());
            }).sorted(Comparator.comparingInt(TournamentSnapshot.Team::rank)).toList();
            for (int index = 0; index < teams.size(); index++) { if (teams.get(index).rank() != index + 1) { throw invalid(); } }
            merged.put(incoming.groupNumber(), new TournamentSnapshot.Group(incoming.groupNumber(), attachment.id, attachment.imageHash, teams));
        }
        final List<TournamentSnapshot.Group> result = merged.values().stream().sorted(Comparator.comparingInt(TournamentSnapshot.Group::groupNumber)).toList();
        if (result.size() > day.expectedGroupCount) { throw error(ApiErrorCode.TOURNAMENT_GROUP_COUNT_MISMATCH); }
        validateSnapshot(result); validateRanksAgainstRules(result, rule, day.dayNumber);
        final Set<String> known = clans.findByEventIdOrderByClanTag(event.id).stream().map(clan -> clan.clanTag).collect(Collectors.toSet());
        final Set<String> confirmed = request.confirmedNewClans().stream().map(TournamentService::clanTag).collect(Collectors.toSet());
        final List<String> missing = tags(result).stream().filter(tag -> !known.contains(tag) && !confirmed.contains(tag)).sorted().toList();
        if (!missing.isEmpty()) { throw new ApiException(ApiErrorCode.TOURNAMENT_NEW_CLAN_CONFIRMATION_REQUIRED, null, Map.of("clanTags", missing)); }
        return result;
    }
    private void validateSnapshot(final List<TournamentSnapshot.Group> groups) {
        final Set<String> seen = new HashSet<>(); final Set<String> hashes = new HashSet<>();
        for (final TournamentSnapshot.Group group : groups) {
            if (!hashes.add(group.imageHash())) { throw new ApiException(ApiErrorCode.TOURNAMENT_GROUP_CONFLICT, null, Map.of("groupNumber", group.groupNumber())); }
            for (final TournamentSnapshot.Team team : group.teams()) {
                if (!seen.add(team.clanTag())) { throw new ApiException(ApiErrorCode.TOURNAMENT_GROUP_CONFLICT, null, Map.of("clanTag", team.clanTag(), "groupNumber", group.groupNumber())); }
            }
        }
    }
    private void validateRanksAgainstRules(final List<TournamentSnapshot.Group> groups, final TournamentRule rule, final int number) {
        final Map<Integer, Integer> points = rulePoints(rule, number);
        for (final TournamentSnapshot.Group group : groups) {
            for (final TournamentSnapshot.Team team : group.teams()) {
                if (!points.containsKey(team.rank())) { throw new ApiException(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE, null, Map.of("dayNumber", number, "rank", team.rank())); }
            }
        }
    }
    private TournamentDtos.Standings standings(final TournamentEvent event, final List<TournamentDay> storedDays, final TournamentDay previewDay, final List<TournamentSnapshot.Group> preview, final boolean admin) {
        final Map<String, Map<String, Long>> scores = new HashMap<>();
        final Map<String, TournamentDay> dayByKey = storedDays.stream().collect(Collectors.toMap(day -> key(day.roundNumber, day.dayNumber), day -> day));
        if (previewDay != null) { dayByKey.put(key(previewDay.roundNumber, previewDay.dayNumber), previewDay); }
        final List<TournamentDtos.StandingDay> columns = new ArrayList<>();
        final Map<Integer, TournamentRule> ruleByRound = rules.findByEventIdOrderByRoundNumber(event.id).stream().collect(Collectors.toMap(rule -> rule.roundNumber, rule -> rule));
        for (int round = 1; round <= event.roundCount; round++) {
            for (int number = 1; number <= event.daysPerRound; number++) {
                final String key = key(round, number); final TournamentDay day = dayByKey.get(key);
                columns.add(new TournamentDtos.StandingDay(round, number, event.dayLabels.get(number - 1), day != null && day.publishedGroups != null));
                if (day == null) { continue; }
                final List<TournamentSnapshot.Group> selected = previewDay == day && preview != null ? preview : admin && day.draftGroups != null ? day.draftGroups : day.publishedGroups;
                if (selected == null) { continue; }
                final Map<Integer, Integer> points = rulePoints(ruleByRound.get(round), number);
                for (final TournamentSnapshot.Group group : selected) {
                    for (final TournamentSnapshot.Team team : group.teams()) {
                        final Integer value = points.get(team.rank()); if (value == null) { throw error(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE); }
                        scores.computeIfAbsent(team.clanTag(), ignored -> new HashMap<>()).put(key, day.clearedClans.contains(team.clanTag()) ? 0L : value.longValue());
                    }
                }
                for (final String tag : day.clearedClans) { scores.computeIfAbsent(tag, ignored -> new HashMap<>()).put(key, 0L); }
            }
        }
        final List<TournamentDtos.StandingRow> rows = new ArrayList<>();
        for (final Map.Entry<String, Map<String, Long>> entry : scores.entrySet()) {
            long total = 0; final List<TournamentDtos.RoundPoints> roundPoints = new ArrayList<>();
            for (int round = 1; round <= event.roundCount; round++) {
                long roundTotal = 0; final List<TournamentDtos.DayPoints> values = new ArrayList<>();
                for (int number = 1; number <= event.daysPerRound; number++) {
                    final Long value = entry.getValue().get(key(round, number)); values.add(new TournamentDtos.DayPoints(number, value));
                    if (value != null) { roundTotal = Math.addExact(roundTotal, value); }
                }
                total = Math.addExact(total, roundTotal); roundPoints.add(new TournamentDtos.RoundPoints(round, roundTotal, values));
            }
            rows.add(new TournamentDtos.StandingRow(0, entry.getKey(), total, roundPoints));
        }
        rows.sort(Comparator.comparingLong(TournamentDtos.StandingRow::totalPoints).reversed().thenComparing(TournamentDtos.StandingRow::clanTag));
        final List<TournamentDtos.StandingRow> ranked = new ArrayList<>(); long previous = -1; int rank = 0;
        for (int index = 0; index < rows.size(); index++) {
            final TournamentDtos.StandingRow row = rows.get(index); if (row.totalPoints() != previous) { rank = index + 1; previous = row.totalPoints(); }
            ranked.add(new TournamentDtos.StandingRow(rank, row.clanTag(), row.totalPoints(), row.rounds()));
        }
        return new TournamentDtos.Standings(mapper.toDto(event), List.copyOf(columns), List.copyOf(ranked));
    }
    private TournamentDtos.DayView dayView(final TournamentEvent event, final TournamentDay day, final List<TournamentSnapshot.Group> preview) {
        final List<TournamentSnapshot.Group> selected = preview != null ? preview : day.draftGroups != null ? day.draftGroups : day.publishedGroups != null ? day.publishedGroups : List.of();
        final String status = day.correction ? "CORRECTION" : day.publishedGroups != null ? "FINALIZED" : day.draftGroups != null || preview != null ? "DRAFT" : "EMPTY";
        return new TournamentDtos.DayView(event.id, day.roundNumber, day.dayNumber, event.version, rule(event.id, day.roundNumber).rulesVersion,
                day.version, status, day.expectedGroupCount, selected.stream().map(mapper::group).toList(), day.publishedGroups != null,
                standings(event, dayList(event.id), preview == null ? null : day, preview, true));
    }
    private TournamentDtos.Config configView(final TournamentEvent event) {
        return new TournamentDtos.Config(mapper.toDto(event), rules.findByEventIdOrderByRoundNumber(event.id).stream()
                .map(rule -> mapper.round(rule, complete(event, rule), roundLocked(event.id, rule.roundNumber))).toList(),
                clans.findByEventIdOrderByClanTag(event.id).stream().map(clan -> clan.clanTag).toList());
    }
    private TournamentEvent event(final long id) { return events.findById(id).orElseThrow(() -> error(ApiErrorCode.RESOURCE_NOT_FOUND)); }
    private TournamentEvent locked(final long id, final long expected) {
        final TournamentEvent event = events.findLocked(id).orElseThrow(() -> error(ApiErrorCode.RESOURCE_NOT_FOUND)); version(event.version, expected); return event;
    }
    private TournamentRule rule(final long id, final int round) { return rules.findByEventIdAndRoundNumber(id, round).orElseThrow(() -> error(ApiErrorCode.RESOURCE_NOT_FOUND)); }
    private TournamentRule readyRule(final TournamentEvent event, final int round, final long expected) {
        final TournamentRule rule = rule(event.id, round); version(rule.rulesVersion, expected);
        if (!complete(event, rule) || rule.rulesVersion <= 0) { throw error(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE); } return rule;
    }
    private List<TournamentDay> dayList(final long id) { return days.findByEventIdOrderByRoundNumberAscDayNumberAsc(id); }
    private java.util.Optional<TournamentDay> existingDay(final long id, final int round, final int number) { return days.findByEventIdAndRoundNumberAndDayNumber(id, round, number); }
    private TournamentDay writableDay(final long id, final int round, final int number, final long expected) {
        final TournamentDay day = existingDay(id, round, number).orElseGet(() -> newDay(id, round, number)); version(day.version, expected);
        if (day.publishedGroups != null && !day.correction) { throw error(ApiErrorCode.TOURNAMENT_LOCKED); } return day;
    }
    private TournamentDay newDay(final long id, final int round, final int number) {
        final TournamentDay day = new TournamentDay(); day.eventId = id; day.roundNumber = round; day.dayNumber = number; day.clearedClans = Set.of(); day.publicationKeys = Set.of(); return day;
    }
    private void changed(final TournamentEvent event, final TournamentDay day) { day.version++; event.version++; days.save(day); }
    private boolean roundLocked(final long id, final int round) { return dayList(id).stream().anyMatch(day -> day.roundNumber == round && day.publishedGroups != null); }
    private boolean complete(final TournamentEvent event, final TournamentRule rule) {
        if (rule.days.size() != event.daysPerRound) { return false; }
        for (int number = 1; number <= event.daysPerRound; number++) {
            final Map<Integer, Integer> values = rulePoints(rule, number);
            if (!(values.containsKey(1) && values.containsKey(2) && values.containsKey(3) && values.containsKey(4))) { return false; }
        }
        return true;
    }
    private Map<Integer, Integer> rulePoints(final TournamentRule rule, final int number) {
        if (rule == null) { return Map.of(); }
        return rule.days.stream().filter(day -> day.dayNumber() == number).findFirst().map(day -> day.points().stream()
                .collect(Collectors.toMap(TournamentSnapshot.RankPoints::rank, TournamentSnapshot.RankPoints::points))).orElse(Map.of());
    }
    private List<TournamentSnapshot.RuleDay> normalizeRules(final TournamentEvent event, final List<TournamentDtos.RuleDay> input) {
        if (input == null || input.size() > event.daysPerRound) { throw invalid(); }
        final Set<Integer> seenDays = new HashSet<>(); final List<TournamentSnapshot.RuleDay> result = new ArrayList<>();
        for (final TournamentDtos.RuleDay day : input) {
            if (day == null || day.dayNumber() < 1 || day.dayNumber() > event.daysPerRound || !seenDays.add(day.dayNumber()) || day.points() == null || day.points().size() > 5) { throw invalid(); }
            final Set<Integer> ranks = new HashSet<>(); final List<TournamentSnapshot.RankPoints> points = new ArrayList<>();
            for (final TournamentDtos.RankPoints point : day.points()) {
                if (point == null || point.rank() < 1 || point.rank() > 5 || !ranks.add(point.rank()) || point.points() < 0 || point.points() > 1_000_000) { throw invalid(); }
                points.add(new TournamentSnapshot.RankPoints(point.rank(), point.points()));
            }
            points.sort(Comparator.comparingInt(TournamentSnapshot.RankPoints::rank)); result.add(new TournamentSnapshot.RuleDay(day.dayNumber(), List.copyOf(points)));
        }
        result.sort(Comparator.comparingInt(TournamentSnapshot.RuleDay::dayNumber)); return List.copyOf(result);
    }
    private void validateEvent(final int year, final String region, final String season, final int rounds, final int number, final List<String> labels) {
        if (year < 2000 || year > 2100 || region == null || !Set.of("CN", "ASIA", "EU", "NA").contains(region) || season == null
                || !Set.of("SPRING", "SUMMER", "AUTUMN", "WINTER", "FIRE_CUP").contains(season) || rounds < 4 || rounds > 5 || number < 2 || number > 3
                || labels == null || labels.size() != number || labels.stream().anyMatch(label -> !StringUtils.hasText(label) || label.length() > 64)) { throw invalid(); }
    }
    private void dimension(final TournamentEvent event, final int round, final int number) { if (round < 1 || round > event.roundCount || number < 1 || number > event.daysPerRound) { throw invalid(); } }
    private static String clanTag(final String input) {
        if (!StringUtils.hasText(input)) { throw invalid(); } final String stripped = input.strip();
        final String tag = stripped.startsWith("[") && stripped.endsWith("]") ? stripped.substring(1, stripped.length() - 1).strip() : stripped;
        if (!StringUtils.hasText(tag) || tag.codePointCount(0, tag.length()) > 32 || tag.codePoints().anyMatch(Character::isISOControl)) { throw invalid(); } return tag;
    }
    private static Set<String> tags(final List<TournamentSnapshot.Group> groups) { return groups.stream().flatMap(group -> group.teams().stream()).map(TournamentSnapshot.Team::clanTag).collect(Collectors.toSet()); }
    private void requireExpectedGroups(final TournamentDay day) { if (day.expectedGroupCount == null) { throw error(ApiErrorCode.TOURNAMENT_GROUP_COUNT_MISMATCH); } }
    private void groupCount(final int count) { if (count < 1 || count > 10000) { throw invalid(); } }
    private void reason(final String reason) { if (!StringUtils.hasText(reason) || reason.length() > 500) { throw invalid(); } }
    private static void version(final long actual, final long expected) { if (actual != expected || expected < 0) { throw error(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT); } }
    private static String key(final int round, final int day) { return round + ":" + day; }
    private static ApiException invalid() { return error(ApiErrorCode.INVALID_ARGUMENT); }
    private static ApiException error(final ApiErrorCode code) { return new ApiException(code); }
    private void audit(final TournamentEvent event, final Integer round, final Integer number, final String action, final String actor, final String reason, final Map<String, Object> before, final Map<String, Object> after) {
        final TournamentAudit audit = new TournamentAudit(); audit.eventId = event.id; audit.roundNumber = round; audit.dayNumber = number;
        audit.action = action; audit.actor = actor; audit.reason = reason; audit.createdAt = Instant.now(); audit.beforeState = before; audit.afterState = after; audits.save(audit);
    }
    private void removeUnusedEvidence(final TournamentEvent event, final boolean immediate) {
        final Set<String> ids = new HashSet<>();
        for (final TournamentDay day : dayList(event.id)) {
            if (day.draftGroups != null) { day.draftGroups.forEach(group -> ids.add(group.evidenceId())); }
            if (day.publishedGroups != null) { day.publishedGroups.forEach(group -> ids.add(group.evidenceId())); }
        }
        for (final TournamentAudit audit : audits.findByEventIdOrderByIdDesc(event.id)) { evidenceIds(audit.beforeState, ids); evidenceIds(audit.afterState, ids); }
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
    private void evidenceIds(final Object value, final Set<String> ids) {
        if (value instanceof TournamentSnapshot.Group group) { ids.add(group.evidenceId()); }
        else if (value instanceof Map<?, ?> map) {
            if (map.get("evidenceId") instanceof String id) { ids.add(id); } map.values().forEach(child -> evidenceIds(child, ids));
        } else if (value instanceof Iterable<?> items) { items.forEach(child -> evidenceIds(child, ids)); }
    }
    private void afterCommit(final Runnable action) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) { action.run(); return; }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                try { action.run(); } catch (final RuntimeException e) { LOG.warn("Tournament evidence cleanup deferred: {}", e.getClass().getSimpleName()); }
            }
        });
    }
}
