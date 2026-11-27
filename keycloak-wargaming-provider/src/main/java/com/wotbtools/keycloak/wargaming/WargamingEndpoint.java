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

import java.util.Set;

final class WargamingEndpoint {

    private static final Logger log = Logger.getLogger(WargamingEndpoint.class);
    private static final int MAX_DIAGNOSTIC_VALUE_LENGTH = 160;
    private static final Set<String> SAFE_CALLBACK_ERROR_CLASSES = Set.of(
            "INVALID_IP_ADDRESS",
            "INVALID_APPLICATION_ID",
            "APPLICATION_IS_BLOCKED",
            "REQUEST_LIMIT_EXCEEDED",
            "METHOD_NOT_FOUND",
            "ACCESS_DENIED",
            "AUTH_ERROR"
    );

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
                                   @QueryParam("code") final String errorCode,
                                   @QueryParam("message") final String errorMessage) {

        if (WargamingIdentityProvider.isBlank(state)) {
            return reject("callback-state", "missing-state");
        }
        final AuthenticationSessionModel authenticationSession =
                authCallback.getAndVerifyAuthenticationSession(state);
        if (authenticationSession == null) {
            return reject("callback-state", "invalid-authentication-session");
        }
        session.getContext().setAuthenticationSession(authenticationSession);

        final String applicationId = WargamingIdentityProvider.applicationId();
        if (WargamingIdentityProvider.isBlank(applicationId)) {
            return reject("configuration", "missing-application-id");
        }

        if (!"ok".equals(status)) {
            log.warnf("Wargaming login rejected region=%s stage=callback-status reason=provider-error code=%s providerError=%s",
                    regionName(), safeProviderCode(errorCode), providerErrorClass(errorMessage));
            return WargamingIdentityProvider.errorResponse();
        }
        if (WargamingIdentityProvider.isBlank(accessToken)) {
            return reject("callback-token", "missing-access-token");
        }

        String wgToken = accessToken;
        String stage = "prolongate";
        try {
            final WargamingApiClient.ProlongatedToken refreshed =
                    apiClient.prolongate(applicationId, wgToken);
            wgToken = refreshed.accessToken();
            final long trustedAccountId = refreshed.accountId();

            stage = "callback-account-check";
            if (!WargamingIdentityProvider.isBlank(accountId)) {
                final Long callbackAccountId = parseAccountId(accountId);
                if (callbackAccountId == null
                        || callbackAccountId.longValue() != trustedAccountId) {
                    return reject(stage, "account-id-mismatch");
                }
            }

            stage = "account-info";
            final String officialNickname =
                    apiClient.fetchOfficialNickname(applicationId, trustedAccountId, wgToken);
            if (WargamingIdentityProvider.isBlank(officialNickname)) {
                return reject(stage, "missing-official-nickname");
            }
            stage = "callback-nickname-check";
            if (!WargamingIdentityProvider.isBlank(nickname) && !nickname.equals(officialNickname)) {
                return reject(stage, "nickname-mismatch");
            }

            stage = "identity-callback";
            final WargamingRegion region = config.region();
            final String externalId = "wg:" + region.key() + ":" + trustedAccountId;
            final BrokeredIdentityContext context = new BrokeredIdentityContext(externalId, config);
            context.setId(externalId);
            context.setBrokerUserId(externalId);
            context.setBrokerSessionId(externalId);
            context.setUsername("wg_" + region.key() + "_" + trustedAccountId);
            context.setIdp(provider);
            context.setAuthenticationSession(authenticationSession);

            context.setUserAttribute("region", region.name());
            context.setUserAttribute("displayName", officialNickname);
            context.setUserAttribute("wotb.account_id", String.valueOf(trustedAccountId));
            context.setUserAttribute("wotb.nickname", officialNickname);
            context.setUserAttribute("wotb.verified", "true");

            return authCallback.authenticated(context);
        } catch (final WargamingApiClient.WargamingApiException e) {
            log.warnf("Wargaming login rejected region=%s stage=%s reason=wg-api-error detail=%s",
                    regionName(), stage, safeMessage(e));
            return WargamingIdentityProvider.errorResponse();
        } catch (final RuntimeException e) {
            log.warnf("Wargaming login failed region=%s stage=%s reason=unexpected-exception type=%s",
                    regionName(), stage, e.getClass().getSimpleName());
            return WargamingIdentityProvider.errorResponse();
        } finally {
            logoutBestEffort(applicationId, wgToken);
        }
    }

    Response handleCallback(final String state,
                            final String status,
                            final String accessToken,
                            final String nickname,
                            final String accountId) {
        return handleCallback(state, status, accessToken, nickname, accountId, null, null);
    }

    private Response reject(final String stage, final String reason) {
        log.warnf("Wargaming login rejected region=%s stage=%s reason=%s",
                regionName(), stage, reason);
        return WargamingIdentityProvider.errorResponse();
    }

    private String regionName() {
        return config.region().name();
    }

    private void logoutBestEffort(final String applicationId, final String accessToken) {
        if (WargamingIdentityProvider.isBlank(accessToken)) {
            return;
        }
        try {
            apiClient.logout(applicationId, accessToken);
        } catch (final WargamingApiClient.WargamingApiException e) {
            log.warnf("Wargaming token logout failed region=%s reason=wg-api-error detail=%s",
                    regionName(), safeMessage(e));
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

    static String safeProviderCode(final String value) {
        if (value == null || value.isBlank()) {
            return "-";
        }
        final String trimmed = value.trim();
        if (trimmed.length() > 6) {
            return "unknown";
        }
        for (int i = 0; i < trimmed.length(); i++) {
            if (!Character.isDigit(trimmed.charAt(i))) {
                return "unknown";
            }
        }
        return trimmed;
    }

    static String providerErrorClass(final String value) {
        if (value == null || value.isBlank()) {
            return "-";
        }
        final String normalized = value.trim();
        return SAFE_CALLBACK_ERROR_CLASSES.contains(normalized) ? normalized : "UNKNOWN";
    }

    private static String safeDiagnosticValue(final String value) {
        if (value == null || value.isBlank()) {
            return "-";
        }
        final int end = Math.min(value.length(), MAX_DIAGNOSTIC_VALUE_LENGTH);
        final StringBuilder sanitized = new StringBuilder(end);
        for (int i = 0; i < end; i++) {
            final char current = value.charAt(i);
            sanitized.append(Character.isISOControl(current) ? ' ' : current);
        }
        final String result = sanitized.toString().trim();
        return result.isEmpty() ? "-" : result;
    }

    private static String safeMessage(final Throwable e) {
        final String message = e.getMessage();
        return safeDiagnosticValue(message != null && !message.isBlank()
                ? message
                : e.getClass().getSimpleName());
    }
}
