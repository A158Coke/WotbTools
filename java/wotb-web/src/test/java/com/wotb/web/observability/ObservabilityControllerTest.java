package com.wotb.web.observability;

import com.wotb.web.observability.controller.ObservabilityController;
import com.wotb.web.observability.service.ObservabilityService;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ObservabilityControllerTest {
    @Test
    void forwardedHeadersCannotCreateNewAnonymousSourceQuotas() throws Exception {
        final Instant now = Instant.now();
        final ObservabilityService service = new ObservabilityService(JsonMapper.builder().build(), "",
                Clock.fixed(now, ZoneOffset.UTC));
        final MockMvc mvc = MockMvcBuilders.standaloneSetup(new ObservabilityController(service))
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver()).build();
        final String event = "{\"event_id\":\"" + UUID.randomUUID()
                + "\",\"event\":\"feature_open\",\"platform\":\"web\",\"feature\":\"home\",\"occurred_at\":\"" + now + "\"}";
        final byte[] body = ("{\"events\":[" + String.join(",", Collections.nCopies(20, event)) + "]}")
                .getBytes(StandardCharsets.UTF_8);
        for (int i = 0; i < 7; i++) {
            mvc.perform(post("/api/observability/events").contentType(MediaType.APPLICATION_JSON).content(body)
                    .with(request -> { request.setRemoteAddr("192.0.2.1"); return request; })
                    .header("X-Forwarded-For", "198.51.100." + i)
                    .header("X-Real-IP", "203.0.113." + i)
                    .header("Forwarded", "for=198.51.100." + i))
                    .andExpect(i < 6 ? status().isNoContent() : status().isTooManyRequests());
        }
        mvc.perform(post("/api/observability/events").contentType(MediaType.APPLICATION_JSON).content(body)
                .with(request -> { request.setRemoteAddr("192.0.2.2"); return request; })
                .header("X-Forwarded-For", "192.0.2.1"))
                .andExpect(status().isNoContent());
    }
}
