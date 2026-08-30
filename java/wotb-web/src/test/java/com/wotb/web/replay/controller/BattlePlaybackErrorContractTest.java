package com.wotb.web.replay.controller;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.wotb.web.config.RequestIdFilter;
import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.replay.MapOverviewQueryService;
import com.wotb.web.replay.ai.AiReplayReviewService;
import com.wotb.web.replay.ai.AiReviewWorkerExecutor;
import com.wotb.web.replay.ai.gateway.AiCancellationRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Actual Battle Playback controller slice: internal failures retain one response/log trace identity. */
class BattlePlaybackErrorContractTest {

    @Test
    void missingCancellationIsCanonicalInsteadOfAnEmptyProtectedApiResponse() throws Exception {
        final String traceId = "cancel-missing-trace";
        final String correlationId = "12345678-1234-1234-1234-123456789abc";
        final AiCancellationRegistry cancellationRegistry = mock(AiCancellationRegistry.class);
        when(cancellationRegistry.cancel(correlationId)).thenReturn(false);
        final ReconstructionController controller = new ReconstructionController(
                mock(AiReplayReviewService.class),
                cancellationRegistry,
                mock(AiReviewWorkerExecutor.class),
                mock(MapOverviewQueryService.class));
        final MockMvc mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler())
                .addFilters(new RequestIdFilter())
                .build();

        mvc.perform(post("/api/replay/analyze/cancel")
                        .header(RequestIdFilter.HEADER, traceId)
                        .param("correlationId", correlationId))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(header().string(RequestIdFilter.HEADER, traceId))
                .andExpect(jsonPath("$.errorCode").value("RESOURCE_NOT_FOUND"))
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.id").value(traceId));
    }

    @Test
    void internalFailureIsCanonicalAndLoggedWithResponseTraceId() throws Exception {
        final String traceId = "playback-error-trace";
        final MapOverviewQueryService mapOverview = mock(MapOverviewQueryService.class);
        when(mapOverview.buildBattlePlaybackFromDataset("p1", 0))
                .thenThrow(new RuntimeException("private playback storage detail"));
        final ReconstructionController controller = new ReconstructionController(
                mock(AiReplayReviewService.class),
                mock(AiCancellationRegistry.class),
                mock(AiReviewWorkerExecutor.class),
                mapOverview);
        final MockMvc mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler())
                .addFilters(new RequestIdFilter())
                .build();

        final ch.qos.logback.classic.Logger logger = (ch.qos.logback.classic.Logger)
                org.slf4j.LoggerFactory.getLogger(GlobalExceptionHandler.class);
        final Level previousLevel = logger.getLevel();
        final ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        logger.setLevel(Level.ALL);
        try {
            mvc.perform(post("/api/replay/battle-playback-v2")
                            .header(RequestIdFilter.HEADER, traceId)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"processingJobId\":\"p1\",\"sourceId\":\"r0\"}"))
                    .andExpect(status().isInternalServerError())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                    .andExpect(header().string(RequestIdFilter.HEADER, traceId))
                    .andExpect(jsonPath("$.errorCode").value("INTERNAL_ERROR"))
                    .andExpect(jsonPath("$.status").value(500))
                    .andExpect(jsonPath("$.id").value(traceId))
                    .andExpect(jsonPath("$.retryable").value(true))
                    .andExpect(jsonPath("$.details").isMap())
                    .andExpect(jsonPath("$.message").doesNotExist())
                    .andExpect(jsonPath("$.stackTrace").doesNotExist());

            assertTrue(appender.list.stream().anyMatch(event ->
                            event.getLevel() == Level.ERROR
                                    && event.getFormattedMessage().contains("api_request_failed")
                                    && event.getFormattedMessage().contains("traceId=" + traceId)),
                    "500 log must carry the same traceId returned by the endpoint");
        } finally {
            logger.detachAppender(appender);
            logger.setLevel(previousLevel);
            appender.stop();
        }
    }
}
