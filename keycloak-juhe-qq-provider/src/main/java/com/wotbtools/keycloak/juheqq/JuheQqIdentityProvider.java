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

/**
 * Juhe 聚合登录 QQ Identity Provider。
 *
 * <p>诊断策略：每个关键失败阶段都记录一条结构化日志（stage + realm/provider alias + 脱敏
 * 判别信息），并保留异常 stack trace。绝不在日志中记录 appkey、authorization code、access
 * token、完整 state、social_uid 原值、完整 callback URL/query 或 Cookie 内容。对用户仍返回
 * 安全的 generic error，不改变既有成功登录协议行为。</p>
 */
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

        final URI endpointUri = session.getContext().getUri().getBaseUriBuilder()
                .path("realms/{realm}/broker/{provider}/endpoint")
                .build(realm, providerAlias);
        final String callbackUrl = endpointUri.toString() + "?state=" + encode(state);

        return buildLoginResponse(appid, appkey, loginBaseUrl, callbackUrl, realm, providerAlias);
    }

    /**
     * performLogin 的可测试核心：发起 Juhe act=login 请求并按 302 返回 QQ redirect URL，或返回
     * generic 500。仅包内/测试调用。
     */
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
        } catch (final IOException e) {
            log.error(loggable("juhe_login_exception", realm, providerAlias), e);
            return errorResponse();
        } catch (final RuntimeException e) {
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

    // ── package-visible helpers ──────────────────────────────────────

    static Response errorResponse() {
        return Response.status(500)
                .entity("QQ login failed. Please try again.")
                .build();
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

    static boolean isBlank(final String s) {
        return s == null || s.isBlank();
    }

    private String realmName() {
        final KeycloakSession s = session;
        if (s == null) {
            return null;
        }
        final RealmModel realm = s.getContext().getRealm();
        return realm == null ? null : realm.getName();
    }

    /**
     * 构造一条脱敏结构化诊断消息。只接受枚举/判别信息（stage、realm、provider alias、
     * HTTP status、juhe code/type、presence boolean 等），严禁传入敏感原值。
     */
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
            if (kv[i] == null || kv[i + 1] == null) {
                continue;
            }
            sb.append(' ').append(kv[i]).append('=').append(kv[i + 1]);
        }
        return sb.toString();
    }
}
