package com.wotb.broker.rabbitmq;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Contract of the deployment-supplied broker settings, including the password secrecy invariant. */
class RabbitBrokerPropertiesTest {

    private static final String PASSWORD = "not-a-real-broker-password";

    @Test
    void toStringNeverRendersThePassword() {
        final RabbitBrokerProperties properties = properties();

        assertFalse(properties.toString().contains(PASSWORD), properties.toString());
        assertTrue(properties.toString().contains("password=***"), properties.toString());
        assertTrue(properties.toString().contains("vhost=/wotbtools"), properties.toString());
    }

    @Test
    void blankTextFieldsAreRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> new RabbitBrokerProperties(" ", 5672, "/wotbtools", "control-api", PASSWORD, 1));
        assertThrows(IllegalArgumentException.class,
                () -> new RabbitBrokerProperties("rabbitmq", 5672, "", "control-api", PASSWORD, 1));
        assertThrows(IllegalArgumentException.class,
                () -> new RabbitBrokerProperties("rabbitmq", 5672, "/wotbtools", null, PASSWORD, 1));
        assertThrows(IllegalArgumentException.class,
                () -> new RabbitBrokerProperties("rabbitmq", 5672, "/wotbtools", "control-api", "\t", 1));
    }

    @Test
    void portAndPrefetchBoundsAreEnforced() {
        assertThrows(IllegalArgumentException.class,
                () -> new RabbitBrokerProperties("rabbitmq", 0, "/wotbtools", "control-api", PASSWORD, 1));
        assertThrows(IllegalArgumentException.class,
                () -> new RabbitBrokerProperties("rabbitmq", 65536, "/wotbtools", "control-api", PASSWORD, 1));
        assertThrows(IllegalArgumentException.class,
                () -> new RabbitBrokerProperties("rabbitmq", 5672, "/wotbtools", "control-api", PASSWORD, 0));
    }

    @Test
    void equalValuesStayEqual() {
        assertEquals(properties(), properties());
        assertEquals(properties().hashCode(), properties().hashCode());
    }

    private static RabbitBrokerProperties properties() {
        return new RabbitBrokerProperties("rabbitmq", 5672, "/wotbtools", "control-api", PASSWORD, 2);
    }
}
