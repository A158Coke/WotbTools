package com.wotb.web;

import com.wotb.web.hof.entity.HallOfFameRecord;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.JsonNode;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class HallOfFameReplayApiIntegrationTest extends WebApiIntegrationTestSupport {
    @Test
    void removedReplayProcessingEndpointsAreDenied() throws Exception {
        mvc().perform(get("/api/columns"))
                .andExpect(status().isUnauthorized());
        mvc().perform(multipart("/api/replay/processing-jobs").file(file(standardRandomFixture())))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void hofUploadPersistsReplayAndAllowsByteIdenticalDownload() throws Exception {
        final Path replay = standardRandomFixture();
        clearHofRecordsOf(replay);
        final String json = hofUpload(replay);
        final JsonNode n = om.readTree(json);
        assertEquals("ok", n.get("status").asText());

        final HallOfFameRecord record = hallOfFameRecordRepository.findAll().stream()
                .filter(r -> r.getReplayHash() != null)
                .findFirst()
                .orElseThrow();
        assertTrue(record.getReplayHash().matches("[0-9a-f]{64}"));
        assertTrue(Files.exists(REPLAY_DIR.resolve(record.getReplayHash() + ".wotbreplay")),
                "content-addressed file must exist on disk");

        final byte[] original = Files.readAllBytes(replay);
        final var res = mvc().perform(get("/api/hof/" + record.getId() + "/replay")
                        .with(jwt()))
                .andExpect(status().isOk())
                .andReturn().getResponse();
        assertTrue(java.util.Arrays.equals(original, res.getContentAsByteArray()),
                "download must be byte-for-byte identical to upload");
        assertTrue(res.getHeader("Content-Disposition").startsWith("attachment"));
    }

    @Test
    void hofUploadIdempotentForSameFile() throws Exception {
        final Path replay = standardRandomFixture();
        clearHofRecordsOf(replay);
        assertEquals("ok", om.readTree(hofUpload(replay)).get("status").asText());
        final long filesAfterFirst = Files.list(REPLAY_DIR)
                .filter(p -> p.getFileName().toString().endsWith(".wotbreplay")).count();

        final String json2 = hofUpload(replay);
        assertEquals("already_recorded", om.readTree(json2).get("status").asText());
        final long filesAfterSecond = Files.list(REPLAY_DIR)
                .filter(p -> p.getFileName().toString().endsWith(".wotbreplay")).count();
        assertEquals(filesAfterFirst, filesAfterSecond, "同文件二次上传不得新增磁盘文件");
    }

    @Test
    void hofUploadRequiresLogin() throws Exception {
        mvc().perform(multipart("/api/hof/upload")
                        .file(hofFile(replays().getFirst())))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void hofDownloadRequiresLogin() throws Exception {
        mvc().perform(get("/api/hof/1/replay"))
                .andExpect(status().isUnauthorized());
    }
    @Test
    void hofUploadRejectsTrainingRoomReplay() throws Exception {
        final Path training = trainingRoomFixture();

        final long rowsBefore = hallOfFameRecordRepository.count();
        final long filesBefore = Files.isDirectory(REPLAY_DIR)
                ? Files.list(REPLAY_DIR).filter(p -> p.getFileName().toString().endsWith(".wotbreplay")).count()
                : 0L;

        final String json = mvc().perform(multipart("/api/hof/upload")
                        .file(hofFile(training))
                        .param("facts", facts(training))
                        .with(jwt()))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();
        final JsonNode n = om.readTree(json);
        assertEquals("UNSUPPORTED_BATTLE_TYPE", n.get("errorCode").asText(), "errorCode 必须为 UNSUPPORTED_BATTLE_TYPE");

        assertEquals(rowsBefore, hallOfFameRecordRepository.count(), "训练房不得新增 hall_of_fame 记录");
        final long filesAfter = Files.isDirectory(REPLAY_DIR)
                ? Files.list(REPLAY_DIR).filter(p -> p.getFileName().toString().endsWith(".wotbreplay")).count()
                : 0L;
        assertEquals(filesBefore, filesAfter, "训练房不得在 replay storage 产生文件");
    }

    @Test
    void hofUploadRejectsInvalidFactsWithoutPersistence() throws Exception {
        final Path replay = standardRandomFixture();
        final long rowsBefore = hallOfFameRecordRepository.count();
        for (final String bad : List.of("{", "{}", "[1,2,3]")) {
            final String json = mvc().perform(multipart("/api/hof/upload")
                            .file(hofFile(replay))
                            .param("facts", bad)
                            .with(jwt()))
                    .andExpect(status().isBadRequest())
                    .andReturn().getResponse().getContentAsString();
            assertEquals("INVALID_REPLAY_FACTS", om.readTree(json).get("errorCode").asText(), bad);
        }
        assertEquals(rowsBefore, hallOfFameRecordRepository.count(), "非法 facts 不得新增 hall_of_fame 记录");
    }

    @Test
    void hofUploadRequiresFacts() throws Exception {
        final String json = mvc().perform(multipart("/api/hof/upload")
                        .file(hofFile(standardRandomFixture()))
                        .with(jwt()))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();
        assertEquals("MISSING_PARAM", om.readTree(json).get("errorCode").asText());
    }

    @Test
    void hofDownloadOldRecordWithoutFileReturns404() throws Exception {
        final HallOfFameRecord record = new HallOfFameRecord();
        record.setArenaId("no-replay-arena");
        record.setAccountId(4242L);
        record.setNickname("NoReplay");
        record.setTankId(6481L);
        record.setTankName("FV4005");
        record.setBattleType("RANDOM");
        record.setArenaBonusType(1);
        record.setDamageDealt(100);
        hallOfFameRecordRepository.saveAndFlush(record);
        try {
            mvc().perform(get("/api/hof/" + record.getId() + "/replay").with(jwt()))
                    .andExpect(status().isNotFound());
        } finally {
            hallOfFameRecordRepository.delete(record);
            hallOfFameRecordRepository.flush();
        }
    }
}
