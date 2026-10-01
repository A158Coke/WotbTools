package com.wotb.web.util.observability;

import com.wotb.core.observability.ApplicationLogger;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.event.Level;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Untrusted reports have a closed schema, bounded size, and fixed diagnostic codes. */
@Service
public class ClientEventService {
    private static final Logger LOGGER = LoggerFactory.getLogger(ClientEventService.class);
    private static final JsonMapper MAPPER = JsonMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    private static final Set<String> FIELDS = Set.of("event", "platform", "errorCode", "correlationId", "stage", "clientSessionId");
    private static final Map<String, String> EVENTS = Map.of(
            "client.bootstrap_failed", "CLIENT_BOOTSTRAP_FAILED",
            "client.wasm_load_failed", "CLIENT_WASM_LOAD_FAILED",
            "client.android_webview_failed", "CLIENT_WEBVIEW_FAILED",
            "client.auth_init_timeout", "AUTH_INIT_TIMEOUT",
            "client.auth_init_failed", "AUTH_INIT_FAILED",
            "client.auth_login_failed", "AUTH_LOGIN_FAILED",
            "client.auth_token_refresh_failed", "AUTH_TOKEN_REFRESH_FAILED",
            "client.native_auth_return_received", "NATIVE_AUTH_RETURN_RECEIVED",
            "client.native_auth_return_rejected", "NATIVE_AUTH_RETURN_REJECTED",
            "client.native_auth_webview_handoff", "NATIVE_AUTH_WEBVIEW_HANDOFF");
    private static final Map<String, String> AUTH_STAGES = Map.of(
            "client.auth_init_timeout", "init", "client.auth_init_failed", "init",
            "client.auth_login_failed", "login", "client.auth_token_refresh_failed", "token-refresh",
            "client.native_auth_return_received", "auth-return", "client.native_auth_return_rejected", "auth-return",
            "client.native_auth_webview_handoff", "webview-handoff");
    private final Map<String, Integer> peers = new HashMap<>();
    private long windowStart;
    private int total;

    public HttpStatus accept(final HttpServletRequest request) throws IOException {
        final var authentication = SecurityContextHolder.getContext().getAuthentication();
        final boolean authenticated = authentication instanceof JwtAuthenticationToken && authentication.isAuthenticated();
        final String peer = authenticated
                ? "user:" + ((JwtAuthenticationToken) authentication).getToken().getSubject()
                : "peer:" + request.getRemoteAddr();
        if (!allow(peer, authenticated ? 10 : 300, System.currentTimeMillis())) return HttpStatus.TOO_MANY_REQUESTS;
        if (request.getContentLengthLong() > 4096) return HttpStatus.CONTENT_TOO_LARGE;
        final byte[] bytes = request.getInputStream().readNBytes(4097);
        if (bytes.length > 4096) return HttpStatus.CONTENT_TOO_LARGE;
        final JsonNode node;
        try {
            node = MAPPER.readTree(bytes);
        } catch (final tools.jackson.core.JacksonException invalid) {
            return HttpStatus.BAD_REQUEST;
        }
        if (node == null || !node.isObject() || node.size() < 3 || node.size() > 6
                || node.propertyStream().anyMatch(entry -> !FIELDS.contains(entry.getKey())
                        || !entry.getValue().isTextual())) return HttpStatus.BAD_REQUEST;
        final String event = node.path("event").asText();
        final String platform = node.path("platform").asText();
        final String errorCode = node.path("errorCode").asText();
        if (!errorCode.equals(EVENTS.get(event)) || !("web".equals(platform) || "android".equals(platform))
                || ((event.equals("client.android_webview_failed") || event.startsWith("client.native_auth_")) && !platform.equals("android"))) {
            return HttpStatus.BAD_REQUEST;
        }
        final String stage = node.path("stage").asText("");
        final String clientSessionId = node.path("clientSessionId").asText("");
        final String correlationId = node.path("correlationId").asText("");
        final String expectedStage = AUTH_STAGES.get(event);
        if ((expectedStage != null && (!expectedStage.equals(stage) || !validUuid(clientSessionId)))
                || (expectedStage == null && (node.has("stage") || node.has("clientSessionId")))
                || (node.has("correlationId") && !validUuid(correlationId))) return HttpStatus.BAD_REQUEST;
        final boolean success = event.equals("client.native_auth_return_received")
                || event.equals("client.native_auth_webview_handoff");
        final var log = ApplicationLogger.event(LOGGER, success ? Level.INFO : Level.WARN, event)
                .addKeyValue("platform", platform).addKeyValue("errorCode", errorCode)
                .addKeyValue("outcome", success ? "succeeded" : "failed");
        if (!correlationId.isEmpty()) log.addKeyValue("correlationId", correlationId);
        if (expectedStage != null) log.addKeyValue("stage", stage).addKeyValue("clientSessionId", clientSessionId);
        log.log("Allowlisted critical client event reported");
        return HttpStatus.NO_CONTENT;
    }

    private static boolean validUuid(final String value) {
        try {
            return UUID.fromString(value).toString().equalsIgnoreCase(value);
        } catch (final IllegalArgumentException invalid) {
            return false;
        }
    }

    // Ignore forwarded headers so clients cannot invent a throttle identity; bound memory to 300 peers.
    private synchronized boolean allow(final String peer, final int limit, final long now) {
        if (now - windowStart >= 60_000) {
            peers.clear();
            total = 0;
            windowStart = now;
        }
        final int count = peers.getOrDefault(peer, 0);
        if (total >= 300 || count >= limit) return false;
        peers.put(peer, count + 1);
        total++;
        return true;
    }
}
