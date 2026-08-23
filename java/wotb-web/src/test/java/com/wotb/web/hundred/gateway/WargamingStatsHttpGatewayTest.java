package com.wotb.web.hundred.gateway;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** WG 统计网关：固定 host、编码、成功、限流、超时与畸形响应。 */
class WargamingStatsHttpGatewayTest {

    private static final long ACCOUNT_ID = 512_345_678L;
    private static final long VEHICLE_ID = 385L;

    @Test
    void serverWhitelistUsesOnlyOfficialAccountHosts() {
        assertThat(WargamingServer.ASIA.accountApiBase().getHost()).isEqualTo("api.wotblitz.asia");
        assertThat(WargamingServer.EU.accountApiBase().getHost()).isEqualTo("api.wotblitz.eu");
        assertThat(WargamingServer.NA.accountApiBase().getHost()).isEqualTo("api.wotblitz.com");
        assertThat(WargamingServer.fromCode("CN")).isNull();
    }

    @Test
    void fetchReadsOfficialTotalsAndEncodesMinimalQueriesForAllServers() throws Exception {
        try (final Stub stub = new Stub()) {
            stub.accountBody = accountBody(5_000);
            stub.tankBody = tankBody(100, 390_000);
            final WargamingStatsHttpGateway gateway = gateway(
                    "app id+secret", stub, Duration.ofSeconds(2));

            for (final WargamingServer server : WargamingServer.values()) {
                final WargamingOfficialStats stats = gateway.fetch(server, ACCOUNT_ID, VEHICLE_ID);
                assertThat(stats.server()).isEqualTo(server.name());
                assertThat(stats.accountId()).isEqualTo(ACCOUNT_ID);
                assertThat(stats.nickname()).isEqualTo("PlayerOne");
                assertThat(stats.accountBattleCount()).isEqualTo(5_000);
                assertThat(stats.tankBattleCount()).isEqualTo(100);
                assertThat(stats.tankDamageDealt()).isEqualTo(390_000);
            }

            assertThat(stub.paths).anyMatch(path -> path.startsWith("/asia/wotb/account/info/"));
            assertThat(stub.paths).anyMatch(path -> path.startsWith("/eu/wotb/tanks/stats/"));
            assertThat(stub.paths).anyMatch(path -> path.startsWith("/na/wotb/account/info/"));
            assertThat(stub.queries).allMatch(query -> query.contains("application_id=app+id%2Bsecret"));
            assertThat(stub.queries).anyMatch(query -> query.contains("tank_id=" + VEHICLE_ID));
            assertThat(stub.queries).noneMatch(query -> query.contains("access_token"));
        }
    }

    @Test
    void missingConfigurationFailsBeforeNetwork() {
        final WargamingStatsHttpGateway gateway = new WargamingStatsHttpGateway(
                "", HttpClient.newHttpClient(), WargamingServer::accountApiBase, Duration.ofSeconds(1));

        assertCode(() -> gateway.fetch(WargamingServer.ASIA, ACCOUNT_ID, VEHICLE_ID),
                HttpStatus.SERVICE_UNAVAILABLE, "HUNDRED_WARGAMING_NOT_CONFIGURED");
    }

    @Test
    void rateLimitAndWargamingErrorReturnStableCodes() throws Exception {
        try (final Stub stub = new Stub()) {
            stub.accountStatus = 429;
            final WargamingStatsHttpGateway gateway = gateway("app", stub, Duration.ofSeconds(1));
            assertCode(() -> gateway.fetch(WargamingServer.ASIA, ACCOUNT_ID, VEHICLE_ID),
                    HttpStatus.TOO_MANY_REQUESTS, "HUNDRED_WARGAMING_RATE_LIMITED");
        }
        try (final Stub stub = new Stub()) {
            stub.accountBody = "{\"status\":\"error\",\"error\":{\"value\":\"secret\"}}";
            final WargamingStatsHttpGateway gateway = gateway("app", stub, Duration.ofSeconds(1));
            assertCode(() -> gateway.fetch(WargamingServer.ASIA, ACCOUNT_ID, VEHICLE_ID),
                    HttpStatus.SERVICE_UNAVAILABLE, "HUNDRED_WARGAMING_UNAVAILABLE");
        }
    }

    @Test
    void timeoutMalformedAndMissingTankReturnStableCodes() throws Exception {
        try (final Stub stub = new Stub()) {
            stub.delayMillis = 200;
            final WargamingStatsHttpGateway gateway = gateway("app", stub, Duration.ofMillis(20));
            assertCode(() -> gateway.fetch(WargamingServer.ASIA, ACCOUNT_ID, VEHICLE_ID),
                    HttpStatus.SERVICE_UNAVAILABLE, "HUNDRED_WARGAMING_UNAVAILABLE");
        }
        try (final Stub stub = new Stub()) {
            stub.accountBody = "not-json";
            final WargamingStatsHttpGateway gateway = gateway("app", stub, Duration.ofSeconds(1));
            assertCode(() -> gateway.fetch(WargamingServer.ASIA, ACCOUNT_ID, VEHICLE_ID),
                    HttpStatus.BAD_GATEWAY, "HUNDRED_WARGAMING_INVALID_RESPONSE");
        }
        try (final Stub stub = new Stub()) {
            stub.accountBody = accountBody(5_000);
            stub.tankBody = "{\"status\":\"ok\",\"data\":{\"" + ACCOUNT_ID + "\":[]}}";
            final WargamingStatsHttpGateway gateway = gateway("app", stub, Duration.ofSeconds(1));
            assertCode(() -> gateway.fetch(WargamingServer.ASIA, ACCOUNT_ID, VEHICLE_ID),
                    HttpStatus.BAD_REQUEST, "HUNDRED_WARGAMING_STATS_NOT_FOUND");
        }
    }

    private static WargamingStatsHttpGateway gateway(final String applicationId,
                                                      final Stub stub,
                                                      final Duration timeout) {
        final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build();
        return new WargamingStatsHttpGateway(applicationId, client,
                server -> stub.base(server.name().toLowerCase()), timeout);
    }

    private static void assertCode(final org.assertj.core.api.ThrowableAssert.ThrowingCallable action,
                                   final HttpStatus status,
                                   final String code) {
        assertThatThrownBy(action)
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> {
                    final ResponseStatusException response = (ResponseStatusException) error;
                    assertThat(response.getStatusCode()).isEqualTo(status);
                    assertThat(response.getReason()).isEqualTo(code);
                });
    }

    private static String accountBody(final long battles) {
        return """
                {"status":"ok","data":{"%d":{"account_id":%d,"nickname":"PlayerOne",
                "statistics":{"all":{"battles":%d}}}}}
                """.formatted(ACCOUNT_ID, ACCOUNT_ID, battles).replace("\n", "");
    }

    private static String tankBody(final long battles, final long damage) {
        return "{\"status\":\"ok\",\"data\":{\"" + ACCOUNT_ID + "\":[{"
                + "\"tank_id\":" + VEHICLE_ID + ",\"all\":{\"battles\":" + battles
                + ",\"damage_dealt\":" + damage + "}}]}}";
    }

    private static final class Stub implements AutoCloseable {
        private final HttpServer server;
        private final List<String> paths = new ArrayList<>();
        private final List<String> queries = new ArrayList<>();
        private volatile String accountBody = accountBody(5_000);
        private volatile String tankBody = tankBody(100, 390_000);
        private volatile int accountStatus = 200;
        private volatile long delayMillis;

        private Stub() throws IOException {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", this::handle);
            server.start();
        }

        private URI base(final String region) {
            return URI.create("http://127.0.0.1:" + server.getAddress().getPort()
                    + "/" + region + "/wotb/");
        }

        private void handle(final HttpExchange exchange) throws IOException {
            paths.add(exchange.getRequestURI().getPath());
            queries.add(exchange.getRequestURI().getRawQuery());
            if (delayMillis > 0) {
                try {
                    Thread.sleep(delayMillis);
                } catch (final InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            final boolean account = exchange.getRequestURI().getPath().endsWith("/account/info/");
            final int status = account ? accountStatus : 200;
            final byte[] body = (account ? accountBody : tankBody).getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        }

        @Override
        public void close() {
            server.stop(0);
        }
    }
}
