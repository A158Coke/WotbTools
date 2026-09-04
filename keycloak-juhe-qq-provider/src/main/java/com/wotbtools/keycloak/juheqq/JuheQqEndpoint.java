package com.wotbtools.keycloak.juheqq;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;
import org.keycloak.broker.provider.BrokeredIdentityContext;
import org.keycloak.broker.provider.UserAuthenticationIdentityProvider.AuthenticationCallback;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.sessions.AuthenticationSessionModel;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;

/**
 * Juhe QQ callback endpoint。诊断策略与 {@link JuheQqIdentityProvider} 一致：每个失败阶段记录
 * 结构化日志（stage + realm/provider alias + 脱敏判别信息），保留异常 stack trace；绝不记录
 * appkey、authorization code、access token、完整 state、social_uid 原值、完整 callback
 * URL/query、return ticket 或 Cookie。对用户仍返回安全的 generic error。
 *
 * <p>Android QQ 会显式把 native 授权回程交给 Chrome，因此 mobile-return 先把 state/code 放入
 * 单次短 TTL ticket，再让 Chrome 通过 explicit package intent 回到 WotBTools。原 WebView 只接收
 * opaque ticket，并在本 endpoint 中消费后继续原有 Keycloak broker callback。</p>
 */
public final class JuheQqEndpoint {

    private static final Logger log = Logger.getLogger(JuheQqEndpoint.class);
    private static final String ANDROID_PACKAGE = "com.wotbtools.app";
    private static final String BRIDGE_PLACEHOLDER = "bridge";
    private static final AuthReturnTicketStore RETURN_TICKETS =
            new AuthReturnTicketStore(Duration.ofMinutes(2), Clock.systemUTC());

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
                                   @QueryParam("code") final String code,
                                   @QueryParam("ticket") final String ticketToken) {

        final String realm = realmName();
        final String providerAlias = config.getAlias();

        if (!JuheQqIdentityProvider.isBlank(ticketToken)) {
            final String returnRef = JuheQqIdentityProvider.callbackRef(ticketToken);
            final AuthReturnTicketStore.Ticket ticket = RETURN_TICKETS.consume(ticketToken);
            if (ticket == null) {
                log.warn(JuheQqIdentityProvider.loggable("auth_return_ticket_invalid", realm, providerAlias,
                        "returnRef", returnRef));
                return JuheQqIdentityProvider.errorResponse();
            }
            final String callbackRef = JuheQqIdentityProvider.callbackRef(ticket.state());
            log.info(JuheQqIdentityProvider.loggable("callback_entered", realm, providerAlias,
                    "callbackRef", callbackRef,
                    "returnRef", returnRef,
                    "returnMode", "android-bridge"));
            return completeCallback(ticket.state(), ticket.type(), ticket.code(), realm, providerAlias, callbackRef);
        }

        final String callbackRef = JuheQqIdentityProvider.callbackRef(state);
        log.info(JuheQqIdentityProvider.loggable("callback_entered", realm, providerAlias,
                "callbackRef", callbackRef,
                "returnMode", "direct"));
        return completeCallback(state, type, code, realm, providerAlias, callbackRef);
    }

    /**
     * Juhe redirect_uri target. Desktop/browser flows stay in the same browser context and continue
     * directly. Android flows receive a user-gesture bridge page because QQ explicitly launches Chrome.
     */
    @GET
    @Path("mobile-return")
    public Response handleMobileReturn(@QueryParam("state") final String state,
                                       @QueryParam("type") final String type,
                                       @QueryParam("code") final String code,
                                       @HeaderParam("User-Agent") final String userAgent) {
        final String realm = realmName();
        final String providerAlias = config.getAlias();
        final String callbackRef = JuheQqIdentityProvider.callbackRef(state);
        final boolean android = isAndroidUserAgent(userAgent);

        log.info(JuheQqIdentityProvider.loggable("mobile_return_entered", realm, providerAlias,
                "callbackRef", callbackRef,
                "android", String.valueOf(android)));

        final Response validationError = validateCallbackInput(state, type, code, realm, providerAlias, callbackRef);
        if (validationError != null) {
            return validationError;
        }

        if (!android) {
            log.info(JuheQqIdentityProvider.loggable("callback_entered", realm, providerAlias,
                    "callbackRef", callbackRef,
                    "returnMode", "browser-direct"));
            return completeCallback(state, type, code, realm, providerAlias, callbackRef);
        }

        final String ticket = RETURN_TICKETS.issue(state, type, code);
        if (ticket == null) {
            log.warn(JuheQqIdentityProvider.loggable("auth_return_ticket_issue_failed", realm, providerAlias,
                    "callbackRef", callbackRef));
            return JuheQqIdentityProvider.errorResponse();
        }

        final String returnRef = JuheQqIdentityProvider.callbackRef(ticket);
        final URI endpointUri = brokerEndpointUri(realm, providerAlias);
        final String intentUrl = buildAndroidReturnIntent(endpointUri, ticket);

        log.info(JuheQqIdentityProvider.loggable("auth_return_ticket_issued", realm, providerAlias,
                "callbackRef", callbackRef,
                "returnRef", returnRef));

        final String html = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>返回 WotBTools</title></head>"
                + "<body style=\"font-family:sans-serif;max-width:32rem;margin:12vh auto;padding:0 1.5rem;line-height:1.6\">"
                + "<h1 style=\"font-size:1.35rem\">QQ 授权已完成</h1>"
                + "<p>请返回 WotBTools 继续完成登录。</p>"
                + "<p><a style=\"display:inline-block;padding:.75rem 1rem;border:1px solid currentColor;border-radius:.5rem;text-decoration:none\" href=\""
                + intentUrl + "\">返回 WotBTools</a></p>"
                + "</body></html>";

        return Response.ok(html)
                .type("text/html; charset=UTF-8")
                .header("Cache-Control", "no-store")
                .header("Pragma", "no-cache")
                .header("Content-Security-Policy",
                        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
                .build();
    }

    /** Browser fallback used only when Chrome cannot resolve the explicit WotBTools package intent. */
    @GET
    @Path("mobile-resume")
    public Response handleBrowserResume(@QueryParam("ticket") final String ticketToken) {
        final String realm = realmName();
        final String providerAlias = config.getAlias();
        final String returnRef = JuheQqIdentityProvider.callbackRef(ticketToken);
        final AuthReturnTicketStore.Ticket ticket = RETURN_TICKETS.consume(ticketToken);
        if (ticket == null) {
            log.warn(JuheQqIdentityProvider.loggable("auth_return_ticket_invalid", realm, providerAlias,
                    "returnRef", returnRef,
                    "returnMode", "browser-fallback"));
            return JuheQqIdentityProvider.errorResponse();
        }

        final String callbackRef = JuheQqIdentityProvider.callbackRef(ticket.state());
        log.info(JuheQqIdentityProvider.loggable("callback_entered", realm, providerAlias,
                "callbackRef", callbackRef,
                "returnRef", returnRef,
                "returnMode", "browser-fallback"));
        return completeCallback(ticket.state(), ticket.type(), ticket.code(), realm, providerAlias, callbackRef);
    }

    private Response completeCallback(final String state,
                                      final String type,
                                      final String code,
                                      final String realm,
                                      final String providerAlias,
                                      final String callbackRef) {
        final Response validationError = validateCallbackInput(state, type, code, realm, providerAlias, callbackRef);
        if (validationError != null) {
            return validationError;
        }

        // 通过 state 恢复 AuthenticationSession。bridge 只恢复原 browser context，不绕过 Keycloak 校验。
        final AuthenticationSessionModel authenticationSession =
                authCallback.getAndVerifyAuthenticationSession(state);
        if (authenticationSession == null) {
            log.warn(JuheQqIdentityProvider.loggable("authentication_session_restore", realm, providerAlias,
                    "callbackRef", callbackRef,
                    "authenticationSession", "invalid"));
            return JuheQqIdentityProvider.errorResponse();
        }
        session.getContext().setAuthenticationSession(authenticationSession);
        log.info(JuheQqIdentityProvider.loggable("authentication_session_restored", realm, providerAlias,
                "callbackRef", callbackRef,
                "authenticationSession", "present"));

        final String appid = config.getAppid();
        final String appkey = config.getAppkey();
        final String loginBaseUrl = config.getLoginBaseUrl();

        if (JuheQqIdentityProvider.isBlank(appid) || JuheQqIdentityProvider.isBlank(appkey)) {
            log.warn(JuheQqIdentityProvider.loggable("config_missing", realm, providerAlias,
                    "callbackRef", callbackRef));
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
                log.warn(JuheQqIdentityProvider.loggable("juhe_callback_http", realm, providerAlias,
                        "callbackRef", callbackRef,
                        "httpStatus", String.valueOf(httpResp.statusCode())));
                return JuheQqIdentityProvider.errorResponse();
            }

            final JsonNode json = JuheQqIdentityProvider.MAPPER.readTree(httpResp.body());
            final int respCode = json.path("code").asInt(-1);
            final String respType = json.path("type").asText("");
            final String socialUid = json.path("social_uid").asText("");

            if (respCode != 0 || !"qq".equals(respType) || socialUid.isEmpty()) {
                log.warn(JuheQqIdentityProvider.loggable("juhe_callback_response_rejected", realm, providerAlias,
                        "callbackRef", callbackRef,
                        "juheCode", String.valueOf(respCode),
                        "juheType", respType,
                        "socialUid", socialUid.isEmpty() ? "empty" : "present"));
                return JuheQqIdentityProvider.errorResponse();
            }

            log.info(JuheQqIdentityProvider.loggable("juhe_callback_accepted", realm, providerAlias,
                    "callbackRef", callbackRef,
                    "juheType", respType,
                    "socialUid", "present"));

            final String nickname = json.path("nickname").asText("");
            final String faceimg = json.path("faceimg").asText("");

            final String cleanedNickname = prepareNickname(nickname);
            if (cleanedNickname == null) {
                log.warn(JuheQqIdentityProvider.loggable("nickname_invalid", realm, providerAlias,
                        "callbackRef", callbackRef,
                        "juheType", respType,
                        "socialUid", "present"));
                return Response.status(400)
                        .entity("QQ nickname is invalid. Please set a valid nickname in your QQ profile and try again.")
                        .build();
            }

            final String externalId = "qq:" + socialUid;
            final String username = buildUsername(cleanedNickname, socialUid);

            final BrokeredIdentityContext context = new BrokeredIdentityContext(externalId, config);
            context.setId(externalId);
            context.setBrokerUserId(externalId);
            context.setBrokerSessionId(externalId);
            context.setUsername(username);
            context.setEmail(null);
            context.setIdp(provider);
            context.setAuthenticationSession(authenticationSession);

            context.setUserAttribute("displayName", nickname);
            context.setUserAttribute("region", "CN");
            context.setUserAttribute("juhe.provider", "qq");
            context.setUserAttribute("juhe.social_uid", socialUid);
            context.setUserAttribute("juhe.nickname", nickname);
            if (!faceimg.isEmpty()) {
                context.setUserAttribute("juhe.faceimg", faceimg);
            }

            log.info(JuheQqIdentityProvider.loggable("before_broker_authenticated", realm, providerAlias,
                    "callbackRef", callbackRef,
                    "juheType", respType,
                    "socialUid", "present"));

            final Response authenticated;
            try {
                authenticated = authCallback.authenticated(context);
            } catch (final RuntimeException e) {
                log.error(JuheQqIdentityProvider.loggable("broker_authenticated_failed", realm, providerAlias,
                        "callbackRef", callbackRef,
                        "juheType", respType,
                        "socialUid", "present"), e);
                return JuheQqIdentityProvider.errorResponse();
            }
            log.info(JuheQqIdentityProvider.loggable("broker_authenticated", realm, providerAlias,
                    "callbackRef", callbackRef,
                    "juheType", respType,
                    "socialUid", "present"));
            return authenticated;

        } catch (final JsonProcessingException e) {
            log.error(JuheQqIdentityProvider.loggable("juhe_callback_invalid_json", realm, providerAlias,
                    "callbackRef", callbackRef), e);
            return JuheQqIdentityProvider.errorResponse();
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
            log.error(JuheQqIdentityProvider.loggable("callback_exception", realm, providerAlias,
                    "callbackRef", callbackRef), e);
            return JuheQqIdentityProvider.errorResponse();
        } catch (final IOException | RuntimeException e) {
            log.error(JuheQqIdentityProvider.loggable("callback_exception", realm, providerAlias,
                    "callbackRef", callbackRef), e);
            return JuheQqIdentityProvider.errorResponse();
        }
    }

    private Response validateCallbackInput(final String state,
                                           final String type,
                                           final String code,
                                           final String realm,
                                           final String providerAlias,
                                           final String callbackRef) {
        if (state == null || state.isBlank()) {
            log.warn(JuheQqIdentityProvider.loggable("callback_state_missing", realm, providerAlias,
                    "callbackRef", callbackRef));
            return JuheQqIdentityProvider.errorResponse();
        }
        if (!"qq".equals(type)) {
            log.warn(JuheQqIdentityProvider.loggable("callback_type_invalid", realm, providerAlias,
                    "callbackRef", callbackRef,
                    "type", type == null ? "null" : type));
            return JuheQqIdentityProvider.errorResponse();
        }
        if (code == null || code.isBlank()) {
            log.warn(JuheQqIdentityProvider.loggable("callback_code_missing", realm, providerAlias,
                    "callbackRef", callbackRef));
            return JuheQqIdentityProvider.errorResponse();
        }
        return null;
    }

    private URI brokerEndpointUri(final String realm, final String providerAlias) {
        return session.getContext().getUri().getBaseUriBuilder()
                .path("realms/{realm}/broker/{provider}/endpoint")
                .build(realm, providerAlias);
    }

    static boolean isAndroidUserAgent(final String userAgent) {
        return userAgent != null && userAgent.toLowerCase(java.util.Locale.ROOT).contains("android");
    }

    static String buildAndroidReturnIntent(final URI endpointUri, final String ticket) {
        final String encodedTicket = encodeForUrl(ticket);
        final String fallbackUrl = endpointUri + "/mobile-resume?ticket=" + encodedTicket;
        final String authority = endpointUri.getRawAuthority();
        final String path = endpointUri.getRawPath();
        return "intent://" + authority + path
                + "?type=qq&state=" + BRIDGE_PLACEHOLDER
                + "&code=" + BRIDGE_PLACEHOLDER
                + "&ticket=" + encodedTicket
                + "#Intent;scheme=" + endpointUri.getScheme()
                + ";package=" + ANDROID_PACKAGE
                + ";S.browser_fallback_url=" + encodeForUrl(fallbackUrl)
                + ";end";
    }

    private static String encodeForUrl(final String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private String realmName() {
        if (session == null) {
            return null;
        }
        final RealmModel realm = session.getContext().getRealm();
        return realm == null ? null : realm.getName();
    }

    private static String prepareNickname(final String nickname) {
        if (nickname == null || nickname.isBlank()) {
            return null;
        }

        String value = nickname.trim();
        value = value.replaceAll("\\p{Cntrl}", "");
        value = value.replaceAll("[/@\\\\:?#\\[\\]{}|<>\"']", "_");
        value = value.replaceAll("\\s+", "_");

        return value.isBlank() ? null : value;
    }

    private static String buildUsername(final String nickname, final String socialUid) {
        final String hashedUid = JuheQqIdentityProvider.sha256prefix(socialUid);
        final String shortHash = hashedUid.length() >= 8 ? hashedUid.substring(0, 8) : hashedUid;

        String value = nickname;
        if (value.length() > 55) {
            value = value.substring(0, 55);
        }

        return value + "-" + shortHash;
    }
}
