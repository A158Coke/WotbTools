package com.wotbtools.keycloak.juheqq;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;
import org.keycloak.broker.provider.BrokeredIdentityContext;
import org.keycloak.broker.provider.UserAuthenticationIdentityProvider.AuthenticationCallback;
import org.keycloak.models.KeycloakSession;
import org.keycloak.sessions.AuthenticationSessionModel;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public final class JuheQqEndpoint {

    private static final Logger logger = Logger.getLogger(JuheQqEndpoint.class);

    private final KeycloakSession session;
    private final JuheQqIdentityProvider provider;
    private final JuheQqIdentityProviderConfig config;
    private final AuthenticationCallback authCallback;

    public JuheQqEndpoint(final KeycloakSession session,
                          final JuheQqIdentityProvider provider,
                          final JuheQqIdentityProviderConfig config,
                          final AuthenticationCallback authCallback) {
        this.session = session;
        this.provider = provider;
        this.config = config;
        this.authCallback = authCallback;
    }

    @GET
    @Path("")
    public Response handleCallback(@QueryParam("state") final String state,
                                   @QueryParam("type") final String type,
                                   @QueryParam("code") final String code) {
        logger.info("juhe-qq endpoint entered");  // TODO: remove after verification

        if (state == null || state.isBlank()) {
            logger.error("juhe-qq: callback missing state");
            return errorResponse();
        }

        if (!"qq".equals(type)) {
            logger.errorf("juhe-qq: callback type mismatch '%s'", type);
            return errorResponse();
        }

        if (code == null || code.isBlank()) {
            logger.error("juhe-qq: callback missing code");
            return errorResponse();
        }

        // 通过 state 恢复 AuthenticationSession
        final AuthenticationSessionModel authenticationSession =
                authCallback.getAndVerifyAuthenticationSession(state);
        if (authenticationSession == null) {
            logger.error("juhe-qq: authenticationSession not found via state");
            return errorResponse();
        }
        session.getContext().setAuthenticationSession(authenticationSession);

        final String appid = config.getAppid();
        final String appkey = config.getAppkey();
        final String loginBaseUrl = config.getLoginBaseUrl();

        if (isBlank(appid) || isBlank(appkey)) {
            logger.error("juhe-qq: callback missing credentials");
            return errorResponse();
        }

        logger.info("juhe-qq act=callback request prepared");  // TODO: remove after verification

        final String actCallbackUrl = loginBaseUrl
                + "?act=callback&appid=" + JuheQqIdentityProvider.encode(appid)
                + "&appkey=" + JuheQqIdentityProvider.encode(appkey)
                + "&type=qq&code=" + JuheQqIdentityProvider.encode(code);

        try {
            final HttpRequest httpReq = HttpRequest.newBuilder()
                    .uri(URI.create(actCallbackUrl))
                    .GET()
                    .timeout(Duration.ofSeconds(10))
                    .build();

            final HttpResponse<String> httpResp = JuheQqIdentityProvider.HTTP
                    .send(httpReq, HttpResponse.BodyHandlers.ofString());

            logger.infof("juhe-qq act=callback HTTP %d", httpResp.statusCode());  // TODO: remove after verification

            if (httpResp.statusCode() != 200) {
                logger.errorf("juhe-qq act=callback failed HTTP %d, body=%s",
                        httpResp.statusCode(), JuheQqIdentityProvider.truncate(httpResp.body(), 500));
                return errorResponse();
            }

            final String body = httpResp.body();
            logger.infof("juhe-qq act=callback raw response body: %s",  // TODO: remove after verification
                    JuheQqIdentityProvider.truncate(body, 2000));

            final JsonNode json = JuheQqIdentityProvider.MAPPER.readTree(body);
            final int respCode = json.path("code").asInt(-1);
            final String respMsg = json.path("msg").asText("");
            final String respType = json.path("type").asText("");
            final String socialUid = json.path("social_uid").asText("");

            if (respCode != 0) {
                logger.errorf("juhe-qq act=callback provider error: code=%d msg=%s", respCode, respMsg);
                return errorResponse();
            }

            if (!"qq".equals(respType)) {
                logger.errorf("juhe-qq act=callback type mismatch, expected=qq actual=%s", respType);
                return errorResponse();
            }

            if (socialUid.isEmpty()) {
                logger.errorf("juhe-qq act=callback social_uid missing, body prefix=%s",
                        JuheQqIdentityProvider.truncate(body, 500));
                return errorResponse();
            }

            // ── 解析 Juhe callback 字段 ────────────────────────────────
            final String nickname = json.path("nickname").asText("");
            final String faceimg = json.path("faceimg").asText("");
            final String gender = json.path("gender").asText("");
            final String location = json.path("location").asText("");

            final String externalId = "qq:" + socialUid;
            final String username = sanitizeUsername(nickname, socialUid);

            // 临时使用 nickname@qq.com，待确认 API 返回字段后再调整
            final String emailLocalPart = sanitizeEmailLocalPart(nickname, socialUid);
            final String email = emailLocalPart + "@qq.com";

            final BrokeredIdentityContext context = new BrokeredIdentityContext(externalId, config);
            context.setId(externalId);
            context.setBrokerUserId(externalId);
            context.setBrokerSessionId(externalId);
            context.setUsername(username);
            context.setEmail(email);
            context.setName(nickname);
            context.setIdp(provider);
            context.setAuthenticationSession(authenticationSession);

            context.setUserAttribute("juhe.provider", "qq");
            context.setUserAttribute("juhe.social_uid", socialUid);
            context.setUserAttribute("juhe.nickname", nickname);
            context.setUserAttribute("juhe.username_source", "nickname");
            if (!faceimg.isEmpty()) {
                context.setUserAttribute("juhe.faceimg", faceimg);
            }
            if (!gender.isEmpty()) {
                context.setUserAttribute("juhe.gender", gender);
            }
            if (!location.isEmpty()) {
                context.setUserAttribute("juhe.location", location);
            }

            logger.infof(
                    "juhe-qq authenticated context: providerCode=%d, providerMsg=%s, socialUid=%s, username=%s, email=%s, nickname=%s, location=%s, gender=%s, idpConfig=%s, idp=%s, authSession=%s",  // TODO: remove after verification
                    respCode, respMsg, "present",
                    context.getUsername(),
                    email != null && !email.isBlank() ? "present" : "absent",
                    nickname != null && !nickname.isBlank() ? "present" : "absent",
                    location != null && !location.isBlank() ? location : "absent",
                    gender != null && !gender.isBlank() ? gender : "absent",
                    context.getIdpConfig() != null ? "present" : "absent",
                    context.getIdp() != null ? "present" : "absent",
                    context.getAuthenticationSession() != null ? "present" : "absent");

            logger.info("juhe-qq calling callback.authenticated");  // TODO: remove after verification
            try {
                final Response response = authCallback.authenticated(context);
                final String redirectLocation = response.getHeaderString("Location");
                logger.infof("juhe-qq callback.authenticated returned status=%d location=%s",  // TODO: remove after verification
                        response.getStatus(), redirectLocation);
                return response;
            } catch (final Throwable t) {
                logger.error("juhe-qq callback.authenticated failed", t);
                throw t;
            }

        } catch (final IOException | InterruptedException | RuntimeException e) {
            logger.error("juhe-qq login failed", e);
            return errorResponse();
        }
    }

    // ── 辅助方法 ──────────────────────────────────────────────────────

    /**
     * 将昵称安全化为 email local part（@ 左边部分）。
     * 昵称为空或清洗后为空时 fallback 到 qq_{hash}。
     */
    private static String sanitizeEmailLocalPart(final String nickname, final String socialUid) {
        final String fallback = "qq_" + JuheQqIdentityProvider.sha256prefix(socialUid, 12);

        if (nickname == null || nickname.isBlank()) {
            return fallback;
        }

        String value = nickname.trim().toLowerCase();

        value = value.replaceAll("[^a-z0-9.\\-_]", "_");
        value = value.replaceAll("_{2,}", "_");
        value = value.replaceAll("^[^a-z0-9]+", "");
        value = value.replaceAll("[^a-z0-9]+$", "");

        if (value.isBlank() || value.length() < 2) {
            return fallback;
        }

        if (value.length() > 48) {
            value = value.substring(0, 48);
        }

        return value;
    }

    /**
     * 将 QQ 昵称安全化为 Keycloak username。
     * 昵称为空或清洗后为空时 fallback 到 qq_user_{hash}。
     */
    private static String sanitizeUsername(final String nickname, final String socialUid) {
        final String fallback = "qq_user_" + JuheQqIdentityProvider.sha256prefix(socialUid, 12);

        if (nickname == null || nickname.isBlank()) {
            return fallback;
        }

        String value = nickname.trim();

        value = value.replaceAll("[\\p{Cntrl}]", "");
        value = value.replaceAll("[/@\\\\:?#\\[\\]{}|<>\"']", "_");
        value = value.replaceAll("\\s+", "_");

        if (value.isBlank()) {
            return fallback;
        }

        if (value.length() > 64) {
            value = value.substring(0, 64);
        }

        return value;
    }

    private static Response errorResponse() {
        return Response.status(500)
                .entity("QQ login failed. Please try again.")
                .build();
    }

    private static boolean isBlank(final String s) {
        return s == null || s.isBlank();
    }
}
