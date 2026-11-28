package com.thockdown.soundscapes;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaDescription;
import android.media.MediaMetadata;
import android.media.browse.MediaBrowser;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.service.media.MediaBrowserService;
import java.util.ArrayList;
import java.util.List;

/**
 * Foreground service of type mediaPlayback, running whenever a soundscape
 * session (SoundscapeSession) or the music (MusicSession) exists, playing
 * or paused. Its presence is
 * what keeps Android from freezing or killing the process with the app in
 * the background or the screen off.
 *
 * It DRAWS the session and RELAYS its controls, and holds no state of its
 * own: the media session (the lock screen and the system's media controls)
 * and the notification show the session's title and what is going on --
 * "Playing", "Paused", or "Scheduled until 07:30" when what is heard is the
 * schedule's -- and their play, pause, next, previous and stop go to the
 * session's control methods. Every change redraws from the session
 * (refresh). Closing the app (onTaskRemoved) is a stop.
 *
 * With music, the controls drive BOTH together (Joe's choice, 2026-11-23):
 * play and pause pause and resume the music and the soundscape alike, stop
 * ends both; next and previous step the songs while music plays (previous
 * goes back to the start of the song, as the native player keeps no
 * history) and the soundscapes otherwise. The notification shows the song
 * while there is music, the soundscape otherwise.
 *
 * It stays in the foreground while paused, so the controls stay, and a
 * paused soundscape can be resumed from the lock screen: a foreground
 * service may not be started again from the background. Stop (the
 * notification's close control, or dismissing it) ends the session and the
 * service.
 *
 * The partial wake lock is held while playing only. Whether it is needed at
 * all (an active audio output may already keep the CPU awake) is still to
 * be settled on a device; if playback survives without it, delete it.
 *
 * It is also the app's MediaBrowserService, which is how Android Auto (and
 * any other media browser) reaches it: a browser BINDS it, with or without a
 * session, sees the session's soundscapes as one browsable list
 * (SoundscapeSession.entries, stored, so it is there before the app has
 * run), and plays one by id. Bound without a session it is NOT in the
 * foreground and shows no notification; the media session then reports
 * STOPPED. The foreground follows the session, not the binding: a session
 * that starts while bound still STARTS the service (startForegroundService,
 * through SoundscapeSession.refreshService), so it outlives the browser
 * unbinding, and a session that ends leaves the foreground while a browser
 * may keep the service alive (sourceChanged).
 */
public class SoundscapePlaybackService extends MediaBrowserService {
    private static final String ROOT_ID = "root";
    private static final String SOUNDSCAPES_ID = "soundscapes";

    private static final String ACTION_PLAY = "com.thockdown.soundscapes.PLAY";
    private static final String ACTION_PAUSE = "com.thockdown.soundscapes.PAUSE";
    private static final String ACTION_NEXT = "com.thockdown.soundscapes.NEXT";
    private static final String ACTION_PREVIOUS = "com.thockdown.soundscapes.PREVIOUS";
    private static final String ACTION_STOP = "com.thockdown.soundscapes.STOP";

    private static final String CHANNEL_ID = "soundscape-playback";
    private static final int NOTIFICATION_ID = 1;

    private static SoundscapePlaybackService running;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private SoundscapeSession soundscape;
    private MusicSession music;
    private MediaSession session;
    private PowerManager.WakeLock wakeLock;
    /**
     * Whether the service was STARTED for the session (onStartCommand with
     * one active), rather than only bound by a browser. Only a started
     * service may be redrawn into the foreground: a merely bound one has to
     * be started first, or it would end with the browser's binding.
     * Volatile: the session sets it from its own thread when it ends.
     */
    private volatile boolean started;

    /** Redraw the started service from the session; false when it is not started. */
    static boolean refreshIfRunning() {
        SoundscapePlaybackService service = running;
        if (service == null || !service.started) return false;
        MAIN.post(service::refresh);
        return true;
    }

    /** The published soundscapes changed: browsers re-read the list. */
    static void libraryChanged() {
        SoundscapePlaybackService service = running;
        if (service != null) MAIN.post(() -> service.notifyChildrenChanged(SOUNDSCAPES_ID));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;
        soundscape = SoundscapeSession.get(this);
        music = MusicSession.get(this);
        session = new MediaSession(this, "ThockdownSoundscape");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { play(); }
            @Override public void onPause() { pause(); }
            @Override public void onSkipToNext() { skip(1); }
            @Override public void onSkipToPrevious() { skip(-1); }
            // Pause is the only way to silence (SoundscapeSession): a stop from a media controller is one.
            @Override public void onStop() { pause(); }
            @Override public void onPlayFromMediaId(String mediaId, Bundle extras) { soundscape.controlPlayFrom(mediaId); }
        });
        session.setActive(true);
        setSessionToken(session.getSessionToken());
        androidx.core.content.ContextCompat.registerReceiver(this, becomingNoisy,
            new android.content.IntentFilter(android.media.AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
        refresh();
    }

    /**
     * Headphones unplugged or a Bluetooth headset disconnected: the system
     * moves the output to the loudspeaker on its own, so what was private
     * would carry on out loud. Everything pauses, as every media app does;
     * play resumes it on the new route.
     */
    private final android.content.BroadcastReceiver becomingNoisy = new android.content.BroadcastReceiver() {
        @Override
        public void onReceive(android.content.Context context, Intent intent) {
            if (android.media.AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) pause();
        }
    };

    // --- Browsing (Android Auto) ---

    @Override
    public BrowserRoot onGetRoot(String clientPackageName, int clientUid, Bundle rootHints) {
        // Every browser may see the list: it names soundscapes, nothing more.
        return new BrowserRoot(ROOT_ID, null);
    }

    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowser.MediaItem>> result) {
        List<MediaBrowser.MediaItem> items = new ArrayList<>();
        if (ROOT_ID.equals(parentId)) {
            // One browsable node rather than playable items at the root: Android
            // Auto shows a root's browsable children as its tabs.
            items.add(new MediaBrowser.MediaItem(new MediaDescription.Builder()
                .setMediaId(SOUNDSCAPES_ID)
                .setTitle("Soundscapes")
                .build(), MediaBrowser.MediaItem.FLAG_BROWSABLE));
        } else if (SOUNDSCAPES_ID.equals(parentId)) {
            for (SoundscapeSession.Entry entry : soundscape.entries()) {
                items.add(new MediaBrowser.MediaItem(new MediaDescription.Builder()
                    .setMediaId(entry.id)
                    .setTitle(entry.name)
                    .build(), MediaBrowser.MediaItem.FLAG_PLAYABLE));
            }
        }
        result.sendResult(items);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PLAY.equals(action)) play();
        else if (ACTION_PAUSE.equals(action)) pause();
        else if (ACTION_NEXT.equals(action)) skip(1);
        else if (ACTION_PREVIOUS.equals(action)) skip(-1);
        else if (ACTION_STOP.equals(action)) {
            stop();
            return START_NOT_STICKY;
        }
        if (!active()) {
            started = false;
            // Started for a session that has already ended (it was stopped
            // between startForegroundService and this call). Android 8+
            // still requires startForeground from a service started that
            // way, and on Android 12+ a stopSelf without it crashes the app
            // (ForegroundServiceDidNotStartInTimeException), so enter the
            // foreground for an instant and leave it again.
            try {
                startForegroundWith(buildNotification(getString(R.string.app_name), "", false));
            } catch (RuntimeException ignored) {
                // Not started with startForegroundService, and not allowed here: nothing was owed.
            }
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        started = true;
        refresh();
        // Not sticky: if the system kills the process, the session is gone
        // with it, and a restarted service would announce a soundscape that
        // is not playing.
        return START_NOT_STICKY;
    }

    // --- The controls, on both together ---

    private boolean active() {
        return soundscape.isActive() || music.isActive();
    }

    /** Resume what is paused; with nothing at all, the soundscape last heard (as before there was music). */
    private void play() {
        boolean withMusic = music.isActive();
        android.util.Log.i("ThockdownAudio", "media play: music active " + withMusic + ", soundscape active " + soundscape.isActive());
        if (withMusic) music.resume();
        if (soundscape.isActive() || !withMusic) soundscape.controlPlay();
    }

    private void pause() {
        pauseAll(this, true);
    }

    /**
     * THE LISTENER'S PAUSE, from any control (the app's transport and orb,
     * the notification, the lock screen, headphones): the music and the
     * soundscape fall silent together and, when a scheduled run is under way,
     * the schedule is switched OFF -- visibly, the app's schedule button
     * following -- since a run that carried on would not be a pause, and one
     * held back unseen would be a blocker the listener cannot find. The
     * music's run is handed to the listener first, so play resumes it.
     * Returns the soundscape's outcome; `announce` as in controlPause.
     */
    static SoundscapeSession.State pauseAll(Context context, boolean announce) {
        MusicSession music = MusicSession.get(context);
        SoundscapeSession soundscape = SoundscapeSession.get(context);
        boolean runInForce = SoundscapeSchedule.load(context).runInForce();
        music.pause();
        if (runInForce) music.adoptRun();
        if (runInForce) SoundscapeSchedule.switchOff(context);
        // Paused after the switch, so the outcome (and its announcement) carries the schedule off.
        return soundscape.controlPause(announce);
    }

    private void skip(int direction) {
        if (!music.isActive()) soundscape.controlSkip(direction);
        else if (direction > 0) music.skip();
        else music.seek(0);
    }

    private void stop() {
        music.stop();
        soundscape.controlStop();
    }

    /**
     * The music or a soundscape started, changed or ended: redraw, start the
     * service if something plays and it is not started, or end it if nothing
     * is left. Decided on the main thread, where neither session's lock is
     * held, so the two sessions never wait on each other. Returns false when
     * the service had to be started and the system refused (from the
     * background): the caller ends what it started.
     */
    static boolean sourceChanged(android.content.Context context, boolean starting) {
        if (refreshIfRunning()) return true;
        if (!starting) {
            MAIN.post(() -> {
                SoundscapePlaybackService service = running;
                if (service == null || service.active()) return;
                service.started = false;
                context.stopService(new Intent(context, SoundscapePlaybackService.class));
                service.refresh();
            });
            return true;
        }
        try {
            androidx.core.content.ContextCompat.startForegroundService(context, new Intent(context, SoundscapePlaybackService.class));
            return true;
        } catch (RuntimeException refused) {
            return false;
        }
    }

    private void refresh() {
        if (running != this) return;
        if (!started || !active()) {
            if (started) {
                // Everything ended while started: the service ends too.
                started = false;
                stopSelf();
            }
            // Bound by a browser with no session: nothing plays, and the
            // controls a browser offers are choosing a soundscape and play.
            session.setMetadata(null);
            session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_PLAY_FROM_MEDIA_ID
                    | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
                .setState(PlaybackState.STATE_STOPPED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 0f)
                .build());
            stopForeground(STOP_FOREGROUND_REMOVE);
            holdWakeLock(false);
            return;
        }
        boolean withMusic = music.isActive();
        boolean playing = (withMusic && music.isPlaying()) || soundscape.isAudible();
        String title = withMusic ? music.title() : soundscape.title();
        String status = withMusic
            ? (playing ? "Playing" : "Paused") + (soundscape.isActive() ? " with " + soundscape.title() : "")
            : statusText(playing);
        session.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, status)
            .build());
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                | PlaybackState.ACTION_PLAY_FROM_MEDIA_ID)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                PlaybackState.PLAYBACK_POSITION_UNKNOWN, playing ? 1f : 0f)
            .build());
        startForegroundWith(buildNotification(title, status, playing));
        holdWakeLock(playing);
    }

    private void startForegroundWith(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void holdWakeLock(boolean hold) {
        if (hold && wakeLock == null) {
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "thockdown:soundscape");
            wakeLock.acquire();
        } else if (!hold && wakeLock != null) {
            if (wakeLock.isHeld()) wakeLock.release();
            wakeLock = null;
        }
    }

    private PendingIntent control(String action, int requestCode) {
        int immutable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
        return PendingIntent.getService(this, requestCode,
            new Intent(this, SoundscapePlaybackService.class).setAction(action), immutable);
    }

    @SuppressWarnings("deprecation")
    private Notification.Action action(int icon, String title, PendingIntent intent) {
        return new Notification.Action.Builder(icon, title, intent).build();
    }

    /** What the notification says is going on: playing, paused, or scheduled, and until when, if it ends. */
    private String statusText(boolean playing) {
        String status = soundscape.source() == SoundscapeSession.Source.SCHEDULE ? "Scheduled" : playing ? "Playing" : "Paused";
        long endsAt = soundscape.state().endsAtMs;
        if (endsAt < 0) return status;
        return status + " until " + android.text.format.DateFormat.getTimeFormat(this).format(new java.util.Date(endsAt));
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Closing the app stops what the listener chose; the schedule carries on.
        stop();
        super.onTaskRemoved(rootIntent);
    }

    private Notification buildNotification(String title, String status, boolean playing) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Soundscape playback", NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        int immutable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent open = PendingIntent.getActivity(this, 0,
            new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), immutable);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setSmallIcon(R.drawable.ic_stat_soundscape)
            .setContentTitle(title)
            .setContentText(status)
            .setContentIntent(open)
            .setDeleteIntent(control(ACTION_STOP, 5))
            .setOngoing(playing)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(action(android.R.drawable.ic_media_previous, "Previous", control(ACTION_PREVIOUS, 1)))
            .addAction(playing
                ? action(android.R.drawable.ic_media_pause, "Pause", control(ACTION_PAUSE, 2))
                : action(android.R.drawable.ic_media_play, "Play", control(ACTION_PLAY, 3)))
            .addAction(action(android.R.drawable.ic_media_next, "Next", control(ACTION_NEXT, 4)))
            .setStyle(new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2))
            .build();
    }

    @Override
    public void onDestroy() {
        if (running == this) running = null;
        unregisterReceiver(becomingNoisy);
        session.setActive(false);
        session.release();
        holdWakeLock(false);
        super.onDestroy();
    }
}
