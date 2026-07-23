package com.agentviz.viewer;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Tiny HTTP helper: fetch the server-rendered office snapshot / ping the API. */
public final class SnapshotFetcher {
    private SnapshotFetcher() { }

    public static Bitmap fetch(String baseUrl) {
        HttpURLConnection conn = null;
        try {
            URL u = new URL(baseUrl + "/snapshot.png?t=" + System.currentTimeMillis());
            conn = (HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(8000);
            if (conn.getResponseCode() != 200) return null; // 503 while warming up
            InputStream in = conn.getInputStream();
            try {
                return BitmapFactory.decodeStream(in);
            } finally {
                in.close();
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** used by the settings screen's "Test connection" button */
    public static boolean ping(String baseUrl) {
        HttpURLConnection conn = null;
        try {
            URL u = new URL(baseUrl + "/api/widget");
            conn = (HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            return conn.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
