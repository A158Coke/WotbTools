package com.wotb.ai.tournament;

import com.wotb.ai.AiServiceApplication;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(classes = AiServiceApplication.class, properties = {
        "spring.security.oauth2.resourceserver.jwt.issuer-uri=",
        "spring.security.oauth2.resourceserver.jwt.jwk-set-uri=http://127.0.0.1:9/jwks",
        "wotb.ai.api-key=",
        "wotb.ai.tournament-recognition.signing-key=" + TournamentGroupRecognizerTest.SIGNING_KEY
})
class TournamentGroupRecognitionHttpTest {
    private static final String ENDPOINT = "/api/ai/tournament-groups/recognize";

    @Autowired
    private WebApplicationContext context;
    @MockitoBean
    private AiChatGateway gateway;
    private MockMvc mvc;
    private byte[] image;

    @BeforeEach
    void setUp() throws Exception {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        image = TournamentGroupRecognizerTest.image("png", 32, 32);
        when(gateway.isConfigured()).thenReturn(true);
        when(gateway.chat(any())).thenReturn(TournamentGroupRecognizerTest.response());
    }

    @Test
    void anonymousAndOrdinaryUserHaveCanonicalErrorsAndNeverReachProvider() throws Exception {
        mvc.perform(multipart(ENDPOINT).file(TournamentGroupRecognizerTest.file(image)).param("permit", "ignored"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode").value("AUTH_UNAUTHENTICATED"))
                .andExpect(jsonPath("$.status").value(401));
        mvc.perform(multipart(ENDPOINT).file(TournamentGroupRecognizerTest.file(image)).param("permit", "ignored")
                        .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode").value("AUTH_FORBIDDEN"));
        verify(gateway, never()).chat(any());
    }

    @Test
    void realAdminAndMatchingPermitReturnReviewableRecognition() throws Exception {
        mvc.perform(multipart(ENDPOINT).file(TournamentGroupRecognizerTest.file(image))
                        .param("permit", TournamentGroupRecognizerTest.permit(image, claims -> { }))
                        .with(jwt().jwt(token -> token.subject(TournamentGroupRecognizerTest.ADMIN_ID))
                                .authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.groupNumber").value(1))
                .andExpect(jsonPath("$.teams[3].rank").value(4))
                .andExpect(jsonPath("$.complete").value(true))
                .andExpect(jsonPath("$.imageHash").value(TournamentGroupRecognizer.imageHash(image)));
    }

    @Test
    void administratorCannotBypassBusinessPermissionWithAnotherImage() throws Exception {
        mvc.perform(multipart(ENDPOINT).file(TournamentGroupRecognizerTest.file(image))
                        .param("permit", TournamentGroupRecognizerTest.permit(image,
                                claims -> claims.claim("image_hash", "0".repeat(64))))
                        .with(jwt().jwt(token -> token.subject(TournamentGroupRecognizerTest.ADMIN_ID))
                                .authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.errorCode").value("INVALID_RECOGNITION_PERMIT"));
        verify(gateway, never()).chat(any());
    }

    @Test
    void missingMultipartFieldIsCanonicalBadRequest() throws Exception {
        mvc.perform(multipart(ENDPOINT).file(TournamentGroupRecognizerTest.file(image))
                        .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("INVALID_RECOGNITION_REQUEST"));
        verify(gateway, never()).chat(any());
    }

    @Test
    void wrongContentTypeBeforeControllerSelectionIsCanonical() throws Exception {
        mvc.perform(post(ENDPOINT).contentType("application/json").content("{}")
                        .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.errorCode").value("INVALID_RECOGNITION_REQUEST"));
        verify(gateway, never()).chat(any());
    }

    @Test
    void oversizedFileHasCanonicalErrorBeforeProvider() throws Exception {
        mvc.perform(multipart(ENDPOINT).file(TournamentGroupRecognizerTest.file(
                                new byte[TournamentGroupRecognizer.MAX_IMAGE_BYTES + 1]))
                        .param("permit", "not-needed")
                        .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-admin"))))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.errorCode").value("TOURNAMENT_IMAGE_TOO_LARGE"));
        verify(gateway, never()).chat(any());
    }
}
