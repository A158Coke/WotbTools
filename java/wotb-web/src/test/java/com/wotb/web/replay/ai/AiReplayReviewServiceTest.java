package com.wotb.web.replay.ai;

import java.io.IOException;

import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

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

    @Test
    void emptyArrayThrowsNoReplayFiles() {
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(new MockMultipartFile[0]));
        assertEquals("NO_REPLAY_FILES", ex.getMessage());
    }

    @Test
    void nullElementThrowsNoReplayFile() {
        final var files = new MockMultipartFile[]{
                new MockMultipartFile("files", "valid.wotbreplay",
                        "application/octet-stream", new byte[]{1}),
                null
        };
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(files));
        assertEquals("NO_REPLAY_FILE", ex.getMessage());
    }

    @Test
    void totalSizeOverflowSafe() {
        final var files = new MockMultipartFile[11];
        for (int i = 0; i < 11; i++) {
            files[i] = new MockMultipartFile(
                    "files", "file" + i + ".wotbreplay",
                    "application/octet-stream", new byte[20 * 1024 * 1024]);
        }
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(files));
        assertEquals("TOTAL_REQUEST_TOO_LARGE", ex.getMessage());
    }

    @Test
    void mixedNullElements() {
        final var files = new MockMultipartFile[]{
                new MockMultipartFile("files", "first.wotbreplay",
                        "application/octet-stream", new byte[]{1}),
                null,
                new MockMultipartFile("files", "third.wotbreplay",
                        "application/octet-stream", new byte[]{1})
        };
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(files));
        assertEquals("NO_REPLAY_FILE", ex.getMessage());
    }

    @Test
    void blankFilenameThrowsInvalidReplayFileType() throws IOException {
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("   ");
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(new MultipartFile[]{file}));
        assertEquals("INVALID_REPLAY_FILE_TYPE", ex.getMessage());
    }

    @Test
    void nullFilenameThrowsInvalidReplayFileType() throws IOException {
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn(null);
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(new MultipartFile[]{file}));
        assertEquals("INVALID_REPLAY_FILE_TYPE", ex.getMessage());
    }

    @Test
    void uppercaseExtensionIsAccepted() throws IOException {
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("TEST.WOTBREPLAY");
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(1L);
        when(file.getBytes()).thenReturn(new byte[]{1});
        when(processingFacade.process(any(), any()))
                .thenThrow(new IllegalStateException("VALIDATION_PASSED"));
        final var ex = assertThrows(IllegalStateException.class,
                () -> service.analyze(new MultipartFile[]{file}));
        assertEquals("VALIDATION_PASSED", ex.getMessage());
    }

    @Test
    void exactMaxFileSizeIsAccepted() throws IOException {
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("valid.wotbreplay");
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(20L * 1024 * 1024);
        when(file.getBytes()).thenReturn(new byte[]{1});
        when(processingFacade.process(any(), any()))
                .thenThrow(new IllegalStateException("VALIDATION_PASSED"));
        final var ex = assertThrows(IllegalStateException.class,
                () -> service.analyze(new MultipartFile[]{file}));
        assertEquals("VALIDATION_PASSED", ex.getMessage());
    }

    @Test
    void exceedsMaxFileSizeThrows() throws IOException {
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("big.wotbreplay");
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(20L * 1024 * 1024 + 1);
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(new MultipartFile[]{file}));
        assertEquals("FILE_TOO_LARGE", ex.getMessage());
    }

    @Test
    void exactMaxTotalSizeIsAccepted() throws IOException {
        final var files = new MultipartFile[10];
        for (int i = 0; i < 10; i++) {
            final var f = mock(MultipartFile.class);
            when(f.getOriginalFilename()).thenReturn("file" + i + ".wotbreplay");
            when(f.isEmpty()).thenReturn(false);
            when(f.getSize()).thenReturn(20L * 1024 * 1024);
            files[i] = f;
        }
        when(processingFacade.process(any(), any()))
                .thenThrow(new IllegalStateException("VALIDATION_PASSED"));
        final var ex = assertThrows(IllegalStateException.class,
                () -> service.analyze(files));
        assertEquals("VALIDATION_PASSED", ex.getMessage());
    }

    @Test
    void exceedsMaxTotalSizeThrows() throws IOException {
        final var files = new MultipartFile[11];
        for (int i = 0; i < 11; i++) {
            final var f = mock(MultipartFile.class);
            when(f.getOriginalFilename()).thenReturn("file" + i + ".wotbreplay");
            when(f.isEmpty()).thenReturn(false);
            when(f.getSize()).thenReturn(20L * 1024 * 1024);
            files[i] = f;
        }
        final var ex = assertThrows(IllegalArgumentException.class,
                () -> service.analyze(files));
        assertEquals("TOTAL_REQUEST_TOO_LARGE", ex.getMessage());
    }

    @Test
    void oneFileIsAccepted() throws IOException {
        final var file = mock(MultipartFile.class);
        when(file.getOriginalFilename()).thenReturn("single.wotbreplay");
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(1L);
        when(file.getBytes()).thenReturn(new byte[]{1});
        when(processingFacade.process(any(), any()))
                .thenThrow(new IllegalStateException("VALIDATION_PASSED"));
        final var ex = assertThrows(IllegalStateException.class,
                () -> service.analyze(new MultipartFile[]{file}));
        assertEquals("VALIDATION_PASSED", ex.getMessage());
    }

    @Test
    void sixteenFilesAreAccepted() throws IOException {
        final var files = new MultipartFile[16];
        for (int i = 0; i < 16; i++) {
            final var f = mock(MultipartFile.class);
            when(f.getOriginalFilename()).thenReturn("file" + i + ".wotbreplay");
            when(f.isEmpty()).thenReturn(false);
            when(f.getSize()).thenReturn(1L);
            files[i] = f;
        }
        when(processingFacade.process(any(), any()))
                .thenThrow(new IllegalStateException("VALIDATION_PASSED"));
        final var ex = assertThrows(IllegalStateException.class,
                () -> service.analyze(files));
        assertEquals("VALIDATION_PASSED", ex.getMessage());
    }

    @Test
    void batchSizeExceededDoesNotCallGetBytes() throws IOException {
        final var files = new MultipartFile[17];
        for (int i = 0; i < 17; i++) {
            files[i] = mock(MultipartFile.class);
        }
        assertThrows(ReplayFileCountExceededException.class,
                () -> service.analyze(files));
        for (final var f : files) {
            verify(f, never()).getBytes();
        }
    }

    @Test
    void batchSizeExceededDoesNotCallProcessingFacade() throws IOException {
        final var files = new MultipartFile[17];
        for (int i = 0; i < 17; i++) {
            files[i] = mock(MultipartFile.class);
        }
        assertThrows(ReplayFileCountExceededException.class,
                () -> service.analyze(files));
        verify(processingFacade, never()).process(any(), any());
    }

}
