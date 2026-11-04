cmake_minimum_required(VERSION 3.22.1)
project(wotb_delta C)
include(CheckTypeSize)
check_type_size("size_t" SIZEOF_SIZE_T LANGUAGE C)
check_type_size("unsigned int" SIZEOF_UNSIGNED_INT LANGUAGE C)
check_type_size("unsigned long" SIZEOF_UNSIGNED_LONG LANGUAGE C)
check_type_size("unsigned long long" SIZEOF_UNSIGNED_LONG_LONG LANGUAGE C)
add_library(wotb_delta SHARED delta_jni.c xdelta3/xdelta3.c)
target_include_directories(wotb_delta PRIVATE xdelta3)
target_compile_definitions(wotb_delta PRIVATE
    SIZEOF_SIZE_T=${SIZEOF_SIZE_T} SIZEOF_UNSIGNED_INT=${SIZEOF_UNSIGNED_INT}
    SIZEOF_UNSIGNED_LONG=${SIZEOF_UNSIGNED_LONG} SIZEOF_UNSIGNED_LONG_LONG=${SIZEOF_UNSIGNED_LONG_LONG}
    XD3_ENCODER=0 XD3_INCLUDE_MAIN=0 SECONDARY_DJW=0 SECONDARY_FGK=0 SECONDARY_LZMA=0
    XD3_HARDMAXWINSIZE=67108864 _FILE_OFFSET_BITS=64)
target_compile_options(wotb_delta PRIVATE -Wall -Wextra -fstack-protector-strong -fvisibility=hidden)
target_link_options(wotb_delta PRIVATE -Wl,-z,relro,-z,now -Wl,-z,max-page-size=16384)
