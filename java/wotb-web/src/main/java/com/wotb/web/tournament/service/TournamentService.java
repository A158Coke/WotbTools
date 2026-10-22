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
import com.wotb.web.tournament.entity.TournamentDefaultRules;
import com.wotb.web.tournament.entity.TournamentEvent;
import com.wotb.web.tournament.entity.TournamentEvidence;
import com.wotb.web.tournament.entity.TournamentRule;
import com.wotb.web.tournament.entity.TournamentSnapshot;
import com.wotb.web.tournament.mapper.TournamentMapper;
import com.wotb.web.tournament.repository.TournamentAuditRepository;
import com.wotb.web.tournament.repository.TournamentClanRepository;
import com.wotb.web.tournament.repository.TournamentDayRepository;
import com.wotb.web.tournament.repository.TournamentDefaultRulesRepository;
import com.wotb.web.tournament.repository.TournamentEventRepository;
import com.wotb.web.tournament.repository.TournamentEvidenceRepository;
import com.wotb.web.tournament.repository.TournamentRuleRepository;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import com.wotb.web.util.csv.CsvDecoder;
import com.wotb.web.util.csv.CsvEncodingException;
import com.wotb.web.util.csv.CsvSyntaxException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/** Every mutation locks the event first. Totals are recomputed from published facts, never incremented. */
@Service
@Transactional
public class TournamentService {
    private static final Logger LOG = LoggerFactory.getLogger(TournamentService.class);
    private final TournamentDefaultRulesRepository defaults;
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
                             final TournamentDefaultRulesRepository defaults,
                             final TournamentDayRepository days, final TournamentClanRepository clans,
                             final TournamentEvidenceRepository evidence, final TournamentAuditRepository audits,
                             final TournamentMapper mapper, final TournamentEvidenceStorage storage,
                             @Value("${wotb.tournament.recognition-signing-key:}") final String signingKey) {
        this.defaults = defaults;
        this.events = events; this.rules = rules; this.days = days; this.clans = clans;
        this.evidence = evidence; this.audits = audits; this.mapper = mapper; this.storage = storage;
        this.signingKey = signingKey.getBytes(StandardCharsets.UTF_8);
    }
    @Transactional(readOnly = true)
    public TournamentDtos.DefaultRules defaultRules() { return mapper.defaultRules(defaultSlot()); }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public TournamentDtos.RuleSource ruleSource(final long id) {
        final TournamentEvent event = event(id); final TournamentDefaultRules slot = defaultSlot();
        final boolean source = slot.active && Objects.equals(slot.sourceEventId, id);
        final boolean outdated = source && !snapshot(effectiveRules(event, slot)).equals(slot.rounds);
        return mapper.ruleSource(event, "INHERIT".equals(event.ruleSource) ? Long.valueOf(slot.version) : event.frozenDefaultVersion, source, outdated);
    }
    public TournamentDtos.DefaultRules setDefaultRules(final String actor, final TournamentDtos.SetDefaultRulesRequest request) {
        final TournamentEvent event = locked(request.eventId(), request.expectedEventVersion());
        final TournamentDefaultRules slot = defaults.findLocked(); version(slot.version, request.expectedDefaultVersion());
        if (slot.active && !request.confirm()) { throw error(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT); }
        final List<TournamentRule> configured = effectiveRules(event, slot);
        if (configured.size() != event.roundCount || configured.stream().anyMatch(rule -> !complete(event, rule))) {
            throw error(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE);
        }
        final Map<String, Object> before = Map.of("defaultRules", mapper.defaultRules(slot));
        slot.rounds = snapshot(configured); slot.active = true; slot.version++;
        slot.sourceEventId = event.id; slot.sourceLabel = event.year + " " + event.region + " " + event.season; slot.updatedAt = Instant.now();
        audit(null, null, null, "DEFAULT_RULES_SET", actor, null, before, Map.of("defaultRules", mapper.defaultRules(slot)));
        return mapper.defaultRules(slot);
    }
    public TournamentDtos.DefaultRules saveDefaultConfiguration(final String actor, final TournamentDtos.DefaultConfigurationRequest request) {
        final TournamentDefaultRules slot = defaults.findLocked(); version(slot.version, request.expectedDefaultVersion());
        if (slot.active && !request.confirm()) { throw error(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT); }
        if (request.rounds() == null || request.rounds().size() < 4 || request.rounds().size() > 5
                || request.rounds().getFirst() == null || request.rounds().getFirst().days() == null) { throw invalid(); }
        final int daysPerRound = request.rounds().getFirst().days().size();
        if (daysPerRound < 2 || daysPerRound > 3) { throw invalid(); }
        final List<TournamentSnapshot.RuleRound> configured = new ArrayList<>();
        for (int index = 0; index < request.rounds().size(); index++) {
            final TournamentDtos.DefaultRound round = request.rounds().get(index);
            if (round == null || round.roundNumber() != index + 1) { throw invalid(); }
            final List<TournamentSnapshot.RuleDay> normalized = normalizeRules(daysPerRound, round.days());
            if (!complete(daysPerRound, normalized)) { throw error(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE); }
            configured.add(new TournamentSnapshot.RuleRound(round.roundNumber(), normalized));
        }
        final Map<String, Object> before = Map.of("defaultRules", mapper.defaultRules(slot));
        slot.rounds = List.copyOf(configured); slot.active = true; slot.version++;
        slot.sourceEventId = null; slot.sourceLabel = "GLOBAL_DEFAULT"; slot.updatedAt = Instant.now();
        audit(null, null, null, "DEFAULT_RULES_SET", actor, null, before, Map.of("defaultRules", mapper.defaultRules(slot)));
        return mapper.defaultRules(slot);
    }
    public TournamentDtos.DefaultRules clearDefaultRules(final String actor, final TournamentDtos.ClearDefaultRulesRequest request) {
        final TournamentDefaultRules slot = defaults.findLocked(); version(slot.version, request.expectedDefaultVersion());
        if (!request.confirm()) { throw invalid(); }
        final Map<String, Object> before = Map.of("defaultRules", mapper.defaultRules(slot));
        slot.active = false; slot.rounds = List.of(); slot.sourceEventId = null; slot.sourceLabel = ""; slot.version++; slot.updatedAt = Instant.now();
        audit(null, null, null, "DEFAULT_RULES_CLEARED", actor, null, before, Map.of("defaultRules", mapper.defaultRules(slot)));
        return mapper.defaultRules(slot);
    }
    private TournamentDefaultRules defaultSlot() {
        return defaults.findById(1L).orElseThrow(() -> new IllegalStateException("Missing tournament default singleton"));
    }
    private List<TournamentSnapshot.RuleRound> snapshot(final List<TournamentRule> configured) {
        return configured.stream().map(rule -> new TournamentSnapshot.RuleRound(rule.roundNumber, List.copyOf(rule.days))).toList();
    }
    private List<TournamentRule> effectiveRules(final TournamentEvent event) {
        return effectiveRules(event, "INHERIT".equals(event.ruleSource) ? defaultSlot() : null);
    }
    private List<TournamentRule> effectiveRules(final TournamentEvent event, final TournamentDefaultRules slot) {
        final List<TournamentRule> stored = rules.findByEventIdOrderByRoundNumber(event.id);
        if (!"INHERIT".equals(event.ruleSource)) { return stored; }
        return stored.stream().map(original -> {
            final TournamentRule effective = new TournamentRule(); effective.eventId = event.id; effective.roundNumber = original.roundNumber;
            // Default revisions are visible in legacy rule-version checks as well as the new explicit guard.
            effective.rulesVersion = slot.version;
            effective.days = slot.active ? slot.rounds.stream().filter(round -> round.roundNumber() == original.roundNumber)
                    .findFirst().map(TournamentSnapshot.RuleRound::days).orElse(List.of()).stream()
                    .filter(day -> day.dayNumber() <= event.daysPerRound).toList() : List.of();
            return effective;
        }).toList();
    }
    private void materializeRules(final TournamentEvent event, final TournamentDefaultRules slot, final String source) {
        final List<TournamentRule> effective = effectiveRules(event, slot);
        for (final TournamentRule selected : effective) {
            final TournamentRule stored = rule(event.id, selected.roundNumber); stored.days = List.copyOf(selected.days); stored.rulesVersion = selected.rulesVersion;
        }
        event.ruleSource = source; event.frozenDefaultVersion = "FROZEN".equals(source) && slot.active ? slot.version : null;
    }
    private void freezeRules(final TournamentEvent event, final Long expectedDefaultVersion) {
        if ("INHERIT".equals(event.ruleSource)) {
            final TournamentDefaultRules slot = defaults.findLocked();
            if (expectedDefaultVersion != null) { version(slot.version, expectedDefaultVersion); }
            materializeRules(event, slot, "FROZEN");
        } else {
            event.ruleSource = "FROZEN";
        }
    }
    @Transactional(readOnly = true)
    public List<TournamentDtos.Event> listEvents() {
        return events.findAllByOrderByYearDescIdDesc().stream().map(mapper::toDto).toList();
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
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
        if ("INHERIT".equals(event.ruleSource)) {
            final TournamentDefaultRules slot = defaults.findLocked();
            if (request.expectedDefaultVersion() != null) { version(slot.version, request.expectedDefaultVersion()); }
            final TournamentRule effective = effectiveRules(event, slot).stream().filter(candidate -> candidate.roundNumber == round).findFirst().orElseThrow();
            version(effective.rulesVersion, request.expectedRulesVersion());
            materializeRules(event, slot, "CUSTOM");
        }
        final TournamentRule rule = rule(id, round); version(rule.rulesVersion, request.expectedRulesVersion());
        if (roundLocked(id, round)) { throw error(ApiErrorCode.TOURNAMENT_LOCKED); }
        final List<TournamentSnapshot.RuleDay> next = normalizeRules(event.daysPerRound, request.days());
        if (dayList(id).stream().anyMatch(day -> day.roundNumber == round && day.publishedHistoricalPoints != null)
                && !complete(event, next)) { throw error(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE); }
        final Map<String, Object> before = Map.of("rules", rule.days);
        rule.days = next; rule.rulesVersion++; event.version++;
        for (final TournamentDay day : dayList(id)) {
            if (day.roundNumber == round && day.draftGroups != null) { validateRanksAgainstRules(day.draftGroups, rule, day.dayNumber); day.version++; }
        }
        audit(event, round, null, "RULES_UPDATED", actor, null, before, Map.of("rules", next)); return configView(event);
    }
    // Event identity, published day facts and historical roster must share one MVCC snapshot.
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public TournamentDtos.Standings publicStandings(final long id) { return standings(event(id), dayList(id), null, null, false); }
    @Transactional(readOnly = true)
    public TournamentDtos.DataSource dataSource(final long id) {
        final boolean imported = event(id).csvImported;
        return new TournamentDtos.DataSource(imported, imported ? new TournamentDtos.Attribution("_EK_", "https://b23.tv/rqx5iYX") : null);
    }
    public TournamentDtos.CsvImportPreview previewCsv(final long id, final long expectedVersion, final MultipartFile file) {
        final TournamentEvent event = locked(id, expectedVersion);
        final List<TournamentDay> stored = dayList(id); requireCsvWorkspace(stored);
        final CsvSource source = csvSource(event, file);
        final Map<String, List<Integer>> matrix = historicalMatrix(event, source.name(), source.sha256(), source.rows());
        final TournamentDtos.Standings before = standings(event, stored, null, null, false);
        final List<TournamentDay> replacement = csvDays(event, matrix, stored);
        return csvView(event, source, matrix, replacement, csvChanges(before, standings(event, replacement, null, null, false, matrix.keySet(), true), stored));
    }
    public TournamentDtos.CsvImportPreview importCsv(final String actor, final long id, final long expectedVersion,
            final MultipartFile file, final String sourceSha256, final boolean confirm, final String idempotencyKey) {
        final TournamentEvent event = events.findLocked(id).orElseThrow(() -> error(ApiErrorCode.RESOURCE_NOT_FOUND));
        if (!confirm || !StringUtils.hasText(idempotencyKey) || idempotencyKey.length() > 64 || idempotencyKey.codePoints().anyMatch(Character::isISOControl)) { throw invalid(); }
        final CsvSource source = csvSource(event, file);
        if (!source.sha256().equals(sourceSha256)) { throw error(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT); }
        final Map<String, List<Integer>> matrix = historicalMatrix(event, source.name(), source.sha256(), source.rows());
        final TournamentAudit previous = audits.findCsvImport(id, idempotencyKey).orElse(null);
        final List<TournamentDay> stored = dayList(id);
        if (previous != null) {
            final Map<String, Object> applied = previous.afterState;
            if (!source.sha256().equals(applied.get("sourceSha256")) || !source.name().equals(applied.get("sourceName"))
                    || ((Number) applied.get("expectedEventVersion")).longValue() != expectedVersion
                    || ((Number) applied.get("appliedVersion")).longValue() != event.version) { throw error(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT); }
            return csvView(event, source, matrix, stored, storedCsvChanges(applied));
        }
        version(event.version, expectedVersion); requireCsvWorkspace(stored);
        final TournamentDtos.Standings before = standings(event, stored, null, null, false);
        final List<TournamentDay> replacement = csvDays(event, matrix, stored);
        final TournamentDtos.CsvChanges changes = csvChanges(before, standings(event, replacement, null, null, false, matrix.keySet(), true), stored);
        final List<Map<String, Object>> previousPublishedDays = stored.stream().filter(day -> day.publishedGroups != null)
                .map(day -> Map.<String, Object>of("roundNumber", day.roundNumber, "dayNumber", day.dayNumber,
                        "groups", List.copyOf(day.publishedGroups))).toList();
        final Map<String, TournamentClan> existing = clans.findByEventIdOrderByClanTag(id).stream().collect(Collectors.toMap(clan -> clan.clanTag, clan -> clan));
        existing.values().forEach(clan -> clan.historicalPublished = matrix.containsKey(clan.clanTag));
        for (final String tag : matrix.keySet()) {
            final TournamentClan clan = existing.getOrDefault(tag, new TournamentClan());
            clan.eventId = id; clan.clanTag = tag; clan.historicalPublished = true; clans.save(clan);
        }
        for (final TournamentDay next : replacement) {
            final TournamentDay day = stored.stream().filter(old -> old.roundNumber == next.roundNumber && old.dayNumber == next.dayNumber).findFirst().orElse(next);
            final boolean replacesPublished = published(day) || published(next);
            day.publishedGroups = null; day.publishedHistoricalPoints = next.publishedHistoricalPoints;
            if (replacesPublished) { day.expectedGroupCount = null; }
            day.version++; days.save(day);
        }
        freezeRules(event, null); event.configLocked = true; event.csvImported = true; event.version++;
        final TournamentDtos.CsvImportPreview result = csvView(event, source, matrix, dayList(id), changes);
        audit(event, null, null, "CSV_IMPORTED", actor, null, Map.of("standings", before, "publishedDays", previousPublishedDays),
                Map.of("sourceName", source.name(), "sourceSha256", source.sha256(), "rows", source.rows(),
                        "idempotencyKey", idempotencyKey, "expectedEventVersion", expectedVersion,
                        "appliedVersion", event.version, "changes", changes, "standings", result.standings()));
        return result;
    }
    private void requireCsvWorkspace(final List<TournamentDay> stored) {
        if (stored.stream().anyMatch(day -> day.draftGroups != null || day.correction)) { throw error(ApiErrorCode.TOURNAMENT_CSV_WORKSPACE_BUSY); }
    }
    private List<TournamentDay> csvDays(final TournamentEvent event, final Map<String, List<Integer>> matrix, final List<TournamentDay> stored) {
        final Map<String, TournamentDay> imported = historicalDays(event, matrix).stream().collect(Collectors.toMap(day -> key(day.roundNumber, day.dayNumber), day -> day));
        final List<TournamentDay> result = new ArrayList<>();
        for (int round = 1; round <= event.roundCount; round++) {
            for (int number = 1; number <= event.daysPerRound; number++) {
                final TournamentDay next = imported.getOrDefault(key(round, number), newDay(event.id, round, number));
                final int selectedRound = round; final int selectedDay = number;
                stored.stream().filter(day -> day.roundNumber == selectedRound && day.dayNumber == selectedDay)
                        .findFirst().ifPresent(day -> next.clearedClans = Set.copyOf(day.clearedClans));
                result.add(next);
            }
        }
        return result;
    }
    private TournamentDtos.CsvImportPreview csvView(final TournamentEvent event, final CsvSource source, final Map<String, List<Integer>> matrix,
            final List<TournamentDay> replacement, final TournamentDtos.CsvChanges changes) {
        final int missing = (int) matrix.values().stream().flatMap(List::stream).filter(Objects::isNull).count();
        return new TournamentDtos.CsvImportPreview(standings(event, replacement, null, null, false, matrix.keySet(), true), source.name(), source.sha256(),
                source.rows().size(), matrix.size(), missing, event.version, changes);
    }
    private TournamentDtos.CsvChanges csvChanges(final TournamentDtos.Standings before, final TournamentDtos.Standings after, final List<TournamentDay> stored) {
        final Map<String, TournamentDtos.StandingRow> old = before.rows().stream().collect(Collectors.toMap(TournamentDtos.StandingRow::clanTag, row -> row));
        final Map<String, TournamentDtos.StandingRow> next = after.rows().stream().collect(Collectors.toMap(TournamentDtos.StandingRow::clanTag, row -> row));
        final Set<String> tags = new HashSet<>(old.keySet()); tags.addAll(next.keySet());
        int addedClans = 0; int changedClans = 0; int removedClans = 0; int added = 0; int changed = 0; int removed = 0;
        for (final String tag : tags) {
            if (!old.containsKey(tag)) { addedClans++; }
            else if (!next.containsKey(tag)) { removedClans++; }
            else if (!old.get(tag).rounds().equals(next.get(tag).rounds())) { changedClans++; }
            final List<Long> oldValues = old.containsKey(tag) ? old.get(tag).rounds().stream().flatMap(round -> round.days().stream()).map(TournamentDtos.DayPoints::points).toList() : null;
            final List<Long> newValues = next.containsKey(tag) ? next.get(tag).rounds().stream().flatMap(round -> round.days().stream()).map(TournamentDtos.DayPoints::points).toList() : null;
            final int count = oldValues != null ? oldValues.size() : newValues.size();
            for (int cell = 0; cell < count; cell++) {
                final Long left = oldValues == null ? null : oldValues.get(cell); final Long right = newValues == null ? null : newValues.get(cell);
                if (left == null && right != null) { added++; } else if (left != null && right == null) { removed++; }
                else if (!Objects.equals(left, right)) { changed++; }
            }
        }
        final int clears = stored.stream().mapToInt(day -> day.clearedClans.size()).sum();
        return new TournamentDtos.CsvChanges(addedClans, changedClans, removedClans, added, changed, removed, clears);
    }
    private TournamentDtos.CsvChanges storedCsvChanges(final Map<String, Object> applied) {
        final Object saved = applied.get("changes");
        if (saved instanceof TournamentDtos.CsvChanges changes) { return changes; }
        final Map<?, ?> values = (Map<?, ?>) saved;
        return new TournamentDtos.CsvChanges(((Number) values.get("addedClans")).intValue(), ((Number) values.get("changedClans")).intValue(),
                ((Number) values.get("removedClans")).intValue(), ((Number) values.get("addedScores")).intValue(), ((Number) values.get("changedScores")).intValue(),
                ((Number) values.get("removedScores")).intValue(), ((Number) values.get("preservedClears")).intValue());
    }
    private record CsvSource(String name, String sha256, List<TournamentDtos.HistoricalRow> rows) { }
    private CsvSource csvSource(final TournamentEvent event, final MultipartFile file) {
        final int limit = 2 * 1024 * 1024;
        if (file == null) { throw csvInvalid(0, "file", "empty"); }
        if (file.getSize() > limit) { throw error(ApiErrorCode.FILE_TOO_LARGE); }
        final byte[] bytes;
        try (final var input = file.getInputStream()) { bytes = input.readNBytes(limit + 1); }
        catch (final IOException failure) { throw csvInvalid(0, "file", "read"); }
        if (bytes.length > limit) { throw error(ApiErrorCode.FILE_TOO_LARGE); }
        if (bytes.length == 0) { throw csvInvalid(0, "file", "empty"); }
        final String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().replace('\\', '/');
        final String sourceName = name.substring(name.lastIndexOf('/') + 1).strip();
        if (!StringUtils.hasText(sourceName) || sourceName.codePointCount(0, sourceName.length()) > 200 || sourceName.codePoints().anyMatch(Character::isISOControl)) { throw csvInvalid(0, "file", "name"); }
        final List<String> pointColumns = new ArrayList<>();
        for (int round = 1; round <= event.roundCount; round++) {
            for (int day = 1; day <= event.daysPerRound; day++) { pointColumns.add("R" + round + "D" + day); }
        }
        final Set<String> required = new HashSet<>(pointColumns); required.add("军团标签"); required.add("总积分");
        final List<TournamentDtos.HistoricalRow> rows = new ArrayList<>();
        try {
            final var document = new CsvDecoder().decode(bytes);
            final List<String> headers = document.headers(); final Set<String> actual = new HashSet<>(headers);
            if (actual.size() != headers.size() || !actual.containsAll(required) || actual.stream().anyMatch(header -> !required.contains(header) && !"积分排名".equals(header))) { throw csvInvalid(1, "header", "header"); }
            for (final var row : document.rows()) {
                final long rowNumber = row.recordNumber() + 1;
                final List<String> cells = row.cells();
                if (cells.stream().allMatch(value -> !StringUtils.hasText(value))) { continue; }
                if (cells.size() != headers.size()) { throw csvInvalid(rowNumber, "header", "columns"); }
                if (rows.size() >= 10000) { throw csvInvalid(rowNumber, "file", "rows"); }
                final Map<String, String> values = new LinkedHashMap<>();
                for (int index = 0; index < headers.size(); index++) { values.put(headers.get(index), cells.get(index)); }
                final String tag;
                try { tag = clanTag(values.get("军团标签")); } catch (final ApiException invalidTag) { throw csvInvalid(rowNumber, "军团标签", "clanTag"); }
                final List<Integer> points = new ArrayList<>(); long sum = 0;
                for (final String column : pointColumns) {
                    final String value = values.get(column).strip();
                    final Integer point = value.isEmpty() ? null : (int) csvNumber(value, 1_000_000, rowNumber, column);
                    points.add(point); if (point != null) { sum += point; }
                }
                final long total = csvNumber(values.get("总积分").strip(), (long) pointColumns.size() * 1_000_000, rowNumber, "总积分");
                if (sum != total) { throw csvInvalid(rowNumber, "总积分", "total"); }
                rows.add(new TournamentDtos.HistoricalRow(tag, points, total));
            }
        } catch (final CsvEncodingException failure) { throw csvInvalid(0, "file", "encoding"); }
        catch (final CsvSyntaxException failure) { throw csvInvalid(0, "file", "syntax"); }
        catch (final IllegalArgumentException invalidHeader) { throw csvInvalid(1, "header", "header"); }
        if (rows.isEmpty()) { throw csvInvalid(0, "file", "empty"); }
        try { return new CsvSource(sourceName, HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)), List.copyOf(rows)); }
        catch (final NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA-256 unavailable", impossible); }
    }
    private long csvNumber(final String text, final long maximum, final long row, final String column) {
        if (!text.matches("[0-9]+")) { throw csvInvalid(row, column, "number"); }
        try { final long value = Long.parseLong(text); if (value > maximum) { throw csvInvalid(row, column, "number"); } return value; }
        catch (final NumberFormatException invalidNumber) { throw csvInvalid(row, column, "number"); }
    }
    private static ApiException csvInvalid(final long row, final String column, final String reason) {
        return new ApiException(ApiErrorCode.TOURNAMENT_CSV_INVALID, null, Map.of("rowNumber", row, "column", column, "reason", reason));
    }
    /** Separate capability/state response leaves strict, already-deployed day clients compatible. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public TournamentDtos.HistoricalState historicalState(final long id, final int round, final int number) {
        final TournamentEvent event = event(id); dimension(event, round, number);
        final List<TournamentDay> stored = dayList(id);
        final boolean historical = stored.stream().anyMatch(day -> day.roundNumber == round && day.dayNumber == number && day.publishedHistoricalPoints != null);
        return new TournamentDtos.HistoricalState(event.version, event.historicalImportKey != null, historicalTargetEmpty(event, stored), historical);
    }
    public TournamentDtos.HistoricalPreview previewHistorical(final long id, final TournamentDtos.HistoricalPreviewRequest request) {
        final TournamentEvent event = locked(id, request.expectedEventVersion()); requireEmptyHistoricalTarget(event);
        final Map<String, List<Integer>> matrix = historicalMatrix(event, request.sourceName(), request.sourceSha256(), request.rows());
        return historicalView(event, request.rows().size(), matrix, historicalDays(event, matrix));
    }
    public TournamentDtos.HistoricalPreview importHistorical(final String actor, final long id, final TournamentDtos.HistoricalImportRequest request) {
        final TournamentEvent event = events.findLocked(id).orElseThrow(() -> error(ApiErrorCode.RESOURCE_NOT_FOUND));
        if (!request.confirm() || !StringUtils.hasText(request.idempotencyKey()) || request.idempotencyKey().length() > 64) { throw invalid(); }
        final Map<String, List<Integer>> matrix = historicalMatrix(event, request.sourceName(), request.sourceSha256(), request.rows());
        final String hash = historicalHash(request.sourceName().strip(), request.sourceSha256(), request.rows());
        if (event.historicalImportKey != null) {
            if (!event.historicalImportKey.equals(request.idempotencyKey()) || !event.historicalImportHash.equals(hash)) { throw error(ApiErrorCode.TOURNAMENT_LOCKED); }
            return historicalView(event, request.rows().size(), matrix, dayList(id));
        }
        version(event.version, request.expectedEventVersion()); requireEmptyHistoricalTarget(event);
        final Map<String, TournamentClan> existing = clans.findByEventIdOrderByClanTag(id).stream().collect(Collectors.toMap(clan -> clan.clanTag, clan -> clan));
        for (final String tag : matrix.keySet()) {
            final TournamentClan clan = existing.getOrDefault(tag, new TournamentClan()); clan.eventId = id; clan.clanTag = tag; clan.historicalPublished = true; clans.save(clan);
        }
        for (final TournamentDay imported : historicalDays(event, matrix)) {
            final TournamentDay day = existingDay(id, imported.roundNumber, imported.dayNumber).orElse(imported);
            day.publishedHistoricalPoints = imported.publishedHistoricalPoints; day.expectedGroupCount = null; day.version++; days.save(day);
        }
        event.ruleSource = "FROZEN"; event.frozenDefaultVersion = null; event.configLocked = true; event.historicalImportKey = request.idempotencyKey(); event.historicalImportHash = hash; event.version++;
        audit(event, null, null, "HISTORICAL_IMPORTED", actor, null, Map.of(), Map.of("sourceName", request.sourceName().strip(),
                "sourceSha256", request.sourceSha256(), "importHash", hash, "rows", request.rows(), "clanCount", matrix.size()));
        return historicalView(event, request.rows().size(), matrix, dayList(id));
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public TournamentDtos.DayView day(final long id, final int round, final int number) {
        final TournamentEvent event = event(id); dimension(event, round, number);
        return dayView(event, existingDay(id, round, number).orElseGet(() -> newDay(id, round, number)), null);
    }
    public TournamentDtos.DayView expectedGroups(final long id, final int round, final int number, final TournamentDtos.ExpectedGroupsRequest request) {
        final TournamentEvent event = locked(id, request.expectedEventVersion()); dimension(event, round, number);
        final TournamentDay day = writableDay(id, round, number, request.expectedDayVersion()); groupCount(request.expectedGroupCount());
        if (day.draftGroups != null && day.draftGroups.size() > request.expectedGroupCount()) { throw error(ApiErrorCode.TOURNAMENT_GROUP_COUNT_MISMATCH); }
        freezeRules(event, request.expectedDefaultVersion());
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
        if (published(day) && !day.correction) { throw error(ApiErrorCode.TOURNAMENT_LOCKED); }
        requireExpectedGroups(day);
        if (day.draftGroups == null || day.draftGroups.size() != day.expectedGroupCount) { throw error(ApiErrorCode.TOURNAMENT_GROUP_COUNT_MISMATCH); }
        validateSnapshot(day.draftGroups); validateRanksAgainstRules(day.draftGroups, rule, number);
        final Map<String, Object> before = Map.of("groups", day.publishedGroups == null ? List.of() : day.publishedGroups,
                "historicalPoints", day.publishedHistoricalPoints == null ? Map.of() : day.publishedHistoricalPoints); final String reason = day.correctionReason;
        day.publishedGroups = List.copyOf(day.draftGroups); day.publishedHistoricalPoints = null; day.draftGroups = null;
        day.publicationKeys = new LinkedHashSet<>(day.publicationKeys); day.publicationKeys.add(request.idempotencyKey()); final String action = day.correction ? "CORRECTION_PUBLISHED" : "DAY_PUBLISHED";
        day.correction = false; day.correctionReason = null; day.correctionStartedAt = null; event.configLocked = true; changed(event, day);
        audit(event, round, number, action, actor, reason, before, Map.of("groups", day.publishedGroups)); return dayView(event, day, null);
    }
    public TournamentDtos.DayView correction(final String actor, final long id, final int round, final int number, final TournamentDtos.CorrectionRequest request) {
        final TournamentEvent event = locked(id, request.expectedEventVersion()); dimension(event, round, number);
        final TournamentDay day = existingDay(id, round, number).orElseThrow(() -> error(ApiErrorCode.RESOURCE_NOT_FOUND));
        version(day.version, request.expectedDayVersion()); reason(request.reason()); groupCount(request.expectedGroupCount());
        if (!published(day) || day.correction) { throw error(ApiErrorCode.TOURNAMENT_LOCKED); }
        if (day.publishedHistoricalPoints != null) { readyRule(event, round, rule(id, round).rulesVersion); }
        day.correction = true; day.correctionReason = request.reason().strip(); day.correctionStartedAt = Instant.now(); day.draftGroups = List.of(); day.expectedGroupCount = request.expectedGroupCount(); changed(event, day);
        audit(event, round, number, "CORRECTION_STARTED", actor, request.reason(), Map.of(), Map.of()); return dayView(event, day, null);
    }
    public TournamentDtos.DayView deleteDraft(final long id, final int round, final int number, final TournamentDtos.Versions request) {
        final TournamentEvent event = locked(id, request.expectedEventVersion()); dimension(event, round, number);
        final TournamentDay day = existingDay(id, round, number).orElseThrow(() -> error(ApiErrorCode.RESOURCE_NOT_FOUND)); version(day.version, request.expectedDayVersion());
        day.draftGroups = null; day.correction = false; day.correctionReason = null; day.correctionStartedAt = null;
        if (day.publishedGroups != null) { day.expectedGroupCount = day.publishedGroups.size(); }
        else if (day.publishedHistoricalPoints != null) { day.expectedGroupCount = null; }
        changed(event, day); removeUnusedEvidence(event, true); return dayView(event, day, null);
    }
    public TournamentDtos.Standings clearPoints(final String actor, final long id, final TournamentDtos.ClearRequest request) {
        final TournamentEvent event = locked(id, request.expectedEventVersion());
        dimension(event, request.roundNumber(), request.dayNumber() == null ? 1 : request.dayNumber()); reason(request.reason()); final String tag = clanTag(request.clanTag());
        if (!clans.existsByEventIdAndClanTag(id, tag)) { throw error(ApiErrorCode.RESOURCE_NOT_FOUND); }
        final List<TournamentDay> affected = dayList(id).stream().filter(day -> day.roundNumber == request.roundNumber() && (request.dayNumber() == null || day.dayNumber == request.dayNumber())).toList();
        final int required = request.dayNumber() == null ? event.daysPerRound : 1;
        if (affected.size() != required || affected.stream().anyMatch(day -> !published(day) || day.correction)) { throw error(ApiErrorCode.TOURNAMENT_LOCKED); }
        if (affected.stream().noneMatch(day -> day.clearedClans.contains(tag) || publishedTags(day).contains(tag))) {
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
    public List<TournamentDtos.Audit> auditList(final long id) { event(id); return audits.findMetadataByEventId(id).stream().map(mapper::audit).toList(); }
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
        return standings(event, storedDays, previewDay, preview, admin, Set.of());
    }
    private TournamentDtos.Standings standings(final TournamentEvent event, final List<TournamentDay> storedDays, final TournamentDay previewDay, final List<TournamentSnapshot.Group> preview, final boolean admin, final Set<String> historicalRoster) {
        return standings(event, storedDays, previewDay, preview, admin, historicalRoster, false);
    }
    private TournamentDtos.Standings standings(final TournamentEvent event, final List<TournamentDay> storedDays, final TournamentDay previewDay, final List<TournamentSnapshot.Group> preview, final boolean admin, final Set<String> historicalRoster, final boolean replaceRoster) {
        final Map<String, Map<String, Long>> scores = new HashMap<>();
        clans.findByEventIdOrderByClanTag(event.id).stream().filter(clan -> !replaceRoster && clan.historicalPublished)
                .forEach(clan -> scores.put(clan.clanTag, new HashMap<>()));
        historicalRoster.forEach(tag -> scores.putIfAbsent(tag, new HashMap<>()));
        final Map<String, TournamentDay> dayByKey = storedDays.stream().collect(Collectors.toMap(day -> key(day.roundNumber, day.dayNumber), day -> day));
        if (previewDay != null) { dayByKey.put(key(previewDay.roundNumber, previewDay.dayNumber), previewDay); }
        final List<TournamentDtos.StandingDay> columns = new ArrayList<>();
        final Map<Integer, TournamentRule> ruleByRound = effectiveRules(event).stream().collect(Collectors.toMap(rule -> rule.roundNumber, rule -> rule));
        for (int round = 1; round <= event.roundCount; round++) {
            for (int number = 1; number <= event.daysPerRound; number++) {
                final String key = key(round, number); final TournamentDay day = dayByKey.get(key);
                columns.add(new TournamentDtos.StandingDay(round, number, event.dayLabels.get(number - 1), day != null && published(day)));
                if (day == null) { continue; }
                final List<TournamentSnapshot.Group> selected = previewDay == day && preview != null ? preview : admin && day.draftGroups != null ? day.draftGroups : day.publishedGroups;
                if (selected == null && day.publishedHistoricalPoints == null) { continue; }
                final Map<Integer, Integer> points = rulePoints(ruleByRound.get(round), number);
                if (selected == null) {
                    day.publishedHistoricalPoints.forEach((tag, value) -> scores.computeIfAbsent(tag, ignored -> new HashMap<>()).put(key, day.clearedClans.contains(tag) ? 0L : value.longValue()));
                }
                for (final TournamentSnapshot.Group group : selected == null ? List.<TournamentSnapshot.Group>of() : selected) {
                    for (final TournamentSnapshot.Team team : group.teams()) {
                        final Integer value = points.get(team.rank()); if (value == null) { throw error(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE); }
                        scores.computeIfAbsent(team.clanTag(), ignored -> new HashMap<>()).put(key, day.clearedClans.contains(team.clanTag()) ? 0L : value.longValue());
                    }
                }
                for (final String tag : day.clearedClans) {
                    if ((!event.csvImported && !replaceRoster) || (selected != null && scores.containsKey(tag))) {
                        scores.computeIfAbsent(tag, ignored -> new HashMap<>()).put(key, 0L);
                    }
                }
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
        final String status = day.correction ? "CORRECTION" : published(day) ? "FINALIZED" : day.draftGroups != null || preview != null ? "DRAFT" : "EMPTY";
        return new TournamentDtos.DayView(event.id, day.roundNumber, day.dayNumber, event.version, effectiveRules(event).stream().filter(rule -> rule.roundNumber == day.roundNumber).findFirst().orElseThrow().rulesVersion,
                day.version, status, day.expectedGroupCount, selected.stream().map(mapper::group).toList(), published(day),
                standings(event, dayList(event.id), preview == null ? null : day, preview, true));
    }
    private TournamentDtos.Config configView(final TournamentEvent event) {
        return new TournamentDtos.Config(mapper.toDto(event), effectiveRules(event).stream()
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
        if (published(day) && !day.correction) { throw error(ApiErrorCode.TOURNAMENT_LOCKED); } return day;
    }
    private TournamentDay newDay(final long id, final int round, final int number) {
        final TournamentDay day = new TournamentDay(); day.eventId = id; day.roundNumber = round; day.dayNumber = number; day.clearedClans = Set.of(); day.publicationKeys = Set.of(); return day;
    }
    private void changed(final TournamentEvent event, final TournamentDay day) { day.version++; event.version++; days.save(day); }
    private boolean roundLocked(final long id, final int round) {
        final List<TournamentDay> roundDays = dayList(id).stream().filter(day -> day.roundNumber == round).toList();
        return roundDays.stream().anyMatch(day -> day.publishedGroups != null)
                || roundDays.stream().anyMatch(day -> day.publishedHistoricalPoints != null) && complete(event(id), rule(id, round));
    }
    private boolean complete(final TournamentEvent event, final TournamentRule rule) {
        return complete(event, rule.days);
    }
    private boolean complete(final TournamentEvent event, final List<TournamentSnapshot.RuleDay> configuredDays) {
        return complete(event.daysPerRound, configuredDays);
    }
    private boolean complete(final int daysPerRound, final List<TournamentSnapshot.RuleDay> configuredDays) {
        if (configuredDays.size() != daysPerRound) { return false; }
        for (int number = 1; number <= daysPerRound; number++) {
            final int target = number;
            final Set<Integer> ranks = configuredDays.stream().filter(day -> day.dayNumber() == target).flatMap(day -> day.points().stream()).map(TournamentSnapshot.RankPoints::rank).collect(Collectors.toSet());
            if (!(ranks.contains(1) && ranks.contains(2) && ranks.contains(3) && ranks.contains(4))) { return false; }
        }
        return true;
    }
    private Map<Integer, Integer> rulePoints(final TournamentRule rule, final int number) {
        if (rule == null) { return Map.of(); }
        return rule.days.stream().filter(day -> day.dayNumber() == number).findFirst().map(day -> day.points().stream()
                .collect(Collectors.toMap(TournamentSnapshot.RankPoints::rank, TournamentSnapshot.RankPoints::points))).orElse(Map.of());
    }
    private List<TournamentSnapshot.RuleDay> normalizeRules(final int daysPerRound, final List<TournamentDtos.RuleDay> input) {
        if (input == null || input.size() > daysPerRound) { throw invalid(); }
        final Set<Integer> seenDays = new HashSet<>(); final List<TournamentSnapshot.RuleDay> result = new ArrayList<>();
        for (final TournamentDtos.RuleDay day : input) {
            if (day == null || day.dayNumber() < 1 || day.dayNumber() > daysPerRound || !seenDays.add(day.dayNumber()) || day.points() == null || day.points().size() > 5) { throw invalid(); }
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
    private static boolean published(final TournamentDay day) { return day.publishedGroups != null || day.publishedHistoricalPoints != null; }
    private static Set<String> publishedTags(final TournamentDay day) { return day.publishedHistoricalPoints != null ? day.publishedHistoricalPoints.keySet() : day.publishedGroups != null ? tags(day.publishedGroups) : Set.of(); }
    private void requireEmptyHistoricalTarget(final TournamentEvent event) {
        if (!historicalTargetEmpty(event, dayList(event.id))) { throw error(ApiErrorCode.TOURNAMENT_LOCKED); }
    }
    private boolean historicalTargetEmpty(final TournamentEvent event, final List<TournamentDay> storedDays) {
        return !event.csvImported && event.historicalImportKey == null && storedDays.stream().noneMatch(day -> day.draftGroups != null || published(day) || day.correction || !day.clearedClans.isEmpty());
    }
    private Map<String, List<Integer>> historicalMatrix(final TournamentEvent event, final String sourceName, final String sourceSha256, final List<TournamentDtos.HistoricalRow> input) {
        if (!StringUtils.hasText(sourceName) || sourceName.codePointCount(0, sourceName.length()) > 200 || sourceName.codePoints().anyMatch(Character::isISOControl)
                || sourceSha256 == null || !sourceSha256.matches("[a-f0-9]{64}") || input == null || input.isEmpty() || input.size() > 10000) { throw invalid(); }
        final int cellCount = event.roundCount * event.daysPerRound;
        final Map<String, List<Integer>> matrix = new LinkedHashMap<>();
        for (int rowIndex = 0; rowIndex < input.size(); rowIndex++) {
            final TournamentDtos.HistoricalRow row = input.get(rowIndex);
            if (row == null || row.points() == null || row.points().size() != cellCount || row.sourceTotal() < 0) { throw invalid(); }
            final String tag = clanTag(row.clanTag()); long total = 0;
            for (final Integer point : row.points()) {
                if (point != null) { if (point < 0 || point > 1_000_000) { throw invalid(); } total += point; }
            }
            if (total != row.sourceTotal()) { throw new ApiException(ApiErrorCode.INVALID_ARGUMENT, null, Map.of("sourceRow", rowIndex + 1, "clanTag", tag, "computedTotal", total, "sourceTotal", row.sourceTotal())); }
            final List<Integer> merged = matrix.computeIfAbsent(tag, ignored -> new ArrayList<>(java.util.Collections.nCopies(cellCount, null)));
            for (int column = 0; column < cellCount; column++) {
                final Integer next = row.points().get(column); if (next == null) { continue; }
                if (merged.get(column) != null) { throw new ApiException(ApiErrorCode.TOURNAMENT_GROUP_CONFLICT, null, Map.of("sourceRow", rowIndex + 1, "clanTag", tag, "roundNumber", column / event.daysPerRound + 1, "dayNumber", column % event.daysPerRound + 1)); }
                merged.set(column, next);
            }
        }
        return matrix;
    }
    private List<TournamentDay> historicalDays(final TournamentEvent event, final Map<String, List<Integer>> matrix) {
        final List<TournamentDay> result = new ArrayList<>();
        for (int column = 0; column < event.roundCount * event.daysPerRound; column++) {
            final Map<String, Integer> values = new LinkedHashMap<>();
            for (final Map.Entry<String, List<Integer>> row : matrix.entrySet()) {
                final Integer point = row.getValue().get(column); if (point != null) { values.put(row.getKey(), point); }
            }
            if (values.isEmpty()) { continue; }
            final TournamentDay day = newDay(event.id, column / event.daysPerRound + 1, column % event.daysPerRound + 1);
            day.publishedHistoricalPoints = Map.copyOf(values); result.add(day);
        }
        return result;
    }
    private TournamentDtos.HistoricalPreview historicalView(final TournamentEvent event, final int sourceRowCount, final Map<String, List<Integer>> matrix, final List<TournamentDay> importedDays) {
        final int missing = (int) matrix.values().stream().flatMap(List::stream).filter(Objects::isNull).count();
        return new TournamentDtos.HistoricalPreview(standings(event, importedDays, null, null, false, matrix.keySet()), sourceRowCount, matrix.size(), missing, event.version);
    }
    private String historicalHash(final String sourceName, final String sourceSha256, final List<TournamentDtos.HistoricalRow> rows) {
        final StringBuilder canonical = new StringBuilder().append(sourceName.length()).append(':').append(sourceName).append(':').append(sourceSha256);
        for (final TournamentDtos.HistoricalRow row : rows) {
            final String tag = clanTag(row.clanTag()); canonical.append('|').append(tag.length()).append(':').append(tag).append(':').append(row.sourceTotal()).append(':').append(row.points());
        }
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.toString().getBytes(StandardCharsets.UTF_8))); }
        catch (final NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA-256 unavailable", impossible); }
    }
    private void requireExpectedGroups(final TournamentDay day) { if (day.expectedGroupCount == null) { throw error(ApiErrorCode.TOURNAMENT_GROUP_COUNT_MISMATCH); } }
    private void groupCount(final int count) { if (count < 1 || count > 10000) { throw invalid(); } }
    private void reason(final String reason) { if (!StringUtils.hasText(reason) || reason.length() > 500) { throw invalid(); } }
    private static void version(final long actual, final long expected) { if (actual != expected || expected < 0) { throw error(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT); } }
    private static String key(final int round, final int day) { return round + ":" + day; }
    private static ApiException invalid() { return error(ApiErrorCode.INVALID_ARGUMENT); }
    private static ApiException error(final ApiErrorCode code) { return new ApiException(code); }
    private void audit(final TournamentEvent event, final Integer round, final Integer number, final String action, final String actor, final String reason, final Map<String, Object> before, final Map<String, Object> after) {
        final TournamentAudit audit = new TournamentAudit(); audit.eventId = event == null ? null : event.id; audit.roundNumber = round; audit.dayNumber = number;
        audit.action = action; audit.actor = actor; audit.reason = reason; audit.createdAt = Instant.now(); audit.beforeState = before; audit.afterState = after; audits.save(audit);
    }
    private void removeUnusedEvidence(final TournamentEvent event, final boolean immediate) {
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
    private void afterCommit(final Runnable action) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) { action.run(); return; }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                try { action.run(); } catch (final RuntimeException e) { LOG.warn("Tournament evidence cleanup deferred: {}", e.getClass().getSimpleName()); }
            }
        });
    }
}
