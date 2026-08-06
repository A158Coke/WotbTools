package com.wotbtools.keycloak.wargaming;

import jakarta.ws.rs.core.Response;
import org.keycloak.broker.provider.AbstractIdentityProvider;
import org.keycloak.broker.provider.AuthenticationRequest;
import org.keycloak.broker.provider.BrokeredIdentityContext;
import org.keycloak.events.EventBuilder;
import org.keycloak.models.FederatedIdentityModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.UserSessionModel;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * Wargaming.net 自定义 Identity Provider（Keycloak 26.6.4）。
 *
 * <p>区服来自实例配置 {@code region}（ASIA/EU/NA，默认 ASIA），一个 SPI 类型可创建
 * 多个区服实例；应用 ID 来自环境变量 {@code WG_APPLICATION_ID}，缺失时登录报错而
 * 不导致 Keycloak 启动失败（需求文档 D14）。</p>
 */
public class WargamingIdentityProvider
        extends AbstractIdentityProvider<WargamingIdentityProviderConfig> {

    /**
     * 测试钩子：非空时优先返回，绕开只读的 {@link System#getenv()}。
     * 仅测试类写入，生产代码保持默认 null。
     */
    static volatile String applicationIdOverride = null;

    private final WargamingApiClient apiClient;

    public WargamingIdentityProvider(final KeycloakSession session,
                                     final WargamingIdentityProviderConfig config) {
        this(session, config, WargamingApiClient.defaultClient(config.region()));
    }

    WargamingIdentityProvider(final KeycloakSession session,
                              final WargamingIdentityProviderConfig config,
                              final WargamingApiClient apiClient) {
        super(session, config);
        this.apiClient = apiClient;
    }

    @Override
    public Response performLogin(final AuthenticationRequest request) {
        final String applicationId = applicationId();
        if (isBlank(applicationId)) {
            return Response.status(500)
                    .entity("Wargaming login not configured. Please contact administrator.")
                    .build();
        }

        final String state = request.getState().getEncoded();
        if (isBlank(state)) {
            return errorResponse();
        }
        return buildLoginResponse(applicationId, state);
    }

    /**
     * 构造 302 跳转 WG 官方登录页。拆出为 package-private 便于单测。
     */
    Response buildLoginResponse(final String applicationId, final String state) {
        final String callbackUrl = brokerEndpointUri().toString() + "?state=" + encode(state);
        final String loginUrl = apiClient.fetchLoginRedirectUrl(applicationId, callbackUrl);
        return Response.status(302).header("Location", loginUrl).build();
    }

    /**
     * 构造 Keycloak broker 回调端点（package-private 便于测试覆写）。
     */
    URI brokerEndpointUri() {
        return session.getContext().getUri().getBaseUriBuilder()
                .path("realms/{realm}/broker/{provider}/endpoint")
                .build(session.getContext().getRealm().getName(), getConfig().getAlias());
    }

    @Override
    public Object callback(final RealmModel realm,
                           final AuthenticationCallback callback,
                           final EventBuilder event) {
        return new WargamingEndpoint(session, this, getConfig(), callback,
                WargamingApiClient.defaultClient(getConfig().region()));
    }

    @Override
    public void updateBrokeredUser(final KeycloakSession session,
                                   final RealmModel realm,
                                   final UserModel user,
                                   final BrokeredIdentityContext context) {
        // 重复登录（决策 D11）：显式刷新展示名与昵称等可变属性，稳定身份不变。
        user.setSingleAttribute("region", getConfig().region().name());
        final String displayName = context.getUserAttribute("displayName");
        if (displayName != null) {
            user.setSingleAttribute("displayName", displayName);
        }
        final String accountId = context.getUserAttribute("wotb.account_id");
        if (accountId != null) {
            user.setSingleAttribute("wotb.account_id", accountId);
        }
        final String nickname = context.getUserAttribute("wotb.nickname");
        if (nickname != null) {
            user.setSingleAttribute("wotb.nickname", nickname);
        }
        user.setSingleAttribute("wotb.verified", "true");
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

    /** 读取环境变量中的 WG 应用 ID；未配置返回 null。 */
    static String applicationId() {
        final String override = applicationIdOverride;
        if (override != null) {
            return override;
        }
        final String value = System.getenv("WG_APPLICATION_ID");
        return value == null ? null : value.trim();
    }

    static Response errorResponse() {
        return Response.status(500)
                .entity("Wargaming login failed. Please try again.")
                .build();
    }

    static String encode(final String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    static boolean isBlank(final String value) {
        return value == null || value.isBlank();
    }
}
