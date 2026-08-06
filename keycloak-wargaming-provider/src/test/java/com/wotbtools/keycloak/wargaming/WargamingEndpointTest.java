package com.wotbtools.keycloak.wargaming;

import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.keycloak.broker.provider.BrokeredIdentityContext;
import org.keycloak.models.KeycloakSession;

import java.io.IOException;
import java.net.http.HttpClient;
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WargamingEndpointTest {

    private static final String VALID_STATE = "state-valid";
    private static final String FUTURE_EXPIRY = "9999999999";

    private WargamingApiStub stub;
    private WargamingEndpoint endpoint;
    private KeycloakFakes.AuthCallbackFake authFake;
    private WargamingIdentityProviderConfig config;

    @BeforeEach
    void setUp() throws IOException {
        WargamingIdentityProvider.applicationIdOverride = "app-test";
        stub = WargamingApiStub.start();
        final HttpClient http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(2))
                .build();
        final WargamingApiClient client = new WargamingApiClient(http, stub.authBase(), stub.accountBase());
        authFake = new KeycloakFakes.AuthCallbackFake(VALID_STATE);
        final KeycloakSession session = KeycloakFakes.sessionWith(KeycloakFakes.contextWith());
        config = new WargamingIdentityProviderConfig();
        config.setEnabled(true);
        endpoint = new WargamingEndpoint(session, null,
                config, authFake.callback(), client);
    }

    @AfterEach
    void tearDown() {
        stub.close();
        WargamingIdentityProvider.applicationIdOverride = null;
    }

    private void okResponses() {
        stub.responses.put("/wot/auth/prolongate/",
                "{\"status\":\"ok\",\"access_token\":\"tok-2\",\"expires_at\":9999999999}");
        stub.responses.put("/wotb/account/info/",
                "{\"status\":\"ok\",\"data\":{\"512345678\":{\"account_id\":512345678,\"nickname\":\"PlayerOne\"}}}");
        stub.responses.put("/wot/auth/logout/", "{\"status\":\"ok\"}");
    }

    @Test
    void successCreatesStableIdentityWithAttributesAndLogsOut() {
        okResponses();
        final Response response = endpoint.handleCallback(
                VALID_STATE, "ok", "tok-1", "PlayerOne", "512345678", FUTURE_EXPIRY);

        assertEquals(200, response.getStatus());
        final BrokeredIdentityContext context = authFake.captured;
        assertNotNull(context);
        assertEquals("wg:asia:512345678", context.getBrokerUserId());
        assertEquals("wg:asia:512345678", context.getId());
        assertEquals("512345678", context.getUsername());
        assertEquals("ASIA", context.getUserAttribute("region"));
        assertEquals("PlayerOne", context.getUserAttribute("displayName"));
        assertEquals("512345678", context.getUserAttribute("wotb.account_id"));
        assertEquals("PlayerOne", context.getUserAttribute("wotb.nickname"));
        assertEquals("true", context.getUserAttribute("wotb.verified"));
        assertNull(context.getUserAttribute("access_token"));
        assertNull(context.getUserAttribute("wotb.token"));
        assertEquals(1, stub.logoutCalls());
    }

    @Test
    void europeanRegionUsesGenericBrokerAndRegionAttribute() {
        okResponses();
        config.getConfig().put(WargamingIdentityProviderConfig.REGION_CONFIG_KEY, "EU");

        final Response response = endpoint.handleCallback(
                VALID_STATE, "ok", "tok-1", "PlayerOne", "512345678", FUTURE_EXPIRY);

        assertEquals(200, response.getStatus());
        final BrokeredIdentityContext context = authFake.captured;
        assertNotNull(context);
        assertEquals("wg:eu:512345678", context.getBrokerUserId());
        assertEquals("wg:eu:512345678", context.getId());
        assertEquals("512345678", context.getUsername());
        assertEquals("EU", context.getUserAttribute("region"));
        assertEquals(1, stub.logoutCalls());
    }

    @Test
    void missingStateRejected() {
        assertEquals(500, endpoint.handleCallback(null, "ok", "t", "P", "1", FUTURE_EXPIRY).getStatus());
    }

    @Test
    void invalidStateRejected() {
        assertEquals(500, endpoint.handleCallback("state-wrong", "ok", "t", "P", "1", FUTURE_EXPIRY).getStatus());
    }

    @Test
    void wargamingDeniedLoginRejected() {
        assertEquals(500, endpoint.handleCallback(VALID_STATE, "error", "t", "P", "1", FUTURE_EXPIRY).getStatus());
    }

    @Test
    void missingTokenRejected() {
        assertEquals(500, endpoint.handleCallback(VALID_STATE, "ok", null, "P", "1", FUTURE_EXPIRY).getStatus());
    }

    @Test
    void invalidAccountIdRejected() {
        assertEquals(500, endpoint.handleCallback(VALID_STATE, "ok", "t", "P", "abc", FUTURE_EXPIRY).getStatus());
    }

    @Test
    void expiredTokenRejected() {
        assertEquals(500, endpoint.handleCallback(VALID_STATE, "ok", "t", "P", "1", "1").getStatus());
    }

    @Test
    void prolongateFailureRejectedAndTokenLoggedOut() {
        stub.responses.put("/wot/auth/prolongate/", "{\"status\":\"error\"}");
        stub.responses.put("/wot/auth/logout/", "{\"status\":\"ok\"}");
        assertEquals(500, endpoint.handleCallback(
                VALID_STATE, "ok", "tok-1", "P", "512345678", FUTURE_EXPIRY).getStatus());
        assertNull(authFake.captured);
        assertEquals(1, stub.logoutCalls());
    }

    @Test
    void accountInfoFailureRejected() {
        stub.responses.put("/wot/auth/prolongate/",
                "{\"status\":\"ok\",\"access_token\":\"tok-2\",\"expires_at\":9999999999}");
        stub.responses.put("/wotb/account/info/", "{\"status\":\"error\"}");
        assertEquals(500, endpoint.handleCallback(
                VALID_STATE, "ok", "tok-1", "P", "512345678", FUTURE_EXPIRY).getStatus());
        assertNull(authFake.captured);
    }

    @Test
    void nicknameMismatchRejected() {
        okResponses();
        assertEquals(500, endpoint.handleCallback(
                VALID_STATE, "ok", "tok-1", "FakeName", "512345678", FUTURE_EXPIRY).getStatus());
        assertNull(authFake.captured);
    }

    @Test
    void missingApplicationIdRejected() {
        WargamingIdentityProvider.applicationIdOverride = null;
        assertEquals(500, endpoint.handleCallback(
                VALID_STATE, "ok", "tok-1", "PlayerOne", "512345678", FUTURE_EXPIRY).getStatus());
        assertNull(authFake.captured);
    }

    @Test
    void logoutFailureDoesNotFailLogin() {
        okResponses();
        stub.responses.put("/wot/auth/logout/", "{\"status\":\"error\"}");
        final Response response = endpoint.handleCallback(
                VALID_STATE, "ok", "tok-1", "PlayerOne", "512345678", FUTURE_EXPIRY);
        assertEquals(200, response.getStatus());
        assertNotNull(authFake.captured);
        assertEquals(1, stub.logoutCalls());
    }
}
