package com.wotbtools.keycloak.auth;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class PersistentBrowserSessionAuthenticatorTest {

    @Test
    void remembersOnlyTheBrowserClient() {
        assertTrue(PersistentBrowserSessionAuthenticator.shouldRemember("wotbtools-web"));
        assertFalse(PersistentBrowserSessionAuthenticator.shouldRemember("wotbtools-android"));
        assertFalse(PersistentBrowserSessionAuthenticator.shouldRemember(null));
    }
}
