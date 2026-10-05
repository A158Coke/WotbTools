package com.wotb.ai.tournament;

import com.wotb.ai.tournament.TournamentGroupRecognitionParser.Recognition;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class TournamentGroupRecognitionController {
    private final TournamentGroupRecognizer recognizer;

    public TournamentGroupRecognitionController(final TournamentGroupRecognizer recognizer) {
        this.recognizer = recognizer;
    }

    @PostMapping(value = "/api/ai/tournament-groups/recognize", consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public Recognition recognize(@RequestParam(name = "image") final MultipartFile image,
            @RequestParam(name = "permit") final String permit, @AuthenticationPrincipal final Jwt caller) {
        return recognizer.recognize(image, permit, caller == null ? null : caller.getSubject());
    }
}
