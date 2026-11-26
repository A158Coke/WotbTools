package com.wotb.web.hof.dto;

public record HofVehicleOptionDto(
        long tankId,
        String tankName,
        String nation,
        String type,
        Integer tier
) {
}
