package com.agentviz.viewer;

import android.app.Activity;
import android.app.WallpaperManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/**
 * The app's launcher screen: URL config, connection test, wallpaper mode,
 * screensaver dimming, and two shortcut buttons straight into the system
 * screens (Samsung buries both the screensaver and live-wallpaper pickers).
 * Pure-code UI — no layout XML, no androidx.
 */
public class SettingsActivity extends Activity {
    private static final int BG = Color.parseColor("#080b14");
    private static final int SURFACE = Color.parseColor("#0f1220");
    private static final int TEXT = Color.parseColor("#e2e4f0");
    private static final int DIM = Color.parseColor("#9096b5");
    private static final int ACCENT = Color.parseColor("#7c3aed");

    private EditText urlField;
    private TextView status;
    private RadioButton liveBtn;
    private RadioButton snapBtn;
    private CheckBox dimBox;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        root.setPadding(pad, pad, pad, pad);
        root.setBackgroundColor(BG);

        TextView title = new TextView(this);
        title.setText("AGENT VIZ");
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        root.addView(title);

        TextView sub = new TextView(this);
        sub.setText("Live office viewer — screensaver & wallpaper");
        sub.setTextColor(DIM);
        sub.setPadding(0, 0, 0, dp(18));
        root.addView(sub);

        root.addView(label("DASHBOARD URL"));
        urlField = new EditText(this);
        urlField.setText(Config.url(this));
        urlField.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        urlField.setSingleLine(true);
        urlField.setTextColor(TEXT);
        urlField.setHintTextColor(DIM);
        urlField.setBackgroundColor(SURFACE);
        urlField.setPadding(dp(12), dp(12), dp(12), dp(12));
        root.addView(urlField);

        status = new TextView(this);
        status.setTextColor(DIM);
        status.setPadding(0, dp(6), 0, 0);
        root.addView(status);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, dp(10), 0, dp(6));
        Button save = button("Save");
        save.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                saveAll();
                Toast.makeText(SettingsActivity.this, "Saved", Toast.LENGTH_SHORT).show();
            }
        });
        Button test = button("Test connection");
        test.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                saveAll();
                status.setText("Testing…");
                status.setTextColor(DIM);
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        final boolean ok = SnapshotFetcher.ping(Config.url(SettingsActivity.this));
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                if (ok) {
                                    status.setText("✓ Connected — dashboard reachable");
                                    status.setTextColor(Color.parseColor("#10b981"));
                                } else {
                                    status.setText("✗ Can't reach it — is Tailscale on and the PC awake?");
                                    status.setTextColor(Color.parseColor("#e63946"));
                                }
                            }
                        });
                    }
                }).start();
            }
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        lp.setMargins(0, 0, dp(8), 0);
        row.addView(save, lp);
        row.addView(test, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        root.addView(row);

        root.addView(label("WALLPAPER MODE"));
        RadioGroup rg = new RadioGroup(this);
        liveBtn = radio("Live (animated — uses more battery)");
        snapBtn = radio("Snapshot (photo every 40s — very light)");
        rg.addView(liveBtn);
        rg.addView(snapBtn);
        if (Config.wallpaperLive(this)) liveBtn.setChecked(true); else snapBtn.setChecked(true);
        root.addView(rg);

        root.addView(label("SCREENSAVER"));
        dimBox = new CheckBox(this);
        dimBox.setText("Dim the screen while dreaming (kinder to the display)");
        dimBox.setTextColor(TEXT);
        dimBox.setChecked(Config.dreamDim(this));
        root.addView(dimBox);

        root.addView(label("SET IT UP"));
        Button dream = button("Set up screensaver…");
        dream.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                saveAll();
                try {
                    startActivity(new Intent(Settings.ACTION_DREAM_SETTINGS));
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(SettingsActivity.this,
                            "Open Settings → Display → Screen saver", Toast.LENGTH_LONG).show();
                }
            }
        });
        root.addView(dream, buttonLp());

        Button wall = button("Set live wallpaper…");
        wall.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                saveAll();
                try {
                    Intent i = new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER);
                    i.putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT,
                            new ComponentName(SettingsActivity.this, DashboardWallpaperService.class));
                    startActivity(i);
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(SettingsActivity.this,
                            "Open Settings → Wallpaper → Live wallpapers", Toast.LENGTH_LONG).show();
                }
            }
        });
        root.addView(wall, buttonLp());

        Button refresh = button("Refresh wallpaper now");
        refresh.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                saveAll();
                // the wallpaper runs in its own process; a package-scoped
                // broadcast tells its engines to reload the page (or fetch a
                // fresh snapshot) right away — this is how a redesigned
                // dashboard reaches a wallpaper that's been alive for days
                Intent i = new Intent(DashboardWallpaperService.ACTION_REFRESH);
                i.setPackage(getPackageName());
                sendBroadcast(i);
                Toast.makeText(SettingsActivity.this, "Wallpaper refreshing…", Toast.LENGTH_SHORT).show();
            }
        });
        root.addView(refresh, buttonLp());

        TextView note = new TextView(this);
        note.setText("The app only talks to the address above (your own PC over Tailscale). "
                + "Its only permission is Internet.");
        note.setTextColor(DIM);
        note.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        note.setPadding(0, dp(18), 0, 0);
        root.addView(note);

        ScrollView sc = new ScrollView(this);
        sc.setBackgroundColor(BG);
        sc.addView(root);
        setContentView(sc);
    }

    private void saveAll() {
        java.util.Properties p = Config.load(this);
        p.setProperty("url", urlField.getText().toString().trim());
        p.setProperty("wallpaperMode", snapBtn.isChecked() ? "snapshot" : "live");
        p.setProperty("dreamDim", dimBox.isChecked() ? "true" : "false");
        Config.save(this, p);
    }

    private TextView label(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextColor(ACCENT);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        t.setTypeface(null, android.graphics.Typeface.BOLD);
        t.setPadding(0, dp(18), 0, dp(6));
        return t;
    }

    private Button button(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextColor(TEXT);
        b.setBackgroundColor(SURFACE);
        b.setAllCaps(false);
        return b;
    }

    private LinearLayout.LayoutParams buttonLp() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 0, 0, dp(8));
        return lp;
    }

    private RadioButton radio(String text) {
        RadioButton r = new RadioButton(this);
        r.setText(text);
        r.setTextColor(TEXT);
        return r;
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }
}
