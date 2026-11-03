package com.wotb.core.ref;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

/** API vehicle-code mapping oracles: Chinese and English class/nation values share one stable code space. */
class VehicleCodesTest {

    @Test
    void classValuesMapToTheStableEnglishCodeSpace() {
        assertEquals("HEAVY_TANK", VehicleCodes.classCode("重坦"));
        assertEquals("HEAVY_TANK", VehicleCodes.classCode("Heavy tank"));
        assertEquals("HEAVY_TANK", VehicleCodes.classCode("HEAVY_TANK"));
        assertEquals("MEDIUM_TANK", VehicleCodes.classCode("中坦"));
        assertEquals("LIGHT_TANK", VehicleCodes.classCode("轻坦"));
        assertEquals("TANK_DESTROYER", VehicleCodes.classCode("TD"));
        assertEquals("TANK_DESTROYER", VehicleCodes.classCode("Tank destroyer"));
        assertEquals("HEAVY_TANK", VehicleCodes.classCode("  Heavy tank  "));
    }

    @Test
    void unmappableClassValuesCollapseToOther() {
        assertEquals("OTHER", VehicleCodes.classCode(""));
        assertEquals("OTHER", VehicleCodes.classCode("   "));
        assertEquals("OTHER", VehicleCodes.classCode(null));
        assertEquals("OTHER", VehicleCodes.classCode("spaceship"));
    }

    @Test
    void nationValuesMapToTheStableEnglishCodeSpace() {
        assertEquals("CHINA", VehicleCodes.nationCode("中国"));
        assertEquals("CHINA", VehicleCodes.nationCode("China"));
        assertEquals("GERMANY", VehicleCodes.nationCode("德国"));
        assertEquals("USA", VehicleCodes.nationCode("美国"));
        assertEquals("USA", VehicleCodes.nationCode("USA"));
        assertEquals("USSR", VehicleCodes.nationCode("苏联"));
        assertEquals("UK", VehicleCodes.nationCode("英国"));
        assertEquals("EUROPE", VehicleCodes.nationCode("欧洲"));
        assertEquals("FRANCE", VehicleCodes.nationCode("法国"));
        assertEquals("JAPAN", VehicleCodes.nationCode("日本"));
    }

    @Test
    void unmappableNationValuesCollapseToOther() {
        assertEquals("OTHER", VehicleCodes.nationCode(""));
        assertEquals("OTHER", VehicleCodes.nationCode(null));
        assertEquals("OTHER", VehicleCodes.nationCode("atlantis"));
        assertEquals("OTHER", VehicleCodes.nationCode("Other"));
    }
}
