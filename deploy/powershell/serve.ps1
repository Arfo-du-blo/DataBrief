<#
.SYNOPSIS
  DataBrief - small web server for teams, for Windows (PowerShell 5.1 or 7). Nothing to install, no admin rights.

.DESCRIPTION
  Serves databrief.html with your team settings written into it. The data files users open never
  reach this server: DataBrief works entirely in the browser.

  Settings priority: command-line parameter > environment variable > databrief.conf > built-in default.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File serve.ps1
  powershell -ExecutionPolicy Bypass -File serve.ps1 -Setup
  powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 9000 -Lang fr -Lock "lang,mode"

.NOTES
  GPL-3.0-or-later - https://github.com/Arfo-du-blo/DataBrief
  Parameter -Address is the listening address (DATABRIEF_HOST); "Host" is reserved in PowerShell.
#>
[CmdletBinding()]
param(
  [switch]$Setup,
  [string]$Config,
  [switch]$Check,
  [string]$Lang,
  [string]$PromptLang,
  [string]$Mode,
  [string]$Layout,
  [string]$Theme,
  [string]$Share,
  [string]$SampleRows,
  [string]$WarnTokens,
  [string]$Lock,
  [string]$PromptIntro,
  [string]$PromptRespond,
  [string]$PromptRespondFiles,
  [string]$Address,
  [string]$Port,
  [string]$Threads,
  [string]$BasePath,
  [string]$AccessLog,
  [string]$FrameAncestors,
  [string]$Html
)
$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Langs = @('en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'zh', 'ja', 'ko', 'hi', 'ar')
$Lockable = @('lang', 'promptLang', 'mode', 'layout', 'theme', 'limit', 'edit', 'view', 'share')

# Param, environment variable, default, page config key ('' = server setting), question for -Setup ('' = none)
$Settings = @(
  @('Lang', 'DATABRIEF_LANG', '', 'lang', "Interface language ($($Langs -join ' '); empty = visitor's choice)"),
  @('PromptLang', 'DATABRIEF_PROMPT_LANG', '', 'promptLang', 'Prompt language (same codes; empty = same as the interface)'),
  @('Mode', 'DATABRIEF_MODE', 'inline', 'mode', 'Give the data to the AI: inline (inside the prompt) or files (separate CSV files)'),
  @('Layout', 'DATABRIEF_LAYOUT', 'auto', 'layout', 'Data layout: auto, table or csv'),
  @('Theme', 'DATABRIEF_THEME', 'system', 'theme', 'Theme: system, light or dark'),
  @('Share', 'DATABRIEF_SHARE', 'yes', 'share', 'Share the data with the AI: yes, or no (Do not share data: the prompt describes the file without its records)'),
  @('SampleRows', 'DATABRIEF_SAMPLE_ROWS', '5', 'sampleRows', 'Sample rows per section in CSV-files mode (1-100)'),
  @('WarnTokens', 'DATABRIEF_WARN_TOKENS', '150000', 'warnTokens', 'Large-file warning above how many tokens'),
  @('Lock', 'DATABRIEF_LOCK', '', 'lock', "Settings to lock, comma-separated ($($Lockable -join ','); empty = none)"),
  @('PromptIntro', 'DATABRIEF_PROMPT_INTRO', '', 'promptIntro', ''),
  @('PromptRespond', 'DATABRIEF_PROMPT_RESPOND', '', 'promptRespond', ''),
  @('PromptRespondFiles', 'DATABRIEF_PROMPT_RESPOND_FILES', '', 'promptRespondFiles', ''),
  @('Address', 'DATABRIEF_HOST', '0.0.0.0', '', 'Address to listen on (0.0.0.0 = whole network, 127.0.0.1 = this computer only)'),
  @('Port', 'DATABRIEF_PORT', '8080', '', 'Port'),
  @('Threads', 'DATABRIEF_THREADS', '8', '', 'Requests served at the same time (threads)'),
  @('BasePath', 'DATABRIEF_BASE_PATH', '/', '', 'URL path, e.g. / or /databrief/'),
  @('AccessLog', 'DATABRIEF_ACCESS_LOG', 'true', '', 'Log every request (true/false)'),
  @('FrameAncestors', 'DATABRIEF_FRAME_ANCESTORS', "'self'", '', "Sites allowed to embed DataBrief in a frame ('self' = none other)"),
  @('Html', 'DATABRIEF_HTML', '', '', '')
)

# ------------------------------------------------------------------ config file ----------
function ConfUnquote([string]$v) {
  $v = $v.Trim()
  if ($v.Length -ge 2 -and $v[0] -eq '"' -and $v[$v.Length - 1] -eq '"') {
    $s = $v.Substring(1, $v.Length - 2)
    return [regex]::Replace($s, '\\(.)', {
      param($m)
      switch -CaseSensitive ($m.Groups[1].Value) { 'n' { "`n" } 't' { "`t" } '"' { '"' } '\' { '\' } default { $m.Value } }
    })
  }
  return $v
}
function ConfQuote([string]$v) {
  if ($v -eq '' -or $v -match '[\s"#\\]') {
    return '"' + $v.Replace('\', '\\').Replace('"', '\"').Replace("`n", '\n').Replace("`t", '\t') + '"'
  }
  return $v
}
function Read-Conf([string]$path) {
  $out = @{}
  foreach ($line in [IO.File]::ReadAllLines($path)) {
    $line = $line.Trim()
    if (-not $line -or $line.StartsWith('#') -or -not $line.Contains('=')) { continue }
    $i = $line.IndexOf('=')
    $out[$line.Substring(0, $i).Trim()] = ConfUnquote $line.Substring($i + 1)
  }
  return $out
}
function Write-Conf([string]$path, [hashtable]$values) {
  $lines = New-Object System.Collections.ArrayList
  if (Test-Path $path) { foreach ($l in [IO.File]::ReadAllLines($path)) { [void]$lines.Add($l) } }
  $done = @{}
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*([A-Z0-9_]+)\s*=' -and $values.ContainsKey($Matches[1])) {
      $lines[$i] = $Matches[1] + '=' + (ConfQuote $values[$Matches[1]])
      $done[$Matches[1]] = $true
    }
  }
  foreach ($k in $values.Keys) { if (-not $done.ContainsKey($k)) { [void]$lines.Add($k + '=' + (ConfQuote $values[$k])) } }
  [IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
}
function Find-First([string[]]$candidates) {
  foreach ($p in $candidates) { if ($p -and (Test-Path -LiteralPath $p -PathType Leaf)) { return (Resolve-Path -LiteralPath $p).Path } }
  return $null
}

# ------------------------------------------------------------------ settings -------------
$confPath = if ($Config) { $Config } else {
  Find-First @($env:DATABRIEF_CONFIG, (Join-Path (Get-Location) 'databrief.conf'), (Join-Path $Here '..\databrief.conf'))
}
$conf = if ($confPath -and (Test-Path $confPath)) { Read-Conf $confPath } else { @{} }
$eff = @{}
foreach ($s in $Settings) {
  $name = $s[0]; $envName = $s[1]
  $envValue = [Environment]::GetEnvironmentVariable($envName)
  if ($PSBoundParameters.ContainsKey($name)) { $eff[$name] = [string]$PSBoundParameters[$name] }
  elseif ($envValue) { $eff[$name] = $envValue }   # an empty variable counts as "not set"
  elseif ($conf.ContainsKey($envName) -and $conf[$envName] -ne '') { $eff[$name] = $conf[$envName] }
  else { $eff[$name] = $s[2] }
}
function Split-List([string]$v) { return @($v.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
function Test-Settings {
  $errors = @()
  foreach ($k in @(@('Lang', 'DATABRIEF_LANG'), @('PromptLang', 'DATABRIEF_PROMPT_LANG'))) {
    if ($eff[$k[0]] -and $Langs -notcontains $eff[$k[0]]) { $errors += "$($k[1]): '$($eff[$k[0]])' is not one of $($Langs -join ' ')" }
  }
  $choices = @{ Mode = @('DATABRIEF_MODE', 'inline', 'files'); Layout = @('DATABRIEF_LAYOUT', 'auto', 'table', 'csv'); Theme = @('DATABRIEF_THEME', 'system', 'light', 'dark'); Share = @('DATABRIEF_SHARE', 'yes', 'no') }
  foreach ($k in $choices.Keys) {
    $allowed = $choices[$k][1..($choices[$k].Count - 1)]
    if ($allowed -notcontains $eff[$k]) { $errors += "$($choices[$k][0]): '$($eff[$k])' must be one of $($allowed -join ', ')" }
  }
  foreach ($r in @(@('SampleRows', 'DATABRIEF_SAMPLE_ROWS', 1, 100), @('WarnTokens', 'DATABRIEF_WARN_TOKENS', 1000, 100000000), @('Port', 'DATABRIEF_PORT', 1, 65535), @('Threads', 'DATABRIEF_THREADS', 1, 1000))) {
    $n = 0
    if (-not [int]::TryParse($eff[$r[0]], [ref]$n) -or $n -lt $r[2] -or $n -gt $r[3]) { $errors += "$($r[1]): '$($eff[$r[0]])' must be a number from $($r[2]) to $($r[3])" }
  }
  $bad = @(Split-List $eff['Lock'] | Where-Object { $Lockable -notcontains $_ })
  if ($bad.Count) { $errors += "DATABRIEF_LOCK: unknown $($bad -join ', ') (allowed: $($Lockable -join ', '))" }
  if (@('true', 'false', '1', '0', 'yes', 'no') -notcontains $eff['AccessLog'].ToLower()) { $errors += 'DATABRIEF_ACCESS_LOG: must be true or false' }
  if (-not $eff['BasePath'].StartsWith('/')) { $errors += 'DATABRIEF_BASE_PATH: must start with /' }
  return , $errors
}

# ------------------------------------------------------------------ setup ----------------
if ($Setup) {
  Write-Host "`nDataBrief setup - press Enter to keep the value in [brackets].`n"
  foreach ($s in $Settings) {
    if (-not $s[4]) { continue }
    while ($true) {
      $ans = Read-Host "$($s[4])`n  [$($eff[$s[0]])]"
      $old = $eff[$s[0]]
      if ($ans) { $eff[$s[0]] = $ans.Trim() }
      $errs = @((Test-Settings) | Where-Object { $_.StartsWith($s[1] + ':') })
      if (-not $errs.Count) { break }
      Write-Host "  ! $($errs[0])"
      $eff[$s[0]] = $old
    }
  }
  Write-Host "`nTip: your team's own prompt text is easiest to write in databrief_set_default.html,"
  Write-Host "     or set DATABRIEF_PROMPT_INTRO / _RESPOND / _RESPOND_FILES in databrief.conf.`n"
  $target = if ($confPath) { $confPath } else { Join-Path (Get-Location) 'databrief.conf' }
  $ans = Read-Host "Save these answers to $target? [Y/n]"
  if (@('', 'y', 'yes', 'o', 'oui') -contains $ans.Trim().ToLower()) {
    $values = @{}
    foreach ($s in $Settings) { if ($s[4]) { $values[$s[1]] = $eff[$s[0]] } }
    Write-Conf $target $values
    Write-Host "Saved to $target`n"
  }
}

$errors = Test-Settings
if ($errors.Count) { foreach ($e in $errors) { Write-Host "Error: $e" -ForegroundColor Red }; exit 2 }

$htmlPath = Find-First @($eff['Html'], (Join-Path (Get-Location) 'databrief.html'), (Join-Path $Here 'databrief.html'), (Join-Path $Here '..\..\databrief.html'))
if (-not $htmlPath) { Write-Host 'Error: databrief.html not found. Use -Html PATH or DATABRIEF_HTML.' -ForegroundColor Red; exit 2 }

# ------------------------------------------------------------------ page -----------------
$pageConfig = [ordered]@{}
foreach ($s in $Settings) {
  $key = $s[3]; if (-not $key) { continue }
  $v = $eff[$s[0]]
  if ($key -eq 'lock') { $list = @(Split-List $v); if ($list.Count) { $pageConfig['lock'] = $list } }
  elseif ($key -eq 'sampleRows' -or $key -eq 'warnTokens') { if ($v -ne $s[2]) { $pageConfig[$key] = [int]$v } }
  elseif ($v -and $v -ne $s[2]) { $pageConfig[$key] = $v }
}
$json = if ($pageConfig.Count) { ($pageConfig | ConvertTo-Json -Depth 4) } else { '{}' }
# "<" -> < so that text from the settings can never close the <script> element.
$json = $json.Replace([string][char]60, ([string][char]92 + 'u003c'))
$utf8 = New-Object Text.UTF8Encoding($false)
$source = [IO.File]::ReadAllText($htmlPath, $utf8)
$block = [regex]'(<script id="databrief-config" type="application/json">)[\s\S]*?(</script>)'
if (-not $block.IsMatch($source)) { Write-Host 'Error: this databrief.html has no settings block: rebuild it with build.ps1.' -ForegroundColor Red; exit 2 }
$pageText = $block.Replace($source, { param($m) $m.Groups[1].Value + "`n" + $json + "`n" + $m.Groups[2].Value }, 1)
if ($Check) { Write-Host "Settings OK. Page config: $(($pageConfig | ConvertTo-Json -Compress -Depth 4))"; exit 0 }
$page = $utf8.GetBytes($pageText)
$ms = New-Object IO.MemoryStream
$gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionMode]::Compress)
$gz.Write($page, 0, $page.Length); $gz.Close()
$pageGz = $ms.ToArray()

# ------------------------------------------------------------------ server ---------------
$base = if ($eff['BasePath'].EndsWith('/')) { $eff['BasePath'] } else { $eff['BasePath'] + '/' }
$log = @('true', '1', 'yes') -contains $eff['AccessLog'].ToLower()
$ip = switch ($eff['Address']) { '0.0.0.0' { [Net.IPAddress]::Any } '::' { [Net.IPAddress]::IPv6Any } default { [Net.IPAddress]::Parse($eff['Address']) } }

# One request per connection (Connection: close), handled by a pool of runspaces.
$handler = {
  param($client, $page, $pageGz, $base, $log, $frame)
  try {
    $client.ReceiveTimeout = 10000
    $stream = $client.GetStream()
    $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 8192, $true)
    $requestLine = $reader.ReadLine()
    if (-not $requestLine) { return }
    $headers = @{}
    while ($true) {
      $l = $reader.ReadLine()
      if ([string]::IsNullOrEmpty($l)) { break }
      $i = $l.IndexOf(':')
      if ($i -gt 0) { $headers[$l.Substring(0, $i).Trim().ToLower()] = $l.Substring($i + 1).Trim() }
    }
    $parts = $requestLine.Split(' ')
    $method = $parts[0]; $url = if ($parts.Count -gt 1) { $parts[1] } else { '/' }
    $path = ($url -split '[?#]')[0]
    $extra = ''
    $type = 'text/plain; charset=utf-8'
    if ($method -ne 'GET' -and $method -ne 'HEAD') { $code = 405; $reason = 'Method Not Allowed'; $body = [Text.Encoding]::ASCII.GetBytes("Method not allowed`n"); $extra = "Allow: GET, HEAD`r`n" }
    elseif ($path -eq '/healthz') { $code = 200; $reason = 'OK'; $body = [Text.Encoding]::ASCII.GetBytes("ok`n"); $extra = "Cache-Control: no-store`r`n" }
    elseif (($path + '/') -eq $base) { $code = 301; $reason = 'Moved Permanently'; $body = New-Object byte[] 0; $extra = "Location: $base$($url.Substring($path.Length))`r`n" }
    elseif ($path -eq $base -or $path -eq ($base + 'index.html') -or $path -eq ($base + 'databrief.html')) {
      $code = 200; $reason = 'OK'; $type = 'text/html; charset=utf-8'
      $extra = "Cache-Control: no-cache`r`nVary: Accept-Encoding`r`n"
      if ($headers['accept-encoding'] -match 'gzip') { $body = $pageGz; $extra += "Content-Encoding: gzip`r`n" } else { $body = $page }
    }
    else { $code = 404; $reason = 'Not Found'; $body = [Text.Encoding]::ASCII.GetBytes("Not found`n") }
    $head = "HTTP/1.1 $code $reason`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nX-Content-Type-Options: nosniff`r`nReferrer-Policy: no-referrer`r`nContent-Security-Policy: frame-ancestors $frame`r`n$($extra)Connection: close`r`n`r`n"
    $hb = [Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($hb, 0, $hb.Length)
    if ($method -ne 'HEAD' -and $body.Length) { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
    if ($log) { [Console]::WriteLine("$($client.Client.RemoteEndPoint) - `"$method $url`" $code") }
  } catch {
  } finally {
    $client.Close()
  }
}

$listener = New-Object Net.Sockets.TcpListener($ip, [int]$eff['Port'])
try { $listener.Start() } catch { Write-Host "Error: cannot listen on $($eff['Address']):$($eff['Port']) - $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
$pool = [runspacefactory]::CreateRunspacePool(1, [int]$eff['Threads'])
$pool.Open()
$jobs = New-Object System.Collections.ArrayList
$shown = if ($eff['Address'] -eq '0.0.0.0' -or $eff['Address'] -eq '::') { 'localhost' } else { $eff['Address'] }
Write-Host "DataBrief is running: http://$($shown):$($eff['Port'])$base"
if ($shown -eq 'localhost') { Write-Host "Team members can use http://$($env:COMPUTERNAME):$($eff['Port'])$base (allow it in the Windows firewall if asked)" }
Write-Host "Settings file: $(if ($confPath) { $confPath } else { 'none' }) - page: $htmlPath - press Ctrl+C to stop"
try {
  while ($true) {
    if ($listener.Pending()) {
      $client = $listener.AcceptTcpClient()
      $ps = [powershell]::Create()
      $ps.RunspacePool = $pool
      [void]$ps.AddScript($handler).AddArgument($client).AddArgument($page).AddArgument($pageGz).AddArgument($base).AddArgument($log).AddArgument($eff['FrameAncestors'])
      [void]$jobs.Add(@{ ps = $ps; handle = $ps.BeginInvoke() })
    } else {
      Start-Sleep -Milliseconds 15
    }
    for ($i = $jobs.Count - 1; $i -ge 0; $i--) {
      if ($jobs[$i].handle.IsCompleted) {
        try { [void]$jobs[$i].ps.EndInvoke($jobs[$i].handle) } catch { }
        $jobs[$i].ps.Dispose()
        $jobs.RemoveAt($i)
      }
    }
  }
} finally {
  $listener.Stop()
  $pool.Close()
  Write-Host "`nStopped."
}
