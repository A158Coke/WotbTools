package com.wotbtools.keycloak.juheqq;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriBuilder;
import jakarta.ws.rs.core.UriInfo;
import org.jboss.logging.Logger;
import org.keycloak.broker.provider.AbstractIdentityProvider;
import org.keycloak.broker.provider.AuthenticationRequest;
import org.keycloak.broker.provider.BrokeredIdentityContext;
import org.keycloak.broker.provider.UserAuthenticationIdentityProvider.AuthenticationCallback;
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

    static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    static final ObjectMapper MAPPER = new ObjectMapper();

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
        return new JuheQqEndpoint(session, this, getConfig(), callback);
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

    // ── package-visible helpers ──────────────────────────────────────

    static Response errorResponse() {
        return Response.status(500)
                .entity("QQ login failed. Please try again.")
                .build();
    }

    static String encode(final String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    static String truncate(final String s, final int maxLen) {   // TODO: remove after verification
        if (s == null) return "null";
        return s.length() <= maxLen ? s : s.substring(0, maxLen) + "...";
    }

    static String sha256prefix(final String input, final int len) {  // TODO: remove after verification
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
