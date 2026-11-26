package com.wotbtools.keycloak.wargaming;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

final class WargamingApiClient {

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final URI authApiBase;
    private final URI accountApiBase;
    private final HttpSender sender;

    WargamingApiClient(final HttpClient http, final URI authApiBase, final URI accountApiBase) {
        this(authApiBase, accountApiBase,
                request -> http.send(request, HttpResponse.BodyHandlers.ofString()));
    }

    WargamingApiClient(final URI authApiBase, final URI accountApiBase,
                       final HttpSender sender) {
        this.authApiBase = authApiBase;
        this.accountApiBase = accountApiBase;
        this.sender = sender;
    }

    static WargamingApiClient defaultClient(final WargamingRegion region) {
        if (region == null) {
            throw new IllegalArgumentException("Wargaming region must not be null");
        }
        final HttpClient http = HttpClient.newBuilder()
                .connectTimeout(CONNECT_TIMEOUT)
                .build();
        return new WargamingApiClient(http, region.authBase(), region.accountBase());
    }

    /**
     * 构造 WG 登录跳转地址（纯函数，便于单测）。
     *
     * @param applicationId WG 应用 ID
     * @param callbackUrl   Keycloak broker endpoint（含 state）
     * @param region        区服（决定白名单 host）
     */
    static String buildLoginUrl(final String applicationId, final String callbackUrl,
                                final WargamingRegion region) {
        if (region == null) {
            throw new IllegalArgumentException("Wargaming region must not be null");
        }
        return region.authBase().resolve("login/") + "?application_id=" + encode(applicationId)
                + "&redirect_uri=" + encode(callbackUrl)
                + "&nofollow=1";
    }

    String fetchLoginRedirectUrl(final String applicationId, final String callbackUrl) {
        final URI uri = URI.create(authApiBase.resolve("login/") + "?application_id="
                + encode(applicationId) + "&redirect_uri=" + encode(callbackUrl) + "&nofollow=1");
        final HttpRequest request = HttpRequest.newBuilder()
                .uri(uri)
                .GET()
                .timeout(REQUEST_TIMEOUT)
                .build();
        try {
            final HttpResponse<String> response = sender.send(request);
            if (response.statusCode() == 302) {
                final String location = response.headers().firstValue("Location").orElse("");
                if (!location.isEmpty()) {
                    return location;
                }
                throw new WargamingApiException("WG login redirect missing Location");
            }
            if (response.statusCode() != 200) {
                throw new WargamingApiException(
                        "WG login returned HTTP " + response.statusCode());
            }
            final JsonNode json = parse(response.body());
            requireStatusOk(json);
            final String location = json.path("data").path("location").asText("");
            if (!location.isEmpty()) {
                return location;
            }
            final String legacyUrl = json.path("url").asText("");
            if (legacyUrl.isEmpty()) {
                throw new WargamingApiException("WG login response missing data.location");
            }
            return legacyUrl;
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new WargamingApiException("WG login request interrupted", e);
        } catch (final IOException e) {
            throw new WargamingApiException("WG login request failed", e);
        }
    }

    ProlongatedToken prolongate(final String applicationId, final String accessToken) {
        final String body = postForm(authApiBase.resolve("prolongate/"),
                "application_id=" + encode(applicationId)
                        + "&access_token=" + encode(accessToken));
        final JsonNode json = parse(body);
        requireStatusOk(json);
        final JsonNode payload = responsePayload(json);
        final String token = payload.path("access_token").asText("");
        if (token.isEmpty()) {
            throw new WargamingApiException("WG prolongate response missing access_token");
        }
        final long accountId = requirePositiveAccountId(payload.path("account_id"));
        final long expiresAt = payload.path("expires_at").asLong(0L);
        return new ProlongatedToken(token, accountId, expiresAt);
    }

    String fetchOfficialNickname(final String applicationId, final long accountId,
                                 final String accessToken) {
        final String accountIdText = Long.toString(accountId);
        final URI uri = URI.create(accountApiBase.resolve("info/") + "?application_id="
                + encode(applicationId) + "&account_id=" + accountIdText
                + "&access_token=" + encode(accessToken));
        final HttpRequest request = HttpRequest.newBuilder()
                .uri(uri)
                .GET()
                .timeout(REQUEST_TIMEOUT)
                .build();
        final String body = send(request);
        final JsonNode json = parse(body);
        requireStatusOk(json);
        final JsonNode account = json.path("data").path(accountIdText);
        final String nickname = account.path("nickname").asText("");
        if (nickname.isEmpty()) {
            throw new WargamingApiException("WG account/info did not return the account");
        }
        return nickname;
    }

    void logout(final String applicationId, final String accessToken) {
        final String body = postForm(authApiBase.resolve("logout/"),
                "application_id=" + encode(applicationId)
                        + "&access_token=" + encode(accessToken));
        final JsonNode json = parse(body);
        requireStatusOk(json);
    }

    private String postForm(final URI uri, final String formBody) {
        final HttpRequest request = HttpRequest.newBuilder()
                .uri(uri)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(formBody, StandardCharsets.UTF_8))
                .timeout(REQUEST_TIMEOUT)
                .build();
        return send(request);
    }

    private String send(final HttpRequest request) {
        try {
            final HttpResponse<String> response = sender.send(request);
            if (response.statusCode() != 200) {
                throw new WargamingApiException("WG API returned HTTP " + response.statusCode());
            }
            return response.body();
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new WargamingApiException("WG API request interrupted", e);
        } catch (final IOException e) {
            throw new WargamingApiException("WG API request failed", e);
        }
    }

    private static JsonNode parse(final String body) {
        try {
            return MAPPER.readTree(body);
        } catch (final IOException e) {
            throw new WargamingApiException("WG API returned invalid JSON", e);
        }
    }

    private static void requireStatusOk(final JsonNode json) {
        if ("ok".equals(json.path("status").asText(""))) {
            return;
        }

        final JsonNode error = json.path("error");
        final int code = error.path("code").asInt(0);
        final String message = error.path("message").asText("UNKNOWN");
        final String field = error.path("field").asText("");

        final String safeMessage = field.isBlank()
                ? "WG API rejected request: code=" + code + ", message=" + message
                : "WG API rejected request: code=" + code
                        + ", message=" + message
                        + ", field=" + field;
        throw new WargamingApiException(safeMessage);
    }

    private static String encode(final String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static long requirePositiveAccountId(final JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull() || !node.canConvertToLong()) {
            throw new WargamingApiException("WG prolongate response missing account_id");
        }
        final long value = node.asLong();
        if (value <= 0) {
            throw new WargamingApiException("WG prolongate response invalid account_id");
        }
        return value;
    }

    private static JsonNode responsePayload(final JsonNode json) {
        final JsonNode data = json.path("data");
        return data.isObject() ? data : json;
    }

    @FunctionalInterface
    interface HttpSender {
        HttpResponse<String> send(HttpRequest request) throws IOException, InterruptedException;
    }

    record ProlongatedToken(String accessToken, long accountId, long expiresAt) {
    }

    static final class WargamingApiException extends RuntimeException {
        WargamingApiException(final String message) {
            super(message);
        }

        WargamingApiException(final String message, final Throwable cause) {
            super(message, cause);
        }
    }
}
