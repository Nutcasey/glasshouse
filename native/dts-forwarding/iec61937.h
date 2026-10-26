/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef GH_DTS_IEC61937_H
#define GH_DTS_IEC61937_H
#include <stddef.h>
#include <string.h>

struct dts_core_frame { unsigned int bytes, samples; int little; };

static int dts_core_header(const unsigned char *data, size_t length, struct dts_core_frame *frame) {
    unsigned char header[10];
    unsigned int index, blocks;
    if (length < 10) return 0;
    frame->little = !memcmp(data, "\xfe\x7f\x01\x80", 4);
    if (!frame->little && memcmp(data, "\x7f\xfe\x80\x01", 4)) return -1;
    for (index = 0; index < 10; index++) header[index] = data[frame->little ? index ^ 1 : index];
    blocks = ((header[4] & 1u) << 6) | (header[5] >> 2);
    frame->samples = (blocks + 1) * 32;
    frame->bytes = (((header[5] & 3u) << 12) | (header[6] << 4) | (header[7] >> 4)) + 1;
    if (((header[8] >> 2) & 15u) != 13 ||
        (frame->samples != 512 && frame->samples != 1024 && frame->samples != 2048) ||
        frame->bytes < 10 || ((frame->bytes + 1) & ~1u) > frame->samples * 4 - 8) return -1;
    return 1;
}

/* Odd core sizes (2013 bytes is common on Blu-ray) are swapped as a final
 * word whose missing byte is zero, and Pd counts that padded word, as
 * ffmpeg's spdif muxer does. */
static void dts_core_burst(const unsigned char *data, const struct dts_core_frame *frame, unsigned char *burst) {
    unsigned int index, source, padded = (frame->bytes + 1) & ~1u;
    unsigned int type = frame->samples == 512 ? 11 : frame->samples == 1024 ? 12 : 13;
    memset(burst, 0, frame->samples * 4);
    burst[0] = 0x72; burst[1] = 0xf8; burst[2] = 0x1f; burst[3] = 0x4e;
    burst[4] = type; burst[6] = (padded * 8) & 255; burst[7] = (padded * 8) >> 8;
    for (index = 0; index < padded; index++) {
        source = frame->little ? index : index ^ 1;
        burst[8 + index] = source < frame->bytes ? data[source] : 0;
    }
}
#endif
