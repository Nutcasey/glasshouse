/* SPDX-License-Identifier: GPL-2.0-only */
/* A decoder-shaped element preserves compressed frames for LG's raw-only sink. */
#include <gst/audio/gstaudiodecoder.h>
#include <gst/base/gstadapter.h>
#include <fcntl.h>
#include <sys/file.h>
#include <unistd.h>
#include "iec61937.h"

#define BASE "/var/lib/lg-dts-native"
#define PARAMS "/sys/module/gh_dts_native/parameters/"

typedef struct {
    GstAudioDecoder parent;
    GstElement *sink;
    GThread *guard;
    gint stopping, failed;
    gint lock_fd;
    gboolean owns_route, previous_bypass;
    guint lease;
} GstGhDts;
typedef struct { GstAudioDecoderClass parent; } GstGhDtsClass;
G_DEFINE_TYPE(GstGhDts, gst_gh_dts, GST_TYPE_AUDIO_DECODER)

/* A refusal is reported on stderr (control.py's sys.exit), so it is kept for the GStreamer log. */
static gboolean control(GstGhDts *self, const gchar *action, gint index) {
    gchar value[12], *errors = NULL;
    gchar *arguments[] = {"/usr/bin/python3", BASE "/control.py", (gchar *)action, value, NULL};
    gint status = -1;
    GError *error = NULL;
    gboolean ok;
    g_snprintf(value, sizeof(value), "%d", index);
    ok = g_spawn_sync(NULL, arguments, NULL, G_SPAWN_STDOUT_TO_DEV_NULL, NULL, NULL, NULL, &errors, &status, &error) &&
        g_spawn_check_wait_status(status, &error);
    if (!ok)
        GST_WARNING_OBJECT(self, "control.py %s %d failed: %s; stderr: %s", action, index,
            error ? error->message : "unknown", errors && *errors ? g_strstrip(errors) : "(empty)");
    g_clear_error(&error);
    g_free(errors);
    return ok;
}

static gboolean heartbeat(GstGhDts *self) {
    gchar active[4] = {0}, value[24];
    gint fd, length;
    if (access(BASE "/enabled", R_OK)) return FALSE;
    fd = open(PARAMS "active", O_RDONLY | O_CLOEXEC);
    if (fd < 0) return FALSE;
    length = read(fd, active, sizeof(active) - 1);
    close(fd);
    if (length < 1 || active[0] != '1') return FALSE;
    fd = open(PARAMS "lease", O_WRONLY | O_CLOEXEC);
    if (fd < 0) return FALSE;
    length = g_snprintf(value, sizeof(value), "%u\n", ++self->lease);
    gboolean ok = write(fd, value, length) == length;
    close(fd);
    return ok;
}

static gpointer keep_route(gpointer data) {
    GstGhDts *self = data;
    while (!g_atomic_int_get(&self->stopping)) {
        if (!heartbeat(self)) {
            g_atomic_int_set(&self->failed, 1);
            control(self, "stop", 0);
            break;
        }
        g_usleep(500000);
    }
    return NULL;
}

static void release_route(GstGhDts *self) {
    g_atomic_int_set(&self->stopping, 1);
    if (self->guard) { g_thread_join(self->guard); self->guard = NULL; }
    gboolean restored = !self->owns_route || control(self, "stop", 0);
    /* Never reconnect the PCM mixer while a compressed route could remain. */
    if (self->sink) {
        if (restored) g_object_set(self->sink, "pcm-bypass", self->previous_bypass, NULL);
        gst_object_unref(self->sink);
        self->sink = NULL;
    }
    self->owns_route = FALSE;
    if (self->lock_fd >= 0) { close(self->lock_fd); self->lock_fd = -1; }
}

static GstElement *find_native_sink(GstGhDts *self) {
    GstObject *root = gst_object_ref(self), *parent;
    GstElement *found = NULL;
    while ((parent = gst_object_get_parent(root))) { gst_object_unref(root); root = parent; }
    if (GST_IS_BIN(root)) {
        GstIterator *iterator = gst_bin_iterate_recurse(GST_BIN(root));
        GValue item = G_VALUE_INIT;
        while (gst_iterator_next(iterator, &item) == GST_ITERATOR_OK) {
            GstElement *element = g_value_get_object(&item);
            GstElementFactory *factory = gst_element_get_factory(element);
            if (factory && !strcmp(gst_plugin_feature_get_name(GST_PLUGIN_FEATURE(factory)), "audiosink")) {
                if (found) { gst_object_unref(found); found = NULL; g_value_unset(&item); break; }
                found = gst_object_ref(element);
            }
            g_value_unset(&item);
        }
        gst_iterator_free(iterator);
    }
    gst_object_unref(root);
    return found;
}

static gboolean acquire_route(GstGhDts *self) {
    gint index = -1;
    gboolean bypass = FALSE;
    if (access(BASE "/enabled", R_OK)) return FALSE;
    self->lock_fd = open(BASE "/stream.lock", O_CREAT | O_RDWR | O_CLOEXEC, 0600);
    if (self->lock_fd < 0 || flock(self->lock_fd, LOCK_EX | LOCK_NB)) goto failed;
    self->sink = find_native_sink(self);
    if (!self->sink) goto failed;
    g_object_get(self->sink, "index", &index, "pcm-bypass", &self->previous_bypass, NULL);
    if (index != 0 && index != 1) goto failed;
    g_object_set(self->sink, "pcm-bypass", TRUE, NULL);
    g_object_get(self->sink, "pcm-bypass", &bypass, NULL);
    /* LG creates its renderer when the raw output caps reach audiosink. */
    if (!bypass || !gst_audio_decoder_negotiate(GST_AUDIO_DECODER(self)) || !control(self, "start", index)) goto failed;
    self->owns_route = TRUE;
    self->lease = 1;
    if (!heartbeat(self)) goto failed;
    g_atomic_int_set(&self->failed, 0);
    g_atomic_int_set(&self->stopping, 0);
    self->guard = g_thread_new("dts-earc-lease", keep_route, self);
    GST_INFO_OBJECT(self, "Native DTS core forwarding on renderer %d", index);
    return TRUE;
failed:
    release_route(self);
    return FALSE;
}

static gboolean set_format(GstAudioDecoder *decoder, GstCaps *caps) {
    GstAudioInfo info;
    (void)caps;
    gst_audio_info_init(&info);
    gst_audio_info_set_format(&info, GST_AUDIO_FORMAT_S16LE, 48000, 2, NULL);
    return gst_audio_decoder_set_output_format(decoder, &info);
}

static GstCaps *get_caps(GstAudioDecoder *decoder, GstCaps *filter) {
    /* Compressed channel counts do not match the stereo carrier channel count. */
    GstCaps *caps = gst_pad_get_pad_template_caps(GST_AUDIO_DECODER_SINK_PAD(decoder));
    if (filter) {
        GstCaps *intersection = gst_caps_intersect_full(filter, caps, GST_CAPS_INTERSECT_FIRST);
        gst_caps_unref(caps);
        return intersection;
    }
    return caps;
}

static GstFlowReturn parse_frame(GstAudioDecoder *decoder, GstAdapter *adapter, gint *offset, gint *length) {
    gsize available = gst_adapter_available(adapter), at;
    const guint8 *data;
    struct dts_core_frame frame;
    (void)decoder;
    if (available < 10) return GST_FLOW_EOS;
    data = gst_adapter_map(adapter, available);
    /* DTS-HD extensions are skipped: the initial profile forwards their core. */
    for (at = 0; at + 10 <= available; at++) {
        if (dts_core_header(data + at, available - at, &frame) == 1) {
            *offset = at;
            *length = frame.bytes;
            gst_adapter_unmap(adapter);
            return available - at >= frame.bytes ? GST_FLOW_OK : GST_FLOW_EOS;
        }
    }
    gst_adapter_unmap(adapter);
    *offset = available - 9;
    *length = 0;
    return GST_FLOW_EOS;
}

static GstFlowReturn handle_frame(GstAudioDecoder *decoder, GstBuffer *input) {
    GstGhDts *self = (GstGhDts *)decoder;
    GstMapInfo source, destination;
    struct dts_core_frame frame;
    GstBuffer *output;
    if (!input) return GST_FLOW_OK;
    if (!gst_buffer_map(input, &source, GST_MAP_READ)) return GST_FLOW_ERROR;
    if (dts_core_header(source.data, source.size, &frame) != 1 || source.size < frame.bytes) {
        gst_buffer_unmap(input, &source);
        return GST_FLOW_ERROR;
    }
    if ((!self->owns_route && !acquire_route(self)) || g_atomic_int_get(&self->failed)) {
        gst_buffer_unmap(input, &source);
        GST_ELEMENT_ERROR(self, RESOURCE, SETTINGS, ("Native DTS eARC route is unavailable"), (NULL));
        return GST_FLOW_ERROR;
    }
    output = gst_audio_decoder_allocate_output_buffer(decoder, frame.samples * 4);
    if (!output || !gst_buffer_map(output, &destination, GST_MAP_WRITE)) {
        if (output) gst_buffer_unref(output);
        gst_buffer_unmap(input, &source);
        return GST_FLOW_ERROR;
    }
    dts_core_burst(source.data, &frame, destination.data);
    gst_buffer_unmap(output, &destination);
    gst_buffer_unmap(input, &source);
    return gst_audio_decoder_finish_frame(decoder, output, 1);
}

/* No flush vfunc: GstAudioDecoder calls it on every seek and DISCONT buffer,
 * and apps seek at start and on resume. Releasing there would restore
 * pcm-bypass on LG's live renderer, which only applies it when the renderer is
 * created. The route is released only when the stream ends or the element stops. */
static gboolean stop(GstAudioDecoder *decoder) { release_route((GstGhDts *)decoder); return TRUE; }
static gboolean sink_event(GstAudioDecoder *decoder, GstEvent *event) {
    gboolean eos = GST_EVENT_TYPE(event) == GST_EVENT_EOS;
    gboolean result = GST_AUDIO_DECODER_CLASS(gst_gh_dts_parent_class)->sink_event(decoder, event);
    if (eos) release_route((GstGhDts *)decoder);
    return result;
}

static void gst_gh_dts_init(GstGhDts *self) {
    self->lock_fd = -1;
    gst_audio_decoder_set_needs_format(GST_AUDIO_DECODER(self), TRUE);
}

static void gst_gh_dts_class_init(GstGhDtsClass *class) {
    GstElementClass *element = GST_ELEMENT_CLASS(class);
    GstAudioDecoderClass *decoder = GST_AUDIO_DECODER_CLASS(class);
    /* x-private1-dts (MPEG-PS) carries a 4-byte substream header; parse_frame's sync search skips it. */
    GstCaps *input = gst_caps_from_string("audio/x-dts; audio/x-private1-dts; audio/x-unknown,codec-id=(string)A_DTS");
    GstCaps *output = gst_caps_from_string("audio/x-raw,format=(string)S16LE,channels=(int)2,rate=(int)48000,layout=(string)interleaved");
    gst_element_class_add_pad_template(element, gst_pad_template_new("sink", GST_PAD_SINK, GST_PAD_ALWAYS, input));
    gst_element_class_add_pad_template(element, gst_pad_template_new("src", GST_PAD_SRC, GST_PAD_ALWAYS, output));
    gst_caps_unref(input); gst_caps_unref(output);
    gst_element_class_set_static_metadata(element, "Native DTS eARC forwarder", "Codec/Decoder/Audio",
        "Preserves 48 kHz DTS core through LG PCM bypass and non-PCM eARC", "Glasshouse contributors");
    decoder->set_format = set_format; decoder->parse = parse_frame; decoder->handle_frame = handle_frame;
    decoder->stop = stop; decoder->sink_event = sink_event; decoder->getcaps = get_caps;
}

static gboolean plugin_init(GstPlugin *plugin) {
    return gst_element_register(plugin, "dts_audiodec", GST_RANK_PRIMARY + 100, gst_gh_dts_get_type());
}
#define PACKAGE "glasshouse-dts-native"
GST_PLUGIN_DEFINE(GST_VERSION_MAJOR, GST_VERSION_MINOR, ghdts, "Native DTS eARC forwarding",
                  plugin_init, "0.1.0", "GPL", PACKAGE, "https://github.com/dakenf/lg-g5-dts")
