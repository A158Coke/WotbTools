package com.wotb.web.battledata.service;

import com.wotb.web.battledata.dto.BattleDataRequest;
import com.wotb.web.battledata.repository.BattleDataRepository;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import com.wotb.web.util.admission.AnonymousAdmission;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigInteger;
import java.io.IOException;
import java.io.InputStream;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** 严格验证先于事务；未知形状不占 arenaId，写入失败不暴露 SQL 或原始载荷。 */
@Service
public class BattleDataService {
    private static final JsonMapper JSON = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
            .enable(DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY).build();
    private static final Set<String> FIELDS = Set.of("schemaVersion", "arenaId", "arenaBonusType", "mapId",
            "mapKey", "clientVersion", "winnerTeam", "teams");
    private static final Set<String> TEAM_FIELDS = Set.of("team", "spawn", "vehicles");
    private static final Map<String, String> OPPOSITE = Map.of("NORTH", "SOUTH", "SOUTH", "NORTH", "WEST", "EAST", "EAST", "WEST");
    private static final Pattern ARENA = Pattern.compile("[1-9][0-9]{0,19}");
    private static final Pattern MAP = Pattern.compile("[a-z0-9_]{1,128}");
    private static final Pattern VERSION = Pattern.compile("[A-Za-z0-9._-]{1,64}");
    private static final BigInteger MAX_ARENA = new BigInteger("18446744073709551615");
    private final BattleDataRepository repository;
    private final TransactionTemplate transaction;
    private final AnonymousAdmission admission;
    private final boolean enabled;
    private final Counter created;
    private final Counter duplicate;
    private final Counter invalid;
    private final Counter oversized;
    private final Counter rateLimited;

    public BattleDataService(final BattleDataRepository repository, final PlatformTransactionManager transactions,
            final MeterRegistry meters, @Value("${battle-data.enabled:true}") final boolean enabled,
            @Value("${battle-data.per-source-per-minute:60}") final int perSource,
            @Value("${battle-data.per-instance-per-minute:3000}") final int global,
            @Value("${battle-data.max-source-keys:4096}") final int maxKeys) {
        this.repository = repository;
        transaction = new TransactionTemplate(transactions);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.enabled = enabled;
        admission = new AnonymousAdmission(Clock.systemUTC(), perSource, global, maxKeys);
        created = meters.counter("battle_data.created");
        duplicate = meters.counter("battle_data.duplicate");
        invalid = meters.counter("battle_data.rejected", "reason", "schema");
        oversized = meters.counter("battle_data.rejected", "reason", "size");
        rateLimited = meters.counter("battle_data.rate_limited");
    }

    public boolean accept(final InputStream input, final String source) {
        if (!enabled) { throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE); }
        final byte[] body;
        try {
            body = input.readNBytes(16_385);
        } catch (final IOException exception) {
            invalid.increment();
            throw new ApiException(ApiErrorCode.INVALID_REQUEST);
        }
        if (body.length > 16_384) {
            oversized.increment();
            throw new ApiException(ApiErrorCode.FILE_TOO_LARGE);
        }
        if (!admission.tryAcquire(source, 1)) {
            rateLimited.increment();
            throw new ApiException(ApiErrorCode.RATE_LIMITED);
        }
        return ingest(body);
    }

    public boolean ingest(final byte[] body) {
        final BattleDataRequest request;
        try {
            request = decode(body);
        } catch (final ApiException exception) {
            invalid.increment();
            throw exception;
        }
        final boolean stored;
        try {
            stored = Boolean.TRUE.equals(transaction.execute(status -> repository.insert(request)));
        } catch (final RuntimeException exception) {
            // The canonical handler can log this safe exception; never retain SQL detail or payload in its cause.
            throw new ApiException(ApiErrorCode.INTERNAL_ERROR);
        }
        (stored ? created : duplicate).increment();
        return stored;
    }

    private static BattleDataRequest decode(final byte[] body) {
        try {
            final JsonNode root = JSON.readTree(body);
            shape(root, FIELDS);
            final int schema = integer(root.get("schemaVersion"), 1, 1);
            final String arena = text(root.get("arenaId"), ARENA);
            require(new BigInteger(arena).compareTo(MAX_ARENA) <= 0);
            final int mode = integer(root.get("arenaBonusType"), 1, 7);
            require(mode == 1 || mode == 7);
            final int mapId = integer(root.get("mapId"), 1, Integer.MAX_VALUE);
            final String mapKey = text(root.get("mapKey"), MAP);
            final String version = text(root.get("clientVersion"), VERSION);
            final int winner = integer(root.get("winnerTeam"), 0, 2);
            final JsonNode teams = root.get("teams");
            require(teams != null && teams.isArray() && teams.size() == 2);
            final List<BattleDataRequest.Team> parsed = new ArrayList<>();
            for (final JsonNode team : teams) {
                shape(team, TEAM_FIELDS);
                final int id = integer(team.get("team"), 1, 2);
                final JsonNode side = team.get("spawn");
                require(side != null && side.isString() && OPPOSITE.containsKey(side.asString()));
                final JsonNode vehicles = team.get("vehicles");
                require(vehicles != null && vehicles.isArray() && vehicles.size() == 7);
                final List<Integer> ids = new ArrayList<>();
                for (final JsonNode vehicle : vehicles) {
                    ids.add(integer(vehicle, 1, Integer.MAX_VALUE));
                }
                parsed.add(new BattleDataRequest.Team(id, side.asString(), ids));
            }
            require(parsed.get(0).team() != parsed.get(1).team()
                    && OPPOSITE.get(parsed.get(0).spawn()).equals(parsed.get(1).spawn()));
            return new BattleDataRequest(schema, arena, mode, mapId, mapKey, version, winner, parsed);
        } catch (final RuntimeException exception) {
            throw new ApiException(ApiErrorCode.INVALID_REQUEST);
        }
    }

    private static void shape(final JsonNode node, final Set<String> fields) {
        require(node != null && node.isObject() && node.size() == fields.size()
                && fields.containsAll(node.propertyNames()));
    }

    private static int integer(final JsonNode node, final int minimum, final int maximum) {
        require(node != null && node.isNumber());
        final int value = node.decimalValue().intValueExact();
        require(value >= minimum && value <= maximum);
        return value;
    }

    private static String text(final JsonNode node, final Pattern pattern) {
        require(node != null && node.isString() && pattern.matcher(node.asString()).matches());
        return node.asString();
    }

    private static void require(final boolean condition) {
        if (!condition) {
            throw new ApiException(ApiErrorCode.INVALID_REQUEST);
        }
    }
}
