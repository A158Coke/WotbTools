package com.wotbtools.keycloak.juheqq;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Response;
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

        if (state == null || state.isBlank()) {
            return JuheQqIdentityProvider.errorResponse();
        }

        if (!"qq".equals(type)) {
            return JuheQqIdentityProvider.errorResponse();
        }

        if (code == null || code.isBlank()) {
            return JuheQqIdentityProvider.errorResponse();
        }

        // 通过 state 恢复 AuthenticationSession
        final AuthenticationSessionModel authenticationSession =
                authCallback.getAndVerifyAuthenticationSession(state);
        if (authenticationSession == null) {
            return JuheQqIdentityProvider.errorResponse();
        }
        session.getContext().setAuthenticationSession(authenticationSession);

        final String appid = config.getAppid();
        final String appkey = config.getAppkey();
        final String loginBaseUrl = config.getLoginBaseUrl();

        if (JuheQqIdentityProvider.isBlank(appid) || JuheQqIdentityProvider.isBlank(appkey)) {
            return JuheQqIdentityProvider.errorResponse();
        }

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

            if (httpResp.statusCode() != 200) {
                return JuheQqIdentityProvider.errorResponse();
            }

            final String body = httpResp.body();

            final JsonNode json = JuheQqIdentityProvider.MAPPER.readTree(body);
            final int respCode = json.path("code").asInt(-1);
            final String respType = json.path("type").asText("");
            final String socialUid = json.path("social_uid").asText("");

            if (respCode != 0) {
                return JuheQqIdentityProvider.errorResponse();
            }

            if (!"qq".equals(respType)) {
                return JuheQqIdentityProvider.errorResponse();
            }

            if (socialUid.isEmpty()) {
                return JuheQqIdentityProvider.errorResponse();
            }

            // ── 解析 Juhe callback 字段 ────────────────────────────────
            final String nickname = json.path("nickname").asText("");
            final String faceimg = json.path("faceimg").asText("");
            final String gender = json.path("gender").asText("");
            final String location = json.path("location").asText("");

            final String externalId = "qq:" + socialUid;
            final String username = sanitizeUsername(nickname, socialUid);

            final BrokeredIdentityContext context = new BrokeredIdentityContext(externalId, config);
            context.setId(externalId);
            context.setBrokerUserId(externalId);
            context.setBrokerSessionId(externalId);
            context.setUsername(username);
            context.setEmail(null);
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
            if (location != null && !location.isBlank() && !"null".equalsIgnoreCase(location)) {
                context.setUserAttribute("juhe.location", location);
            }

            return authCallback.authenticated(context);

        } catch (final IOException | InterruptedException | RuntimeException e) {
            return JuheQqIdentityProvider.errorResponse();
        }
    }

    // ── 辅助方法 ──────────────────────────────────────────────────────

    /**
     * 将 QQ 昵称安全化为 Keycloak username。
     * 昵称为空或清洗后为空时 fallback 到 qq_user_{hash}。
     */
    private static String sanitizeUsername(final String nickname, final String socialUid) {
        final String fallback = "qq_user_" + JuheQqIdentityProvider.sha256prefix(socialUid);

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
}
