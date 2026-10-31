# DataBrief build: produces two self-contained files from src/ and vendor/:
#   databrief.html              the tool (every script, style and the SQLite WebAssembly inlined)
#   databrief_set_default.html  the team settings page (contains a gzip copy of databrief.html)
# and also:
#   examples/tampered/*.html            the two tampered copies for the privacy demo (docs/verify-privacy.md)
#   deploy/esp32/DataBrief/databrief_html.h   the compressed page for the ESP32 firmware (not committed)
# No dependencies: runs with Windows PowerShell 5.1 or PowerShell 7 (Windows, Linux, macOS).
#   powershell -ExecutionPolicy Bypass -File build.ps1      (Windows)
#   pwsh ./build.ps1                                          (PowerShell 7)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Read-Text([string]$rel) {
  $path = Join-Path $root $rel
  if (-not (Test-Path $path)) { throw "Missing file: $rel" }
  return [System.IO.File]::ReadAllText($path, $utf8)
}

function Expand-Template([string]$templateRel) {
  $html = Read-Text $templateRel
  $html = [regex]::Replace($html, '/\*@inline ([^*]+?)\*/', [System.Text.RegularExpressions.MatchEvaluator] {
    param($m)
    $rel = $m.Groups[1].Value.Trim()
    $text = Read-Text $rel
    # Drop source map references (they would point to files that are not shipped).
    $text = [regex]::Replace($text, '(?m)^\s*//# sourceMappingURL=.*$', '')
    if ($rel.EndsWith('.css')) {
      $text = [regex]::Replace($text, '(?i)</style', '<\/style')
    } else {
      # Keep the HTML parser from ending the <script> element early.
      $text = [regex]::Replace($text, '(?i)</script', '<\/script')
      $text = $text.Replace('<!--', '<\!--')
    }
    return $text
  })
  $html = [regex]::Replace($html, '/\*@base64 ([^*]+?)\*/', [System.Text.RegularExpressions.MatchEvaluator] {
    param($m)
    $path = Join-Path $root $m.Groups[1].Value.Trim()
    return [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($path))
  })
  $html = [regex]::Replace($html, '/\*@gzbase64 ([^*]+?)\*/', [System.Text.RegularExpressions.MatchEvaluator] {
    param($m)
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $root $m.Groups[1].Value.Trim()))
    $ms = New-Object System.IO.MemoryStream
    $gz = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionMode]::Compress)
    $gz.Write($bytes, 0, $bytes.Length)
    $gz.Close()
    return [Convert]::ToBase64String($ms.ToArray())
  })
  if ($html -match '/\*@(inline|base64|gzbase64) ') { throw "Unresolved build directive left in $templateRel" }
  return $html
}

function Write-Output-File([string]$name, [string]$html) {
  $out = Join-Path $root $name
  [System.IO.File]::WriteAllText($out, $html, $utf8)
  $size = (Get-Item $out).Length
  Write-Output ("Built {0} ({1:N0} bytes, {2:N2} MB)" -f $name, $size, ($size / 1MB))
}

function Replace-Once([string]$text, [string]$old, [string]$new) {
  $i = $text.IndexOf($old)
  if ($i -lt 0) { throw "Tampered demo: '$old' not found in databrief.html" }
  return $text.Substring(0, $i) + $new + $text.Substring($i + $old.Length)
}

# Privacy demo (docs/verify-privacy.md): two deliberately tampered copies of databrief.html.
# They live in examples/tampered/ only and are never published (Pages, releases and Docker images
# copy databrief.html and databrief_set_default.html by name).
function Build-Tampered([string]$real) {
  $code = Read-Text 'examples/tampered/injected_code.js'
  $banner = '<div style="position:sticky;top:0;z-index:99999;background:#c62828;color:#fff;font:700 15px/1.4 system-ui,sans-serif;padding:10px 16px;text-align:center">' +
    'DEMO: deliberately TAMPERED copy of DataBrief. Do not use it with real data. See docs/verify-privacy.md</div>'
  $page = Replace-Once $real '<!doctype html>' "<!doctype html>`n<!-- DEMO ONLY: deliberately tampered copy of databrief.html, built by build.ps1 for docs/verify-privacy.md. DO NOT USE. -->"
  $page = Replace-Once $page '<title>DataBrief</title>' '<title>TAMPERED DEMO - DataBrief</title>'
  $page = Replace-Once $page '<body>' ("<body>`n" + $banner)
  $at = $page.LastIndexOf('</body>')
  if ($at -lt 0) { throw 'Tampered demo: </body> not found' }
  $page = $page.Substring(0, $at) + "<!-- ===== INJECTED BY THE 'ATTACKER' (demo, see examples/tampered/injected_code.js) ===== -->`n<script>`n" +
    $code + "</script>`n" + $page.Substring($at)
  # 1. The attacker also loosens the security policy so the request can leave: this copy leaks file names.
  Write-Output-File 'examples/tampered/corrupted_databrief.html' (Replace-Once $page "connect-src 'none'" 'connect-src http://127.0.0.1:8765')
  # 2. Same injected code, policy left untouched: the browser blocks the request.
  Write-Output-File 'examples/tampered/corrupted_databrief_blocked.html' $page
}

Add-Type -AssemblyName System.IO.Compression
$tool = Expand-Template 'src/template.html'
Write-Output-File 'databrief.html' $tool
# The settings page embeds the databrief.html built just above.
Write-Output-File 'databrief_set_default.html' (Expand-Template 'src/setdefault.html')
Build-Tampered $tool
# ESP32 firmware: the compressed page as a C header (generated, not committed).
& (Join-Path $root 'deploy/esp32/make_header.ps1') -Html (Join-Path $root 'databrief.html')
