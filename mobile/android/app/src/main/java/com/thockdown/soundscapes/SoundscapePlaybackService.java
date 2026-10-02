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
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Foreground service of type mediaPlayback, held while a soundscape is
 * audible (see BackgroundAudioPlugin). Its presence is what lets the app's
 * WebView keep generating audio with the app in the background or the screen
 * off; it carries no audio of its own.
 *
 * It also owns the media session, so the soundscape appears in the
 * notification shade and on the lock screen with a stop control, and the
 * partial wake lock that keeps the CPU running with the screen off.
 *
 * Whether the wake lock is needed at all is one of the things the background
 * playback test on a real device is meant to settle: an active audio output
 * may already keep the CPU awake. If playback survives without it, delete it.
 */
public class SoundscapePlaybackService extends Service {
    static final String ACTION_START = "com.thockdown.soundscapes.START";
    static final String ACTION_STOP_PRESSED = "com.thockdown.soundscapes.STOP_PRESSED";
    static final String EXTRA_TITLE = "title";

    private static final String CHANNEL_ID = "soundscape-playback";
    private static final int NOTIFICATION_ID = 1;

    private MediaSession session;
    private PowerManager.WakeLock wakeLock;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP_PRESSED.equals(action)) {
            // Stop at once rather than waiting for the web side's stop(), so
            // the control works even if the WebView is slow to answer; the
            // web side's own stop() that follows is then a no-op.
            BackgroundAudioPlugin.reportStopRequested();
            stopSelf();
            return START_NOT_STICKY;
        }

        String title = intent == null ? "Soundscape" : intent.getStringExtra(EXTRA_TITLE);
        if (title == null) title = "Soundscape";
        ensureSession(title);
        Notification notification = buildNotification(title);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        if (wakeLock == null) {
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "thockdown:soundscape");
            wakeLock.acquire();
        }
        // Not sticky: if the system kills the process, the WebView that makes
        // the sound is gone too, and a restarted service would announce a
        // soundscape that is not playing.
        return START_NOT_STICKY;
    }

    private void ensureSession(String title) {
        if (session == null) {
            session = new MediaSession(this, "ThockdownSoundscape");
            session.setCallback(new MediaSession.Callback() {
                @Override public void onPause() { requestStop(); }
                @Override public void onStop() { requestStop(); }
            });
            session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_STOP)
                .setState(PlaybackState.STATE_PLAYING, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
                .build());
            session.setActive(true);
        }
        session.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, "Thockdown Soundscapes")
            .build());
    }

    private void requestStop() {
        startService(new Intent(this, SoundscapePlaybackService.class).setAction(ACTION_STOP_PRESSED));
    }

    private Notification buildNotification(String title) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Soundscape playback", NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        int immutable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent open = PendingIntent.getActivity(this, 0,
            new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), immutable);
        PendingIntent stop = PendingIntent.getService(this, 1,
            new Intent(this, SoundscapePlaybackService.class).setAction(ACTION_STOP_PRESSED), immutable);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText("Soundscape playing")
            .setContentIntent(open)
            .setOngoing(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(new Notification.Action.Builder(null, "Stop", stop).build())
            .setStyle(new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0))
            .build();
    }

    @Override
    public void onDestroy() {
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        if (wakeLock != null) {
            if (wakeLock.isHeld()) wakeLock.release();
            wakeLock = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
