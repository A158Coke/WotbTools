package com.wotb.web.config;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class BackendManagementHealthContractTest {

    @Test
    void applicationYmlExposesHealthOnTheDedicatedActuatorPort() throws Exception {
        List<PropertySource<?>> propertySources = new YamlPropertySourceLoader()
                .load("application", new ClassPathResource("application.yml"));
        PropertySource<?> application = propertySources.getFirst();

        assertEquals(8088, application.getProperty("management.server.port"));
        assertEquals("health,info,metrics,prometheus",
                application.getProperty("management.endpoints.web.exposure.include"));
        assertNull(application.getProperty("management.endpoints.web.base-path"),
                "an unset base path preserves Spring Boot's default /actuator path");
    }
}
