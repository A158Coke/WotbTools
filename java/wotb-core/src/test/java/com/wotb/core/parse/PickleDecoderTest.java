package com.wotb.core.parse;

import com.wotb.core.parse.EventStreamReader.ArenaInfo;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PickleDecoderTest {

    /** Real basePlayerCreate payload from the CHRD neptune replay (9034890693886323). */
    private static final String TYPE0_HEX =
            "7432c9000100150200000f434852442d41313538e5b883e4b88173c1646a2f1920002a000100ffef010080027d710128550b626174746c"
            + "654c6576656c4b0a5510626174746c6543617465676f727949644b00550577656249448a08612003af81b3837d550c6d6f757365456e"
            + "61626c65644b0055097465616d49636f6e737d7102284b014e4b024e75550e636f6e647357696e4966447261775d7103284b014b024b"
            + "03655508636c616e546167737d7104284b01550542534b2d544b02550443485244755511616c6c7944616d616765456e61626c656489"
            + "55066d6d547970654b03550e63616d6f75666c616765536c6f744b0155126163636f756e7444617461626173654964735d7105284933"
            + "3130313336353535320a49333131353035353830310a49333130313639323731340a49333131363331393930330a4933313038303934"
            + "3239360a49333131323736373836380a49333130333834353738370a49333131313630353332310a49333130353531393630350a4933"
            + "3132353231363432300a49333131303838373437370a49333131313938343638380a49333130383535363235340a4933313039313731"
            + "3132340a65550477696e737d7106284b014b014b024b0075550c776562456d697474657249444b465511737769746368426174746c65"
            + "5465616d7388550a7465616d5469746c65737d7107284b01550d466f72657665722042534b2d544b0255046368726475752e00050000"
            + "0004";

    @Test
    void decodesRealArenaInfoPickle() {
        final EventStreamReader.ParsedPacket pkt =
                new EventStreamReader.ParsedPacket(0, 0.2f, hexToBytes(TYPE0_HEX));
        final ArenaInfo info = EventStreamReader.extractArenaInfo(List.of(pkt));

        assertEquals(14, info.accountDatabaseIds().size());
        assertTrue(info.accountDatabaseIds().contains(3125216420L));
        assertTrue(info.accountDatabaseIds().contains(3101365552L));
        assertEquals("BSK-T", info.clanTags().get(1));
        assertEquals("CHRD", info.clanTags().get(2));
        assertEquals("Forever BSK-T", info.teamTitles().get(1));
        assertEquals("chrd", info.teamTitles().get(2));
        assertEquals(1, info.wins().get(1));
        assertEquals(0, info.wins().get(2));
        assertEquals(10, info.battleLevel());
        assertEquals(3, info.mmType());
        assertEquals(9044269846258458721L, info.webId());
    }

    @Test
    void returnsNullWithoutBasePlayerCreate() {
        final EventStreamReader.ParsedPacket pkt =
                new EventStreamReader.ParsedPacket(10, 1.0f, new byte[49]);
        assertNull(EventStreamReader.extractArenaInfo(List.of(pkt)));
    }

    private static byte[] hexToBytes(final String hex) {
        final byte[] out = new byte[hex.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

}
