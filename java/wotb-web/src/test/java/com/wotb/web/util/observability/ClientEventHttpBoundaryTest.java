package com.wotb.web.util.observability;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.wotb.web.config.ApiErrorTestConfig;
import com.wotb.web.config.RequestIdFilter;
import com.wotb.web.config.SecurityConfig;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ClientEventHttpBoundaryTest {
    private static final String ENDPOINT = "/api/observability/client-events";
    private static final String BODY = """
            {"event":"client.wasm_load_failed","platform":"web","errorCode":"CLIENT_WASM_LOAD_FAILED"}
            """;

    @Test
    void identityComesFromValidatedJwtAndNeverLeaksToAnonymousReports() throws Exception {
        final Logger logger = (Logger) LoggerFactory.getLogger(ClientEventService.class);
        final ListAppender<ILoggingEvent> appender = new ListAppender<>() {
            @Override
            protected void append(final ILoggingEvent event) {
                event.prepareForDeferredProcessing();
                super.append(event);
            }
        };
        appender.start();
        logger.addAppender(appender);
        try (final AnnotationConfigWebApplicationContext context = new AnnotationConfigWebApplicationContext()) {
            context.setServletContext(new MockServletContext());
            context.register(TestConfig.class);
            context.refresh();
            final var mvc = MockMvcBuilders.webAppContextSetup(context).addFilters(new RequestIdFilter())
                    .apply(springSecurity()).build();
            mvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(BODY)
                    .header("X-User-ID", "forged").with(jwt().jwt(token -> token.subject("authoritative-sub"))))
                    .andExpect(status().isNoContent());
            mvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(BODY)
                    .header("X-User-ID", "forged"))
                    .andExpect(status().isNoContent());
            assertEquals("authoritative-sub", appender.list.get(0).getMDCPropertyMap().get("userId"));
            assertNull(appender.list.get(1).getMDCPropertyMap().get("userId"));
            mvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON)
                    .content(BODY.strip().replace("}", ",\"userId\":\"forged\"}")))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("errorCode").value("INVALID_REQUEST"));
            mvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(" ".repeat(4097)))
                    .andExpect(status().isPayloadTooLarge()).andExpect(jsonPath("errorCode").value("UPLOAD_TOO_LARGE"));
            assertEquals(2, appender.list.size(), "Rejected reports must never become client failure logs");
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    @Configuration
    @EnableWebMvc
    @Import({SecurityConfig.class, ApiErrorTestConfig.class, ClientEventController.class, ClientEventService.class})
    static class TestConfig {
        @Bean
        JwtDecoder jwtDecoder() { return mock(JwtDecoder.class); }
    }
}
