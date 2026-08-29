package com.wotb.core;

import com.wotb.core.replay.event.AmmunitionSelectionChangedEvent;
import com.wotb.core.replay.event.AmmunitionStateEvent;
import com.wotb.core.replay.event.MaterializationAnnouncedEvent;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.ProjectileLaunchedEvent;
import com.wotb.core.replay.event.ProjectileTerminalEvent;
import com.wotb.core.replay.event.RecorderHealthChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ShotResultEvent;
import com.wotb.core.replay.event.TargetingInfoSnapshotEvent;
import com.wotb.core.replay.event.VehicleFiredEvent;
import com.wotb.core.replay.event.VehicleHealthStateEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

/**
 * Slice B/C 真实 fixture 探针（手动维护，不进常规 CI）：
 * {@code mvn -pl wotb-core test -Dtest=SliceCRealFixtureProbeTest -Dprobe.dir=<dir>}。
 * 验证 Type5/33/28 与 method0/1/5/17/20/29/36/38 解码器在真实回放上的产出。
 */
class SliceCRealFixtureProbeTest {

    @Test
    void probe() throws Exception {
        final String dir = System.getProperty("probe.dir");
        final String single = System.getProperty("probe.replay");
        Assumptions.assumeTrue(dir != null || single != null,
                "set -Dprobe.dir=<dir> or -Dprobe.replay=<file> to run");
        final List<Path> files;
        if (single != null) {
            files = List.of(Path.of(single));
        } else {
            try (Stream<Path> s = Files.walk(Path.of(dir))) {
                files = s.filter(p -> p.toString().toLowerCase().endsWith(".wotbreplay"))
                        .sorted().toList();
            }
        }
        final ReplayReconstructionService service = new ReplayReconstructionService();
        for (final Path f : files) {
            System.out.println("\n#### " + f.getFileName() + " ####");
            try {
                final ReplayReconstruction recon = service.reconstruct(Files.readAllBytes(f));
                int type5 = 0;
                int type33 = 0;
                int type28 = 0;
                int m0 = 0;
                int m1 = 0;
                int m5 = 0;
                int m17 = 0;
                int m20 = 0;
                int m29 = 0;
                int m36 = 0;
                int m38 = 0;
                for (final ReplayEvent e : recon.events()) {
                    if (e instanceof MaterializationEvent) type5++;
                    else if (e instanceof MaterializationAnnouncedEvent) type33++;
                    else if (e instanceof AmmunitionSelectionChangedEvent) type28++;
                    else if (e instanceof VehicleFiredEvent) m0++;
                    else if (e instanceof VehicleHealthStateEvent) m1++;
                    else if (e instanceof RecorderHealthChangedEvent) m5++;
                    else if (e instanceof AmmunitionStateEvent) m17++;
                    else if (e instanceof ProjectileTerminalEvent) m20++;
                    else if (e instanceof ProjectileLaunchedEvent) m29++;
                    else if (e instanceof TargetingInfoSnapshotEvent) m36++;
                    else if (e instanceof ShotResultEvent) m38++;
                }
                System.out.println("version=" + recon.metadata().clientVersion()
                        + " events=" + recon.events().size()
                        + " Type5=" + type5 + " Type33=" + type33 + " Type28=" + type28
                        + " m0=" + m0 + " m1=" + m1 + " m5=" + m5
                        + " m17=" + m17 + " m20=" + m20 + " m29=" + m29
                        + " m36=" + m36 + " m38=" + m38);
            } catch (Exception e) {
                System.out.println("  PROBE ERROR: " + e.getMessage());
            }
        }
    }
}
