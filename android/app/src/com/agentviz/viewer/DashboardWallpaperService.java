package com.agentviz.viewer;

import android.app.Presentation;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.service.wallpaper.WallpaperService;
import android.view.SurfaceHolder;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Live wallpaper. Two engines in one:
 *
 * LIVE mode (default): a VirtualDisplay (private, OWN_CONTENT_ONLY — no
 * permission needed) targets the wallpaper surface, and a Presentation on
 * that display hosts a WebView — so the dashboard renders hardware-
 * accelerated, fully animated, straight into the wallpaper.
 *
 * SNAPSHOT mode (fallback + user-selectable): draws /snapshot.png onto the
 * surface every 40s while visible. Near-zero battery. The live engine
 * auto-trips to this if Presentation.show() throws or the WebView's
 * renderer dies.
 */
public class DashboardWallpaperService extends WallpaperService {

    /** Sent by SettingsActivity's "Refresh wallpaper now" button. The live
     *  WebView loads the dashboard once and can then run for DAYS — live
     *  events keep streaming in, but a redesigned page never arrives
     *  without a reload. */
    public static final String ACTION_REFRESH = "com.agentviz.viewer.WALLPAPER_REFRESH";
    /** Belt-and-braces: reload automatically on becoming visible if the
     *  page is older than this (or the configured URL changed). */
    private static final long STALE_RELOAD_MS = 6 * 60 * 60 * 1000;

    private final java.util.List<DashboardEngine> engines = new java.util.ArrayList<DashboardEngine>();
    private BroadcastReceiver refreshReceiver;

    @Override
    public void onCreate() {
        super.onCreate();
        // This service runs in its own :wallpaper process; since API 28 two
        // processes must not share one WebView data directory (fatal), so
        // claim a suffix BEFORE any WebView exists in this process.
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                WebView.setDataDirectorySuffix("wallpaper");
            } catch (IllegalStateException e) {
                // already set for this process — fine
            }
        }
        refreshReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                java.util.List<DashboardEngine> copy = new java.util.ArrayList<DashboardEngine>(engines);
                for (int n = 0; n < copy.size(); n++) copy.get(n).refreshNow();
            }
        };
        IntentFilter f = new IntentFilter(ACTION_REFRESH);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(refreshReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(refreshReceiver, f);
        }
    }

    @Override
    public void onDestroy() {
        if (refreshReceiver != null) {
            try { unregisterReceiver(refreshReceiver); } catch (Throwable t) { }
            refreshReceiver = null;
        }
        super.onDestroy();
    }

    @Override
    public Engine onCreateEngine() {
        DashboardEngine e = new DashboardEngine();
        engines.add(e);
        return e;
    }

    private class DashboardEngine extends Engine {
        // live mode state
        private VirtualDisplay vd;
        private Presentation presentation;
        private WebView webView;
        private boolean liveFailed = false;
        // snapshot mode state
        private final Handler handler = new Handler(Looper.getMainLooper());
        private Bitmap lastBitmap;
        private boolean snapshotLoopRunning = false;
        // shared
        private boolean visible = false;
        private int width, height;
        private long loadedAt = 0;
        private String loadedUrl = null;

        private boolean liveMode() {
            return !liveFailed && Config.wallpaperLive(DashboardWallpaperService.this);
        }

        private int dpi() {
            return getResources().getDisplayMetrics().densityDpi;
        }

        @Override
        public void onSurfaceChanged(SurfaceHolder holder, int format, int w, int h) {
            super.onSurfaceChanged(holder, format, w, h);
            width = w;
            height = h;
            if (liveMode()) {
                if (vd == null) startLive(holder, w, h);
                else vd.resize(w, h, dpi());
            } else {
                drawSnapshot();
            }
        }

        @Override
        public void onSurfaceCreated(SurfaceHolder holder) {
            super.onSurfaceCreated(holder);
            if (vd != null) vd.setSurface(holder.getSurface());
        }

        @Override
        public void onSurfaceDestroyed(SurfaceHolder holder) {
            if (vd != null) vd.setSurface(null);
            super.onSurfaceDestroyed(holder);
        }

        @Override
        public void onVisibilityChanged(boolean v) {
            visible = v;
            if (liveMode()) {
                // user may have switched live -> snapshot in settings while hidden
                if (v && !Config.wallpaperLive(DashboardWallpaperService.this)) {
                    stopLive();
                    startSnapshotLoop();
                    return;
                }
                if (webView != null) {
                    if (v) {
                        webView.onResume();
                        webView.resumeTimers();
                        // stale-page insurance: a wallpaper lives for days,
                        // but the dashboard keeps evolving — reload when the
                        // loaded page is old or the configured URL changed
                        String cur = Config.url(DashboardWallpaperService.this);
                        if (System.currentTimeMillis() - loadedAt > STALE_RELOAD_MS || !cur.equals(loadedUrl)) {
                            webView.loadUrl(cur);
                            loadedAt = System.currentTimeMillis();
                            loadedUrl = cur;
                        }
                    } else {
                        webView.onPause();
                        webView.pauseTimers(); // process-global, but this process only has this WebView
                    }
                }
                // ...or switched snapshot -> live: engine may not have started yet
                if (v && vd == null && width > 0) startLive(getSurfaceHolder(), width, height);
            } else if (v) {
                // snapshot -> live switch requires a fresh engine only if live never failed here
                if (!liveFailed && Config.wallpaperLive(DashboardWallpaperService.this) && width > 0) {
                    startLive(getSurfaceHolder(), width, height);
                } else {
                    startSnapshotLoop();
                }
            }
        }

        private void startLive(SurfaceHolder holder, int w, int h) {
            try {
                DisplayManager dm = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
                vd = dm.createVirtualDisplay(
                        "agentviz-wp" + (isPreview() ? "-preview" : ""),
                        w, h, dpi(), holder.getSurface(),
                        DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY);
                Context dc = createDisplayContext(vd.getDisplay());
                webView = new WebView(dc);
                WebSettings s = webView.getSettings();
                s.setJavaScriptEnabled(true);
                s.setDomStorageEnabled(true);
                s.setLoadWithOverviewMode(true);
                s.setUseWideViewPort(true);
                webView.setBackgroundColor(0xFF080B14);
                webView.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                        tripToSnapshot();
                        return true; // handled — don't kill our process
                    }
                });
                loadedUrl = Config.url(DashboardWallpaperService.this);
                loadedAt = System.currentTimeMillis();
                webView.loadUrl(loadedUrl);
                presentation = new Presentation(dc, vd.getDisplay());
                presentation.setContentView(webView);
                presentation.show();
            } catch (Throwable t) {
                tripToSnapshot();
            }
        }

        private void tripToSnapshot() {
            liveFailed = true;
            stopLive();
            if (visible) startSnapshotLoop();
        }

        /** The settings screen's "Refresh wallpaper now" button. Reloads the
         *  live page (also picking up a changed URL), or fetches a fresh
         *  snapshot immediately; a previous live failure gets another
         *  chance — the refresh may well be BECAUSE something was fixed. */
        void refreshNow() {
            liveFailed = false;
            if (Config.wallpaperLive(DashboardWallpaperService.this)) {
                if (webView != null) {
                    loadedUrl = Config.url(DashboardWallpaperService.this);
                    loadedAt = System.currentTimeMillis();
                    webView.loadUrl(loadedUrl);
                } else if (width > 0) {
                    startLive(getSurfaceHolder(), width, height);
                }
            } else {
                stopLive();
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        final Bitmap b = SnapshotFetcher.fetch(Config.url(DashboardWallpaperService.this));
                        handler.post(new Runnable() {
                            @Override
                            public void run() {
                                if (b != null) lastBitmap = b;
                                drawSnapshot();
                                if (visible) startSnapshotLoop();
                            }
                        });
                    }
                }).start();
            }
        }

        private void stopLive() {
            try { if (presentation != null) presentation.dismiss(); } catch (Throwable t) { }
            presentation = null;
            try { if (webView != null) webView.destroy(); } catch (Throwable t) { }
            webView = null;
            try { if (vd != null) vd.release(); } catch (Throwable t) { }
            vd = null;
        }

        // ---- snapshot mode ----

        private final Runnable tick = new Runnable() {
            @Override
            public void run() {
                if (!visible || liveMode()) {
                    snapshotLoopRunning = false;
                    return;
                }
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        final Bitmap b = SnapshotFetcher.fetch(Config.url(DashboardWallpaperService.this));
                        handler.post(new Runnable() {
                            @Override
                            public void run() {
                                if (b != null) {
                                    lastBitmap = b; // keep the old one on failure
                                    drawSnapshot();
                                }
                                if (snapshotLoopRunning) handler.postDelayed(tick, 40000);
                            }
                        });
                    }
                }).start();
            }
        };

        private void startSnapshotLoop() {
            drawSnapshot(); // whatever we have, immediately (dark bg first time)
            if (snapshotLoopRunning) return;
            snapshotLoopRunning = true;
            handler.post(tick);
        }

        private void drawSnapshot() {
            SurfaceHolder holder = getSurfaceHolder();
            if (holder == null || holder.getSurface() == null || !holder.getSurface().isValid()) return;
            Canvas c = null;
            try {
                c = holder.lockCanvas();
                if (c == null) return;
                c.drawColor(0xFF080B14);
                if (lastBitmap != null) {
                    // fit-width, vertically centered: the office image is
                    // wider than tall, so center-crop on a portrait phone
                    // would zoom into a strip; letterboxing on the dark
                    // background looks right instead.
                    float scale = (float) c.getWidth() / lastBitmap.getWidth();
                    float dy = (c.getHeight() - lastBitmap.getHeight() * scale) / 2f;
                    Matrix m = new Matrix();
                    m.setScale(scale, scale);
                    m.postTranslate(0, dy);
                    c.drawBitmap(lastBitmap, m, new Paint(Paint.FILTER_BITMAP_FLAG));
                }
            } catch (Throwable t) {
                // drawing into a dying surface — next tick gets a fresh one
            } finally {
                if (c != null) {
                    try { holder.unlockCanvasAndPost(c); } catch (Throwable t) { }
                }
            }
        }

        @Override
        public void onDestroy() {
            engines.remove(this);
            snapshotLoopRunning = false;
            handler.removeCallbacksAndMessages(null);
            stopLive();
            super.onDestroy();
        }
    }
}
