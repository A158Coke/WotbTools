package com.wotbtools.keycloak.juheqq;

import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.keycloak.models.KeycloakSession;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JuheQqIdentityProviderTest {

    private JuheApiStub stub;
    private JuheQqIdentityProvider provider;

    @BeforeEach
    void setUp() throws IOException {
        stub = JuheApiStub.start();
        final KeycloakSession session = JuheQqTestSupport.sessionWith(JuheQqTestSupport.contextWith());
        provider = JuheQqTestSupport.providerWith(session, validConfig());
    }

    @AfterEach
    void tearDown() {
        stub.close();
    }

    private JuheQqIdentityProviderConfig validConfig() {
        return JuheQqTestSupport.configWith("appid-test", "appkey-test", stub.base());
    }

    @Test
    void configMissingReturnsNotConfiguredAndDoesNotHitHttp() {
        final KeycloakSession session = JuheQqTestSupport.sessionWith(JuheQqTestSupport.contextWith());
        final JuheQqIdentityProvider p = JuheQqTestSupport.providerWith(session,
                JuheQqTestSupport.configWith("", "", ""));
        final Response response = p.performLogin(null);
        assertEquals(500, response.getStatus());
        assertTrue(((String) response.getEntity()).contains("not configured"));
        assertEquals(0, stub.requestsWith("login"));
    }

    @Test
    void stateMissingReturnsSafeError() {
        final Response response = provider.performLogin(JuheQqTestSupport.requestWithState(null));
        assertEquals(500, response.getStatus());
        assertEquals("QQ login failed. Please try again.", response.getEntity());
        assertEquals(0, stub.requestsWith("login"));
    }

    @Test
    void loginHttpNon200ReturnsSafeError() {
        stub.respondStatus(500, "{\"code\":0}");
        final Response response = provider.buildLoginResponse(
                "appid-test", "appkey-test", stub.base(),
                "https://auth.wotbtools.com/realms/wotbtools/broker/juhe-qq/endpoint?state=s0",
                null, "juhe-qq");
        assertEquals(500, response.getStatus());
    }

    @Test
    void loginInvalidJsonReturnsSafeError() {
        stub.respond("not-json");
        final Response response = provider.buildLoginResponse(
                "appid-test", "appkey-test", stub.base(),
                "https://auth.wotbtools.com/realms/wotbtools/broker/juhe-qq/endpoint?state=s0",
                null, "juhe-qq");
        assertEquals(500, response.getStatus());
    }

    @Test
    void loginResponseRejectedReturnsSafeError() {
        stub.respond("{\"code\":1,\"type\":\"qq\",\"url\":\"https://graph.qq.com/x\"}");
        final Response response = provider.buildLoginResponse(
                "appid-test", "appkey-test", stub.base(),
                "https://auth.wotbtools.com/realms/wotbtools/broker/juhe-qq/endpoint?state=s0",
                null, "juhe-qq");
        assertEquals(500, response.getStatus());
    }

    @Test
    void loginSuccessStillRedirectsToProviderUrl() {
        stub.respond("{\"code\":0,\"type\":\"qq\",\"url\":\"https://graph.qq.com/login?token=abc\"}");
        final Response response = provider.buildLoginResponse(
                "appid-test", "appkey-test", stub.base(),
                "https://auth.wotbtools.com/realms/wotbtools/broker/juhe-qq/endpoint?state=s0",
                null, "juhe-qq");
        assertEquals(302, response.getStatus());
        assertEquals("https://graph.qq.com/login?token=abc", response.getHeaderString("Location"));
        assertEquals(1, stub.requestsWith("login"));
    }

    @Test
    void webViewMarkerDoesNotMatchOrdinaryAndroidChrome() {
        assertTrue(JuheQqIdentityProvider.isAndroidWebViewUserAgent(
                "Mozilla/5.0 (Linux; Android 15; PHU110 Build/X; wv) AppleWebKit/537.36 Version/4.0 Chrome/152 Mobile"));
        assertTrue(!JuheQqIdentityProvider.isAndroidWebViewUserAgent(
                "Mozilla/5.0 (Linux; Android 15; PHU110) AppleWebKit/537.36 Chrome/152 Mobile"));
    }

    @Test
    void loginExceptionReturnsSafeErrorWithoutLeaking() {
        final String base = stub.base();
        stub.close();
        final Response response = provider.buildLoginResponse(
                "appid-test", "appkey-test", base,
                "https://auth.wotbtools.com/realms/wotbtools/broker/juhe-qq/endpoint?state=s0",
                null, "juhe-qq");
        assertEquals(500, response.getStatus());
        assertEquals("QQ login failed. Please try again.", response.getEntity());
    }

    @Test
    void callbackRefIsStableOpaqueShortHash() {
        final String state = "state-super-secret-abc";
        final String ref1 = JuheQqIdentityProvider.callbackRef(state);
        final String ref2 = JuheQqIdentityProvider.callbackRef(state);
        assertEquals(ref1, ref2);
        assertEquals(8, ref1.length());
        assertTrue(!ref1.contains(state));
        assertNotEquals(ref1, JuheQqIdentityProvider.callbackRef("state-other"));
        assertEquals("unknown", JuheQqIdentityProvider.callbackRef(null));
        assertEquals("unknown", JuheQqIdentityProvider.callbackRef(""));
    }
}
