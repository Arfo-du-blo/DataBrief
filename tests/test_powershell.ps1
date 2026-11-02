# Tests deploy/powershell/serve.ps1 on Windows (nothing to install).
#   powershell -ExecutionPolicy Bypass -File tests/test_powershell.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$serve = Join-Path $root 'deploy\powershell\serve.ps1'
$html = Join-Path $root 'databrief.html'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('databrief-ps-test-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
$script:pass = 0; $script:fail = 0
function Check([string]$name, [bool]$cond, [string]$detail = '') {
  if ($cond) { Write-Host "PASS $name"; $script:pass++ } else { Write-Host "FAIL $name  -  $detail"; $script:fail++ }
}
$block = [regex]'<script id="databrief-config" type="application/json">([\s\S]*?)</script>'
function Get-Raw([string]$url, [hashtable]$headers = @{}) {
  $req = [Net.HttpWebRequest]::Create($url)
  $req.AllowAutoRedirect = $false
  $req.AutomaticDecompression = [Net.DecompressionMethods]::None
  foreach ($k in $headers.Keys) { $req.Headers[$k] = $headers[$k] }
  try { $res = $req.GetResponse() } catch [Net.WebException] { $res = $_.Exception.Response }
  $ms = New-Object IO.MemoryStream
  $res.GetResponseStream().CopyTo($ms)
  $out = @{ code = [int]$res.StatusCode; headers = $res.Headers; body = $ms.ToArray() }
  $res.Close()
  return $out
}

Set-Content -Path (Join-Path $tmp 'databrief.conf') -Encoding ASCII -Value @(
  'DATABRIEF_LANG=de', 'DATABRIEF_MODE=files', 'DATABRIEF_PROMPT_INTRO="Line 1\nLine 2 <b>"', 'DATABRIEF_PORT=1')
$env:DATABRIEF_MODE = 'inline'
$p = Start-Process -FilePath powershell -PassThru -WindowStyle Hidden -WorkingDirectory $tmp -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $serve, '-Html', $html, '-Port', '18082', '-BasePath', '/db/',
  '-Lock', 'lang,edit', '-Threads', '4', '-AccessLog', 'false', '-Address', '127.0.0.1')
Remove-Item Env:DATABRIEF_MODE
try {
  $up = $false
  for ($i = 0; $i -lt 60 -and -not $up; $i++) { try { $up = (Get-Raw 'http://127.0.0.1:18082/healthz').code -eq 200 } catch { Start-Sleep -Milliseconds 300 } }
  Check 'powershell: /healthz' $up
  $r = Get-Raw 'http://127.0.0.1:18082/db/'
  $text = [Text.Encoding]::UTF8.GetString($r.body)
  $cfg = ($block.Match($text).Groups[1].Value | ConvertFrom-Json)
  Check 'powershell: settings priority + page config' ($cfg.lang -eq 'de' -and -not $cfg.mode -and (($cfg.lock -join ',') -eq 'lang,edit') -and $cfg.promptIntro -eq "Line 1`nLine 2 <b>") ($cfg | ConvertTo-Json -Compress)
  $raw = $block.Match($text).Groups[1].Value
  Check 'powershell: "<" escaped in the config block' ($raw.Contains('Line 2 ' + [char]92 + 'u003cb') -and $raw.IndexOf([char]60) -lt 0) $raw
  Check 'powershell: page is the full tool' ($r.body.Length -gt 2000000)
  $g = Get-Raw 'http://127.0.0.1:18082/db/' @{ 'Accept-Encoding' = 'gzip' }
  Check 'powershell: gzip' ($g.headers['Content-Encoding'] -eq 'gzip' -and $g.body.Length -lt 2500000)
  Check 'powershell: security headers' ($g.headers['Content-Security-Policy'] -eq "frame-ancestors 'self'" -and $g.headers['X-Content-Type-Options'] -eq 'nosniff')
  $red = Get-Raw 'http://127.0.0.1:18082/db?lang=fr'
  Check 'powershell: base path redirect' ($red.code -eq 301 -and $red.headers['Location'] -eq '/db/?lang=fr') "$($red.code) $($red.headers['Location'])"
  Check 'powershell: 404 elsewhere' ((Get-Raw 'http://127.0.0.1:18082/other').code -eq 404)
  $jobs = 1..12 | ForEach-Object { Start-Job -ScriptBlock { (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:18082/db/').StatusCode } }
  $codes = $jobs | Wait-Job | Receive-Job
  $jobs | Remove-Job
  Check 'powershell: 12 parallel requests' ((@($codes | Where-Object { $_ -eq 200 })).Count -eq 12) ($codes -join ',')
} finally {
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
}

$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $serve -Html $html -Mode bogus -Check 2>&1 | Out-String
Check 'powershell: invalid value rejected' ($LASTEXITCODE -eq 2 -and $out -match 'DATABRIEF_MODE') $out
# "Do not share data": "NO" must not be accepted and then ignored by the page (which would share): it is refused
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $serve -Html $html -Share NO -Check 2>&1 | Out-String
Check 'powershell: -Share NO refused (no silent sharing)' ($LASTEXITCODE -eq 2 -and $out -cmatch 'DATABRIEF_SHARE') $out
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $serve -Html $html -Share no -Lock share -Check 2>&1 | Out-String
Check 'powershell: -Share no -Lock share in the page' ($LASTEXITCODE -eq 0 -and $out -match '"share":\s*"no"' -and $out -match '"lock":\s*\[?\s*"share"') $out
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $serve -Html $html -DataProfile no -Lock profile -Check 2>&1 | Out-String
Check 'powershell: -DataProfile no -Lock profile in the page' ($LASTEXITCODE -eq 0 -and $out -match '"profile":\s*"no"' -and $out -match '"lock":\s*\[?\s*"profile"') $out
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $serve -Html $html -DataProfile maybe -Check 2>&1 | Out-String
Check 'powershell: invalid -DataProfile rejected' ($LASTEXITCODE -eq 2 -and $out -match 'DATABRIEF_PROFILE') $out
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $serve -Html $html -Config (Join-Path $root 'deploy\databrief.conf') -Check 2>&1 | Out-String
Check 'powershell: repository databrief.conf is valid' ($LASTEXITCODE -eq 0) $out

Remove-Item -Recurse -Force $tmp
Write-Host "`n$($script:pass) passed, $($script:fail) failed"
if ($script:fail) { exit 1 }
