package com.wotb.web.util.apierror;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;

/** Writes the canonical envelope from filter-layer handlers without hand-built JSON. */
@Component
public class ApiErrorWriter {

    private final ObjectMapper objectMapper;

    public ApiErrorWriter(final ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void write(final HttpServletResponse response, final ApiErrorResponse error) throws IOException {
        response.setStatus(error.status());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.setHeader(RequestTrace.HEADER, error.traceId());
        objectMapper.writeValue(response.getOutputStream(), error);
    }
}
