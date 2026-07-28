package com.agentviz.viewer;

import android.service.dreams.DreamService;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Screensaver: the live dashboard fullscreen whenever the phone is
 * charging/docked. Dreams are recreated on every activation, so the URL is
 * re-read from Config naturally each time.
 */
public class DashboardDreamService extends DreamService {
    private WebView webView;

    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);
        setFullscreen(true);
        setScreenBright(!Config.dreamDim(this));

        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        webView.setBackgroundColor(0xFF080B14);
        webView.setWebViewClient(new WebViewClient());
        webView.loadUrl(Config.url(this));
        setContentView(webView);
    }

    @Override
    public void onDetachedFromWindow() {
        // blank + destroy, or Chromium leaks a renderer per dream activation
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDetachedFromWindow();
    }
}
