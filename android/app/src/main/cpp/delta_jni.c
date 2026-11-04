#include <jni.h>
#include <stddef.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include "xdelta3.h"

#define BLOCK (1024U * 1024U)
#define MEMORY_LIMIT (96U * 1024U * 1024U)
#define PATCH_LIMIT (256U * 1024U * 1024U)
typedef union allocation { size_t bytes; max_align_t alignment; } allocation;
typedef struct { size_t used; } budget;
static void *bounded_alloc(void *opaque, size_t count, usize_t size) {
    budget *b = opaque;
    if (size > SIZE_MAX || (size && count > SIZE_MAX / (size_t)size)) return NULL;
    size_t bytes = count * (size_t)size;
    if (bytes > MEMORY_LIMIT - b->used || bytes > SIZE_MAX - sizeof(allocation)) return NULL;
    allocation *p = malloc(sizeof(*p) + bytes);
    if (!p) return NULL;
    p->bytes = bytes; b->used += bytes;
    return p + 1;
}
static void bounded_free(void *opaque, void *address) {
    if (!address) return;
    allocation *p = (allocation *)address - 1;
    ((budget *)opaque)->used -= p->bytes;
    free(p);
}
static int64_t monotonic_seconds(void) {
    struct timespec value;
    return clock_gettime(CLOCK_MONOTONIC, &value) ? -1 : value.tv_sec;
}
static ssize_t read_retry(int fd, void *buffer, size_t bytes) {
    ssize_t n;
    do { n = read(fd, buffer, bytes); } while (n < 0 && errno == EINTR);
    return n;
}
static int write_all(int fd, const uint8_t *buffer, size_t bytes) {
    while (bytes) {
        ssize_t n = write(fd, buffer, bytes);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return -1;
        buffer += n; bytes -= (size_t)n;
    }
    return 0;
}
static int alias(const struct stat *a, const struct stat *b) {
    return a->st_dev == b->st_dev && a->st_ino == b->st_ino;
}
/* No command line, shell, JNI callbacks, global mutable state, or complete-file buffers. */
JNIEXPORT jstring JNICALL Java_com_wotbtools_app_DeltaApplier_nativeApply(
    JNIEnv *env, jobject self, jstring jb, jstring jp, jstring jo, jlong limit) {
    (void)self;
    const char *base = NULL, *patch = NULL, *output = NULL;
    const char *error = "Invalid input";
    int bf = -1, pf = -1, of = -1, created = 0;
    uint8_t *input = NULL, *block = NULL;
    xd3_stream stream; xd3_source source; xd3_config config; budget memory = {0};
    struct stat bs, ps;
    memset(&stream, 0, sizeof(stream)); memset(&source, 0, sizeof(source));
    int64_t start = monotonic_seconds();
    if (!jb || !jp || !jo || limit <= 0 || limit > INT32_MAX || start < 0) goto done;
    base = (*env)->GetStringUTFChars(env, jb, NULL); if (!base) goto done;
    patch = (*env)->GetStringUTFChars(env, jp, NULL); if (!patch) goto done;
    output = (*env)->GetStringUTFChars(env, jo, NULL); if (!output) goto done;
    bf = open(base, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    pf = open(patch, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (bf < 0 || pf < 0 || fstat(bf, &bs) || fstat(pf, &ps) ||
        !S_ISREG(bs.st_mode) || !S_ISREG(ps.st_mode) || alias(&bs, &ps) ||
        bs.st_size <= 0 || bs.st_size > INT32_MAX || ps.st_size < 5 || ps.st_size > PATCH_LIMIT) goto done;
    /* Only the stage-produced VCDIFF dialect: version zero, no secondary codec,
       custom code table, or application header. Fail before opening output. */
    uint8_t header[5];
    if (read_retry(pf, header, sizeof(header)) != sizeof(header) ||
        memcmp(header, "\xd6\xc3\xc4\x00\x00", sizeof(header)) || lseek(pf, 0, SEEK_SET) < 0) goto done;
    of = open(output, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (of < 0) { error = "Output must be new"; goto done; }
    created = 1;
    input = malloc(BLOCK); block = malloc(BLOCK);
    if (!input || !block) { error = "Memory limit"; goto done; }
    xd3_init_config(&config, 0);
    config.winsize = BLOCK; config.alloc = bounded_alloc; config.freef = bounded_free; config.opaque = &memory;
    if (xd3_config_stream(&stream, &config)) { error = "Decoder configuration"; goto done; }
    source.blksize = BLOCK; source.curblk = block; source.curblkno = 0;
    ssize_t first = read_retry(bf, block, BLOCK);
    if (first < 0) { error = "Source read"; goto done; }
    source.onblk = (usize_t)first;
    if (xd3_set_source_and_size(&stream, &source, (xoff_t)bs.st_size)) goto done;
    uint64_t written = 0, consumed = 0;
    for (;;) {
        ssize_t n = read_retry(pf, input, BLOCK);
        if (n < 0) { error = "Patch read"; goto done; }
        consumed += (uint64_t)n;
        if (consumed > (uint64_t)ps.st_size) { error = "Patch changed"; goto done; }
        if (!n) xd3_set_flags(&stream, stream.flags | XD3_FLUSH);
        xd3_avail_input(&stream, input, (usize_t)n);
        for (;;) {
            int64_t now = monotonic_seconds();
            if (now < 0 || now - start > 120) { error = "Decode time limit"; goto done; }
            int rc = xd3_decode_input(&stream);
            if (rc == XD3_INPUT) break;
            if (rc == XD3_OUTPUT) {
                if (stream.avail_out > (uint64_t)limit - written) { error = "Output limit"; goto done; }
                if (write_all(of, stream.next_out, (size_t)stream.avail_out)) { error = "Output write"; goto done; }
                written += stream.avail_out; xd3_consume_output(&stream); continue;
            }
            if (rc == XD3_GETSRCBLK) {
                if (source.getblkno > (uint64_t)bs.st_size / BLOCK) { error = "Source bounds"; goto done; }
                off_t position = (off_t)(source.getblkno * BLOCK);
                if (lseek(bf, position, SEEK_SET) < 0) { error = "Source seek"; goto done; }
                ssize_t count = read_retry(bf, block, BLOCK);
                if (count < 0) { error = "Source read"; goto done; }
                source.onblk = (usize_t)count; source.curblkno = source.getblkno; continue;
            }
            if (rc == XD3_GOTHEADER || rc == XD3_WINSTART || rc == XD3_WINFINISH) continue;
            error = "Invalid or unsupported patch"; goto done;
        }
        if (!n) break;
    }
    if (!written || consumed != (uint64_t)ps.st_size || xd3_close_stream(&stream)) { error = "Incomplete patch"; goto done; }
    if (fsync(of)) { error = "Output sync"; goto done; }
    error = NULL;
done:
    xd3_free_stream(&stream); free(input); free(block);
    if (bf >= 0) close(bf);
    if (pf >= 0) close(pf);
    if (of >= 0 && close(of) && !error) error = "Output close";
    if (created && error) unlink(output);
    if (base) (*env)->ReleaseStringUTFChars(env, jb, base);
    if (patch) (*env)->ReleaseStringUTFChars(env, jp, patch);
    if (output) (*env)->ReleaseStringUTFChars(env, jo, output);
    if ((*env)->ExceptionCheck(env)) return NULL;
    return error ? (*env)->NewStringUTF(env, error) : NULL;
}
