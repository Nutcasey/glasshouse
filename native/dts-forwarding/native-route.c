/* SPDX-License-Identifier: GPL-2.0-only */
/* Private O24 audio interfaces, pinned to the captured 33.31.68 image.
 * The initial build only audits these interfaces; it changes no audio state.
 * module layout is checked against the target's unmodified stock module. */
#include "target.h"

typedef unsigned long u64;
typedef unsigned int u32;
typedef unsigned char u8;
typedef int (*print_fn)(const char *, ...);
typedef void *(*block_fn)(const char *, unsigned int);
typedef int (*connection_fn)(void *, unsigned int, void *, unsigned int);
typedef int (*disconnect_fn)(void *, unsigned int);
typedef void (*format_fn)(unsigned int, unsigned int);
extern void *kthread_create_on_node(int (*function)(void *), void *data, int node, const char *name, ...);
extern int wake_up_process(void *task);
extern int kthread_stop(void *task);
extern _Bool kthread_should_stop(void);
extern void msleep(unsigned int milliseconds);
extern void mutex_lock(void *mutex);
extern void mutex_unlock(void *mutex);

#ifndef NATIVE_APPLY
#define NATIVE_APPLY 0
#endif
#ifndef NATIVE_SOURCE_INDEX
#define NATIVE_SOURCE_INDEX 0
#endif

#if NATIVE_APPLY
static void *source_block, *old_source_block, *output_block, *watchdog;
static u32 original_nonpcm, original_rate;
static int applied;
static u32 lease = 1;
static u32 restore_pcm;

/* Recovered from _bm_disconnect_block_locked and _bm_get_block_port on this
 * exact image: port connections +48, peer port +16, owner +32, port ID +40,
 * public block-info +88. The block-manager operation mutex protects the walk. */
static int output_edge(void **source, u32 *source_port) {
    void *node = ((void *(*)(void *))NATIVE_FIND_BLOCK)(output_block);
    u8 *port, *head, *entry, *peer, *owner;
    if (!node) return -1;
    port = ((u8 *(*)(void *, u32, u8))NATIVE_GET_PORT)(node, 0, 1);
    if (!port) return -1;
    head = port + 48;
    entry = *(u8 **)head;
    if (entry == head) return 0;
    if (!entry || *(u8 **)entry != head || *(u8 **)(head + 8) != entry) return -1;
    peer = *(u8 **)(entry + 16);
    if (!peer) return -1;
    owner = *(u8 **)(peer + 32);
    if (!owner) return -1;
    *source = *(void **)(owner + 88);
    *source_port = *(u32 *)(peer + 40);
    return 1;
}

static void restore_route(void) {
    block_fn block = (block_fn)NATIVE_BM_GET;
    void *current_source = (void *)0;
    u32 current_port = 0;
    int edge, restored = 0, restore_format = 0;
    if (!__atomic_exchange_n(&applied, 0, __ATOMIC_SEQ_CST)) return;
    mutex_lock((void *)NATIVE_BM_MUTEX);
    if (block("output", 3) == output_block) {
        edge = output_edge(&current_source, &current_port);
        /* A removed renderer leaves an empty input. A foreign connection
         * belongs to LG's new source and must survive module cleanup. */
        if (edge == 0 || (edge == 1 && current_source == source_block && current_port == 0x100)) {
            void *current_baseline = block(restore_pcm ? "mixer" : "encoder", restore_pcm ? 0 : 3);
            int disconnected = edge == 0 || ((disconnect_fn)NATIVE_DISCONNECT_LOCKED)(output_block, 0) >= 0;
            if (disconnected) {
                restore_format = 1;
                if (current_baseline)
                    restored = ((connection_fn)NATIVE_CONNECT_LOCKED)(current_baseline, 0, output_block, 0) >= 0;
            }
        }
    }
    mutex_unlock((void *)NATIVE_BM_MUTEX);
    if (restore_format) ((format_fn)NATIVE_HAL_FORMAT)(original_nonpcm, original_rate);
    ((print_fn)NATIVE_PRINTK)(restored ? "\0016gh_dts_native: original output route restored\n" :
        restore_format ? "\0013gh_dts_native: carrier disconnected and format restored; baseline source unavailable\n" :
        "\0016gh_dts_native: output ownership changed; preserving current route\n");
}

static int watch_route(void *unused) {
    unsigned int tick = 0, previous = lease;
    (void)unused;
    while (tick < 200 && !kthread_should_stop()) {
        void *current_source = (void *)0;
        u32 current_port = 0;
        int owned;
        msleep(100);
        tick++;
        if (__atomic_load_n(&lease, __ATOMIC_ACQUIRE) != previous) {
            previous = __atomic_load_n(&lease, __ATOMIC_ACQUIRE);
            tick = 0;
        }
        mutex_lock((void *)NATIVE_BM_MUTEX);
        owned = ((block_fn)NATIVE_BM_GET)("renderer", NATIVE_SOURCE_INDEX) == source_block &&
            ((block_fn)NATIVE_BM_GET)("output", 3) == output_block &&
            output_edge(&current_source, &current_port) == 1 && current_source == source_block && current_port == 0x100;
        mutex_unlock((void *)NATIVE_BM_MUTEX);
        if (!owned) break;
        if (*(volatile u32 *)NATIVE_HAL_NONPCM != 1 || *(volatile u32 *)NATIVE_HAL_RATE != 48000) break;
    }
    restore_route();
    /* Keep the task alive until module removal owns kthread_stop(). */
    while (!kthread_should_stop()) msleep(100);
    return 0;
}
#endif

static int fingerprints_match(void) {
    unsigned int check, byte;
    for (check = 0; check < sizeof(native_checks) / sizeof(native_checks[0]); check++) {
        const volatile u8 *actual = (const volatile u8 *)native_checks[check].address;
        for (byte = 0; byte < sizeof(native_checks[check].bytes); byte++)
            if (actual[byte] != native_checks[check].bytes[byte]) return 0;
    }
    return 1;
}

int init_module(void) {
    print_fn print = (print_fn)NATIVE_PRINTK;
    block_fn block = (block_fn)NATIVE_BM_GET;
    if (!fingerprints_match()) return -22;
    print("\0016gh_dts_native: matched 33.31.68 code fingerprints\n");
    print("\0016gh_dts_native: renderer0=%px renderer1=%px output3=%px encoder3=%px\n",
          block("renderer", 0), block("renderer", 1), block("output", 3), block("encoder", 3));
    print("\0016gh_dts_native: initial eARC nonpcm=%u rate=%u\n",
          *(volatile u32 *)NATIVE_HAL_NONPCM, *(volatile u32 *)NATIVE_HAL_RATE);
#if NATIVE_APPLY
    int connected;
    void *current_source = (void *)0;
    u32 current_port = 0;
    if (restore_pcm > 1) return -22;
    source_block = block("renderer", NATIVE_SOURCE_INDEX);
    old_source_block = block(restore_pcm ? "mixer" : "encoder", restore_pcm ? 0 : 3);
    output_block = block("output", 3);
    if (!source_block || !old_source_block || !output_block) return -19;
    print("\0016gh_dts_native: native PCM bypass head=%08x\n",
          ((u32 (*)(void *))NATIVE_PCM_HEAD)(source_block));
    mutex_lock((void *)NATIVE_BM_MUTEX);
    if (block("renderer", NATIVE_SOURCE_INDEX) != source_block || block("output", 3) != output_block ||
        block(restore_pcm ? "mixer" : "encoder", restore_pcm ? 0 : 3) != old_source_block ||
        output_edge(&current_source, &current_port) != 1 || current_source != old_source_block || current_port != 0) {
        mutex_unlock((void *)NATIVE_BM_MUTEX);
        return -16;
    }
    original_nonpcm = *(volatile u32 *)NATIVE_HAL_NONPCM;
    original_rate = *(volatile u32 *)NATIVE_HAL_RATE;
    if (original_nonpcm > 1 || (original_rate != 48000 && original_rate != 192000)) {
        mutex_unlock((void *)NATIVE_BM_MUTEX);
        return -22;
    }
    applied = 1;
    ((disconnect_fn)NATIVE_DISCONNECT_LOCKED)(output_block, 0);
    connected = ((connection_fn)NATIVE_CONNECT_LOCKED)(source_block, 0x100, output_block, 0);
    mutex_unlock((void *)NATIVE_BM_MUTEX);
    print("\0016gh_dts_native: native PCM carrier route result=%d\n", connected);
    if (connected < 0) { restore_route(); return connected; }
    ((format_fn)NATIVE_HAL_FORMAT)(1, 48000);
    watchdog = kthread_create_on_node(watch_route, (void *)0, -1, "gh-dts-guard");
    if ((u64)watchdog >= (u64)-4095) { watchdog = (void *)0; restore_route(); return -12; }
    wake_up_process(watchdog);
    print("\0016gh_dts_native: renderer%d PCM-bypass -> eARC; 20-second producer lease\n", NATIVE_SOURCE_INDEX);
#endif
    return 0;
}

void cleanup_module(void) {
#if NATIVE_APPLY
    if (watchdog) kthread_stop(watchdog);
    restore_route();
#endif
    ((print_fn)NATIVE_PRINTK)("\0016gh_dts_native: unloaded\n");
}

/* Linux's loader initialises the remaining fields. These offsets and the
 * complete 0x380-byte layout are audited against aspectratiodrv.ko, rather
 * than borrowing headers from a different configured vendor kernel. */
struct target_module {
    u8 prefix[24];
    char name[56];
    u8 before_init[0x150 - 80];
    int (*initialise)(void);
    u8 before_exit[0x338 - 0x158];
    void (*finish)(void);
    u8 suffix[0x380 - 0x340];
};
_Static_assert(sizeof(struct target_module) == 0x380, "module size");
_Static_assert(__builtin_offsetof(struct target_module, initialise) == 0x150, "module init");
_Static_assert(__builtin_offsetof(struct target_module, finish) == 0x338, "module exit");
struct target_module __this_module __attribute__((section(".gnu.linkonce.this_module"), aligned(64), used)) = {
    .name = "gh_dts_native", .initialise = init_module, .finish = cleanup_module
};
#if NATIVE_APPLY
/* Linux 5.4 moduleparam.h: three pointers, u16/s8/u8, then pointer union. */
extern int param_set_uint(const char *value, const void *parameter);
extern int param_get_uint(char *value, const void *parameter);
static const struct {
    unsigned int flags;
    int (*set)(const char *, const void *);
    int (*get)(char *, const void *);
    void (*free)(void *);
} uint_operations = {0, param_set_uint, param_get_uint, (void *)0};
struct target_parameter {
    const char *name;
    struct target_module *module;
    const void *operations;
    unsigned short permissions;
    signed char level;
    unsigned char flags;
    void *argument;
};
_Static_assert(sizeof(struct target_parameter) == 40, "parameter size");
static const struct target_parameter parameters[] __attribute__((section("__param"), aligned(8), used)) = {
    {"lease", &__this_module, &uint_operations, 0600, -1, 0, &lease},
    {"active", &__this_module, &uint_operations, 0400, -1, 0, &applied},
    {"restore_pcm", &__this_module, &uint_operations, 0400, -1, 0, &restore_pcm}
};
#endif
static const char module_license[] __attribute__((section(".modinfo"), used)) = "license=GPL";
static const char module_vermagic[] __attribute__((section(".modinfo"), used)) = NATIVE_VERMAGIC;
static const char module_description[] __attribute__((section(".modinfo"), used)) = "description=Glasshouse native DTS exact-target audio interface audit";
__asm__(".pushsection .plt,\"ax\",%progbits\n.byte 0\n.popsection\n"
        ".pushsection .init.plt,\"a\",%progbits\n.byte 0\n.popsection\n"
        ".pushsection .text.ftrace_trampoline,\"ax\",%progbits\n.byte 0\n.popsection\n");
