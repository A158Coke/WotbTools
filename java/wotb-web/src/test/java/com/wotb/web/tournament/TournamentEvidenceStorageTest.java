package com.wotb.web.tournament;
import com.wotb.web.tournament.service.TournamentEvidenceStorage;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
class TournamentEvidenceStorageTest {
    @TempDir Path temp;
    @Test void validationUsesBytesNotUploadedFilenameOrContentTypeAndStorageIsAtomicIsolated() throws Exception {
        final TournamentEvidenceStorage storage=new TournamentEvidenceStorage(temp.toString(),0);
        final TournamentEvidenceStorage.Image image=storage.validate(png(32,32)); assertEquals("image/png",image.contentType()); assertEquals(64,image.imageHash().length());
        storage.store(1,image); storage.store(1,image); storage.store(2,image); assertArrayEquals(image.bytes(),storage.load(1,image.imageHash()));
        storage.deleteEvent(1); assertFalse(Files.exists(temp.resolve("1"))); assertTrue(Files.exists(temp.resolve("2").resolve(image.imageHash()+".image")));
    }
    @Test void tinyCorruptAndOversizedImagesAreRejected() throws Exception {
        final TournamentEvidenceStorage storage=new TournamentEvidenceStorage(temp.toString(),0);
        assertThrows(ApiException.class,()->storage.validate(png(8,32)));
        assertThrows(ApiException.class,()->storage.validate(new MockMultipartFile("image","f.png","image/png",new byte[]{1,2,3})));
        assertThrows(ApiException.class,()->storage.validate(new MockMultipartFile("image","f.png","image/png",new byte[10*1024*1024+1])));
    }
    @Test void cleanupPreservesReferencedHashesAndYoungOrphans() throws Exception {
        final TournamentEvidenceStorage storage=new TournamentEvidenceStorage(temp.toString(),0);
        final TournamentEvidenceStorage.Image image=storage.validate(png(32,32)); storage.store(1,image);
        storage.cleanup(1,Set.of(),Instant.now().minusSeconds(86400)); assertTrue(Files.exists(temp.resolve("1").resolve(image.imageHash()+".image")));
        storage.cleanup(1,Set.of(image.imageHash()),Instant.now().plusSeconds(1)); assertTrue(Files.exists(temp.resolve("1").resolve(image.imageHash()+".image")));
        storage.cleanup(1,Set.of(),Instant.now().plusSeconds(1)); assertFalse(Files.exists(temp.resolve("1").resolve(image.imageHash()+".image")));
        assertThrows(ApiException.class,()->storage.load(1,"../escape"));
    }
    @Test void orphanEventDeletionRetriesOnlyOldDirectoriesWithinOwnRoot() throws Exception {
        final TournamentEvidenceStorage storage=new TournamentEvidenceStorage(temp.toString(),0);
        final TournamentEvidenceStorage.Image image=storage.validate(png(32,32)); storage.store(7,image);
        assertEquals(java.util.List.of(7L),storage.eventDirectories());
        storage.deleteOldOrphanEvent(7,Instant.now().minusSeconds(86400)); assertTrue(Files.exists(temp.resolve("7")));
        final java.nio.file.attribute.FileTime old=java.nio.file.attribute.FileTime.from(Instant.now().minusSeconds(90000));
        Files.setLastModifiedTime(temp.resolve("7").resolve(image.imageHash()+".image"),old); Files.setLastModifiedTime(temp.resolve("7"),old);
        storage.deleteOldOrphanEvent(7,Instant.now().minusSeconds(86400)); assertFalse(Files.exists(temp.resolve("7")));
    }
    private MockMultipartFile png(final int width, final int height) throws Exception {
        final ByteArrayOutputStream out=new ByteArrayOutputStream(); ImageIO.write(new BufferedImage(width,height,BufferedImage.TYPE_INT_RGB),"png",out);
        return new MockMultipartFile("image","misleading.exe","application/octet-stream",out.toByteArray());
    }
}
