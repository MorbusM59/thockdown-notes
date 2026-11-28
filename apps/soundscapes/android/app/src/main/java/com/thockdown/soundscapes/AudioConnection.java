package com.thockdown.soundscapes;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import java.util.ArrayList;
import java.util.List;

/**
 * THE AUDIO DEVICE CONNECTION, a state of its own beside playback and the
 * schedule (Joe, 2026-11-28): it never changes what plays, only whether the
 * output is HEARD.
 *
 * DISCONNECTED: the output media played through went away. Android sends
 * ACTION_AUDIO_BECOMING_NOISY just before it moves the route from a
 * private output (wired or USB headphones, a Bluetooth device) to the
 * loudspeaker. The output then HALTS (AudioOutput.setHalted): the track is
 * paused and flushed, every lane rewound to the frame actually heard, and
 * nothing is mixed, so each lane's playhead stands still. The soundscape
 * session, the music and the schedule keep their own states: a playing
 * soundscape is still playing, a scheduled run still runs. Only output that
 * was being heard halts: with every lane holding there is nothing to
 * protect, and the state stays connected.
 *
 * CONNECTED again, by either of: an output of a private kind is ADDED
 * (AudioDeviceCallback.onAudioDevicesAdded: the headphones back in, the
 * Bluetooth device reconnected), which resumes on it; or the listener's
 * `resume` (the play button, the lock screen's play), which resumes on the
 * output they picked, or with none picked on whatever the system routes to.
 * AUDIO FOCUS (Joe, 2026-11-28: halt, but duck short sounds) is the second
 * reason to halt, through the same state: focus is asked for whenever the
 * output starts to be heard (AudioOutput.onHeard). A call or another app's
 * transient focus HALTS until focus comes back (AUDIOFOCUS_GAIN), which
 * resumes; a short sound that allows ducking (navigation, a notification)
 * only lowers everything heard to AudioOutput.DUCK_GAIN until it is over;
 * a permanent loss (another media app playing) halts until the listener
 * presses play, which asks for focus again. The play button shows halted
 * for either reason alike: `isConnected` is false while halted.
 * Everything halted carries on from where it was heard; whatever the
 * listener changed meanwhile (a pause, a schedule switched off) stands,
 * because it changed the states and the halt never did.
 *
 * THE OUTPUTS are the media outputs present now, one per device (a
 * Bluetooth device listed as both A2DP and LE Audio is one), each of a
 * KIND the app draws: speaker, wired (jack, USB, line), bluetooth, hdmi,
 * hearing aid. A picked output is AudioTrack.setPreferredDevice's, applied
 * by AudioOutput to every track it builds; it lasts until the device goes
 * away. Nothing is polled: the device callback and the broadcast are the
 * only inputs. Process-wide, registered once on the application context
 * (the service and the plugin both reach it), so it works with the page
 * paused.
 */
final class AudioConnection {
    private static final String LOG = "ThockdownAudio";

    /** One media output the listener can pick. */
    static final class Output {
        final int id;
        final String kind;
        final String name;
        final AudioDeviceInfo device;

        Output(int id, String kind, String name, AudioDeviceInfo device) {
            this.id = id;
            this.kind = kind;
            this.name = name;
            this.device = device;
        }
    }

    interface Listener {
        void changed();
    }

    /** The kinds media is routed to before the built-in speaker, most preferred first (the system's own order). */
    private static final int[] PREFERENCE = {
            AudioDeviceInfo.TYPE_BLE_HEADSET,
            AudioDeviceInfo.TYPE_BLE_SPEAKER,
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
            AudioDeviceInfo.TYPE_USB_HEADSET,
            AudioDeviceInfo.TYPE_USB_DEVICE,
            AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioDeviceInfo.TYPE_LINE_ANALOG,
            AudioDeviceInfo.TYPE_LINE_DIGITAL,
            AudioDeviceInfo.TYPE_HDMI,
            AudioDeviceInfo.TYPE_HEARING_AID,
    };

    private static AudioConnection shared;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private final AudioManager audio;
    private final List<Listener> listeners = new ArrayList<>();
    /** The output device went away and nothing has replaced it. */
    private boolean connected = true;
    /** Another app holds audio focus. */
    private boolean focusLost = false;
    private final android.media.AudioFocusRequest focusRequest;
    private boolean focusHeld = false;
    /** The output the listener picked (its device id), or -1 for the system's choice. */
    private int picked = -1;
    private List<Output> outputs = new ArrayList<>();

    static synchronized AudioConnection get(Context context) {
        if (shared == null) shared = new AudioConnection(context.getApplicationContext());
        return shared;
    }

    private final Context context;

    private AudioConnection(Context context) {
        this.context = context;
        audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        outputs = listOutputs();
        focusRequest = new android.media.AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(new android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
                .build())
            // The duck is ours (a share of the level), not the system's.
            .setWillPauseWhenDucked(true)
            .setOnAudioFocusChangeListener(this::focusChanged, MAIN)
            .build();
        AudioOutput.onHeard = this::requestFocus;
        // Reported once the halt has rewound the lanes, so the song's position is the one heard, not one a deep buffer ahead.
        AudioOutput.onHalted = () -> MusicSession.get(context).haltChanged();
        audio.registerAudioDeviceCallback(new AudioDeviceCallback() {
            @Override
            public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
                devicesChanged(added);
            }

            @Override
            public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
                devicesChanged(null);
            }
        }, MAIN);
        androidx.core.content.ContextCompat.registerReceiver(context, new BroadcastReceiver() {
            @Override
            public void onReceive(Context ignored, Intent intent) {
                if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) disconnected();
            }
        }, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    synchronized void addListener(Listener listener) {
        listeners.add(listener);
    }

    synchronized void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    /** Whether output may be heard: the device is connected and no other app holds focus. */
    synchronized boolean isConnected() {
        return connected && !focusLost;
    }

    /** Ask for focus (main thread). Refused (a call is up) is a focus loss. */
    private void requestFocus() {
        synchronized (this) {
            if (focusHeld) return;
        }
        int result = audio.requestAudioFocus(focusRequest);
        boolean granted = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        Log.i(LOG, "focus: requested, " + (granted ? "granted" : "refused"));
        synchronized (this) {
            focusHeld = granted;
            if (granted) return;
            focusLost = true;
        }
        AudioOutput.setHalted(true);
        notifyChanged();
    }

    private void focusChanged(int change) {
        Log.i(LOG, "focus: change " + change);
        boolean halt;
        switch (change) {
            case AudioManager.AUDIOFOCUS_GAIN:
                AudioOutput.setDucked(false);
                synchronized (this) {
                    focusHeld = true;
                    focusLost = false;
                    halt = !connected;
                }
                AudioOutput.setHalted(halt);
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                AudioOutput.setDucked(true);
                return;
            case AudioManager.AUDIOFOCUS_LOSS:
                // Another media app: no GAIN will follow, so play asks again.
                synchronized (this) {
                    focusHeld = false;
                }
                // fall through
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                AudioOutput.setDucked(false);
                synchronized (this) {
                    focusLost = true;
                }
                AudioOutput.setHalted(true);
                break;
            default:
                return;
        }
        notifyChanged();
    }

    synchronized List<Output> outputs() {
        return new ArrayList<>(outputs);
    }

    /** The output media plays through now: the picked one, else the first present by the system's preference, else the speaker. */
    synchronized Output active() {
        for (Output output : outputs) if (output.id == picked) return output;
        for (int type : PREFERENCE) {
            for (Output output : outputs) if (output.device.getType() == type) return output;
        }
        for (Output output : outputs) if ("speaker".equals(output.kind)) return output;
        return null;
    }

    /** The active output's name for the settings kept per device (AudioRoutePlugin). */
    String activeName() {
        Output output = active();
        return output == null ? "Phone speaker" : output.name;
    }

    /**
     * The listener resumes: on the output with device id `id`, or (-1) on
     * whatever the system routes to. Connected again either way.
     */
    void resume(int id) {
        AudioDeviceInfo device = null;
        synchronized (this) {
            picked = -1;
            for (Output output : outputs) {
                if (output.id == id) {
                    picked = id;
                    device = output.device;
                }
            }
            connected = true;
            focusLost = false;
        }
        AudioOutput.setPreferredDevice(device);
        requestFocus();
        synchronized (this) {
            // Refused (a call is up): requestFocus has already halted and told.
            if (focusLost) return;
        }
        Log.i(LOG, "connection: resumed by the listener on " + (device == null ? "the system's route" : device.getProductName()));
        AudioOutput.setHalted(false);
        notifyChanged();
    }

    private void disconnected() {
        // Only what is heard halts: with nothing playing there is nothing to protect.
        if (!AudioOutput.isHeard()) return;
        synchronized (this) {
            if (!connected) return;
            connected = false;
        }
        Log.i(LOG, "connection: output disconnected, halting");
        AudioOutput.setHalted(true);
        notifyChanged();
    }

    private void devicesChanged(AudioDeviceInfo[] added) {
        boolean resume = false;
        boolean pickedLost = false;
        synchronized (this) {
            outputs = listOutputs();
            boolean pickedPresent = false;
            for (Output output : outputs) if (output.id == picked) pickedPresent = true;
            if (picked != -1 && !pickedPresent) {
                picked = -1;
                pickedLost = true;
            }
            if (!connected && added != null) {
                for (AudioDeviceInfo device : added) {
                    if (device.isSink() && isPrivate(device.getType())) resume = true;
                }
            }
            if (resume) {
                connected = true;
                picked = -1;
            }
            // Still halted while another app holds focus.
            if (resume && focusLost) resume = false;
        }
        if (resume) {
            Log.i(LOG, "connection: an output was connected, resuming");
            AudioOutput.setPreferredDevice(null);
            AudioOutput.setHalted(false);
        } else if (pickedLost) {
            AudioOutput.setPreferredDevice(null);
        }
        notifyChanged();
    }

    private void notifyChanged() {
        List<Listener> copy;
        synchronized (this) {
            copy = new ArrayList<>(listeners);
        }
        MAIN.post(() -> {
            MusicSession.get(context).haltChanged();
            for (Listener listener : copy) listener.changed();
        });
        SoundscapePlaybackService.refreshIfRunning();
    }

    /** An output that is the listener's alone, whose loss would carry the sound on out loud. */
    private static boolean isPrivate(int type) {
        String kind = kindOf(type);
        return kind != null && !"speaker".equals(kind);
    }

    /** The kind the app draws for a media output type, or null for one media does not play through. */
    static String kindOf(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
                return "speaker";
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_USB_HEADSET:
            case AudioDeviceInfo.TYPE_USB_DEVICE:
            case AudioDeviceInfo.TYPE_USB_ACCESSORY:
            case AudioDeviceInfo.TYPE_LINE_ANALOG:
            case AudioDeviceInfo.TYPE_LINE_DIGITAL:
            case AudioDeviceInfo.TYPE_DOCK:
                return "wired";
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
            case AudioDeviceInfo.TYPE_BLE_HEADSET:
            case AudioDeviceInfo.TYPE_BLE_SPEAKER:
                return "bluetooth";
            case AudioDeviceInfo.TYPE_HDMI:
            case AudioDeviceInfo.TYPE_HDMI_ARC:
                return "hdmi";
            case AudioDeviceInfo.TYPE_HEARING_AID:
                return "hearing";
            default:
                // The earpiece, call-only Bluetooth (SCO), telephony, remote submixes, ...
                return null;
        }
    }

    /** The media outputs present now, one per device: two entries of one kind with one address are one device. */
    private List<Output> listOutputs() {
        List<Output> list = new ArrayList<>();
        List<String> seen = new ArrayList<>();
        for (AudioDeviceInfo device : audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            String kind = kindOf(device.getType());
            if (kind == null) continue;
            // An address exists from Android 9 (API 28); before it each entry counts as its own device.
            String address = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P ? device.getAddress() : null;
            String key = kind + "|" + (address == null || address.isEmpty() ? String.valueOf(device.getId()) : address);
            if ("speaker".equals(kind)) key = kind;
            if (seen.contains(key)) continue;
            seen.add(key);
            list.add(new Output(device.getId(), kind, nameOf(device, kind), device));
        }
        return list;
    }

    /** A name a reader recognizes and two devices do not share: the kind, and the product for an external one. */
    private static String nameOf(AudioDeviceInfo device, String kind) {
        switch (device.getType()) {
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
                return "Phone speaker";
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
                // The product name of a jack is the phone's own model, which says nothing.
                return "Wired headphones";
            default:
                CharSequence product = device.getProductName();
                String label;
                switch (kind) {
                    case "bluetooth": label = "Bluetooth"; break;
                    case "hdmi": label = "HDMI"; break;
                    case "hearing": label = "Hearing aid"; break;
                    default: label = device.getType() == AudioDeviceInfo.TYPE_USB_HEADSET
                        || device.getType() == AudioDeviceInfo.TYPE_USB_DEVICE
                        || device.getType() == AudioDeviceInfo.TYPE_USB_ACCESSORY ? "USB" : "Line out";
                }
                return product == null || product.length() == 0 ? label : label + ": " + product;
        }
    }
}
