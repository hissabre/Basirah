package app.basirah.glasses;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/** Basirah pour lunettes : la page (assets/www) est servie en https local, micro autorisé, anneau → commandes de la page. */
public class MainActivity extends Activity {
  private WebView web; private PermissionRequest pending;
  private static final String HOST = "appassets.androidplatform.net";

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
    web = new WebView(this); web.setBackgroundColor(0xFF000000); setContentView(web); immersive();
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setMediaPlaybackRequiresUserGesture(false);
    s.setAllowFileAccess(false); s.setAllowContentAccess(false); s.setCacheMode(WebSettings.LOAD_NO_CACHE);
    final WebViewAssetLoader loader = new WebViewAssetLoader.Builder().setDomain(HOST).addPathHandler("/assets/", path -> {
      try {
        InputStream in = getAssets().open(path);
        WebResourceResponse r = new WebResourceResponse(mime(path), mime(path).startsWith("text") ? "utf-8" : null, in);
        Map<String, String> h = new HashMap<>(); h.put("Cache-Control", "no-store"); r.setResponseHeaders(h); return r;
      } catch (Exception e) { return null; }
    }).build();
    web.setWebViewClient(new WebViewClient() {
      @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) { return loader.shouldInterceptRequest(req.getUrl()); }
    });
    web.setWebChromeClient(new WebChromeClient() {
      @Override public void onPermissionRequest(PermissionRequest req) {
        runOnUiThread(() -> {
          if (Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) req.grant(req.getResources());
          else { pending = req; requestPermissions(new String[]{ Manifest.permission.RECORD_AUDIO }, 7); }
        });
      }
    });
    if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
      requestPermissions(new String[]{ Manifest.permission.RECORD_AUDIO }, 6);
    web.loadUrl("https://" + HOST + "/assets/www/glasses.html");
  }
  private static String mime(String p) {
    p = p.toLowerCase();
    if (p.endsWith(".html")) return "text/html"; if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
    if (p.endsWith(".wasm")) return "application/wasm"; if (p.endsWith(".json")) return "application/json"; if (p.endsWith(".txt")) return "text/plain";
    return "application/octet-stream";
  }
  @Override public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
    if (pending != null) { if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) pending.grant(pending.getResources()); else pending.deny(); pending = null; }
  }
  private void immersive() {
    web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
  }
  @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) immersive(); }

  /** Anneau / pavé tactile / télécommande : chaque touche devient une commande de la page. Les touches inconnues sont signalées (Aide). */
  @Override public boolean dispatchKeyEvent(KeyEvent e) {
    int k = e.getKeyCode();
    if (k == KeyEvent.KEYCODE_VOLUME_UP || k == KeyEvent.KEYCODE_VOLUME_DOWN || k == KeyEvent.KEYCODE_POWER) return super.dispatchKeyEvent(e);
    String a = null;
    switch (k) {
      case KeyEvent.KEYCODE_DPAD_UP: case KeyEvent.KEYCODE_PAGE_UP: a = "up"; break;
      case KeyEvent.KEYCODE_DPAD_DOWN: case KeyEvent.KEYCODE_PAGE_DOWN: a = "down"; break;
      case KeyEvent.KEYCODE_DPAD_LEFT: case KeyEvent.KEYCODE_MEDIA_PREVIOUS: a = "left"; break;
      case KeyEvent.KEYCODE_DPAD_RIGHT: case KeyEvent.KEYCODE_MEDIA_NEXT: a = "right"; break;
      case KeyEvent.KEYCODE_DPAD_CENTER: case KeyEvent.KEYCODE_ENTER: case KeyEvent.KEYCODE_NUMPAD_ENTER: case KeyEvent.KEYCODE_SPACE:
      case KeyEvent.KEYCODE_BUTTON_A: case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: case KeyEvent.KEYCODE_HEADSETHOOK: a = "ok"; break;
      case KeyEvent.KEYCODE_BACK: case KeyEvent.KEYCODE_ESCAPE: case KeyEvent.KEYCODE_BUTTON_B: a = "back"; break;
    }
    if (e.getAction() != KeyEvent.ACTION_DOWN) return a != null || super.dispatchKeyEvent(e);
    if (a == null) { js("window.basirahKey&&window.basirahKey('touche " + k + "')"); return super.dispatchKeyEvent(e); }
    if (a.equals("back")) { web.evaluateJavascript("window.basirahBack?window.basirahBack():false", v -> { if (!"true".equals(v)) finish(); }); return true; }
    js("window.basirahKey&&window.basirahKey('" + a + "')"); return true;
  }
  private void js(String s) { web.evaluateJavascript(s, null); }
  @Override protected void onDestroy() { if (web != null) web.destroy(); super.onDestroy(); }
}
