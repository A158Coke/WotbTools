package com.wotb.web.user.dto;

/** Dedicated user transport; a zero epoch with NONE is the initial receipt. */
public record OnboardingReceiptDto(int coreEpoch, String disposition) { }
