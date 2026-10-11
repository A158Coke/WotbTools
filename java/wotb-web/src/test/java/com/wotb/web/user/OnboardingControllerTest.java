package com.wotb.web.user;

import com.wotb.web.config.ApiErrorTestConfig;
import com.wotb.web.config.SecurityConfig;
import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.user.controller.UserProfileController;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import com.wotb.web.user.service.UserProfileMapper;
import com.wotb.web.user.service.UserProfileService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Real MVC/Jackson/security boundary with the production user service and an isolated repository. */
class OnboardingControllerTest {
    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;
    private UserProfileRepository repository;

    @BeforeEach
    void setUp() {
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.register(TestConfig.class);
        context.refresh();
        repository = context.getBean(UserProfileRepository.class);
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId("kc-current");
        when(repository.findByKeycloakUserId("kc-current")).thenReturn(Optional.of(profile));
        when(repository.findByKeycloakUserIdForUpdate("kc-current")).thenReturn(Optional.of(profile));
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @AfterEach
    void tearDown() { context.close(); }

    @Test
    void initialAndTerminalReceiptHaveExactlyTheContractShapeAndOnlyUseTheJwtSubject() throws Exception {
        mvc.perform(get("/api/users/onboarding").with(jwt().jwt(token -> token.subject("kc-current"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(content().json("{\"coreEpoch\":0,\"disposition\":\"NONE\"}"));
        mvc.perform(put("/api/users/onboarding").with(jwt().jwt(token -> token.subject("kc-current")))
                        .contentType("application/json").content("{\"coreEpoch\":2,\"disposition\":\"COMPLETED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(content().json("{\"coreEpoch\":2,\"disposition\":\"COMPLETED\"}"));
        verify(repository).findByKeycloakUserIdForUpdate("kc-current");
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void bothMethodsRequireAuthenticationAndMissingProfileReturnsCanonical404() throws Exception {
        mvc.perform(get("/api/users/onboarding"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode").value("AUTH_UNAUTHENTICATED"));
        mvc.perform(put("/api/users/onboarding").contentType("application/json")
                        .content("{\"coreEpoch\":1,\"disposition\":\"SKIPPED\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode").value("AUTH_UNAUTHENTICATED"));
        mvc.perform(get("/api/users/onboarding").with(jwt().jwt(token -> token.subject("kc-missing"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.errorCode").value("PROFILE_NOT_FOUND"))
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.id").isNotEmpty());
        mvc.perform(put("/api/users/onboarding").with(jwt().jwt(token -> token.subject("kc-missing")))
                        .contentType("application/json").content("{\"coreEpoch\":1,\"disposition\":\"SKIPPED\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.errorCode").value("PROFILE_NOT_FOUND"));
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void invalidOrImpersonatingInputReturnsCanonical400WithoutWriting() throws Exception {
        for (final String body : List.of(
                "{}", "null", "[]", "{\"coreEpoch\":1}",
                "{\"coreEpoch\":null,\"disposition\":\"SKIPPED\"}",
                "{\"coreEpoch\":\"1\",\"disposition\":\"SKIPPED\"}",
                "{\"coreEpoch\":1.5,\"disposition\":\"SKIPPED\"}",
                "{\"coreEpoch\":2147483648,\"disposition\":\"SKIPPED\"}",
                "{\"coreEpoch\":0,\"disposition\":\"SKIPPED\"}",
                "{\"coreEpoch\":1,\"disposition\":null}",
                "{\"coreEpoch\":1,\"disposition\":\"NONE\"}",
                "{\"coreEpoch\":1,\"disposition\":\"completed\"}",
                "{\"coreEpoch\":1,\"disposition\":\"COMPLETED\",\"userId\":\"kc-other\"}")) {
            mvc.perform(put("/api/users/onboarding").with(jwt().jwt(token -> token.subject("kc-current")))
                            .contentType("application/json").content(body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.errorCode").value("INVALID_REQUEST"))
                    .andExpect(jsonPath("$.status").value(400))
                    .andExpect(jsonPath("$.details").isMap());
        }
        verify(repository, never()).save(any());
    }

    @Configuration
    @EnableWebMvc
    @Import({SecurityConfig.class, ApiErrorTestConfig.class, GlobalExceptionHandler.class,
            UserProfileController.class, UserProfileService.class, UserProfileMapper.class})
    static class TestConfig {
        @Bean
        UserProfileRepository userProfileRepository() { return mock(UserProfileRepository.class); }
        @Bean
        JwtDecoder jwtDecoder() { return mock(JwtDecoder.class); }
    }
}
