package com.wotb.ai;

import com.wotb.web.replay.ai.gateway.AiChatGateway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import javax.sql.DataSource;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(classes = AiServiceApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "spring.security.oauth2.resourceserver.jwt.issuer-uri=",
                "spring.security.oauth2.resourceserver.jwt.jwk-set-uri=http://127.0.0.1:9/jwks",
                "wotb.ai.api-key="
        })
class AiServiceStartupTest {
    @Autowired
    private ApplicationContext context;

    @Test
    void bootsWithoutDatabaseObjectStorageOrProviderKey() {
        assertNotNull(context.getBean(AiReviewController.class));
        assertNotNull(context.getBean(AiChatGateway.class));
        assertFalse(context.getBean(AiChatGateway.class).isConfigured());
        assertNull(context.getBeanProvider(DataSource.class).getIfAvailable());
        assertTrue(context.getBean("requestMappingHandlerMapping", RequestMappingHandlerMapping.class)
                .getHandlerMethods().values()
                .stream().anyMatch(method -> method.getBeanType() == AiReviewController.class
                        && method.getMethod().getName().equals("reviewJson")));
    }
}
