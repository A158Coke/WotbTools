package com.wotb.web.util.apierror;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;

/** Writes the canonical envelope from filter-layer handlers without hand-built JSON. */
@Component
public class ApiErrorWriter {

    private static final Logger LOGGER = LoggerFactory.getLogger(ApiErrorWriter.class);

    private final ObjectMapper objectMapper;

    public ApiErrorWriter(final ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void write(final HttpServletResponse response, final ApiErrorResponse error,
                      final HttpServletRequest request) throws IOException {
        response.setStatus(error.status());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.setHeader(RequestTrace.HEADER, RequestTrace.resolve(request));
        LOGGER.info("api_request_rejected traceId={} id={} errorCode={} status={} method={} path={}",
                error.id(), error.id(), error.errorCode(), error.status(),
                request == null ? "UNKNOWN" : request.getMethod(),
                request == null ? "UNKNOWN" : request.getRequestURI());
        objectMapper.writeValue(response.getOutputStream(), error);
    }
}
