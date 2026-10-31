# DataBrief build: produces two self-contained files from src/ and vendor/:
#   databrief.html              the tool (every script, style and the SQLite WebAssembly inlined)
#   databrief_set_default.html  the team settings page (contains a gzip copy of databrief.html)
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

Add-Type -AssemblyName System.IO.Compression
Write-Output-File 'databrief.html' (Expand-Template 'src/template.html')
# The settings page embeds the databrief.html built just above.
Write-Output-File 'databrief_set_default.html' (Expand-Template 'src/setdefault.html')
