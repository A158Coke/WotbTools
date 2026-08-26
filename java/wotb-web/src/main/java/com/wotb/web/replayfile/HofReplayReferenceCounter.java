package com.wotb.web.replayfile;

/**
 * 名人堂（hof）域的回放 hash 引用计数器。
 * 由 hof 域实现、供 hundred 域通过接口注入使用（跨域清理时避免 hof↔hundred 循环依赖）。
 */
public interface HofReplayReferenceCounter {

    long countHofReferences(String sha256);
}
