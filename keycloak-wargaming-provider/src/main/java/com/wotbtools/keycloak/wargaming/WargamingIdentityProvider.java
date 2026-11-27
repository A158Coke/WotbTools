package com.wotbtools.keycloak.wargaming;

import jakarta.ws.rs.core.Response;
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

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public class WargamingIdentityProvider
        extends AbstractIdentityProvider<WargamingIdentityProviderConfig> {

    private static final Logger log = Logger.getLogger(WargamingIdentityProvider.class);

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
        return buildLoginResponseSafely(applicationId, state);
    }

    Response buildLoginResponseSafely(final String applicationId, final String state) {
        try {
            return buildLoginResponse(applicationId, state);
        } catch (final WargamingApiClient.WargamingApiException e) {
            log.warnf("Wargaming login initialization failed: %s", e.getMessage());
            return errorResponse();
        }
    }

    Response buildLoginResponse(final String applicationId, final String state) {
        final String callbackUrl = brokerEndpointUri().toString() + "?state=" + encode(state);
        final String loginUrl = apiClient.fetchLoginRedirectUrl(applicationId, callbackUrl);
        return Response.status(302).header("Location", loginUrl).build();
    }

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
