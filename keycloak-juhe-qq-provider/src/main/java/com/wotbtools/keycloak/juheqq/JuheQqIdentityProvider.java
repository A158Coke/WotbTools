package com.wotbtools.keycloak.juheqq;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import org.jboss.logging.Logger;
import org.keycloak.broker.provider.AbstractIdentityProvider;
import org.keycloak.broker.provider.AuthenticationRequest;
import org.keycloak.broker.provider.BrokeredIdentityContext;
import org.keycloak.events.EventBuilder;
import org.keycloak.models.FederatedIdentityModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.UserSessionModel;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;

public final class JuheQqIdentityProvider
        extends AbstractIdentityProvider<JuheQqIdentityProviderConfig> {

    private static final Logger logger = Logger.getLogger(JuheQqIdentityProvider.class);

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private static final ObjectMapper MAPPER = new ObjectMapper();

    public JuheQqIdentityProvider(final KeycloakSession session,
                                  final JuheQqIdentityProviderConfig config) {
        super(session, config);
    }

    @Override
    public Response performLogin(final AuthenticationRequest request) {
        final String appid = getConfig().getAppid();
        final String appkey = getConfig().getAppkey();
        final String loginBaseUrl = getConfig().getLoginBaseUrl();

        if (isBlank(appid) || isBlank(appkey) || isBlank(loginBaseUrl)) {
            logger.error("juhe-qq: provider not fully configured");
            return Response.status(500)
                    .entity("QQ login not configured. Please contact administrator.")
                    .build();
        }

        // Keycloak 框架生成 IdentityBrokerState，获取其编码值
        final String state = request.getState().getEncoded();
        if (state == null || state.isBlank()) {
            logger.error("juhe-qq: authentication request missing state");
            return errorResponse();
        }

        final URI endpointUri = session.getContext().getUri().getBaseUriBuilder()
                .path("realms/{realm}/broker/{provider}/endpoint")
                .build(session.getContext().getRealm().getName(), getConfig().getAlias());
        final String callbackUrl = endpointUri.toString() + "?state=" + encode(state);

        logger.debug("juhe-qq: state obtained from IdentityBrokerState");  // TODO: remove after verification

        final String actLoginUrl = loginBaseUrl
                + "?act=login&appid=" + encode(appid)
                + "&appkey=" + encode(appkey)
                + "&type=qq&redirect_uri=" + encode(callbackUrl);

        logger.debug("juhe-qq: login request started");  // TODO: remove after verification

        try {
            final HttpRequest httpReq = HttpRequest.newBuilder()
                    .uri(URI.create(actLoginUrl))
                    .GET()
                    .timeout(Duration.ofSeconds(10))
                    .build();

            final HttpResponse<String> httpResp = HTTP.send(httpReq, HttpResponse.BodyHandlers.ofString());

            if (httpResp.statusCode() != 200) {
                logger.errorf("juhe-qq: act=login HTTP %d", httpResp.statusCode());
                return errorResponse();
            }

            final JsonNode json = MAPPER.readTree(httpResp.body());
            final int code = json.path("code").asInt(-1);
            final String type = json.path("type").asText("");
            final String redirectUrl = json.path("url").asText("");

            if (code != 0 || !"qq".equals(type) || redirectUrl.isEmpty()) {
                logger.errorf("juhe-qq: act=login failed code=%d type=%s", code, type);
                return errorResponse();
            }

            logger.debug("juhe-qq: redirecting user to QQ login");  // TODO: remove after verification
            return Response.status(302).header("Location", redirectUrl).build();

        } catch (final IOException | InterruptedException e) {
            logger.error("juhe-qq: act=login request failed", e);
            return errorResponse();
        }
    }

    @Override
    public Object callback(final RealmModel realm,
                           final AuthenticationCallback callback,
                           final EventBuilder event) {
        final UriInfo uriInfo = session.getContext().getUri();
        final String state = uriInfo.getQueryParameters().getFirst("state");
        final String type = uriInfo.getQueryParameters().getFirst("type");
        final String code = uriInfo.getQueryParameters().getFirst("code");

        logger.info("juhe-qq callback entered");  // TODO: remove after verification
        logger.debugf("juhe-qq callback: state=%s type=%s code=%s codeLength=%d",  // TODO: remove after verification
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
        final var authenticationSession = callback.getAndVerifyAuthenticationSession(state);
        if (authenticationSession == null) {
            logger.error("juhe-qq: authenticationSession not found via state");
            return errorResponse();
        }
        session.getContext().setAuthenticationSession(authenticationSession);
        logger.debugf("juhe-qq: authenticationSession restored, clientId=%s",  // TODO: remove after verification
                authenticationSession.getClient() != null
                        ? authenticationSession.getClient().getClientId()
                        : "null");

        final String appid = getConfig().getAppid();
        final String appkey = getConfig().getAppkey();
        final String loginBaseUrl = getConfig().getLoginBaseUrl();

        if (isBlank(appid) || isBlank(appkey)) {
            logger.error("juhe-qq: callback missing credentials");
            return errorResponse();
        }

        logger.info("juhe-qq act=callback request prepared");  // TODO: remove after verification
        logger.debugf("juhe-qq act=callback diag: appid=%s type=%s codeLength=%d baseUrl=%s",  // TODO: remove after verification
                appid != null ? "present" : "absent", "qq", code.length(), loginBaseUrl != null ? loginBaseUrl : "null");

        final String actCallbackUrl = loginBaseUrl
                + "?act=callback&appid=" + encode(appid)
                + "&appkey=" + encode(appkey)
                + "&type=qq&code=" + encode(code);

        try {
            final HttpRequest httpReq = HttpRequest.newBuilder()
                    .uri(URI.create(actCallbackUrl))
                    .GET()
                    .timeout(Duration.ofSeconds(10))
                    .build();

            final HttpResponse<String> httpResp = HTTP.send(httpReq, HttpResponse.BodyHandlers.ofString());

            logger.infof("juhe-qq act=callback HTTP %d", httpResp.statusCode());  // TODO: remove after verification
            logger.debugf("juhe-qq act=callback response body prefix: %s",  // TODO: remove after verification
                    truncate(httpResp.body(), 500));

            if (httpResp.statusCode() != 200) {
                logger.errorf("juhe-qq act=callback failed HTTP %d, body=%s",
                        httpResp.statusCode(), truncate(httpResp.body(), 500));
                return errorResponse();
            }

            final String body = httpResp.body();
            final JsonNode json = MAPPER.readTree(body);
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
                        truncate(body, 500));
                return errorResponse();
            }

            final String nickname = json.path("nickname").asText("");
            final String faceimg = json.path("faceimg").asText("");
            final String gender = json.path("gender").asText("");
            final String location = json.path("location").asText("");

            final String externalId = "qq:" + socialUid;
            final String username = "juhe_qq_" + sha256prefix(socialUid, 32);

            final BrokeredIdentityContext context = new BrokeredIdentityContext(
                    externalId, getConfig());
            context.setId(externalId);
            context.setBrokerUserId(externalId);
            context.setBrokerSessionId(externalId);
            context.setUsername(username);
            context.setName(nickname);
            context.setFirstName(nickname);
            context.setLastName("");
            context.setIdp(this);
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
                final Response response = callback.authenticated(context);
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

    @Override
    public Response retrieveToken(final KeycloakSession session,
                                   final FederatedIdentityModel identity,
                                   final UserSessionModel userSession,
                                   final UserModel user) {
        return Response.status(400).entity("Token retrieval not supported").build();
    }

    public Response retrieveToken(final KeycloakSession session,
                                   final FederatedIdentityModel identity) {
        return Response.status(400).entity("Token retrieval not supported").build();
    }

    private static Response errorResponse() {
        return Response.status(500)
                .entity("QQ login failed. Please try again.")
                .build();
    }

    private static String encode(final String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String truncate(final String s, final int maxLen) {   // TODO: remove after verification
        if (s == null) return "null";
        return s.length() <= maxLen ? s : s.substring(0, maxLen) + "...";
    }

    private static String sha256prefix(final String input, final int len) {  // TODO: remove after verification
        if (input == null) {
            return "";
        }
        try {
            final MessageDigest md = MessageDigest.getInstance("SHA-256");
            final byte[] hash = md.digest(input.getBytes(StandardCharsets.UTF_8));
            final StringBuilder sb = new StringBuilder();
            for (int i = 0; i < hash.length && sb.length() < len; i++) {
                sb.append(String.format("%02x", hash[i] & 0xff));
            }
            return sb.toString();
        } catch (final NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    private static boolean isBlank(final String s) {
        return s == null || s.isBlank();
    }
}
