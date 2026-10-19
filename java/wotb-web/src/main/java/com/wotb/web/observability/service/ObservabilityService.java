package com.wotb.web.observability.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Bounded telemetry intake. No persistent identity, arbitrary text, or raw client exception logging. */
@Service
public class ObservabilityService {
    private static final Logger log = LoggerFactory.getLogger(ObservabilityService.class);
    private static final Set<String> FIELDS = Set.of("event_id", "event", "platform", "feature", "occurred_at",
            "operation_id", "outcome", "error_code", "error_id");
    private static final Set<String> FEATURES = Set.of("home", "replay_parse", "replay_2d", "replay_3d", "replay_shots",
            "ai_review", "tankopedia", "armor", "hall_of_fame", "tournament", "android_download", "sponsor", "profile");
    private static final Set<String> ERRORS = Set.of("PARSE_FAILED", "UNSUPPORTED_REPLAY", "INVALID_REPLAY",
            "RESOURCE_UNAVAILABLE", "UNKNOWN");
    private final ObjectMapper mapper;
    private final String hashKey;
    private static final int AUTHENTICATED_EVENTS_PER_SUBJECT = 120;
    private static final int ANONYMOUS_EVENTS_PER_SOURCE = 120;
    private static final int AUTHENTICATED_EVENTS_PER_MINUTE = 6_000;
    private static final int ANONYMOUS_EVENTS_PER_MINUTE = 6_000;
    private static final int MAX_AUTHENTICATED_KEYS = 4_096;
    private static final int MAX_ANONYMOUS_KEYS = 4_096;
    // Ephemeral fixed-minute counters, never logged or persisted.
    private final Map<String, Integer> authenticatedSubjects = new HashMap<>();
    private final Map<String, Integer> anonymousSources = new HashMap<>();
    private final Clock clock;
    private long minute = Long.MIN_VALUE;
    private String sourceSalt;
    private int authenticatedTotal;
    private int anonymousTotal;

    @Autowired
    public ObservabilityService(final ObjectMapper mapper,
            @Value("${WOTB_OBSERVABILITY_HASH_KEY:}") final String hashKey) {
        this(mapper, hashKey, Clock.systemUTC());
    }

    public ObservabilityService(final ObjectMapper mapper, final String hashKey, final Clock clock) {
        this.mapper = mapper;
        this.hashKey = hashKey;
        this.clock = clock;
    }

    public void accept(final byte[] body, final Jwt jwt, final String clientSource) {
        if (body.length > 16_384) {
            throw rejected(HttpStatus.PAYLOAD_TOO_LARGE);
        }
        final JsonNode root;
        try {
            root = mapper.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(body);
        } catch (final RuntimeException exception) {
            throw rejected(HttpStatus.BAD_REQUEST);
        }
        if (root == null || !root.isObject() || root.size() != 1 || !root.has("events")) {
            throw rejected(HttpStatus.BAD_REQUEST);
        }
        final JsonNode events = root.get("events");
        if (!events.isArray() || events.isEmpty() || events.size() > 20) {
            throw rejected(HttpStatus.BAD_REQUEST);
        }
        final Instant now = clock.instant();
        // Validate the entire batch first so a rejected request never partially contributes events.
        for (final JsonNode event : events) {
            validate(event, jwt, now);
        }
        limit(jwt == null ? null : jwt.getSubject(), clientSource, events.size());
        for (final JsonNode event : events) {
            log.info("event=product_telemetry telemetry_event={} event_id={} platform={} feature={} occurred_at={} operation_id={} outcome={} error_code={} error_id={} account_hash={}",
                    text(event, "event"), text(event, "event_id"), text(event, "platform"), text(event, "feature"),
                    text(event, "occurred_at"), text(event, "operation_id"), text(event, "outcome"),
                    text(event, "error_code"), text(event, "error_id"),
                    "active_user".equals(text(event, "event")) ? hash(jwt.getSubject()) : "");
        }
    }

    private void validate(final JsonNode event, final Jwt jwt, final Instant now) {
        if (!event.isObject() || !FIELDS.containsAll(event.propertyNames())) {
            throw rejected(HttpStatus.BAD_REQUEST);
        }
        uuid(event, "event_id", true);
        final String type = text(event, "event");
        final String platform = text(event, "platform");
        final String feature = text(event, "feature");
        if (!Set.of("active_user", "feature_open", "replay_parse").contains(type)
                || !Set.of("web", "android").contains(platform)
                || !FEATURES.contains(feature)) {
            throw rejected(HttpStatus.BAD_REQUEST);
        }
        try {
            final Instant occurred = Instant.parse(text(event, "occurred_at"));
            if (occurred.isBefore(now.minusSeconds(86_400)) || occurred.isAfter(now.plusSeconds(300))) {
                throw rejected(HttpStatus.BAD_REQUEST);
            }
        } catch (final java.time.format.DateTimeParseException exception) {
            throw rejected(HttpStatus.BAD_REQUEST);
        }
        if ("active_user".equals(type)) {
            if (jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
                throw rejected(HttpStatus.UNAUTHORIZED);
            }
            if (hashKey.length() < 32) {
                throw rejected(HttpStatus.SERVICE_UNAVAILABLE);
            }
        }
        final boolean androidDownloadSignal = "feature_open".equals(type)
                && "web".equals(platform) && "android_download".equals(feature);
        if ("replay_parse".equals(type)) {
            uuid(event, "operation_id", true);
            if (!"replay_parse".equals(feature)
                    || !Set.of("start", "success", "failure", "cancelled").contains(text(event, "outcome"))) {
                throw rejected(HttpStatus.BAD_REQUEST);
            }
        } else if (androidDownloadSignal) {
            // New APK-button clicks carry operation_id as a marker. Legacy page-open events did not;
            // accept them for rolling compatibility, but the Android Downloads dashboard excludes them.
            uuid(event, "operation_id", false);
            if (event.has("outcome")) {
                throw rejected(HttpStatus.BAD_REQUEST);
            }
        } else if (event.has("outcome") || event.has("operation_id")) {
            throw rejected(HttpStatus.BAD_REQUEST);
        }
        if (event.has("error_code") || event.has("error_id")) {
            if (!"replay_parse".equals(type) || !"failure".equals(text(event, "outcome"))
                    || (event.has("error_code") && !ERRORS.contains(text(event, "error_code")))) {
                throw rejected(HttpStatus.BAD_REQUEST);
            }
            uuid(event, "error_id", false);
        }
    }

    private synchronized void limit(final String subject, final String clientSource, final int cost) {
        final long current = clock.millis() / 60_000;
        if (current != minute) {
            authenticatedSubjects.clear();
            anonymousSources.clear();
            authenticatedTotal = 0;
            anonymousTotal = 0;
            sourceSalt = UUID.randomUUID().toString();
            minute = current;
        }
        final boolean authenticated = subject != null && !subject.isBlank();
        final Map<String, Integer> counters = authenticated ? authenticatedSubjects : anonymousSources;
        final String key = authenticated ? subject : anonymousSourceKey(clientSource);
        final int count = counters.getOrDefault(key, 0);
        final int total = authenticated ? authenticatedTotal : anonymousTotal;
        final int sourceLimit = authenticated ? AUTHENTICATED_EVENTS_PER_SUBJECT : ANONYMOUS_EVENTS_PER_SOURCE;
        final int globalLimit = authenticated ? AUTHENTICATED_EVENTS_PER_MINUTE : ANONYMOUS_EVENTS_PER_MINUTE;
        final int maxKeys = authenticated ? MAX_AUTHENTICATED_KEYS : MAX_ANONYMOUS_KEYS;
        // Check every bound before mutation: rejected requests consume no capacity.
        if (count + cost > sourceLimit || total + cost > globalLimit
                || (!counters.containsKey(key) && counters.size() >= maxKeys)) {
            throw rejected(HttpStatus.TOO_MANY_REQUESTS);
        }
        counters.put(key, count + cost);
        if (authenticated) {
            authenticatedTotal += cost;
        } else {
            anonymousTotal += cost;
        }
    }

    private String anonymousSourceKey(final String clientSource) {
        try {
            // Minute-specific hash: this is a rate-limit source, never an analytics identity.
            final MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest((sourceSalt + ":" + clientSource)
                    .getBytes(StandardCharsets.UTF_8)));
        } catch (final NoSuchAlgorithmException exception) {
            throw new IllegalStateException("Telemetry source hashing unavailable", exception);
        }
    }

    private String hash(final String subject) {
        if (hashKey.length() < 32 || subject == null) {
            return "";
        }
        try {
            final Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(hashKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(subject.getBytes(StandardCharsets.UTF_8)));
        } catch (final GeneralSecurityException exception) {
            throw new IllegalStateException("Telemetry hashing unavailable", exception);
        }
    }

    private static void uuid(final JsonNode event, final String field, final boolean required) {
        if (!required && !event.has(field)) {
            return;
        }
        try {
            final String value = text(event, field);
            if (!UUID.fromString(value).toString().equalsIgnoreCase(value)) {
                throw rejected(HttpStatus.BAD_REQUEST);
            }
        } catch (final IllegalArgumentException exception) {
            throw rejected(HttpStatus.BAD_REQUEST);
        }
    }

    private static String text(final JsonNode event, final String field) {
        final JsonNode value = event.get(field);
        if (value == null) {
            return "";
        }
        if (!value.isString()) {
            throw rejected(HttpStatus.BAD_REQUEST);
        }
        return value.asString();
    }

    private static ResponseStatusException rejected(final HttpStatus status) {
        return new ResponseStatusException(status);
    }
}
