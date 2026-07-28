package com.wotb.web.replay.ai;

import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

@ExtendWith(MockitoExtension.class)
class AiReplayReviewServiceTest {

    @Mock
    private DefaultReplayProcessingFacade processingFacade;

    @Mock
    private AiReplayAnalysisService aiAnalysisService;

    private AiReplayReviewService service;

    @BeforeEach
    void setUp() {
        service = new AiReplayReviewService(processingFacade, aiAnalysisService);
    }

    @Test
    void nullBatchThrowsIllegalArgument() {
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(null));
        assertEquals("NO_REPLAY_FILES", ex.getMessage());
    }

    @Test
    void seventeenFilesThrowsReplayFileCountExceeded() {
        final var files = new MockMultipartFile[17];
        for (int i = 0; i < 17; i++) {
            files[i] = new MockMultipartFile(
                    "files", "file" + i + ".wotbreplay",
                    "application/octet-stream", new byte[]{1});
        }
        assertThrows(ReplayFileCountExceededException.class,
                () -> service.analyze(files));
    }

    @Test
    void invalidExtensionThrowsIllegalArgument() {
        final var files = new MockMultipartFile[]{
                new MockMultipartFile("files", "file.txt",
                        "application/octet-stream", new byte[]{1})
        };
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(files));
        assertEquals("INVALID_REPLAY_FILE_TYPE", ex.getMessage());
    }

    @Test
    void emptyFileThrowsIllegalArgument() {
        final var files = new MockMultipartFile[]{
                new MockMultipartFile("files", "empty.wotbreplay",
                        "application/octet-stream", new byte[0])
        };
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(files));
        assertEquals("NO_REPLAY_FILE", ex.getMessage());
    }

    @Test
    void fileTooLargeThrowsIllegalArgument() {
        final var files = new MockMultipartFile[]{
                new MockMultipartFile("files", "big.wotbreplay",
                        "application/octet-stream", new byte[21 * 1024 * 1024])
        };
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(files));
        assertEquals("FILE_TOO_LARGE", ex.getMessage());
    }

}
