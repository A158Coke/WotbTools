package com.wotbtools.keycloak.juheqq;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
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
    public Response handleCallback(@QueryParam("state") final String state,
                                   @QueryParam("type") final String type,
                                   @QueryParam("code") final String code) {
        logger.info("juhe-qq endpoint entered");  // TODO: remove after verification
        logger.debugf("juhe-qq endpoint: state=%s type=%s code=%s codeLength=%d",  // TODO: remove after verification
                state != null ? "present" : "absent",
                type != null && !type.isBlank() ? type : "absent",
                code != null ? "present" : "absent",
                code != null ? code.length() : 0);

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
        logger.debugf("juhe-qq: authenticationSession restored, clientId=%s",  // TODO: remove after verification
                authenticationSession.getClient() != null
                        ? authenticationSession.getClient().getClientId()
                        : "null");

        final String appid = config.getAppid();
        final String appkey = config.getAppkey();
        final String loginBaseUrl = config.getLoginBaseUrl();

        if (isBlank(appid) || isBlank(appkey)) {
            logger.error("juhe-qq: callback missing credentials");
            return errorResponse();
        }

        logger.info("juhe-qq act=callback request prepared");  // TODO: remove after verification
        logger.debugf("juhe-qq act=callback diag: appid=%s type=%s codeLength=%d baseUrl=%s",  // TODO: remove after verification
                appid != null ? "present" : "absent", "qq", code.length(),
                loginBaseUrl != null ? loginBaseUrl : "null");

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
            logger.debugf("juhe-qq act=callback response body prefix: %s",  // TODO: remove after verification
                    JuheQqIdentityProvider.truncate(httpResp.body(), 500));

            if (httpResp.statusCode() != 200) {
                logger.errorf("juhe-qq act=callback failed HTTP %d, body=%s",
                        httpResp.statusCode(), JuheQqIdentityProvider.truncate(httpResp.body(), 500));
                return errorResponse();
            }

            final String body = httpResp.body();
            final JsonNode json = JuheQqIdentityProvider.MAPPER.readTree(body);
            final int respCode = json.path("code").asInt(-1);
            final String respMsg = json.path("msg").asText("");
            final String respType = json.path("type").asText("");
            final String socialUid = json.path("social_uid").asText("");

            logger.debugf("juhe-qq act=callback parsed: providerCode=%d providerMsg=%s type=%s social_uid=%s",  // TODO: remove after verification
                    respCode, respMsg, respType, socialUid.isEmpty() ? "absent" : "present");

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

            final String nickname = json.path("nickname").asText("");
            final String faceimg = json.path("faceimg").asText("");
            final String gender = json.path("gender").asText("");
            final String location = json.path("location").asText("");

            final String externalId = "qq:" + socialUid;
            final String username = "juhe_qq_" + JuheQqIdentityProvider.sha256prefix(socialUid, 32);

            final BrokeredIdentityContext context = new BrokeredIdentityContext(
                    externalId, config);
            context.setId(externalId);
            context.setBrokerUserId(externalId);
            context.setBrokerSessionId(externalId);
            context.setUsername(username);
            context.setName(nickname);
            context.setFirstName(nickname);
            context.setLastName("-");
            context.setIdp(provider);
            context.setAuthenticationSession(authenticationSession);

            context.setUserAttribute("juhe.provider", "qq");
            context.setUserAttribute("juhe.social_uid", socialUid);
            context.setUserAttribute("juhe.nickname", nickname);
            if (!faceimg.isEmpty()) {
                context.setUserAttribute("juhe.faceimg", faceimg);
            }
            if (!gender.isEmpty()) {
                context.setUserAttribute("juhe.gender", gender);
            }
            if (!location.isEmpty()) {
                context.setUserAttribute("juhe.location", location);
            }

            logger.infof("juhe-qq authenticated context: providerCode=%d, providerMsg=%s, socialUid=%s, externalId=%s, username=%s, idpConfig=%s, idp=%s, authSession=%s",  // TODO: remove after verification
                    respCode, respMsg, socialUid.isEmpty() ? "absent" : "present",
                    context.getId(), context.getUsername(),
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

        } catch (final IOException | InterruptedException e) {
            logger.error("juhe-qq login failed", e);
            return errorResponse();
        } catch (final RuntimeException e) {
            logger.error("juhe-qq login failed", e);
            return errorResponse();
        }
    }

    @POST
    public Response postCallback() {
        logger.error("juhe-qq endpoint received POST unexpectedly");
        return Response.status(405)
                .entity("POST not supported for juhe-qq callback")
                .build();
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
