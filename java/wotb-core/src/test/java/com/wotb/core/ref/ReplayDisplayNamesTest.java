package com.wotb.core.ref;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

/** Display-name resolution oracles: structured facts come only from tankopedia fields,
 * and unresolvable values degrade to stable placeholders instead of invented names. */
class ReplayDisplayNamesTest {

    @Test
    void mapNamesResolveKnownCodesAndDegradeToAStablePlaceholder() {
        assertEquals("海岸礁湖", ReplayDisplayNames.mapName("lagoon"));
        assertEquals("海岸礁湖", ReplayDisplayNames.mapName("LAGOON"));
        assertEquals("未知地图", ReplayDisplayNames.mapName("not-a-real-map"));
        assertEquals("未知地图", ReplayDisplayNames.mapName(" "));
        assertEquals("未知地图", ReplayDisplayNames.mapName(null));
    }

    @Test
    void tankNamesPreferTankopediaThenFallBackToTheReplayProvidedName() {
        assertEquals("KV-2", ReplayDisplayNames.tankName(10497, null));
        // tankopedia 车辆名的权威专有名词契约：不解析名称文本、不由名称推断。
        assertEquals("Replay Label", ReplayDisplayNames.tankName(987654321L, "Replay Label"));
        assertEquals("未知坦克", ReplayDisplayNames.tankName(987654321L, null));
        assertEquals("未知坦克", ReplayDisplayNames.tankName(0, null));
        assertEquals("Replay Label", ReplayDisplayNames.tankName(0, "Replay Label"));
        assertEquals("未知坦克", ReplayDisplayNames.tankName(987654321L, "#987654321"));
        assertEquals("未知坦克", ReplayDisplayNames.tankName(987654321L, "12345"));
    }

    @Test
    void tankClassOnlyUsesTheStructuredTankopediaField() {
        assertEquals("Heavy tank", ReplayDisplayNames.tankClass(10497));
        assertEquals(ReplayDisplayNames.UNKNOWN_TANK_CLASS, ReplayDisplayNames.tankClass(987654321L));
        assertEquals(ReplayDisplayNames.UNKNOWN_TANK_CLASS, ReplayDisplayNames.tankClass(-1));
    }

    @Test
    void apiFacingVehicleFactsStayEmptyInsteadOfGuessing() {
        assertEquals("Heavy tank", ReplayDisplayNames.tankClassEn(10497));
        assertEquals("", ReplayDisplayNames.tankClassEn(987654321L));
        assertEquals("", ReplayDisplayNames.tankClassEn(0));
        assertEquals("6", ReplayDisplayNames.tankTier(10497));
        assertEquals("", ReplayDisplayNames.tankTier(987654321L));
        assertEquals("", ReplayDisplayNames.tankTier(0));
        assertEquals("USSR", ReplayDisplayNames.tankNation(10497));
        assertEquals("", ReplayDisplayNames.tankNation(987654321L));
        assertEquals("310", ReplayDisplayNames.tankAlphaDamage(5137));
        assertEquals("320", ReplayDisplayNames.tankAlphaDamage(10497));
        assertEquals("", ReplayDisplayNames.tankAlphaDamage(0));
        assertEquals("1850", ReplayDisplayNames.tankMaxHp(5137));
        assertEquals("", ReplayDisplayNames.tankMaxHp(987654321L));
        assertEquals("", ReplayDisplayNames.tankMaxHp(-5));
        assertEquals(1850, ReplayDisplayNames.tankMaxHpValue(5137));
        assertEquals(null, ReplayDisplayNames.tankMaxHpValue(987654321L));
        assertEquals(null, ReplayDisplayNames.tankMaxHpValue(0));
        assertEquals(1850, ReplayDisplayNames.tankBaseHpValue(5137));
        assertEquals("", ReplayDisplayNames.tankExtraInfo(10497));
        assertEquals("", ReplayDisplayNames.tankExtraInfo(0));
    }
}
