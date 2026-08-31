package com.wotb.web.config;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.slf4j.LoggerFactory.getLogger;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class SecurityErrorLoggingContractTest {

    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;
    private Logger logger;
    private ListAppender<ILoggingEvent> appender;
    private Level previousLevel;
    private final ObjectMapper objectMapper = JsonMapper.builder().findAndAddModules().build();

    @BeforeEach
    void setUp() {
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.register(SecurityConfigTest.TestConfig.class);
        context.refresh();
        mvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();

        logger = (Logger) getLogger("com.wotb.web.util.apierror.ApiErrorWriter");
        previousLevel = logger.getLevel();
        logger.setLevel(Level.INFO);
        appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
    }

    @AfterEach
    void tearDown() {
        logger.detachAppender(appender);
        logger.setLevel(previousLevel);
        context.close();
    }

    @Test
    void unauthenticatedResponseIdMatchesSafeRejectionLog() throws Exception {
        final String responseId = performAndReadId(
                get("/api/users/probe").header("X-Request-ID", "security-401"));

        final ILoggingEvent event = rejectionEvent("AUTH_UNAUTHENTICATED", 401);
        assertSecurityLog(event, responseId, "security-401", "GET", "/api/users/probe");
    }

    @Test
    void forbiddenResponseIdMatchesSafeRejectionLog() throws Exception {
        final String responseId = performAndReadId(
                get("/api/replay/analyze")
                        .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_other")))
                        .header("X-Request-ID", "security-403"));

        final ILoggingEvent event = rejectionEvent("AUTH_FORBIDDEN", 403);
        assertSecurityLog(event, responseId, "security-403", "GET", "/api/replay/analyze");
    }

    @Test
    void errorExplorerQueryMatchesSecurityRejectionEventsAndDiagnosticId() throws Exception {
        final Path dashboard = dashboardPath();
        final JsonNode root = objectMapper.readTree(Files.readString(dashboard));
        final String query = errorExplorerQuery(root);

        assertTrue(query.contains("api_request_failed|api_request_rejected|ERROR|WARN"));
        assertTrue(query.contains("${id:raw}"));
        assertTrue(query.contains("${traceId:raw}"));
        assertFalse(query.contains("${version:raw}"));
    }

    private String performAndReadId(final org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request)
            throws Exception {
        final MvcResult result = mvc.perform(request).andExpect(status().is4xxClientError()).andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString())
                .get("id").asText();
    }

    private ILoggingEvent rejectionEvent(final String errorCode, final int status) {
        return appender.list.stream()
                .filter(event -> event.getLevel() == Level.INFO)
                .filter(event -> event.getFormattedMessage().contains("api_request_rejected"))
                .filter(event -> event.getFormattedMessage().contains("errorCode=" + errorCode))
                .filter(event -> event.getFormattedMessage().contains("status=" + status))
                .findFirst()
                .orElseThrow(() -> new AssertionError("security rejection log is missing"));
    }

    private static void assertSecurityLog(final ILoggingEvent event, final String responseId,
                                          final String traceId, final String method, final String path) {
        final String message = event.getFormattedMessage();
        assertEquals(Level.INFO, event.getLevel());
        assertTrue(message.contains("traceId=" + traceId));
        assertTrue(message.contains("id=" + responseId));
        assertTrue(message.contains("method=" + method));
        assertTrue(message.contains("path=" + path));
        assertFalse(message.contains("Authorization"));
        assertFalse(message.contains("JWT"));
        assertFalse(message.contains("Bearer"));
        assertFalse(message.contains("body="));
    }

    private static Path dashboardPath() {
        final Path relative = Path.of("deploy", "observability", "grafana", "dashboards",
                "wotbtools-error-explorer.json");
        final Path fromModule = Path.of("..", "..", "deploy", "observability", "grafana", "dashboards",
                "wotbtools-error-explorer.json");
        return Files.isRegularFile(relative) ? relative : fromModule;
    }

    private static String errorExplorerQuery(final JsonNode root) {
        for (final JsonNode panel : root.get("panels")) {
            if ("Filtered error explorer".equals(panel.get("title").asText())) {
                return panel.get("targets").get(0).get("expr").asText();
            }
        }
        throw new AssertionError("Filtered error explorer panel is missing");
    }
}
