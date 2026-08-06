package com.wotbtools.keycloak.wargaming;

import com.wotbtools.keycloak.wargaming.WargamingApiClient.WargamingApiException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.http.HttpClient;
import java.time.Duration;

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
        assertTrue(url.startsWith("https://api.wotblitz.asia/wot/auth/login/?application_id=app-123&redirect_uri="));
        assertTrue(url.contains("redirect_uri=https%3A%2F%2Fauth.wotbtools.com%2Fendpoint%3Fstate%3Ds+1"));
        assertTrue(url.endsWith("&nofollow=1"));
    }

    @Test
    void buildLoginUrlMapsEachRegionToItsOfficialWhitelistedHost() {
        assertTrue(WargamingApiClient.buildLoginUrl("a", "c", WargamingRegion.ASIA)
                .startsWith("https://api.wotblitz.asia/wot/auth/login/"));
        assertTrue(WargamingApiClient.buildLoginUrl("a", "c", WargamingRegion.EU)
                .startsWith("https://api.wotblitz.eu/wot/auth/login/"));
        assertTrue(WargamingApiClient.buildLoginUrl("a", "c", WargamingRegion.NA)
                .startsWith("https://api.wotblitz.com/wot/auth/login/"));
    }

    @Test
    void defaultClientAndBuildLoginUrlRejectNullRegion() {
        assertThrows(IllegalArgumentException.class,
                () -> WargamingApiClient.defaultClient(null));
        assertThrows(IllegalArgumentException.class,
                () -> WargamingApiClient.buildLoginUrl("a", "c", null));
    }

    @Test
    void fetchLoginRedirectUrlParsesJsonUrl() {
        stub.responses.put("/wot/auth/login/",
                "{\"status\":\"ok\",\"url\":\"https://wargaming.net/id/login\"}");
        assertEquals("https://wargaming.net/id/login",
                client.fetchLoginRedirectUrl("app-1", "https://auth.wotbtools.com/endpoint"));
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
}
