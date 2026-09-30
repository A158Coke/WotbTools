package com.wotb.ai;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code POST /api/ai/reviews} 的 HTTP 边界契约：JWT 角色门 + 返回 worker 之前的失败必须是契约
 * {@code ApiError} 信封（含稳定 {@code errorCode}），而不是 Spring 默认错误体。
 *
 * <p>覆盖 plan §25 的 HTTP 用例：无 JWT、角色不足、不支持的 schemaVersion、未知 locale、非法
 * correlationId。SSE 事件流与取消端点由 {@link AiReviewControllerTest} 在 controller 层覆盖。</p>
 *
 * <p>MockMvc 按本仓库既有形态手工装配（{@code webAppContextSetup + springSecurity()}），
 * 不依赖 {@code @AutoConfigureMockMvc}（Spring Boot 4.1 该切片不在现有测试依赖内）。</p>
 */
@SpringBootTest(classes = AiServiceApplication.class,
        properties = {
                "spring.security.oauth2.resourceserver.jwt.issuer-uri=",
                "spring.security.oauth2.resourceserver.jwt.jwk-set-uri=http://127.0.0.1:9/jwks",
                "wotb.ai.api-key="
        })
class AiReviewHttpBoundaryTest {

    private static final String ENDPOINT = "/api/ai/reviews";
    private static final String USER = "ROLE_wotbtools-user";

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void rejectsRequestWithoutJwt() throws Exception {
        mockMvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(validBody("zh-CN")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void rejectsAuthenticatedCallerWithoutAiRole() throws Exception {
        mockMvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(validBody("zh-CN"))
                        .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-hof"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void returnsContractEnvelopeForUnsupportedSchemaVersion() throws Exception {
        mockMvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"schemaVersion\":2}").with(jwt().authorities(new SimpleGrantedAuthority(USER))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("UNSUPPORTED_AI_REQUEST_SCHEMA"))
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.retryable").value(false))
                .andExpect(jsonPath("$.details").exists())
                .andExpect(jsonPath("$.timestamp").exists());
    }

    @Test
    void returnsContractEnvelopeForUnknownLocale() throws Exception {
        mockMvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(validBody("de-DE"))
                        .with(jwt().authorities(new SimpleGrantedAuthority(USER))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("UNKNOWN_LOCALE"));
    }

    @Test
    void returnsContractEnvelopeForNonCanonicalCorrelationId() throws Exception {
        mockMvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON)
                        .content(body("zh-CN", "not-a-uuid"))
                        .with(jwt().authorities(new SimpleGrantedAuthority(USER))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("INVALID_CORRELATION_ID"));
    }

    private static String validBody(final String locale) {
        return body(locale, "6f1e6f1e-0000-4000-8000-000000000001");
    }

    /** 最小但结构合法的客户端投影：battle/reconstruction 必填段齐备，其余留空由 null 容忍兜底。 */
    private static String body(final String locale, final String correlationId) {
        return "{\"schemaVersion\":1,\"locale\":\"" + locale + "\",\"correlationId\":\"" + correlationId + "\","
                + "\"battle\":{\"players\":[]},"
                + "\"reconstruction\":{\"participants\":[],\"events\":[],"
                + "\"coverage\":{\"totalPackets\":0,\"decodedPackets\":0,\"partiallyDecodedPackets\":0,"
                + "\"unknownPackets\":0,\"failedPackets\":0,\"decodedPacketRatio\":0,\"packetTypes\":{}}}}";
    }
}
