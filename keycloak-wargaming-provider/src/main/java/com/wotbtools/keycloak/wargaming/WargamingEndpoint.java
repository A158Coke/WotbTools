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
 * WG 回调端点。职责：校验 state → 基础参数校验 → prolongate 验证 token 并取得
 * 服务端绑定的可信 account_id → account/info 获取官方昵称 → 构造稳定身份 → 立即 logout。
 *
 * <p>安全要点（需求文档 D5 / 第十五节）：浏览器回调的 {@code account_id} /
 * {@code nickname} / {@code expires_at} 都是不可信输入；最终身份只来自
 * {@code prolongate} 服务端响应的 account_id，回调值仅作一致性检查。
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
                                   @QueryParam("account_id") final String accountId) {

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

        String wgToken = accessToken;
        String stage = "prolongate";
        try {
            // ── 3. 服务端验证 token 并取得绑定的可信 account_id ────
            final WargamingApiClient.ProlongatedToken refreshed =
                    apiClient.prolongate(applicationId, wgToken);
            wgToken = refreshed.accessToken();
            final long trustedAccountId = refreshed.accountId();

            // ── 4. 一致性检查：回调 account_id 可选；存在则必须与可信值一致 ──
            stage = "callback-account-check";
            if (!WargamingIdentityProvider.isBlank(accountId)) {
                final Long callbackAccountId = parseAccountId(accountId);
                if (callbackAccountId == null
                        || callbackAccountId.longValue() != trustedAccountId) {
                    return WargamingIdentityProvider.errorResponse();
                }
            }

            // ── 5. 查询官方昵称（回调 nickname 仅作一致性检查） ──────
            stage = "account-info";
            final String officialNickname =
                    apiClient.fetchOfficialNickname(applicationId, trustedAccountId, wgToken);
            if (WargamingIdentityProvider.isBlank(officialNickname)) {
                return WargamingIdentityProvider.errorResponse();
            }
            stage = "callback-nickname-check";
            if (!WargamingIdentityProvider.isBlank(nickname) && !nickname.equals(officialNickname)) {
                return WargamingIdentityProvider.errorResponse();
            }

            // ── 6. 构造稳定身份（全部来自可信 account_id） ────────────
            stage = "identity-callback";
            final WargamingRegion region = config.region();
            final String externalId = "wg:" + region.key() + ":" + trustedAccountId;
            final BrokeredIdentityContext context = new BrokeredIdentityContext(externalId, config);
            context.setId(externalId);
            context.setBrokerUserId(externalId);
            context.setBrokerSessionId(externalId);
            // username 带区服前缀避免跨区服 account_id 冲突；游戏账号 ID 保持纯数字存 wotb.account_id。
            context.setUsername("wg_" + region.key() + "_" + trustedAccountId);
            context.setIdp(provider);
            context.setAuthenticationSession(authenticationSession);

            // 只写业务属性，绝不写 WG token。
            context.setUserAttribute("region", region.name());
            context.setUserAttribute("displayName", officialNickname);
            context.setUserAttribute("wotb.account_id", String.valueOf(trustedAccountId));
            context.setUserAttribute("wotb.nickname", officialNickname);
            context.setUserAttribute("wotb.verified", "true");

            return authCallback.authenticated(context);
        } catch (final WargamingApiClient.WargamingApiException e) {
            // 安全错误日志：允许 stage / 错误码 / message / field，不含 token /
            // application_id / state / 完整响应 / error.value。
            log.warnf("Wargaming login rejected at stage=%s: %s", stage, safeMessage(e));
            return WargamingIdentityProvider.errorResponse();
        } catch (final RuntimeException e) {
            // 非预期异常：只记录安全的异常类名，不吞掉 JVM Error。
            log.warnf("Wargaming login failed at stage=%s: %s",
                    stage, e.getClass().getSimpleName());
            return WargamingIdentityProvider.errorResponse();
        } finally {
            // ── 7. 成功或失败路径都尽力立即销毁 token ────────────────
            // Java 执行顺序：return 表达式（authenticated(context)）先完成求值，
            // 随后才执行 finally；因此 logout 不会抢在身份处理之前执行，
            // logout 失败也不会覆盖原登录结果。
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

    private static String safeMessage(final Throwable e) {
        final String message = e.getMessage();
        return message != null && !message.isBlank() ? message : e.getClass().getSimpleName();
    }
}
