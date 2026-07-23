package com.agentviz.viewer;

import android.content.Context;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.Properties;

/**
 * Plain-file config in getFilesDir() instead of SharedPreferences:
 * the wallpaper service runs in its own :wallpaper process, and
 * SharedPreferences are not multi-process safe. The wallpaper engine
 * re-reads this file on every onVisibilityChanged(true), so a save from
 * the settings screen is picked up the next time the home screen shows.
 */
public final class Config {
    // Placeholder — set your own computer's address in the app's settings
    // screen (e.g. your LAN IP, or a Tailscale/VPN address, port 4317).
    public static final String DEFAULT_URL = "http://192.168.1.100:4317";
    private static final String FILE = "config.properties";

    private Config() { }

    public static Properties load(Context ctx) {
        Properties p = new Properties();
        File f = new File(ctx.getFilesDir(), FILE);
        if (f.exists()) {
            FileInputStream in = null;
            try {
                in = new FileInputStream(f);
                p.load(in);
            } catch (IOException e) {
                // unreadable config -> defaults
            } finally {
                if (in != null) try { in.close(); } catch (IOException e) { }
            }
        }
        return p;
    }

    public static void save(Context ctx, Properties p) {
        File dir = ctx.getFilesDir();
        File tmp = new File(dir, FILE + ".tmp");
        File dst = new File(dir, FILE);
        FileOutputStream out = null;
        try {
            out = new FileOutputStream(tmp);
            p.store(out, "agent viz viewer");
            out.getFD().sync();
        } catch (IOException e) {
            return;
        } finally {
            if (out != null) try { out.close(); } catch (IOException e) { }
        }
        tmp.renameTo(dst); // write-temp + rename so the other process never reads a torn file
    }

    public static void set(Context ctx, String key, String value) {
        Properties p = load(ctx);
        p.setProperty(key, value);
        save(ctx, p);
    }

    public static String url(Context ctx) {
        String u = load(ctx).getProperty("url", DEFAULT_URL).trim();
        if (u.isEmpty()) u = DEFAULT_URL;
        if (!u.startsWith("http://") && !u.startsWith("https://")) u = "http://" + u;
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        return u;
    }

    /** true = WebView-on-VirtualDisplay wallpaper; false = snapshot image mode */
    public static boolean wallpaperLive(Context ctx) {
        return !"snapshot".equals(load(ctx).getProperty("wallpaperMode", "live"));
    }

    /** screensaver dimming (burn-in kindness) */
    public static boolean dreamDim(Context ctx) {
        return "true".equals(load(ctx).getProperty("dreamDim", "false"));
    }
}
