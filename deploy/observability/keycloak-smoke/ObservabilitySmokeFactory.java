package io.github.trashblazer.keycloak.social.qq;

import org.keycloak.Config;
import org.keycloak.events.Event;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventListenerProviderFactory;
import org.keycloak.events.admin.AdminEvent;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;

/** CI-only hook. Calls the production provider logger inside a real Keycloak JVM. */
public final class ObservabilitySmokeFactory implements EventListenerProviderFactory {
    public String getId() { return "observability-smoke"; }
    public void init(Config.Scope config) { }
    public void close() { }
    public void postInit(KeycloakSessionFactory factory) {
        AuthEventLog.failure("qq", "runtime_smoke", "QQ_UPSTREAM_FAILURE",
                new IllegalStateException("runtime smoke", new java.io.IOException("test cause")));
    }
    public EventListenerProvider create(KeycloakSession session) {
        return new EventListenerProvider() {
            public void onEvent(Event event) { }
            public void onEvent(AdminEvent event, boolean includeRepresentation) { }
            public void close() { }
        };
    }
}
