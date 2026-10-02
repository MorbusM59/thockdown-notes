package com.thockdown.soundscapes;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/**
 * Foreground service of type mediaPlayback, running whenever a soundscape
 * session (SoundscapeSession) exists, playing or paused. Its presence is
 * what keeps Android from freezing or killing the process with the app in
 * the background or the screen off.
 *
 * It DRAWS the session and RELAYS its controls, and holds no state of its
 * own: the media session (the lock screen and the system's media controls)
 * and the notification show the session's title and whether it plays, and
 * their play, pause, next, previous and stop go to the session's control
 * methods. Every change redraws from the session (refresh).
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
 */
public class SoundscapePlaybackService extends Service {
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
    private MediaSession session;
    private PowerManager.WakeLock wakeLock;

    /** Redraw the running service from the session; false when it is not running. */
    static boolean refreshIfRunning() {
        SoundscapePlaybackService service = running;
        if (service == null) return false;
        MAIN.post(service::refresh);
        return true;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;
        soundscape = SoundscapeSession.get(this);
        session = new MediaSession(this, "ThockdownSoundscape");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { soundscape.controlPlay(); }
            @Override public void onPause() { soundscape.controlPause(); }
            @Override public void onSkipToNext() { soundscape.controlSkip(1); }
            @Override public void onSkipToPrevious() { soundscape.controlSkip(-1); }
            @Override public void onStop() { soundscape.controlStop(); }
        });
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PLAY.equals(action)) soundscape.controlPlay();
        else if (ACTION_PAUSE.equals(action)) soundscape.controlPause();
        else if (ACTION_NEXT.equals(action)) soundscape.controlSkip(1);
        else if (ACTION_PREVIOUS.equals(action)) soundscape.controlSkip(-1);
        else if (ACTION_STOP.equals(action)) {
            soundscape.controlStop();
            return START_NOT_STICKY;
        }
        if (!soundscape.isActive()) {
            // Started for a session that has already ended.
            stopSelf();
            return START_NOT_STICKY;
        }
        refresh();
        // Not sticky: if the system kills the process, the session is gone
        // with it, and a restarted service would announce a soundscape that
        // is not playing.
        return START_NOT_STICKY;
    }

    private void refresh() {
        if (running != this || !soundscape.isActive()) return;
        boolean playing = soundscape.isPlaying();
        String title = soundscape.title();
        session.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, "Thockdown Soundscapes")
            .build());
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                PlaybackState.PLAYBACK_POSITION_UNKNOWN, playing ? 1f : 0f)
            .build());
        Notification notification = buildNotification(title, playing);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        holdWakeLock(playing);
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

    private Notification buildNotification(String title, boolean playing) {
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
            .setContentText(playing ? "Soundscape playing" : "Soundscape paused")
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
            .addAction(action(android.R.drawable.ic_menu_close_clear_cancel, "Stop", control(ACTION_STOP, 5)))
            .setStyle(new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2))
            .build();
    }

    @Override
    public void onDestroy() {
        if (running == this) running = null;
        session.setActive(false);
        session.release();
        holdWakeLock(false);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
