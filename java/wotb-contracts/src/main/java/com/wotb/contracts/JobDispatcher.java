package com.wotb.contracts;

/** Port for publishing metadata-only job commands; broker implementations belong elsewhere. */
public interface JobDispatcher {
    void dispatch(JobRequestedEvent request);
}
