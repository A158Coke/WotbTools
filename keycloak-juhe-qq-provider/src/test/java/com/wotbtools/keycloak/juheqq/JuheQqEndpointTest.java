package com.wotbtools.keycloak.juheqq;

import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.keycloak.broker.provider.BrokeredIdentityContext;
import org.keycloak.models.KeycloakSession;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * JuheQqEndpoint（callback）诊断 stage 覆盖：进入对应诊断路径，不泄漏敏感值，
 * exception path 有日志入口，且不改变既有成功登录协议行为。
 */
class JuheQqEndpointTest {

    private static final String VALID_STATE = "state-valid";

    private JuheApiStub stub;
    private JuheQqEndpoint endpoint;
    private JuheQqTestSupport.AuthCallbackFake authFake;
    private JuheQqIdentityProviderConfig config;

    @BeforeEach
    void setUp() throws IOException {
        stub = JuheApiStub.start();
        authFake = new JuheQqTestSupport.AuthCallbackFake(VALID_STATE);
        final KeycloakSession session = JuheQqTestSupport.sessionWith(JuheQqTestSupport.contextWith());
        config = JuheQqTestSupport.configWith("appid-test", "appkey-test", stub.base());
        endpoint = new JuheQqEndpoint(session, null, config, authFake.callback());
    }

    @AfterEach
    void tearDown() {
        stub.close();
    }

    @Test
    void brokerAuthenticatedPreservesProtocol() {
        stub.respond("{\"code\":0,\"type\":\"qq\",\"social_uid\":\"12345\",\"nickname\":\"PlayerOne\"}");

        try (LogCapture capture = new LogCapture()) {
            final Response response = endpoint.handleCallback(VALID_STATE, "qq", "code-1");

            assertEquals(200, response.getStatus());
            final BrokeredIdentityContext context = authFake.captured;
            assertNotNull(context);
            assertEquals("qq:12345", context.getBrokerUserId());
            assertEquals("PlayerOne", context.getUserAttribute("displayName"));
            assertEquals("CN", context.getUserAttribute("region"));
            assertEquals("qq", context.getUserAttribute("juhe.provider"));
            assertEquals("12345", context.getUserAttribute("juhe.social_uid"));
            assertEquals(1, stub.requestsWith("callback"));
            assertTrue(capture.messages().stream()
                            .anyMatch(m -> m.contains("stage=broker_authenticated ")),
                    "authenticated() 成功返回后必须记录 broker_authenticated 成功日志");
        }
    }

    @Test
    void brokerAuthenticatedFailureLogsFailureStageAndNotFalseSuccess() {
        stub.respond("{\"code\":0,\"type\":\"qq\",\"social_uid\":\"12345\",\"nickname\":\"PlayerOne\"}");
        authFake.failOnAuthenticated = true;

        try (LogCapture capture = new LogCapture()) {
            final Response response = endpoint.handleCallback(VALID_STATE, "qq", "code-1");

            assertEquals(500, response.getStatus());
            assertNull(authFake.captured, "authenticated() 抛出异常，不得捕获成功上下文");
            final List<String> messages = capture.messages();
            assertTrue(messages.stream().anyMatch(m -> m.contains("stage=broker_authenticated_failed")),
                    "必须记录属于 broker authenticated 阶段的失败日志");
            assertFalse(messages.stream().anyMatch(m -> m.contains("stage=broker_authenticated ")),
                    "authenticated() 抛出异常时不得出现 broker_authenticated 假成功日志");
        }
    }

    @Test
    void callbackStateMissingRejected() {
        assertEquals(500, endpoint.handleCallback(null, "qq", "code-1").getStatus());
    }

    @Test
    void callbackTypeInvalidRejected() {
        assertEquals(500, endpoint.handleCallback(VALID_STATE, "wechat", "code-1").getStatus());
    }

    @Test
    void callbackCodeMissingRejected() {
        assertEquals(500, endpoint.handleCallback(VALID_STATE, "qq", null).getStatus());
    }

    @Test
    void authenticationSessionRestoreRejected() {
        assertEquals(500, endpoint.handleCallback("state-wrong", "qq", "code-1").getStatus());
    }

    @Test
    void configMissingRejected() {
        config.getConfig().put(JuheQqIdentityProviderConfig.CONFIG_APPID, "");
        assertEquals(500, endpoint.handleCallback(VALID_STATE, "qq", "code-1").getStatus());
    }

    @Test
    void callbackHttpNon200Rejected() {
        stub.respondStatus(500, "{\"code\":0}");
        assertEquals(500, endpoint.handleCallback(VALID_STATE, "qq", "code-1").getStatus());
    }

    @Test
    void callbackInvalidJsonRejected() {
        stub.respond("not-json");
        assertEquals(500, endpoint.handleCallback(VALID_STATE, "qq", "code-1").getStatus());
    }

    @Test
    void callbackResponseRejected() {
        stub.respond("{\"code\":1,\"type\":\"qq\",\"social_uid\":\"12345\",\"nickname\":\"N\"}");
        assertEquals(500, endpoint.handleCallback(VALID_STATE, "qq", "code-1").getStatus());
    }

    @Test
    void callbackWrongProviderTypeRejected() {
        stub.respond("{\"code\":0,\"type\":\"wechat\",\"social_uid\":\"12345\",\"nickname\":\"N\"}");
        assertEquals(500, endpoint.handleCallback(VALID_STATE, "qq", "code-1").getStatus());
    }

    @Test
    void callbackMissingSocialUidRejected() {
        stub.respond("{\"code\":0,\"type\":\"qq\",\"social_uid\":\"\",\"nickname\":\"N\"}");
        assertEquals(500, endpoint.handleCallback(VALID_STATE, "qq", "code-1").getStatus());
    }

    @Test
    void nicknameInvalidRejected() {
        stub.respond("{\"code\":0,\"type\":\"qq\",\"social_uid\":\"12345\",\"nickname\":\"   \"}");
        assertEquals(400, endpoint.handleCallback(VALID_STATE, "qq", "code-1").getStatus());
        assertNull(authFake.captured);
    }

    @Test
    void callbackExceptionLogsAndReturnsSafeError() {
        final String base = stub.base();
        stub.close(); // 连接被拒 → IOException → callback_exception

        final Response response = endpoint.handleCallback(VALID_STATE, "qq", "code-1");

        assertEquals(500, response.getStatus());
        assertNull(authFake.captured);
    }

    @Test
    void sensitiveValuesNeverLeakIntoUserFacingResponse() {
        config.getConfig().put(JuheQqIdentityProviderConfig.CONFIG_APP_KEY, "SECRET_APPKEY");
        config.getConfig().put(JuheQqIdentityProviderConfig.CONFIG_APPID, "");

        final Response response = endpoint.handleCallback(VALID_STATE, "qq", "SECRET_CODE");

        assertEquals(500, response.getStatus());
        final String entity = (String) response.getEntity();
        assertTrue(!entity.contains("SECRET_APPKEY"), "must not leak appkey");
        assertTrue(!entity.contains("SECRET_CODE"), "must not leak authorization code");
    }

    @Test
    void callbackStagesFollowExpectedOrderWithSingleOpaqueCallbackRef() {
        stub.respond("{\"code\":0,\"type\":\"qq\",\"social_uid\":\"12345\",\"nickname\":\"PlayerOne\"}");

        try (LogCapture capture = new LogCapture()) {
            final Response response = endpoint.handleCallback(VALID_STATE, "qq", "code-1");
            assertEquals(200, response.getStatus());

            final List<String> stages = capture.messages().stream()
                    .filter(m -> m.contains("stage=callback_entered")
                            || m.contains("stage=authentication_session_restored")
                            || m.contains("stage=juhe_callback_accepted")
                            || m.contains("stage=before_broker_authenticated")
                            || m.contains("stage=broker_authenticated"))
                    .map(JuheQqEndpointTest::stage)
                    .collect(Collectors.toList());

            assertEquals(5, stages.size(), "must trace all 5 callback stages in the success flow");
            assertEquals(List.of("callback_entered", "authentication_session_restored",
                    "juhe_callback_accepted", "before_broker_authenticated", "broker_authenticated"), stages);

            final List<String> refs = capture.messages().stream()
                    .filter(m -> m.contains("stage=callback_entered")
                            || m.contains("stage=authentication_session_restored")
                            || m.contains("stage=juhe_callback_accepted")
                            || m.contains("stage=before_broker_authenticated")
                            || m.contains("stage=broker_authenticated"))
                    .map(JuheQqEndpointTest::callbackRef)
                    .distinct()
                    .collect(Collectors.toList());
            assertEquals(1, refs.size(), "all callback stages must carry the same callbackRef");
            assertFalse(refs.get(0).isEmpty(), "callbackRef must be present and non-empty");
        }
    }

    @Test
    void sensitiveValuesNeverLeakIntoDiagnosticLogs() {
        final String state = "state-opaque-9f3a";
        final String code = "code-secret-7b1c";
        final String socialUid = "social-secret-4d8e";
        final JuheQqTestSupport.AuthCallbackFake auth = new JuheQqTestSupport.AuthCallbackFake(state);
        final KeycloakSession session = JuheQqTestSupport.sessionWith(JuheQqTestSupport.contextWith());
        final JuheQqIdentityProviderConfig config = JuheQqTestSupport.configWith(
                "appid-test", "appkey-secret-5f20", stub.base());
        final JuheQqEndpoint ep = new JuheQqEndpoint(session, null, config, auth.callback());
        stub.respond("{\"code\":0,\"type\":\"qq\",\"social_uid\":\"" + socialUid + "\",\"nickname\":\"PlayerOne\"}");

        try (LogCapture capture = new LogCapture()) {
            final Response response = ep.handleCallback(state, "qq", code);
            assertEquals(200, response.getStatus());

            final List<String> messages = capture.messages();
            assertFalse(messages.stream().anyMatch(m -> m.contains(state)), "must not log raw state");
            assertFalse(messages.stream().anyMatch(m -> m.contains(code)), "must not log authorization code");
            assertFalse(messages.stream().anyMatch(m -> m.contains(socialUid)), "must not log social_uid original value");
            assertFalse(messages.stream().anyMatch(m -> m.contains("appkey-secret-5f20")), "must not log appkey");
        }
    }

    /** 从结构化日志行中抽取 stage 名。 */
    private static String stage(final String message) {
        final Matcher m = Pattern.compile("stage=([a-zA-Z_]+)").matcher(message);
        return m.find() ? m.group(1) : "";
    }

    /** 从结构化日志行中抽取 callbackRef（8 位 hex）。 */
    private static String callbackRef(final String message) {
        final Matcher m = Pattern.compile("callbackRef=([0-9a-f]{8})").matcher(message);
        return m.find() ? m.group(1) : "";
    }
}
