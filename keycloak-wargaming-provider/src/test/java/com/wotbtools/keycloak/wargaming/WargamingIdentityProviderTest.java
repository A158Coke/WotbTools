package com.wotbtools.keycloak.wargaming;

import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.keycloak.broker.provider.BrokeredIdentityContext;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.UserModel;

import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WargamingIdentityProviderTest {

    @AfterEach
    void resetEnvOverride() {
        WargamingIdentityProvider.applicationIdOverride = null;
    }

    private WargamingIdentityProvider provider() {
        final KeycloakSession session = KeycloakFakes.sessionWith(KeycloakFakes.contextWith());
        return new TestableProvider(session);
    }

    private WargamingIdentityProvider providerWithClient(final WargamingApiClient client) {
        final KeycloakSession session = KeycloakFakes.sessionWith(KeycloakFakes.contextWith());
        return new TestableProvider(session, client);
    }

    private static final class TestableProvider extends WargamingIdentityProvider {
        TestableProvider(final KeycloakSession session) {
            super(session, new WargamingIdentityProviderConfig());
        }

        TestableProvider(final KeycloakSession session,
                         final WargamingIdentityProviderConfig config) {
            super(session, config);
        }

        TestableProvider(final KeycloakSession session, final WargamingApiClient client) {
            super(session, new WargamingIdentityProviderConfig(), client);
        }

        @Override
        java.net.URI brokerEndpointUri() {
            return java.net.URI.create(
                    "https://auth.wotbtools.com/realms/wotbtools/broker/wargaming-asia/endpoint");
        }
    }

    @Test
    void applicationIdReturnsEnvOverrideWhenSet() {
        WargamingIdentityProvider.applicationIdOverride = "app-test";
        assertEquals("app-test", WargamingIdentityProvider.applicationId());
    }

    @Test
    void applicationIdIsNullWithoutEnv() {
        assertNull(WargamingIdentityProvider.applicationId());
    }

    @Test
    void buildLoginResponseRedirectsToWargamingLoginWithState() throws Exception {
        WargamingIdentityProvider.applicationIdOverride = "app-123";
        try (WargamingApiStub stub = WargamingApiStub.start()) {
            stub.responses.put("/wot/auth/login/",
                    "{\"status\":\"ok\",\"url\":\"https://wargaming.net/id/login?token=abc\"}");
            final HttpClient http = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(2))
                    .build();
            final WargamingApiClient client =
                    new WargamingApiClient(http, stub.authBase(), stub.accountBase());

            final Response response = providerWithClient(client).buildLoginResponse("app-123", "state-42");

            assertEquals(302, response.getStatus());
            assertEquals("https://wargaming.net/id/login?token=abc",
                    response.getHeaderString("Location"));
            final String requested = stub.requests.get(0);
            assertEquals("/wot/auth/login/", requested);
            final String query = stub.requestQuery();
            assertTrue(query.contains("application_id=app-123"));
            assertTrue(query.contains("nofollow=1"));
            assertTrue(query.contains("redirect_uri=" + URLEncoder.encode(
                    "https://auth.wotbtools.com/realms/wotbtools/broker/wargaming-asia/endpoint?state=state-42",
                    StandardCharsets.UTF_8)));
        }
    }

    @Test
    void updateBrokeredUserRefreshesMutableAttributesOnRepeatLogin() {
        final WargamingIdentityProvider provider = provider();
        final KeycloakFakes.UserModelFake userFake = new KeycloakFakes.UserModelFake();
        final UserModel user = userFake.user();

        final WargamingIdentityProviderConfig config = new WargamingIdentityProviderConfig();
        config.setEnabled(true);
        final BrokeredIdentityContext context = new BrokeredIdentityContext(
                "wg:asia:512345678", config);
        context.setUserAttribute("displayName", "NewNick");
        context.setUserAttribute("wotb.account_id", "512345678");
        context.setUserAttribute("wotb.nickname", "NewNick");

        provider.updateBrokeredUser(null, null, user, context);

        assertEquals(Map.of(
                "region", "ASIA",
                "displayName", "NewNick",
                "wotb.account_id", "512345678",
                "wotb.nickname", "NewNick",
                "wotb.verified", "true"), userFake.attributes);
    }

    @Test
    void updateBrokeredUserWritesRegionFromInstanceConfig() {
        final KeycloakSession session = KeycloakFakes.sessionWith(KeycloakFakes.contextWith());
        final WargamingIdentityProviderConfig config = new WargamingIdentityProviderConfig();
        config.setEnabled(true);
        config.getConfig().put(WargamingIdentityProviderConfig.REGION_CONFIG_KEY, "NA");
        final WargamingIdentityProvider provider = new TestableProvider(session, config);
        final KeycloakFakes.UserModelFake userFake = new KeycloakFakes.UserModelFake();
        final UserModel user = userFake.user();

        final BrokeredIdentityContext context =
                new BrokeredIdentityContext("wg:na:512345678", config);
        context.setUserAttribute("displayName", "NewNick");

        provider.updateBrokeredUser(null, null, user, context);

        assertEquals("NA", userFake.attributes.get("region"));
        assertEquals("NewNick", userFake.attributes.get("displayName"));
    }
}
