package id.my.kheireditz.yuknonton;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Vibrator;
import android.os.VibrationEffect;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.io.File;

public class MainActivity extends AppCompatActivity {

    public static final String APP_VERSION = "1.0.0";
    public static final int APP_VERSION_CODE = 1;
    private static final String APP_URL = "https://yuknonton.kheireditz.my.id";
    private static final String LOCAL_ASSET_URL = "file:///android_asset/www/index.html";

    private WebView webView;
    private ProgressBar loadingBar;
    private ValueCallback<Uri[]> fileUploadCallback;
    private boolean doubleBackToExitPressedOnce = false;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Styling status bar & navigation bar sesuai estetika Neumorphism (#E7E5E4)
        setupNeumorphicBars();

        setContentView(R.layout.activity_main);
        webView = findViewById(R.id.webView);
        loadingBar = findViewById(R.id.loadingBar);
        webView.setBackgroundColor(0xFFE7E5E4);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        String customUA = settings.getUserAgentString() + " YukNontonApp/" + APP_VERSION + " (Android Native)";
        settings.setUserAgentString(customUA);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new WebAppInterface(this), "AndroidApp");

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                handleDownload(url, contentDisposition, mimeType);
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();

                // Halaman YukNonton tetap di dalam aplikasi
                if (url.startsWith("https://yuknonton.kheireditz.my.id") ||
                    url.startsWith("http://yuknonton.kheireditz.my.id") ||
                    url.startsWith("http://localhost") ||
                    url.startsWith("file:///android_asset/")) {
                    return false;
                }

                // Link luar (WhatsApp, PlayMusic, dll) dibuka lewat aplikasi/browser
                if (url.startsWith("http://") || url.startsWith("https://") ||
                    url.startsWith("whatsapp:") || url.startsWith("intent:") ||
                    url.startsWith("mailto:") || url.startsWith("tel:")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                        return true;
                    } catch (Exception e) {
                        return false;
                    }
                }

                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                loadingBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                loadingBar.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    view.loadUrl(LOCAL_ASSET_URL);
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress < 100) {
                    loadingBar.setVisibility(View.VISIBLE);
                    loadingBar.setProgress(newProgress);
                } else {
                    loadingBar.setVisibility(View.GONE);
                }
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle("YukNonton")
                        .setMessage(message)
                        .setPositiveButton("OKE", (dialog, which) -> result.confirm())
                        .setCancelable(false)
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle("YukNonton")
                        .setMessage(message)
                        .setPositiveButton("YA", (dialog, which) -> result.confirm())
                        .setNegativeButton("BATAL", (dialog, which) -> result.cancel())
                        .setCancelable(false)
                        .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                final EditText input = new EditText(MainActivity.this);
                input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle("YukNonton")
                        .setMessage(message)
                        .setView(input)
                        .setPositiveButton("OKE", (dialog, which) -> result.confirm(input.getText().toString()))
                        .setNegativeButton("BATAL", (dialog, which) -> result.cancel())
                        .setCancelable(false)
                        .show();
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = filePathCallback;

                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, 1001);
                } catch (Exception e) {
                    fileUploadCallback = null;
                    Toast.makeText(MainActivity.this, "Gagal membuka pengelola file", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        setupBackNavigation();
        webView.loadUrl(APP_URL);
    }

    private void setupNeumorphicBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        WindowInsetsControllerCompat insets = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (insets != null) {
            insets.setAppearanceLightStatusBars(true);
            insets.setAppearanceLightNavigationBars(true);
        }
        getWindow().setStatusBarColor(0xFFE7E5E4);
        getWindow().setNavigationBarColor(0xFFE7E5E4);
    }

    private void setupBackNavigation() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                webView.evaluateJavascript(
                        "(function() { " +
                        "  if (typeof window.handleAndroidBack === 'function') { " +
                        "    try { if (window.handleAndroidBack()) return true; } catch (e) {} " +
                        "  } " +
                        "  return false; " +
                        "})();",
                        result -> {
                            if ("true".equals(result)) {
                                return;
                            }
                            if (doubleBackToExitPressedOnce) {
                                finish();
                                return;
                            }
                            doubleBackToExitPressedOnce = true;
                            Toast.makeText(MainActivity.this, "Tekan sekali lagi untuk keluar dari YukNonton", Toast.LENGTH_SHORT).show();
                            new Handler(Looper.getMainLooper()).postDelayed(() -> doubleBackToExitPressedOnce = false, 2000);
                        }
                );
            }
        });
    }

    private void handleDownload(String url, String contentDisposition, String mimeType) {
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
            if (fileName == null || fileName.isEmpty()) {
                fileName = "yuknonton_download.mp4";
            }

            request.setMimeType(mimeType != null ? mimeType : "video/mp4");
            request.addRequestHeader("User-Agent", webView.getSettings().getUserAgentString());
            request.setDescription("Mengunduh " + fileName);
            request.setTitle(fileName);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm != null) {
                dm.enqueue(request);
                Toast.makeText(this, "Mulai mengunduh: " + fileName, Toast.LENGTH_SHORT).show();
            }
        } catch (Exception e) {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            try {
                startActivity(intent);
            } catch (Exception ex) {
                Toast.makeText(this, "Gagal mengunduh: " + ex.getMessage(), Toast.LENGTH_SHORT).show();
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 1001 && fileUploadCallback != null) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getDataString() != null) {
                    results = new Uri[]{Uri.parse(data.getDataString())};
                } else if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                }
            }
            fileUploadCallback.onReceiveValue(results);
            fileUploadCallback = null;
        }
    }

    // ── Jembatan JavaScript Antara Web dan Android Native ──
    public class WebAppInterface {
        private final Context context;

        WebAppInterface(Context context) {
            this.context = context;
        }

        @JavascriptInterface
        public boolean isAndroidApp() {
            return true;
        }

        @JavascriptInterface
        public int getAppVersionCode() {
            return APP_VERSION_CODE;
        }

        @JavascriptInterface
        public String getAppVersionName() {
            return APP_VERSION;
        }

        @JavascriptInterface
        public void downloadMedia(String url, String fileName) {
            runOnUiThread(() -> handleDownload(url, null, "video/mp4"));
        }

        @JavascriptInterface
        public void downloadAndInstallUpdate(String apkUrl) {
            runOnUiThread(() -> startInAppUpdate(apkUrl));
        }

        @JavascriptInterface
        public void triggerHaptic() {
            try {
                Vibrator v = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null && v.hasVibrator()) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v.vibrate(VibrationEffect.createOneShot(18, VibrationEffect.DEFAULT_AMPLITUDE));
                    } else {
                        v.vibrate(18);
                    }
                }
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public String getClipboardText() {
            try {
                ClipboardManager clipboard = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null && clipboard.hasPrimaryClip()) {
                    ClipData clip = clipboard.getPrimaryClip();
                    if (clip != null && clip.getItemCount() > 0) {
                        CharSequence text = clip.getItemAt(0).getText();
                        if (text != null) return text.toString();
                    }
                }
            } catch (Exception ignored) {}
            return "";
        }

        @JavascriptInterface
        public void setClipboardText(String text) {
            try {
                ClipboardManager clipboard = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null) {
                    ClipData clip = ClipData.newPlainText("YukNonton", text);
                    clipboard.setPrimaryClip(clip);
                }
            } catch (Exception ignored) {}
        }
    }

    private void startInAppUpdate(String apkUrl) {
        try {
            Toast.makeText(this, "Mengunduh pembaruan APK YukNonton...", Toast.LENGTH_LONG).show();

            String fileName = "yuknonton-release.apk";
            File destinationFile = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), fileName);
            if (destinationFile.exists()) {
                destinationFile.delete();
            }

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(apkUrl));
            request.setTitle("Pembaruan YukNonton");
            request.setDescription("Mengunduh versi terbaru...");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            request.setDestinationUri(Uri.fromFile(destinationFile));

            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) return;
            long downloadId = dm.enqueue(request);

            BroadcastReceiver onComplete = new BroadcastReceiver() {
                @Override
                public void onReceive(Context ctxt, Intent intent) {
                    long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (id == downloadId) {
                        try {
                            unregisterReceiver(this);
                        } catch (Exception ignored) {}
                        installApkFile(destinationFile);
                    }
                }
            };

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(onComplete, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), Context.RECEIVER_EXPORTED);
            } else {
                registerReceiver(onComplete, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
            }

        } catch (Exception e) {
            Toast.makeText(this, "Gagal memulai unduhan pembaruan: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl));
            startActivity(browserIntent);
        }
    }

    private void installApkFile(File apkFile) {
        if (!apkFile.exists()) return;
        try {
            Uri apkUri = FileProvider.getUriForFile(
                    this,
                    getApplicationContext().getPackageName() + ".fileprovider",
                    apkFile
            );

            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(installIntent);
        } catch (Exception e) {
            Toast.makeText(this, "Gagal membuka installer APK: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }
}