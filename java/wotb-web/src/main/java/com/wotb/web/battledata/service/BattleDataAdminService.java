package com.wotb.web.battledata.service;

import com.wotb.web.battledata.dto.BattleDataAdminDtos;
import com.wotb.web.battledata.repository.BattleDataAdminRepository;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.Objects;
import java.util.regex.Pattern;

@Service
public class BattleDataAdminService {
    private static final JsonMapper JSON = JsonMapper.builder().findAndAddModules().build();
    private static final BigInteger MAX_ARENA = new BigInteger("18446744073709551615");
    private static final Pattern ARENA = Pattern.compile("[1-9][0-9]{0,19}");
    private static final Pattern MAP = Pattern.compile("[a-z0-9_]{1,128}");
    private static final Pattern VERSION = Pattern.compile("[A-Za-z0-9._-]{1,64}");
    private final BattleDataAdminRepository repository;
    private final Clock clock = Clock.systemUTC();
    public BattleDataAdminService(final BattleDataAdminRepository repository) { this.repository = repository; }
    public record CursorPayload(int version, Instant time, String id, BattleDataAdminDtos.Filter filter) { }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.INVALID_REQUEST); }
    public static Instant parseTime(final String input) {
        if (input == null) return null;
        try { return Instant.parse(input); } catch (final RuntimeException e) { throw invalid(); }
    }
    private static void interval(final Instant from, final Instant to) {
        if (from != null && to != null && !from.isBefore(to)) throw invalid();
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public BattleDataAdminDtos.Summary summary(final String fromInput, final String toInput) {
        final var from = parseTime(fromInput);
        final var requestedTo = parseTime(toInput);
        interval(from, requestedTo);
        final var asOf = clock.instant();
        final var to = requestedTo == null || requestedTo.isAfter(asOf) ? asOf : requestedTo;
        final var totals = repository.totals(asOf);
        return new BattleDataAdminDtos.Summary(asOf, totals.total(), totals.last24(), totals.last7(), totals.last30(),
                repository.windowCount(from, to), totals.latest(), totals.maps(), totals.versions(),
                repository.numeric("arena_bonus_type", from, to), repository.numeric("winner_team", from, to),
                repository.numeric("schema_version", from, to), repository.daily(from, to),
                repository.namedCounts("map_key", from, to), repository.namedCounts("client_version", from, to),
                repository.spawnStats(from, to));
    }
    private static void validate(final BattleDataAdminDtos.Filter filter, final int size) {
        interval(filter.from(), filter.to());
        if (size < 1 || size > 100) throw invalid();
        if (filter.arenaId() != null && (!ARENA.matcher(filter.arenaId()).matches()
                || new BigInteger(filter.arenaId()).compareTo(MAX_ARENA) > 0)) throw invalid();
        if (filter.mapKey() != null && !MAP.matcher(filter.mapKey()).matches()) throw invalid();
        if (filter.clientVersion() != null && !VERSION.matcher(filter.clientVersion()).matches()) throw invalid();
        if (filter.arenaBonusType() != null && filter.arenaBonusType() != 1 && filter.arenaBonusType() != 7) throw invalid();
        if (filter.winnerTeam() != null && (filter.winnerTeam() < 0 || filter.winnerTeam() > 2)) throw invalid();
    }
    private static BattleDataAdminRepository.Cursor decode(final String encoded, final BattleDataAdminDtos.Filter filter) {
        if (encoded == null) return null;
        if (encoded.length() > 2048) throw invalid();
        try {
            final var payload = JSON.readValue(Base64.getUrlDecoder().decode(encoded), CursorPayload.class);
            if (payload.version() != 1 || payload.time() == null || !Objects.equals(filter, payload.filter())
                    || payload.id() == null || !payload.id().matches("[1-9][0-9]{0,18}")) throw invalid();
            final long id = Long.parseLong(payload.id());
            if (id <= 0) throw invalid();
            return new BattleDataAdminRepository.Cursor(payload.time(), id);
        } catch (final RuntimeException exception) { throw invalid(); }
    }
    private static String encode(final BattleDataAdminDtos.Battle last, final BattleDataAdminDtos.Filter filter) {
        final byte[] bytes = JSON.writeValueAsString(new CursorPayload(1, last.receivedAt(), last.id(), filter)).getBytes(StandardCharsets.UTF_8);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
    @Transactional(readOnly = true)
    public BattleDataAdminDtos.Page list(final BattleDataAdminDtos.Filter filter, final String cursor, final int size) {
        validate(filter, size);
        final var rows = repository.list(filter, decode(cursor, filter), size + 1);
        final boolean more = rows.size() > size;
        final var items = more ? rows.subList(0, size) : rows;
        return new BattleDataAdminDtos.Page(items, more ? encode(items.getLast(), filter) : null);
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public BattleDataAdminDtos.Detail detail(final String id) {
        final long parsed;
        try {
            if (id == null || !id.matches("[1-9][0-9]{0,18}")) throw invalid();
            parsed = Long.parseLong(id);
        } catch (final RuntimeException exception) { throw invalid(); }
        final var matches = repository.find(parsed);
        if (matches.isEmpty()) throw new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND);
        return new BattleDataAdminDtos.Detail(matches.getFirst(), repository.vehicles(parsed));
    }
}
