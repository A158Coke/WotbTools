package com.wotb.web.replayfile;

/**
 * 百场（hundred）域的回放 hash 引用计数器。
 * 由 hundred 域实现、供 hof 域通过接口注入使用（跨域清理时避免 hof↔hundred 循环依赖）。
 */
public interface HundredReplayReferenceCounter {

    long countHundredReferences(String sha256);
}
