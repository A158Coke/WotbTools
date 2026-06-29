package com.wotbtools.keycloak.juheqq;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import org.jboss.logging.Logger;
import org.keycloak.broker.provider.AbstractIdentityProvider;
import org.keycloak.broker.provider.AuthenticationCallback;
import org.keycloak.broker.provider.AuthenticationRequest;
import org.keycloak.broker.provider.BrokeredIdentityContext;
import org.keycloak.events.EventBuilder;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
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

        final String callbackUrl = request.getRedirectUri();
        final String actLoginUrl = loginBaseUrl
                + "?act=login&appid=" + encode(appid)
                + "&appkey=" + encode(appkey)
                + "&type=qq&redirect_uri=" + encode(callbackUrl);

        logger.debug("juhe-qq: login request started");

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

            logger.debug("juhe-qq: redirecting user to QQ login");
            return Response.status(302).header("Location", redirectUrl).build();

        } catch (final IOException | InterruptedException e) {
            logger.error("juhe-qq: act=login request failed", e);
            return errorResponse();
        }
    }

    @Override
    public Response callback(final RealmModel realm,
                             final AuthenticationCallback callback,
                             final EventBuilder event) {
        final UriInfo uriInfo = session.getContext().getUri();
        final String type = uriInfo.getQueryParameters().getFirst("type");
        final String code = uriInfo.getQueryParameters().getFirst("code");

        if (!"qq".equals(type)) {
            logger.errorf("juhe-qq: callback type mismatch '%s'", type);
            return errorResponse();
        }

        if (code == null || code.isBlank()) {
            logger.error("juhe-qq: callback missing code");
            return errorResponse();
        }

        logger.debug("juhe-qq: callback received");

        final String appid = getConfig().getAppid();
        final String appkey = getConfig().getAppkey();
        final String loginBaseUrl = getConfig().getLoginBaseUrl();

        if (isBlank(appid) || isBlank(appkey)) {
            logger.error("juhe-qq: callback missing credentials");
            return errorResponse();
        }

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

            if (httpResp.statusCode() != 200) {
                logger.errorf("juhe-qq: act=callback HTTP %d", httpResp.statusCode());
                return errorResponse();
            }

            final JsonNode json = MAPPER.readTree(httpResp.body());
            final int respCode = json.path("code").asInt(-1);
            final String respType = json.path("type").asText("");
            final String socialUid = json.path("social_uid").asText("");

            if (respCode != 0 || !"qq".equals(respType) || socialUid.isEmpty()) {
                logger.errorf("juhe-qq: act=callback failed code=%d type=%s uid=%s",
                        respCode, respType, socialUid.isEmpty() ? "(empty)" : "***");
                return errorResponse();
            }

            final String nickname = json.path("nickname").asText("");
            final String faceimg = json.path("faceimg").asText("");
            final String gender = json.path("gender").asText("");
            final String location = json.path("location").asText("");

            logger.debugf("juhe-qq: user info retrieved uid=*** nick=%s", nickname);

            final BrokeredIdentityContext context = new BrokeredIdentityContext(
                    "qq:" + socialUid, getConfig());
            context.setBrokerUserId("qq:" + socialUid);
            context.setUsername("juhe_qq_" + socialUid);
            context.setFirstName(nickname);
            context.setIdp(this);
            context.setAuthenticationSession(session.getContext().getAuthenticationSession());

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

            context.setEmail(null);

            return callback.authenticated(context);

        } catch (final IOException | InterruptedException e) {
            logger.error("juhe-qq: act=callback request failed", e);
            return errorResponse();
        }
    }

    @Override
    protected boolean supportsExternalExchange() {
        return false;
    }

    private static Response errorResponse() {
        return Response.status(500)
                .entity("QQ login failed. Please try again.")
                .build();
    }

    private static String encode(final String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static boolean isBlank(final String s) {
        return s == null || s.isBlank();
    }
}
