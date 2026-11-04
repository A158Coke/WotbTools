# xdelta3 3.2.2

上游：https://github.com/jmacd/xdelta/tree/v3.2.2
源码包：https://github.com/jmacd/xdelta/releases/download/v3.2.2/xdelta3-3.2.2.tar.gz
源码包 SHA-256：d839ae8c1f1bf5d0abfd66f152ec089a65a20d56c1f6d8d36cb7716a6c766d0e
许可证：Apache-2.0，完整文本见 LICENSE；源码保留上游版权声明。

目录内上游 C / header 原样保留。外层 CMake 仅编译 decoder，禁用命令行、encoder 和所有 secondary compression。
升级须重新核验来源、许可证、边界测试与真实 APK 重建。每个解码请求限制 96 MiB xdelta 分配、64 MiB 窗口、1 MiB source/input 缓冲、120 秒运行时间；目标上限由调用方传入且不超过 2 GiB-1。
