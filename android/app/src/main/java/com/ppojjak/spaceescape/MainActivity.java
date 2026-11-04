package com.ppojjak.spaceescape;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.PixelCopy;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * 뽀짝 우주 대탈출 WebView 셸.
 * - 게임 파일은 web/ 폴더(assets)에서만 읽습니다. 외부 네트워크 요청은 모두 차단합니다.
 * - 화면은 edge-to-edge로 그리고, 상태바·내비게이션바·노치 영역만큼 여백을 줍니다. (targetSdk 35+ 대응)
 * - 뒤로가기는 게임에 먼저 전달합니다: 도감/꾸미기 닫기 → 플레이 중이면 일시정지 → 그 외에는 앱 종료.
 * - WebView 렌더러가 죽어도(메모리 부족 등) 앱을 끄지 않고 새 WebView로 다시 엽니다.
 * - 게임은 window.NeonAndroid.vibrate(ms)로 짧은 진동을, share(text)로 공유 시트를,
 *   shareResult(text)로 '결과 화면 캡처 + 메시지' 공유를 요청할 수 있습니다.
 */
public class MainActivity extends Activity {
    private static final int BG = 0xff15152d;
    private static final String HOST = "app.local";
    private static final String RANK_HOST = "rbtodhdjwumkmlnpdmcm.supabase.co";
    private static final String START_URL = "https://" + HOST + "/?app=1";
    private static final Set<String> ASSETS = new HashSet<>(Arrays.asList("index.html", "style.css", "game.js",
            "fonts/onemobilepop.woff", "fonts/nsn-eb.woff2", "fonts/nsn-hv.woff2")); // 글꼴도 앱 안에서만 읽음

    private FrameLayout root;
    private WebView web;
    private Vibrator vibrator;
    private OnBackInvokedCallback backCallback;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        setupEdgeToEdge();
        vibrator = findVibrator();

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                l = i.left; t = i.top; r = i.right; b = i.bottom;
            } else {
                l = insets.getSystemWindowInsetLeft(); t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight(); b = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(l, t, r, b);
            return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        setContentView(root);
        attachWebView();

        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
    }

    private void attachWebView() {
        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100); // 시스템 글꼴 크기에 따라 HUD가 깨지지 않도록 고정
        // 로컬 에셋만 여는 앱이므로 브리지 노출이 안전합니다(외부 페이지는 shouldOverrideUrlLoading에서 차단).
        web.addJavascriptInterface(new Bridge(), "NeonAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                // 하루 랭킹 서버(Supabase)만 실제 인터넷으로 보냄. 그 밖의 외부 요청은 모두 막음.
                if ("https".equals(uri.getScheme()) && RANK_HOST.equals(uri.getHost())) return null;
                if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost())) return empty();
                String path = uri.getPath();
                String asset = (path == null || "/".equals(path)) ? "index.html" : path.substring(1);
                if (!ASSETS.contains(asset)) return empty();
                String mime = asset.endsWith(".css") ? "text/css" : asset.endsWith(".js") ? "application/javascript"
                        : asset.endsWith(".woff2") ? "font/woff2" : asset.endsWith(".woff") ? "font/woff" : "text/html";
                boolean font = mime.startsWith("font/");
                try {
                    WebResourceResponse res = new WebResourceResponse(mime, font ? null : "UTF-8", getAssets().open(asset));
                    if (font) res.setResponseHeaders(java.util.Collections.singletonMap("Access-Control-Allow-Origin", "*"));
                    return res;
                } catch (IOException error) {
                    return empty();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !HOST.equals(request.getUrl().getHost());
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // 렌더러가 종료되면 이 WebView는 더 쓸 수 없습니다. 버리고 새로 만듭니다. (true = 앱 크래시 방지)
                if (view == web) {
                    root.removeView(web);
                    web.destroy();
                    web = null;
                    root.post(MainActivity.this::attachWebView);
                }
                return true;
            }

            private WebResourceResponse empty() {
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        web.loadUrl(START_URL);
    }

    @SuppressWarnings("deprecation")
    private void setupEdgeToEdge() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        if (Build.VERSION.SDK_INT < 35) { // 35+에서는 시스템이 투명 바를 강제하므로 호출하지 않음
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
        }
        if (Build.VERSION.SDK_INT >= 29) w.setNavigationBarContrastEnforced(false);
    }

    @SuppressWarnings("deprecation")
    private Vibrator findVibrator() {
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return vm != null ? vm.getDefaultVibrator() : null;
        }
        return (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
    }

    /** JavaScript에서 호출: window.NeonAndroid.vibrate(ms), window.NeonAndroid.share(text) */
    private class Bridge {
        /** 결과 공유: Android 공유 시트(카카오톡 등)를 엽니다. */
        @JavascriptInterface
        public void share(String text) {
            if (text == null || text.length() > 1000) return;
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(send, "결과 공유"));
            });
        }

        /**
         * 결과 공유 + 결과 화면 자동 캡처: 지금 화면을 찍어 이미지로 붙이고, 메시지도 함께 보냅니다.
         * 카카오톡은 이미지와 글을 같이 받을 때 글을 빼는 경우가 있어서, 메시지는 클립보드에도 복사해 둡니다.
         */
        @JavascriptInterface
        public void shareResult(String text) {
            if (text == null || text.length() > 1000) return;
            runOnUiThread(() -> captureAndShare(text));
        }

        @JavascriptInterface
        public void vibrate(long ms) {
            if (vibrator == null || !vibrator.hasVibrator()) return;
            long d = Math.max(5, Math.min(ms, 300));
            try {
                vibrator.vibrate(VibrationEffect.createOneShot(d, VibrationEffect.DEFAULT_AMPLITUDE));
            } catch (RuntimeException ignored) {
            }
        }
    }

    /** 화면(WebView 영역)을 그대로 캡처 — PixelCopy는 게임 캔버스(GPU)까지 찍힙니다. */
    private void captureAndShare(String text) {
        if (web == null || web.getWidth() < 1 || web.getHeight() < 1) { shareTextOnly(text); return; }
        int[] at = new int[2];
        web.getLocationInWindow(at);
        android.graphics.Rect area = new android.graphics.Rect(at[0], at[1], at[0] + web.getWidth(), at[1] + web.getHeight());
        Bitmap shot = Bitmap.createBitmap(web.getWidth(), web.getHeight(), Bitmap.Config.ARGB_8888);
        try {
            PixelCopy.request(getWindow(), area, shot, result -> {
                if (result == PixelCopy.SUCCESS) shareWithImage(text, shot);
                else shareTextOnly(text);
            }, new Handler(Looper.getMainLooper()));
        } catch (RuntimeException e) {
            shareTextOnly(text);
        }
    }

    private void shareWithImage(String text, Bitmap shot) {
        try {
            File dir = new File(getCacheDir(), "share");
            if (!dir.exists() && !dir.mkdirs()) { shareTextOnly(text); return; }
            File file = new File(dir, "neon-drift-result.png");
            try (FileOutputStream out = new FileOutputStream(file)) { shot.compress(Bitmap.CompressFormat.PNG, 100, out); }
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".share", file);
            copyToClipboard(text);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("image/png");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_TEXT, text);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "결과 공유");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(chooser);
            Toast.makeText(this, "결과 화면을 붙였어요 · 메시지는 복사해 뒀어요", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            shareTextOnly(text);
        }
    }

    private void shareTextOnly(String text) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        startActivity(Intent.createChooser(send, "결과 공유"));
    }

    private void copyToClipboard(String text) {
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("뽀짝 우주 대탈출 결과", text));
    }

    /** 게임이 뒤로가기를 처리했으면("true") 그대로 두고, 아니면 앱을 닫습니다. */
    private void handleBack() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("(window.neonBack ? window.neonBack() : false)", result -> {
            if (!"true".equals(result)) finish();
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() { // Android 12 이하
        handleBack();
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.evaluateJavascript("window.dispatchEvent(new Event('blur'));", null); // 게임 자동 일시정지
            web.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null)
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
