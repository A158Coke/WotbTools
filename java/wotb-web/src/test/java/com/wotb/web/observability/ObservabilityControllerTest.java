package com.wotb.web.observability;

import com.wotb.web.observability.controller.ObservabilityController;
import com.wotb.web.observability.service.ObservabilityService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.MediaType;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class ObservabilityControllerTest {
    @ParameterizedTest
    @ValueSource(strings = {"172.29.0.1", "172.29.0.7", "10.20.0.3"})
    void productionProxySeparatesClientsAndIgnoresForgedForwardingChains(final String peer) throws Exception {
        final Instant now = Instant.now();
        final ObservabilityService service = new ObservabilityService(JsonMapper.builder().build(), "",
                Clock.fixed(now, ZoneOffset.UTC));
        final MockMvc mvc = mvc(service, "172.29.0.0/16,10.20.0.3/32");
        final String event = "{\"event_id\":\"" + UUID.randomUUID()
                + "\",\"event\":\"feature_open\",\"platform\":\"web\",\"feature\":\"home\",\"occurred_at\":\"" + now + "\"}";
        final byte[] body = ("{\"events\":[" + String.join(",", Collections.nCopies(20, event)) + "]}")
                .getBytes(StandardCharsets.UTF_8);
        for (int i = 0; i < 7; i++) {
            mvc.perform(post("/api/observability/events").contentType(MediaType.APPLICATION_JSON).content(body)
                    .with(request -> { request.setRemoteAddr(peer); return request; })
                    .header("X-Real-IP", "203.0.113.10")
                    .header("X-Forwarded-For", "198.51.100." + i + ", 203.0.113.10")
                    .header("Forwarded", "for=198.51.100." + i))
                    .andExpect(i < 6 ? status().isNoContent() : status().isTooManyRequests());
        }
        mvc.perform(post("/api/observability/events").contentType(MediaType.APPLICATION_JSON).content(body)
                .with(request -> { request.setRemoteAddr(peer); return request; })
                .header("X-Real-IP", "203.0.113.11")
                .header("X-Forwarded-For", "203.0.113.10"))
                .andExpect(status().isNoContent());
    }

    @ParameterizedTest
    @CsvSource({"203.0.113.10,203.0.113.10", "2001:db8::1,2001:db8:0:0:0:0:0:1",
            "2001:0db8:0000:0000:0000:0000:0000:0001,2001:db8:0:0:0:0:0:1",
            "localhost,172.29.0.1", "'203.0.113.10, 198.51.100.1',172.29.0.1",
            "203.0.113.10:1234,172.29.0.1", "fe80::1%eth0,172.29.0.1", "'',172.29.0.1"})
    void trustedProxyAcceptsOnlySingleIpLiterals(final String header, final String expected) throws Exception {
        final ObservabilityService service = mock(ObservabilityService.class);
        mvc(service, "172.29.0.0/16").perform(post("/api/observability/events")
                .contentType(MediaType.APPLICATION_JSON).content("{}")
                .with(request -> { request.setRemoteAddr("172.29.0.1"); return request; })
                .header("X-Real-IP", header)).andExpect(status().isNoContent());
        verify(service).accept(any(byte[].class), isNull(), eq(expected));
    }

    @Test
    void missingOrDuplicateNormalizedHeadersFallBackToPeer() throws Exception {
        for (final boolean duplicate : new boolean[] {false, true}) {
            final ObservabilityService service = mock(ObservabilityService.class);
            final var request = post("/api/observability/events").contentType(MediaType.APPLICATION_JSON)
                    .content("{}").with(value -> { value.setRemoteAddr("172.29.0.1"); return value; })
                    .header("X-Forwarded-For", "203.0.113.10");
            if (duplicate) {
                request.header("X-Real-IP", "203.0.113.10", "203.0.113.11");
            }
            mvc(service, "172.29.0.0/16").perform(request).andExpect(status().isNoContent());
            verify(service).accept(any(byte[].class), isNull(), eq("172.29.0.1"));
        }
    }

    @Test
    void emptyProxyConfigurationTrustsNoHeadersEvenFromPrivatePeers() throws Exception {
        final ObservabilityService service = mock(ObservabilityService.class);
        mvc(service, "").perform(post("/api/observability/events").contentType(MediaType.APPLICATION_JSON)
                .content("{}").with(request -> { request.setRemoteAddr("172.29.0.1"); return request; })
                .header("X-Real-IP", "203.0.113.10")).andExpect(status().isNoContent());
        verify(service).accept(any(byte[].class), isNull(), eq("172.29.0.1"));
    }

    @Test
    void productionConfigurationPinsTrustAndNginxOverwritesClientHeader() throws Exception {
        final Path root = java.util.stream.Stream.of(Path.of("."), Path.of(".."), Path.of("../.."))
                .filter(path -> Files.exists(path.resolve("deploy/tx/business-api.compose.yml")))
                .findFirst().orElseThrow();
        final String compose = Files.readString(root.resolve("deploy/tx/business-api.compose.yml"));
        final String nginx = Files.readString(root.resolve("deploy/tx/nginx/frontend.conf.template"));
        assertTrue(compose.contains("WOTB_OBSERVABILITY_TRUSTED_PROXIES: \"172.29.0.0/16,10.20.0.3/32\""));
        assertTrue(nginx.contains("set_real_ip_from caddy;"));
        assertTrue(nginx.contains("real_ip_header X-Forwarded-For;"));
        final String api = nginx.substring(nginx.indexOf("location /api/ {"));
        assertTrue(api.contains("proxy_set_header X-Real-IP $remote_addr;"));
    }

    private MockMvc mvc(final ObservabilityService service, final String trustedProxies) {
        return MockMvcBuilders.standaloneSetup(new ObservabilityController(service, trustedProxies))
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver()).build();
    }

    @Test
    void forwardedHeadersCannotCreateNewAnonymousSourceQuotas() throws Exception {
        final Instant now = Instant.now();
        final ObservabilityService service = new ObservabilityService(JsonMapper.builder().build(), "",
                Clock.fixed(now, ZoneOffset.UTC));
        final MockMvc mvc = MockMvcBuilders.standaloneSetup(new ObservabilityController(service, "172.29.0.0/16,10.20.0.3/32"))
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
