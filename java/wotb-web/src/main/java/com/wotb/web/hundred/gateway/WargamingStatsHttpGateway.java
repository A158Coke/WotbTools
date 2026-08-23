package com.wotb.web.hundred.gateway;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.function.Function;

/**
 * WG 官方统计 HTTP 网关。生产 host 只能来自 {@link WargamingServer}，不接受 URL 输入；
 * application id、完整响应和用户身份值均不写日志或异常正文。
 */
@Service
public class WargamingStatsHttpGateway {

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private static final String ACCOUNT_FIELDS = "account_id,nickname,statistics.all.battles";
    private static final String TANK_FIELDS = "tank_id,all.battles,all.damage_dealt";

    private final String applicationId;
    private final HttpClient httpClient;
    private final Function<WargamingServer, URI> baseUriResolver;
    private final Duration requestTimeout;

    public WargamingStatsHttpGateway(
            @Value("${wotb.wargaming.application-id:}") final String applicationId) {
        this(applicationId,
                HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build(),
                WargamingServer::accountApiBase,
                REQUEST_TIMEOUT);
    }

    /** 测试构造器：仅包内测试可把固定 host 映射到本地 HTTP stub。 */
    WargamingStatsHttpGateway(final String applicationId,
                              final HttpClient httpClient,
                              final Function<WargamingServer, URI> baseUriResolver,
                              final Duration requestTimeout) {
        this.applicationId = StringUtils.hasText(applicationId) ? applicationId.trim() : "";
        this.httpClient = httpClient;
        this.baseUriResolver = baseUriResolver;
        this.requestTimeout = requestTimeout;
    }

    public WargamingOfficialStats fetch(final WargamingServer server,
                                        final long accountId,
                                        final long vehicleId) {
        if (!StringUtils.hasText(applicationId)) {
            throw error(HttpStatus.SERVICE_UNAVAILABLE, "HUNDRED_WARGAMING_NOT_CONFIGURED");
        }
        if (server == null || accountId <= 0 || vehicleId <= 0) {
            throw error(HttpStatus.BAD_REQUEST, "HUNDRED_WARGAMING_INVALID_RESPONSE");
        }

        final String accountKey = Long.toString(accountId);
        final JsonNode accountRoot = get(server, "account/info/", accountId, null, ACCOUNT_FIELDS);
        final JsonNode account = accountRoot.path("data").path(accountKey);
        if (!account.isObject()) {
            throw error(HttpStatus.BAD_REQUEST, "HUNDRED_WARGAMING_STATS_NOT_FOUND");
        }
        final long returnedAccountId = requiredPositiveLong(account.get("account_id"));
        final String nickname = account.path("nickname").asText("").trim();
        final long accountBattles = requiredNonNegativeLong(
                account.path("statistics").path("all").get("battles"));
        if (returnedAccountId != accountId || !StringUtils.hasText(nickname)) {
            throw error(HttpStatus.BAD_GATEWAY, "HUNDRED_WARGAMING_INVALID_RESPONSE");
        }

        final JsonNode tankRoot = get(server, "tanks/stats/", accountId, vehicleId, TANK_FIELDS);
        final JsonNode tanks = tankRoot.path("data").path(accountKey);
        if (!tanks.isArray()) {
            throw error(HttpStatus.BAD_REQUEST, "HUNDRED_WARGAMING_STATS_NOT_FOUND");
        }
        JsonNode target = null;
        for (final JsonNode tank : tanks) {
            if (tank != null && tank.isObject()
                    && tank.path("tank_id").canConvertToLong()
                    && tank.path("tank_id").asLong() == vehicleId) {
                target = tank;
                break;
            }
        }
        if (target == null) {
            throw error(HttpStatus.BAD_REQUEST, "HUNDRED_WARGAMING_STATS_NOT_FOUND");
        }
        final long tankBattles = requiredNonNegativeLong(target.path("all").get("battles"));
        final long tankDamage = requiredNonNegativeLong(target.path("all").get("damage_dealt"));
        return new WargamingOfficialStats(server.name(), accountId, nickname,
                accountBattles, vehicleId, tankBattles, tankDamage);
    }

    private JsonNode get(final WargamingServer server,
                         final String endpoint,
                         final long accountId,
                         final Long vehicleId,
                         final String fields) {
        final StringBuilder query = new StringBuilder()
                .append("application_id=").append(encode(applicationId))
                .append("&account_id=").append(accountId)
                .append("&fields=").append(encode(fields));
        if (vehicleId != null) {
            query.append("&tank_id=").append(vehicleId);
        }
        final URI uri = URI.create(baseUriResolver.apply(server).resolve(endpoint) + "?" + query);
        final HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(requestTimeout)
                .GET()
                .build();
        final HttpResponse<String> response;
        try {
            response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (final HttpTimeoutException e) {
            throw error(HttpStatus.SERVICE_UNAVAILABLE, "HUNDRED_WARGAMING_UNAVAILABLE");
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
            throw error(HttpStatus.SERVICE_UNAVAILABLE, "HUNDRED_WARGAMING_UNAVAILABLE");
        } catch (final IOException e) {
            throw error(HttpStatus.SERVICE_UNAVAILABLE, "HUNDRED_WARGAMING_UNAVAILABLE");
        }
        if (response.statusCode() == 429) {
            throw error(HttpStatus.TOO_MANY_REQUESTS, "HUNDRED_WARGAMING_RATE_LIMITED");
        }
        if (response.statusCode() != 200) {
            throw error(HttpStatus.SERVICE_UNAVAILABLE, "HUNDRED_WARGAMING_UNAVAILABLE");
        }
        final JsonNode root;
        try {
            root = MAPPER.readTree(response.body());
        } catch (final Exception e) {
            throw error(HttpStatus.BAD_GATEWAY, "HUNDRED_WARGAMING_INVALID_RESPONSE");
        }
        if (root == null || !root.isObject()) {
            throw error(HttpStatus.BAD_GATEWAY, "HUNDRED_WARGAMING_INVALID_RESPONSE");
        }
        if (!"ok".equals(root.path("status").asText(""))) {
            throw error(HttpStatus.SERVICE_UNAVAILABLE, "HUNDRED_WARGAMING_UNAVAILABLE");
        }
        return root;
    }

    private static long requiredPositiveLong(final JsonNode node) {
        final long value = requiredNonNegativeLong(node);
        if (value <= 0) {
            throw error(HttpStatus.BAD_GATEWAY, "HUNDRED_WARGAMING_INVALID_RESPONSE");
        }
        return value;
    }

    private static long requiredNonNegativeLong(final JsonNode node) {
        if (node == null || !node.isIntegralNumber() || !node.canConvertToLong()) {
            throw error(HttpStatus.BAD_GATEWAY, "HUNDRED_WARGAMING_INVALID_RESPONSE");
        }
        final long value = node.asLong();
        if (value < 0) {
            throw error(HttpStatus.BAD_GATEWAY, "HUNDRED_WARGAMING_INVALID_RESPONSE");
        }
        return value;
    }

    private static String encode(final String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static ResponseStatusException error(final HttpStatus status, final String code) {
        return new ResponseStatusException(status, code);
    }
}
