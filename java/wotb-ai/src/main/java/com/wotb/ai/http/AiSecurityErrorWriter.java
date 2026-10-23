package com.wotb.ai.http;

import com.wotb.web.util.apierror.ApiErrorResponse;
import jakarta.servlet.http.HttpServletResponse;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;

/** Writes the stable ApiError response used for AI service authentication failures. */
public final class AiSecurityErrorWriter {

    private AiSecurityErrorWriter() {
    }

    public static void write(final HttpServletResponse response, final int status, final String errorCode)
            throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        JsonMapper.builder().build().writeValue(response.getOutputStream(), new ApiErrorResponse(
                null, errorCode, null, status, false, Map.of(), Instant.now()));
    }
}
