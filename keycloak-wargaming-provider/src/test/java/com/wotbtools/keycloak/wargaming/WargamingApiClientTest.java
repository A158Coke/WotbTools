package com.wotbtools.keycloak.wargaming;

import com.wotbtools.keycloak.wargaming.WargamingApiClient.WargamingApiException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.reflect.Proxy;
import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WargamingApiClientTest {

    private WargamingApiStub stub;
    private WargamingApiClient client;

    @BeforeEach
    void setUp() throws IOException {
        stub = WargamingApiStub.start();
        final HttpClient http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(2))
                .build();
        client = new WargamingApiClient(http, stub.authBase(), stub.accountBase());
    }

    @AfterEach
    void tearDown() {
        stub.close();
    }

    @Test
    void buildLoginUrlUsesFixedWhitelistAndEncodesParams() {
        final String url = WargamingApiClient.buildLoginUrl(
                "app-123", "https://auth.wotbtools.com/endpoint?state=s 1", WargamingRegion.ASIA);
        assertTrue(url.startsWith(
                "https://api.worldoftanks.asia/wot/auth/login/?application_id=app-123&redirect_uri="));
        assertTrue(url.contains("redirect_uri=https%3A%2F%2Fauth.wotbtools.com%2Fendpoint%3Fstate%3Ds+1"));
        assertTrue(url.endsWith("&nofollow=1"));
    }

    @Test
    void buildLoginUrlMapsEachRegionToItsOfficialWhitelistedHost() {
        assertTrue(WargamingApiClient.buildLoginUrl("a", "c", WargamingRegion.ASIA)
                .startsWith("https://api.worldoftanks.asia/wot/auth/login/"));
        assertTrue(WargamingApiClient.buildLoginUrl("a", "c", WargamingRegion.EU)
                .startsWith("https://api.worldoftanks.eu/wot/auth/login/"));
        assertTrue(WargamingApiClient.buildLoginUrl("a", "c", WargamingRegion.NA)
                .startsWith("https://api.worldoftanks.com/wot/auth/login/"));
    }

    @Test
    void defaultClientAndBuildLoginUrlRejectNullRegion() {
        assertThrows(IllegalArgumentException.class,
                () -> WargamingApiClient.defaultClient(null));
        assertThrows(IllegalArgumentException.class,
                () -> WargamingApiClient.buildLoginUrl("a", "c", null));
    }

    @Test
    void fetchLoginRedirectUrlReadsDataLocation() {
        stub.responses.put("/wot/auth/login/",
                "{\"status\":\"ok\",\"meta\":{\"count\":1},\"data\":{"
                        + "\"location\":\"https://asia.wargaming.net/id/openid/abc\"}}");
        assertEquals("https://asia.wargaming.net/id/openid/abc",
                client.fetchLoginRedirectUrl("app-1", "https://auth.wotbtools.com/endpoint"));
    }

    @Test
    void fetchLoginRedirectUrlRejectsResponseWithoutDataLocation() {
        stub.responses.put("/wot/auth/login/", "{\"status\":\"ok\",\"data\":{}}");
        final WargamingApiException e = assertThrows(WargamingApiException.class,
                () -> client.fetchLoginRedirectUrl("app-1", "https://auth.wotbtools.com/endpoint"));
        assertEquals("WG login response missing data.location", e.getMessage());
    }

    @Test
    void fetchLoginRedirectUrlStillAcceptsLegacyUrlField() {
        stub.responses.put("/wot/auth/login/",
                "{\"status\":\"ok\",\"url\":\"https://wargaming.net/id/login\"}");
        assertEquals("https://wargaming.net/id/login",
                client.fetchLoginRedirectUrl("app-1", "https://auth.wotbtools.com/endpoint"));
    }

    @Test
    void errorResponseYieldsSafeMessageWithoutValueOrApplicationId() {
        stub.responses.put("/wot/auth/login/", "{\"status\":\"error\",\"error\":{"
                + "\"field\":null,\"message\":\"METHOD_NOT_FOUND\",\"code\":404,"
                + "\"value\":\"/wot/auth/login/\"}}");
        final WargamingApiException e = assertThrows(WargamingApiException.class,
                () -> client.fetchLoginRedirectUrl("app-1", "https://auth.wotbtools.com/endpoint"));
        assertTrue(e.getMessage().contains("code=404"));
        assertTrue(e.getMessage().contains("METHOD_NOT_FOUND"));
        assertFalse(e.getMessage().contains("/wot/auth/login/"));
        assertFalse(e.getMessage().contains("app-1"));
    }

    @Test
    void actualRequestsUseAuthHostForAuthEndpointsAndAccountHostForAccountInfo() {
        final Map<String, String> responsesByPath = Map.of(
                "/wot/auth/login/", "{\"status\":\"ok\",\"data\":{"
                        + "\"location\":\"https://asia.wargaming.net/id/openid/x\"}}",
                "/wot/auth/prolongate/", "{\"status\":\"ok\",\"access_token\":\"t2\","
                        + "\"account_id\":1,\"expires_at\":9999999999}",
                "/wot/auth/logout/", "{\"status\":\"ok\"}",
                "/wotb/account/info/", "{\"status\":\"ok\",\"data\":{\"1\":{\"nickname\":\"P\"}}}");

        for (final WargamingRegion region : WargamingRegion.values()) {
            final List<String> seen = new CopyOnWriteArrayList<>();
            final WargamingApiClient hostClient = new WargamingApiClient(
                    region.authBase(), region.accountBase(), request -> {
                        seen.add(request.uri().toString());
                        final String path = request.uri().getPath();
                        return response(200,
                                responsesByPath.getOrDefault(path, "{\"status\":\"ok\"}"));
                    });

            assertEquals("https://asia.wargaming.net/id/openid/x",
                    hostClient.fetchLoginRedirectUrl("a", "c"));
            assertTrue(seen.get(0).startsWith(
                    "https://" + region.authHost() + "/wot/auth/login/"),
                    "login must use auth host for " + region);
            seen.clear();

            hostClient.prolongate("a", "t");
            assertTrue(seen.get(0).startsWith(
                    "https://" + region.authHost() + "/wot/auth/prolongate/"),
                    "prolongate must use auth host for " + region);
            seen.clear();

            hostClient.logout("a", "t");
            assertTrue(seen.get(0).startsWith(
                    "https://" + region.authHost() + "/wot/auth/logout/"),
                    "logout must use auth host for " + region);
            seen.clear();

            assertEquals("P", hostClient.fetchOfficialNickname("a", 1L, "t"));
            assertTrue(seen.get(0).startsWith(
                    "https://" + region.accountHost() + "/wotb/account/info/"),
                    "account/info must use account host for " + region);
        }
    }

    @Test
    void prolongateReturnsRefreshedToken() {
        stub.responses.put("/wot/auth/prolongate/",
                "{\"status\":\"ok\",\"access_token\":\"tok-2\",\"account_id\":512345678,"
                        + "\"expires_at\":9999999999}");
        final WargamingApiClient.ProlongatedToken result =
                client.prolongate("app-1", "tok-1");
        assertEquals("tok-2", result.accessToken());
        assertEquals(512345678L, result.accountId());
        assertEquals(9999999999L, result.expiresAt());
    }

    @Test
    void prolongateRejectsInvalidToken() {
        stub.responses.put("/wot/auth/prolongate/", "{\"status\":\"error\"}");
        assertThrows(WargamingApiException.class, () -> client.prolongate("app-1", "bad-token"));
    }

    @Test
    void prolongateRejectsResponseWithoutTrustedAccountId() {
        stub.responses.put("/wot/auth/prolongate/",
                "{\"status\":\"ok\",\"access_token\":\"tok-2\",\"expires_at\":9999999999}");
        assertThrows(WargamingApiException.class, () -> client.prolongate("app-1", "tok-1"));
    }

    @Test
    void prolongateRejectsInvalidAccountId() {
        stub.responses.put("/wot/auth/prolongate/",
                "{\"status\":\"ok\",\"access_token\":\"tok-2\",\"account_id\":0}");
        assertThrows(WargamingApiException.class, () -> client.prolongate("app-1", "tok-1"));
    }

    @Test
    void fetchOfficialNicknameReturnsOfficialValue() {
        stub.responses.put("/wotb/account/info/",
                "{\"status\":\"ok\",\"data\":{\"512345678\":{\"account_id\":512345678,\"nickname\":\"PlayerOne\"}}}");
        assertEquals("PlayerOne",
                client.fetchOfficialNickname("app-1", 512345678L, "tok-2"));
        assertTrue(stub.lastQueryByPath.get("/wotb/account/info/")
                .contains("access_token=tok-2"));
    }

    @Test
    void fetchOfficialNicknameFailsWhenAccountMissing() {
        stub.responses.put("/wotb/account/info/",
                "{\"status\":\"ok\",\"data\":{\"999\":{\"nickname\":\"Other\"}}}");
        assertThrows(WargamingApiException.class,
                () -> client.fetchOfficialNickname("app-1", 512345678L, "tok-2"));
    }

    @Test
    void logoutSucceedsOnOk() {
        stub.responses.put("/wot/auth/logout/", "{\"status\":\"ok\"}");
        client.logout("app-1", "tok-1");
        assertEquals(1, stub.logoutCalls());
    }

    @Test
    void logoutThrowsOnError() {
        stub.responses.put("/wot/auth/logout/", "{\"status\":\"error\"}");
        assertThrows(WargamingApiException.class, () -> client.logout("app-1", "tok-1"));
    }

    @Test
    void interruptedRequestsRestoreInterruptFlagOnBothHttpPaths() {
        final WargamingApiClient throwingClient = new WargamingApiClient(
                stub.authBase(), stub.accountBase(), request -> {
                    throw new InterruptedException("boom");
                });
        final Thread thread = Thread.currentThread();
        try {
            assertThrows(WargamingApiException.class,
                    () -> throwingClient.fetchLoginRedirectUrl(
                            "app-1", "https://auth.wotbtools.com/endpoint"));
            assertTrue(thread.isInterrupted());
            Thread.interrupted();

            assertThrows(WargamingApiException.class,
                    () -> throwingClient.fetchOfficialNickname("app-1", 512345678L, "tok"));
            assertTrue(thread.isInterrupted());
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void ioExceptionsDoNotMarkThreadInterruptedOnBothHttpPaths() {
        final WargamingApiClient throwingClient = new WargamingApiClient(
                stub.authBase(), stub.accountBase(), request -> {
                    throw new IOException("boom");
                });
        assertThrows(WargamingApiException.class,
                () -> throwingClient.fetchLoginRedirectUrl(
                        "app-1", "https://auth.wotbtools.com/endpoint"));
        assertFalse(Thread.currentThread().isInterrupted());

        assertThrows(WargamingApiException.class,
                () -> throwingClient.fetchOfficialNickname("app-1", 512345678L, "tok"));
        assertFalse(Thread.currentThread().isInterrupted());
    }

    private static HttpResponse<String> response(final int status, final String body) {
        return (HttpResponse<String>) Proxy.newProxyInstance(
                HttpResponse.class.getClassLoader(),
                new Class<?>[]{HttpResponse.class},
                (proxy, method, args) -> {
                    switch (method.getName()) {
                        case "statusCode":
                            return status;
                        case "body":
                            return body;
                        case "headers":
                            // 测试路径均为 200，不会访问 headers；302 兼容分支不覆盖。
                            return null;
                        default:
                            return null;
                    }
                });
    }
}
