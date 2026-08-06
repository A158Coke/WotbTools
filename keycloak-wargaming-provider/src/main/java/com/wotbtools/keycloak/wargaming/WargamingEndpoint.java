package com.wotbtools.keycloak.wargaming;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;
import org.keycloak.broker.provider.BrokeredIdentityContext;
import org.keycloak.broker.provider.UserAuthenticationIdentityProvider.AuthenticationCallback;
import org.keycloak.models.KeycloakSession;
import org.keycloak.sessions.AuthenticationSessionModel;

/**
 * WG 回调端点。职责：校验 state → 基础参数校验 → prolongate 验证 token →
 * account/info 获取官方昵称 → 构造稳定身份 → 立即 logout。
 *
 * <p>安全要点（需求文档 D5 / 第十五节）：回调参数不能直接作为可信身份；
 * 任何一环失败都终止登录；token 不落库、不进属性/JWT/日志。</p>
 */
final class WargamingEndpoint {

    private static final Logger log = Logger.getLogger(WargamingEndpoint.class);

    private final KeycloakSession session;
    private final WargamingIdentityProvider provider;
    private final WargamingIdentityProviderConfig config;
    private final AuthenticationCallback authCallback;
    private final WargamingApiClient apiClient;

    WargamingEndpoint(final KeycloakSession session,
                      final WargamingIdentityProvider provider,
                      final WargamingIdentityProviderConfig config,
                      final AuthenticationCallback authCallback,
                      final WargamingApiClient apiClient) {
        this.session = session;
        this.provider = provider;
        this.config = config;
        this.authCallback = authCallback;
        this.apiClient = apiClient;
    }

    @GET
    @Path("")
    public Response handleCallback(@QueryParam("state") final String state,
                                   @QueryParam("status") final String status,
                                   @QueryParam("access_token") final String accessToken,
                                   @QueryParam("nickname") final String nickname,
                                   @QueryParam("account_id") final String accountId,
                                   @QueryParam("expires_at") final String expiresAt) {

        // ── 1. 会话校验（state 缺失/无效/过期/被篡改一律拒绝） ────────
        if (WargamingIdentityProvider.isBlank(state)) {
            return WargamingIdentityProvider.errorResponse();
        }
        final AuthenticationSessionModel authenticationSession =
                authCallback.getAndVerifyAuthenticationSession(state);
        if (authenticationSession == null) {
            return WargamingIdentityProvider.errorResponse();
        }
        session.getContext().setAuthenticationSession(authenticationSession);

        final String applicationId = WargamingIdentityProvider.applicationId();
        if (WargamingIdentityProvider.isBlank(applicationId)) {
            return WargamingIdentityProvider.errorResponse();
        }

        // ── 2. 基础校验 ──────────────────────────────────────────────
        if (!"ok".equals(status)) {
            return WargamingIdentityProvider.errorResponse();
        }
        if (WargamingIdentityProvider.isBlank(accessToken)) {
            return WargamingIdentityProvider.errorResponse();
        }
        final Long accountIdValue = parseAccountId(accountId);
        if (accountIdValue == null) {
            return WargamingIdentityProvider.errorResponse();
        }
        if (!isNotExpired(expiresAt)) {
            return WargamingIdentityProvider.errorResponse();
        }

        String wgToken = accessToken;
        try {
            // ── 3. 服务端验证 token 有效性并刷新 ────────────────────
            wgToken = apiClient.prolongate(applicationId, wgToken);

            // ── 4. 查询官方昵称并核对 ────────────────────────────────
            final String officialNickname =
                    apiClient.fetchOfficialNickname(applicationId, accountIdValue);
            if (WargamingIdentityProvider.isBlank(officialNickname)) {
                return WargamingIdentityProvider.errorResponse();
            }
            if (!WargamingIdentityProvider.isBlank(nickname) && !nickname.equals(officialNickname)) {
                return WargamingIdentityProvider.errorResponse();
            }

            // ── 5. 构造稳定身份（username = account_id，broker = wg:{region}:{id}） ──
            final WargamingRegion region = config.region();
            final String externalId = "wg:" + region.key() + ":" + accountIdValue;
            final BrokeredIdentityContext context = new BrokeredIdentityContext(externalId, config);
            context.setId(externalId);
            context.setBrokerUserId(externalId);
            context.setBrokerSessionId(externalId);
            context.setUsername(String.valueOf(accountIdValue));
            context.setIdp(provider);
            context.setAuthenticationSession(authenticationSession);

            // 只写业务属性，绝不写 WG token。
            context.setUserAttribute("region", region.name());
            context.setUserAttribute("displayName", officialNickname);
            context.setUserAttribute("wotb.account_id", String.valueOf(accountIdValue));
            context.setUserAttribute("wotb.nickname", officialNickname);
            context.setUserAttribute("wotb.verified", "true");

            return authCallback.authenticated(context);
        } catch (final RuntimeException e) {
            // 不回显原始错误正文；仅记录不含 token 的安全级别信息。
            log.debugf("Wargaming login rejected: %s", safeMessage(e));
            return WargamingIdentityProvider.errorResponse();
        } finally {
            // ── 6. 成功或失败路径都尽力立即销毁 token ────────────────
            logoutBestEffort(applicationId, wgToken);
        }
    }

    private void logoutBestEffort(final String applicationId, final String accessToken) {
        if (WargamingIdentityProvider.isBlank(accessToken)) {
            return;
        }
        try {
            apiClient.logout(applicationId, accessToken);
        } catch (final WargamingApiClient.WargamingApiException e) {
            // token 值绝不进日志。
            log.warnf("Wargaming token logout failed (status-level warning only): %s",
                    safeMessage(e));
        }
    }

    private static Long parseAccountId(final String accountId) {
        if (WargamingIdentityProvider.isBlank(accountId)) {
            return null;
        }
        try {
            final long value = Long.parseLong(accountId);
            return value > 0 ? value : null;
        } catch (final NumberFormatException e) {
            return null;
        }
    }

    /** expires_at 为 epoch 秒；缺失时以 prolongate 为准，给出值则必须未过期。 */
    private static boolean isNotExpired(final String expiresAt) {
        if (WargamingIdentityProvider.isBlank(expiresAt)) {
            return true;
        }
        try {
            final long expiresSeconds = Long.parseLong(expiresAt);
            return expiresSeconds > System.currentTimeMillis() / 1000L;
        } catch (final NumberFormatException e) {
            return false;
        }
    }

    private static String safeMessage(final Throwable e) {
        final String message = e.getMessage();
        return message != null && !message.isBlank() ? message : e.getClass().getSimpleName();
    }
}
