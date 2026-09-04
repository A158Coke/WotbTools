package com.wotbtools.keycloak.juheqq;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;
import org.keycloak.broker.provider.AbstractIdentityProvider;
import org.keycloak.broker.provider.AuthenticationRequest;
import org.keycloak.broker.provider.util.IdentityBrokerState;
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
import java.util.Locale;

/** Juhe 聚合登录 QQ Identity Provider。 */
public final class JuheQqIdentityProvider
        extends AbstractIdentityProvider<JuheQqIdentityProviderConfig> {

    static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Logger log = Logger.getLogger(JuheQqIdentityProvider.class);

    public JuheQqIdentityProvider(final KeycloakSession session,
                                  final JuheQqIdentityProviderConfig config) {
        super(session, config);
    }

    @Override
    public Response performLogin(final AuthenticationRequest request) {
        final JuheQqIdentityProviderConfig cfg = getConfig();
        final String realm = realmName();
        final String providerAlias = cfg.getAlias();
        final String appid = cfg.getAppid();
        final String appkey = cfg.getAppkey();
        final String loginBaseUrl = cfg.getLoginBaseUrl();

        if (isBlank(appid) || isBlank(appkey) || isBlank(loginBaseUrl)) {
            log.warn(loggable("config_missing", realm, providerAlias));
            return Response.status(500)
                    .entity("QQ login not configured. Please contact administrator.")
                    .build();
        }

        final IdentityBrokerState stateObj = request.getState();
        final String state = stateObj == null ? null : stateObj.getEncoded();
        if (state == null || state.isBlank()) {
            log.warn(loggable("state_missing", realm, providerAlias));
            return errorResponse();
        }

        /*
         * Bind the bridge decision at login start, while the original browser context is still known.
         * WotBTools Android uses the platform WebView UA (`; wv)`); ordinary Android Chrome does not.
         * This marker is routing-only: Keycloak state remains the authentication authority.
         */
        final boolean androidAppFlow = isAndroidWebViewUserAgent(currentUserAgent());
        final String endpointPath = androidAppFlow
                ? "realms/{realm}/broker/{provider}/endpoint/mobile-return"
                : "realms/{realm}/broker/{provider}/endpoint";
        final URI endpointUri = session.getContext().getUri().getBaseUriBuilder()
                .path(endpointPath)
                .build(realm, providerAlias);
        final String callbackUrl = endpointUri.toString() + "?state=" + encode(state);

        log.debug(loggable("juhe_login_route", realm, providerAlias,
                "returnMode", androidAppFlow ? "android-bridge" : "browser-direct"));
        return buildLoginResponse(appid, appkey, loginBaseUrl, callbackUrl, realm, providerAlias);
    }

    private String currentUserAgent() {
        try {
            if (session == null || session.getContext() == null || session.getContext().getHttpRequest() == null) {
                return null;
            }
            return session.getContext().getHttpRequest().getHttpHeaders().getHeaderString("User-Agent");
        } catch (final RuntimeException e) {
            return null;
        }
    }

    static boolean isAndroidWebViewUserAgent(final String userAgent) {
        if (userAgent == null) {
            return false;
        }
        final String ua = userAgent.toLowerCase(Locale.ROOT);
        return ua.contains("android") && ua.contains("; wv)");
    }

    Response buildLoginResponse(final String appid,
                                final String appkey,
                                final String loginBaseUrl,
                                final String callbackUrl,
                                final String realm,
                                final String providerAlias) {
        final String actLoginUrl = loginBaseUrl
                + "?act=login&appid=" + encode(appid)
                + "&appkey=" + encode(appkey)
                + "&type=qq&redirect_uri=" + encode(callbackUrl);

        try {
            final HttpRequest httpReq = HttpRequest.newBuilder()
                    .uri(URI.create(actLoginUrl))
                    .GET()
                    .timeout(Duration.ofSeconds(10))
                    .build();
            final HttpResponse<String> httpResp = HTTP.send(httpReq, HttpResponse.BodyHandlers.ofString());

            if (httpResp.statusCode() != 200) {
                log.warn(loggable("juhe_login_http", realm, providerAlias,
                        "httpStatus", String.valueOf(httpResp.statusCode())));
                return errorResponse();
            }

            final JsonNode json = MAPPER.readTree(httpResp.body());
            final int code = json.path("code").asInt(-1);
            final String type = json.path("type").asText("");
            final String redirectUrl = json.path("url").asText("");
            if (code != 0 || !"qq".equals(type) || redirectUrl.isEmpty()) {
                log.warn(loggable("juhe_login_response_rejected", realm, providerAlias,
                        "juheCode", String.valueOf(code),
                        "juheType", type,
                        "redirectUri", redirectUrl.isEmpty() ? "empty" : "present"));
                return errorResponse();
            }

            log.debug(loggable("juhe_login_redirect", realm, providerAlias,
                    "juheCode", String.valueOf(code),
                    "juheType", type,
                    "redirectUri", "present"));
            return Response.status(302).header("Location", redirectUrl).build();
        } catch (final JsonProcessingException e) {
            log.error(loggable("juhe_login_invalid_json", realm, providerAlias), e);
            return errorResponse();
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
            log.error(loggable("juhe_login_exception", realm, providerAlias), e);
            return errorResponse();
        } catch (final IOException | RuntimeException e) {
            log.error(loggable("juhe_login_exception", realm, providerAlias), e);
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

    static Response errorResponse() {
        return Response.status(500).entity("QQ login failed. Please try again.").build();
    }

    static String encode(final String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    static String sha256prefix(final String input) {
        if (input == null) {
            return "";
        }
        try {
            final MessageDigest md = MessageDigest.getInstance("SHA-256");
            final byte[] hash = md.digest(input.getBytes(StandardCharsets.UTF_8));
            final StringBuilder sb = new StringBuilder();
            for (int i = 0; i < hash.length && sb.length() < 12; i++) {
                sb.append(String.format("%02x", hash[i] & 0xff));
            }
            return sb.toString();
        } catch (final NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    static String callbackRef(final String state) {
        if (isBlank(state)) {
            return "unknown";
        }
        final String hash = sha256prefix(state);
        return hash.length() >= 8 ? hash.substring(0, 8) : hash;
    }

    static boolean isBlank(final String s) {
        return s == null || s.isBlank();
    }

    private String realmName() {
        if (session == null) {
            return null;
        }
        final RealmModel realm = session.getContext().getRealm();
        return realm == null ? null : realm.getName();
    }

    static String loggable(final String stage,
                           final String realm,
                           final String providerAlias,
                           final String... kv) {
        final StringBuilder sb = new StringBuilder();
        sb.append("[juhe-qq] stage=").append(stage);
        if (realm != null) {
            sb.append(" realm=").append(realm);
        }
        if (providerAlias != null) {
            sb.append(" provider=").append(providerAlias);
        }
        for (int i = 0; i + 1 < kv.length; i += 2) {
            if (kv[i] != null && kv[i + 1] != null) {
                sb.append(' ').append(kv[i]).append('=').append(kv[i + 1]);
            }
        }
        return sb.toString();
    }
}
