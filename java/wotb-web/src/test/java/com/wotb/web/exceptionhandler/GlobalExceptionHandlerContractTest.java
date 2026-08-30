package com.wotb.web.exceptionhandler;

import com.wotb.web.admin.exception.AdminBadRequestException;
import com.wotb.web.admin.exception.AdminConflictException;
import com.wotb.web.admin.exception.AdminInternalException;
import com.wotb.web.config.RequestIdFilter;
import com.wotb.web.replay.exception.ReplayBusyException;
import com.wotb.web.replay.job.ExportQueueFullException;
import com.wotb.web.replayfile.HallOfFameStorageException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class GlobalExceptionHandlerContractTest {

    private static final String TRACE_ID = "contract-trace-42";
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new ErrorProbeController())
                .setControllerAdvice(new GlobalExceptionHandler())
                .addFilters(new RequestIdFilter())
                .build();
    }

    @Test
    void legacyDomainAndUnhandledExceptionsUseCanonicalEnvelope() throws Exception {
        assertEnvelope(get("/contract/illegal-stable"), 404, "PROFILE_NOT_FOUND", false);
        assertEnvelope(get("/contract/illegal-unsafe"), 400, "INVALID_ARGUMENT", false);
        assertEnvelope(get("/contract/state"), 409, "INVALID_STATE", false);
        assertEnvelope(get("/contract/replay-busy"), 503, "REPLAY_BUSY", true);
        assertEnvelope(get("/contract/export-full"), 503, "EXPORT_QUEUE_FULL", true);
        assertEnvelope(get("/contract/hof-storage"), 500, "STORAGE_ERROR", true);
        assertEnvelope(get("/contract/multipart"), 400, "MULTIPART_ERROR", false);
        assertEnvelope(get("/contract/response-status"), 404, "RESOURCE_NOT_FOUND", false);
        assertEnvelope(get("/contract/admin-bad"), 400, "ADMIN_BAD_REQUEST", false);
        assertEnvelope(get("/contract/admin-conflict"), 409, "ADMIN_CONFLICT", false);
        assertEnvelope(get("/contract/admin-internal"), 500, "ADMIN_INTERNAL_ERROR", true);
        assertEnvelope(get("/contract/max-upload"), 413, "UPLOAD_TOO_LARGE", false);
        assertEnvelope(get("/contract/unhandled"), 500, "INTERNAL_ERROR", true);
    }

    @Test
    void springMvcProtocolErrorsUseCanonicalEnvelope() throws Exception {
        assertEnvelope(post("/contract/request")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"),
                400, "MISSING_PARAM", false);
        assertEnvelope(post("/contract/request?required=yes")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{"),
                400, "INVALID_REQUEST", false);
        assertEnvelope(post("/contract/request?required=yes")
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("text"),
                415, "UNSUPPORTED_MEDIA_TYPE", false);
        assertEnvelope(get("/contract/request"), 405, "METHOD_NOT_ALLOWED", false);
    }

    private void assertEnvelope(final org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request,
                                final int expectedStatus, final String expectedCode,
                                final boolean expectedRetryable) throws Exception {
        final ResultActions result = mvc.perform(request.header(RequestIdFilter.HEADER, TRACE_ID));
        result.andExpect(status().is(expectedStatus))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(header().string(RequestIdFilter.HEADER, TRACE_ID))
                .andExpect(jsonPath("$.errorCode").value(expectedCode))
                .andExpect(jsonPath("$.status").value(expectedStatus))
                .andExpect(jsonPath("$.id").value(TRACE_ID))
                .andExpect(jsonPath("$.retryable").value(expectedRetryable))
                .andExpect(jsonPath("$.details").isMap())
                .andExpect(jsonPath("$.timestamp").isNotEmpty())
                .andExpect(jsonPath("$.messageKey").doesNotExist())
                .andExpect(jsonPath("$.traceId").doesNotExist())
                .andExpect(jsonPath("$.stackTrace").doesNotExist())
                .andExpect(jsonPath("$.message").doesNotExist());
    }

    @RestController
    static class ErrorProbeController {

        @GetMapping("/contract/illegal-stable")
        void illegalStable() { throw new IllegalArgumentException("PROFILE_NOT_FOUND"); }

        @GetMapping("/contract/illegal-unsafe")
        void illegalUnsafe() { throw new IllegalArgumentException("private file path /srv/data/replay"); }

        @GetMapping("/contract/state")
        void state() { throw new IllegalStateException("state details must remain private"); }

        @GetMapping("/contract/replay-busy")
        void replayBusy() { throw new ReplayBusyException(); }

        @GetMapping("/contract/export-full")
        void exportFull() { throw new ExportQueueFullException(); }

        @GetMapping("/contract/hof-storage")
        void hofStorage() {
            throw new HallOfFameStorageException("STORAGE_ERROR", HttpStatus.INTERNAL_SERVER_ERROR,
                    "private storage path");
        }

        @GetMapping("/contract/multipart")
        void multipart() { throw new MultipartException("private multipart parser details"); }

        @GetMapping("/contract/response-status")
        void responseStatus() { throw new ResponseStatusException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND"); }

        @GetMapping("/contract/admin-bad")
        void adminBad() { throw new AdminBadRequestException("ADMIN_BAD_REQUEST", "private details"); }

        @GetMapping("/contract/admin-conflict")
        void adminConflict() { throw new AdminConflictException("ADMIN_CONFLICT", "private details"); }

        @GetMapping("/contract/admin-internal")
        void adminInternal() { throw new AdminInternalException("ADMIN_INTERNAL_ERROR", "private details"); }

        @GetMapping("/contract/max-upload")
        void maxUpload() { throw new MaxUploadSizeExceededException(-1); }

        @GetMapping("/contract/unhandled")
        void unhandled() { throw new RuntimeException("database password must remain private"); }

        @PostMapping(value = "/contract/request", consumes = MediaType.APPLICATION_JSON_VALUE)
        Map<String, Object> request(@RequestParam String required,
                                    @RequestBody Map<String, Object> body) {
            return body;
        }
    }
}
