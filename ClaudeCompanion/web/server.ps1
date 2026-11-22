# Claude Companion app.
# A tiny web server on this PC only (http://localhost:47615). It serves the
# app and reads the game's saved file (ClaudeCompanion.lua) directly, so the
# page updates by itself a few seconds after you Sync in game.
# Nothing is sent anywhere: it only answers this computer.
#
# Daily use: "Claude Companion" in the Start menu (pin it to the taskbar) opens the app in its own
# window. The server starts by itself when you sign in to Windows. Nothing shows a console window:
# both shortcuts run PowerShell through "conhost --headless".
# "Claude Companion.bat" runs this script once to set that up, restart the server after an update,
# and open the app.
#   server.ps1             set up both shortcuts, (re)start the server hidden, open the app
#   server.ps1 -Open       start the server if it isn't running, open the app (the Start menu shortcut)
#   server.ps1 -Serve      just serve (what the Startup shortcut runs)
#   server.ps1 -Uninstall  remove both shortcuts and stop the server
param([switch]$Serve, [switch]$Open, [switch]$Uninstall)
$ErrorActionPreference = 'Continue'
$web = Split-Path -Parent $MyInvocation.MyCommand.Path
$forever = (Resolve-Path (Join-Path $web '..\..\..\..')).Path   # ...\_forever_
$accounts = Join-Path $forever 'WTF\Account'
$dataDir = Join-Path (Split-Path -Parent $web) 'companion-data'
$cardsDir = Join-Path $dataDir 'from-claude'
$port = if ($env:CC_PORT) { [int]$env:CC_PORT } else { 47615 }   # CC_PORT: only for testing a second copy
$files = @{ '/api/cards' = (Join-Path $cardsDir 'cards.json'); '/api/cards-state' = (Join-Path $cardsDir 'state.json'); '/api/settings' = (Join-Path $dataDir 'settings.json') }
$prefix = "http://localhost:$port/"
$self = $MyInvocation.MyCommand.Path
$startup = [Environment]::GetFolderPath('Startup')
$autostart = Join-Path $startup 'Claude Companion server.lnk'
$menuLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'Claude Companion.lnk'
$appIcon = Join-Path $web 'icons\app.ico'
$psExe = Join-Path $PSHOME 'powershell.exe'
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
function Ps-Args([string]$flag) { "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$self`" $flag" }
# "conhost --headless" runs PowerShell with no console window at all (Windows 10 1903 and later);
# without it, a hidden PowerShell still flashes a window for a moment
$headless = Test-Path $conhost
function Start-Hidden([string]$flag) {
    if ($headless) { Start-Process -FilePath $conhost -ArgumentList ('--headless "' + $psExe + '" ' + (Ps-Args $flag)) -WindowStyle Hidden }
    else { Start-Process -FilePath $psExe -ArgumentList (Ps-Args $flag) -WindowStyle Hidden }
}
function Write-Link([string]$path, [string]$flag, [string]$what) {
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($path)
    if ($headless) { $lnk.TargetPath = $conhost; $lnk.Arguments = '--headless "' + $psExe + '" ' + (Ps-Args $flag) }
    else { $lnk.TargetPath = $psExe; $lnk.Arguments = (Ps-Args $flag) }
    $lnk.WorkingDirectory = $web
    $lnk.WindowStyle = 7
    if (Test-Path $appIcon) { $lnk.IconLocation = "$appIcon,0" }
    $lnk.Description = $what
    $lnk.Save()
}

function Test-Running {
    try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri ($prefix + 'api/ping')).Content -eq 'claude-companion' } catch { $false }
}
# every other copy of this server (an older version, or one started some other way)
function Stop-Servers {
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*server.ps1*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
function Open-App {
    # installed from Edge or Chrome as an app ("Install as an app"): that shortcut opens it (it runs
    # the browser with --app-id). Ours, which runs this script, is skipped.
    $sh = New-Object -ComObject WScript.Shell
    $programs = [Environment]::GetFolderPath('Programs')
    $installed = Get-ChildItem -Path $programs -Filter 'Claude Companion*.lnk' -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notlike "$startup*" -and $sh.CreateShortcut($_.FullName).Arguments -like '*--app-id=*' } | Select-Object -First 1
    if ($installed) { Start-Process $installed.FullName; return }
    # otherwise its own window in Edge or Chrome (--app: no tabs or address bar), else the default browser
    $browser = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($browser) { Start-Process -FilePath $browser -ArgumentList "--app=$prefix" } else { Start-Process $prefix }
}
function Wait-Running { for ($i = 0; $i -lt 60 -and -not (Test-Running); $i++) { Start-Sleep -Milliseconds 250 }; Test-Running }
function Show-PortError {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show("Claude Companion couldn't start its server on port $port. Is another program using it?", 'Claude Companion')
}

if ($Uninstall) {
    Remove-Item -LiteralPath $autostart, $menuLink -ErrorAction SilentlyContinue
    Stop-Servers
    exit
}
if ($Open) {
    # the Start menu shortcut: the server normally runs since sign-in; start it if it doesn't
    if (-not (Test-Running)) { Start-Hidden '-Serve' }
    if (Wait-Running) { Open-App } else { Show-PortError }
    exit
}
if (-not $Serve) {
    Write-Link $autostart '-Serve' 'Claude Companion: the local app server'
    Write-Link $menuLink '-Open' 'Claude Companion: your character, gear, AH and grinds'
    Stop-Servers                                          # so an update takes effect
    Start-Hidden '-Serve'
    if (Wait-Running) { Open-App } else { Show-PortError }
    exit
}

function Find-Save {
    Get-ChildItem -Path $accounts -Filter 'ClaudeCompanion.lua' -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Directory.Name -eq 'SavedVariables' } |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
}

function Read-Shared([string]$path) {
    # the game may be writing the file; open it without locking it
    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        $buf = New-Object byte[] $fs.Length
        $read = 0
        while ($read -lt $buf.Length) {
            $n = $fs.Read($buf, $read, $buf.Length - $read)
            if ($n -le 0) { break }
            $read += $n
        }
        return ,$buf   # the comma keeps it a byte array (PowerShell would unroll it)
    } finally { $fs.Close() }
}

# -Serve: already serving? then this copy isn't needed
if (Test-Running) { exit }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() } catch { exit 1 }

$types = @{
    '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
}
$webFull = [System.IO.Path]::GetFullPath($web)
$save = $null
$lastFind = [DateTime]::MinValue
function Get-Save {
    # look for the save again at most every 30 seconds (or if it vanished)
    if (-not $script:save -or -not (Test-Path $script:save.FullName) -or ((Get-Date) - $script:lastFind).TotalSeconds -gt 30) {
        $script:save = Find-Save
        $script:lastFind = Get-Date
    }
    if ($script:save) { $script:save.Refresh() }
    return $script:save
}

# ---------------------------------------------------------------- snapshot in the background (#3)
# snapshot.json is built by the app page (one implementation, js\claude.js). When the game saves and
# no app window wrote a snapshot for that save, a hidden (headless) Edge or Chrome loads the page
# once, which writes it. The page keeps its settings in companion-data\settings.json, so the hidden
# one gives the same gear advice. Same as server.py.
$bgProfile = Join-Path $env:TEMP 'claude-companion-background'
$bgTried = $null; $bgProc = $null; $bgStart = $null; $bgNext = [DateTime]::MinValue
function Find-Browser {
    @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
function Check-Background {
    if ($script:bgProc) {
        if (-not $script:bgProc.HasExited -and ((Get-Date) - $script:bgStart).TotalSeconds -lt 90) { return }
        if (-not $script:bgProc.HasExited) { try { $script:bgProc.Kill() } catch { } }
        $script:bgProc = $null
    }
    $s = Get-Save
    if (-not $s) { return }
    $stamp = $s.LastWriteTimeUtc.ToString('o')
    # already tried, or saved under 10 s ago (an open app window writes it within seconds)
    if ($stamp -eq $script:bgTried -or ([DateTime]::UtcNow - $s.LastWriteTimeUtc).TotalSeconds -lt 10) { return }
    $snapFile = Join-Path $dataDir 'snapshot.json'
    $have = if (Test-Path $snapFile) { [regex]::Match([System.IO.File]::ReadAllText($snapFile), '"saveModified":\s*"([^"]*)"').Groups[1].Value } else { '' }
    if ($stamp -eq $have) { return }
    $script:bgTried = $stamp
    $exe = Find-Browser
    if (-not $exe) { return }
    $script:bgProc = Start-Process -FilePath $exe -WindowStyle Hidden -PassThru -ArgumentList @('--headless=new', '--disable-gpu',
        '--no-first-run', '--no-default-browser-check', '--mute-audio', "--user-data-dir=`"$bgProfile`"", '--virtual-time-budget=20000',
        '--dump-dom', ($prefix + '?background=1'))
    $script:bgStart = Get-Date
}

# ---------------------------------------------------------------- updates (same as server.py)
# Each tested build is pushed to the repository's "stable" branch with BUILD.json (every file's SHA-256).
# Checked every 30 min and when the page asks; installed by itself when "auto" is on (default), or with
# the page's Install button. Every file is checked against BUILD.json before anything is copied.
# Download, check the zip has the whole addon, back up the current addon folder (last 5 kept, in
# %LOCALAPPDATA%\Claude Companion\backups), copy the new files over. Never touched: companion-data\
# (only its SCHEMA.md is updated) and the game's saved data. Then the server restarts on the new code;
# the addon's Lua takes effect at the next /reload in game.
# Private repository: the token comes from companion-data\update.json "token", CC_GITHUB_TOKEN, or `gh auth token`.
$updCfgFile = Join-Path $dataDir 'update.json'
$installedFile = Join-Path $dataDir 'installed.json'
$addonDir = Split-Path -Parent $web
$backupDir = Join-Path $env:LOCALAPPDATA 'Claude Companion\backups'
$upd = @{ checked = [DateTime]::MinValue; latest = $null; error = $null; last = $null }
$updNext = (Get-Date).AddSeconds(60)
function Read-Json([string]$f) { if (Test-Path $f) { try { return (Get-Content -Raw -LiteralPath $f | ConvertFrom-Json) } catch { } }; $null }
function Write-Json([string]$f, $o) {
    $tmp = "$f.tmp"; [System.IO.File]::WriteAllText($tmp, ($o | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $f -Force
}
function Get-UpdCfg {
    $c = Read-Json $updCfgFile
    $repo = if ($c -and $c.repo) { $c.repo } else { 'saikyr/claude-companion' }
    $auto = if ($c -and $null -ne $c.auto) { [bool]$c.auto } else { $true }
    $tok = if ($c -and $c.token) { $c.token } elseif ($env:CC_GITHUB_TOKEN) { $env:CC_GITHUB_TOKEN } else { $null }
    if (-not $tok) { $gh = Get-Command gh -ErrorAction SilentlyContinue; if ($gh) { try { $t = (& $gh.Source auth token 2>$null); if ($LASTEXITCODE -eq 0 -and $t) { $tok = ([string]$t).Trim() } } catch { } } }
    $api = if ($c -and $c.api) { $c.api } else { 'https://api.github.com' }   # api: only changed for testing
    $branch = if ($c -and $c.branch) { $c.branch } else { 'stable' }
    @{ repo = $repo; auto = $auto; token = $tok; api = $api; branch = $branch }
}
function Invoke-GitHub([string]$url, $cfg, [switch]$Raw) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $rq = [System.Net.HttpWebRequest]::Create($url)
    $rq.UserAgent = 'claude-companion'; $rq.Timeout = 30000
    $rq.Accept = if ($Raw) { 'application/octet-stream' } else { 'application/vnd.github+json' }
    if ($cfg.token) { $rq.Headers.Add('Authorization', 'Bearer ' + $cfg.token) }
    $rq.AllowAutoRedirect = $false
    $rs = $rq.GetResponse()
    try {
        if ([int]$rs.StatusCode -ge 300 -and [int]$rs.StatusCode -lt 400) {
            # assets redirect to a signed link, fetched without the token
            $loc = $rs.Headers['Location']; $rs.Close()
            $rq = [System.Net.HttpWebRequest]::Create($loc); $rq.UserAgent = 'claude-companion'; $rq.Timeout = 300000
            $rs = $rq.GetResponse()
        }
        $ms = New-Object System.IO.MemoryStream; $rs.GetResponseStream().CopyTo($ms)
        if ($Raw) { return ,$ms.ToArray() }
        return ([System.Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json)
    } finally { $rs.Close() }
}
function Check-Update([switch]$Force) {
    if (-not $Force -and ((Get-Date) - $upd.checked).TotalMinutes -lt 15) { return $upd.latest }
    $cfg = Get-UpdCfg
    $upd.checked = Get-Date
    try {
        $c = Invoke-GitHub "$($cfg.api)/repos/$($cfg.repo)/commits/$($cfg.branch)" $cfg
        $msg = [string]$c.commit.message; if ($msg.Length -gt 3000) { $msg = $msg.Substring(0, 3000) }
        $first = ($msg -split "`n")[0]; if ($first.Length -gt 120) { $first = $first.Substring(0, 120) }
        $latest = @{ tag = $c.sha.Substring(0, 12); sha = $c.sha; name = $(if ($first) { $first } else { $c.sha.Substring(0, 12) }); published = $c.commit.committer.date; notes = $msg }
        $upd.latest = $latest; $upd.error = $null
    } catch {
        $msg = $_.Exception.Message
        $upd.error = if ($msg -match '\((401|403|404)\)') { "GitHub said no ($($Matches[1])). The repository is private: add a token to companion-data\update.json, or sign in with the GitHub CLI (gh auth login)." } else { "Could not reach GitHub: $msg" }
    }
    $upd.latest
}
function Get-UpdStatus([switch]$Force) {
    $latest = Check-Update -Force:$Force
    $inst = Read-Json $installedFile
    $cfg = Get-UpdCfg
    @{ installed = $inst; latest = $latest; available = [bool]($latest -and (-not $inst -or $latest.tag -ne $inst.tag)); auto = $cfg.auto
       busy = $false; error = $upd.error; last = $upd.last; checked = $(if ($upd.checked -ne [DateTime]::MinValue) { $upd.checked.ToUniversalTime().ToString('o') } else { $null }) }
}
function Install-Update {
    $work = $null
    try {
        $latest = Check-Update -Force
        if (-not $latest) { return @{ ok = $false; error = $(if ($upd.error) { $upd.error } else { 'No build found.' }) } }
        $cfg = Get-UpdCfg
        $bytes = Invoke-GitHub "$($cfg.api)/repos/$($cfg.repo)/zipball/$($latest.sha)" $cfg -Raw
        $work = Join-Path $env:TEMP ('cc-update-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $work | Out-Null
        $zip = Join-Path $work 'release.zip'
        [System.IO.File]::WriteAllBytes($zip, $bytes)
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $x = Join-Path $work 'x'
        $za = [System.IO.Compression.ZipFile]::OpenRead($zip)
        try { foreach ($e in $za.Entries) { $n = $e.FullName -replace '\\', '/'; if ($n.StartsWith('/') -or ($n.Split('/') -contains '..')) { throw "unsafe path in the zip: $n" } } } finally { $za.Dispose() }
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $x)
        $toc = Get-ChildItem -Path $x -Filter 'ClaudeCompanion.toc' -Recurse -File | Select-Object -First 1
        if (-not $toc) { throw 'the build has no ClaudeCompanion.toc' }
        $src = $toc.DirectoryName
        $missing = @('ClaudeCompanion.toc', 'Core.lua', 'Journal.lua', 'web\index.html', 'web\js\app.js', 'web\server.py', 'web\server.ps1') | Where-Object { -not (Test-Path (Join-Path $src $_)) }
        if ($missing) { throw ('the build is missing ' + ($missing -join ', ')) }
        # every file must match BUILD.json (next to the ClaudeCompanion folder): a broken download installs nothing
        $build = Read-Json (Join-Path (Split-Path -Parent $src) 'BUILD.json')
        if (-not $build -or -not $build.files) { throw 'the build has no BUILD.json' }
        $sha = [System.Security.Cryptography.SHA256]::Create()
        foreach ($p in $build.files.PSObject.Properties) {
            $fp = Join-Path $src ($p.Name -replace '/', '\')
            if (-not (Test-Path -LiteralPath $fp)) { throw "the build is missing $($p.Name)" }
            $h = -join ($sha.ComputeHash([System.IO.File]::ReadAllBytes($fp)) | ForEach-Object { $_.ToString('x2') })
            if ($h -ne $p.Value) { throw "checksum mismatch: $($p.Name)" }
        }
        # back up the current addon (without companion-data, which is never overwritten anyway)
        $backup = Join-Path $backupDir ('ClaudeCompanion-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        New-Item -ItemType Directory -Path $backup -Force | Out-Null
        Get-ChildItem -LiteralPath $addonDir -Force | Where-Object { $_.Name -ne 'companion-data' } | Copy-Item -Destination $backup -Recurse -Force
        Get-ChildItem -LiteralPath $backupDir -Directory | Where-Object { $_.Name -like 'ClaudeCompanion-*' } | Sort-Object Name | Select-Object -SkipLast 5 | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        $copied = 0
        foreach ($f in (Get-ChildItem -LiteralPath $src -Recurse -File)) {
            $rel = $f.FullName.Substring($src.Length).TrimStart('\')
            if ($rel -like 'companion-data\*' -and $rel -ne 'companion-data\SCHEMA.md') { continue }
            $dest = Join-Path $addonDir $rel
            $dd = Split-Path -Parent $dest
            if (-not (Test-Path $dd)) { New-Item -ItemType Directory -Path $dd -Force | Out-Null }
            Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
            $copied++
        }
        $info = @{ tag = $latest.tag; sha = $latest.sha; version = $build.version; at = (Get-Date).ToUniversalTime().ToString('o'); backup = $backup; files = $copied }
        Write-Json $installedFile $info
        $upd.last = $info
        return @{ ok = $true; tag = $info.tag; at = $info.at; backup = $backup; files = $copied }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message }
    } finally {
        if ($work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
# ---------------------------------------------------------------- one character on every computer (same as server.py)
# Each computer publishes its save to a branch of the private repository (sync/<computer>: one commit,
# no parent, with save.lua.gz, meta.json and settings.json), and downloads the others' into
# companion-data\devices\<computer>\. The page merges them (js\merge.js). Saves are never written.
# Settings follow the computer where they changed last (the replaced file is kept as settings.json.bak).
# Off: "sync": false in companion-data\update.json.
$devicesDir = Join-Path $dataDir 'devices'
$devId = (($env:COMPUTERNAME.ToLower() -replace '[^a-z0-9-]+', '-').Trim('-')); if (-not $devId) { $devId = 'computer' }
if ($env:CC_DEVICE) { $devId = $env:CC_DEVICE }   # tests only
$syncSecs = if ($env:CC_SYNC_SECS) { [double]$env:CC_SYNC_SECS } else { 15 }   # tests only: how often to look
$sync = @{ pushed = $null; lastPush = $null; lastPull = $null; error = $null; nextPull = [DateTime]::MinValue; next = (Get-Date).AddSeconds(5) }
function Send-GitHub([string]$method, [string]$url, $cfg, $body) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $rq = [System.Net.HttpWebRequest]::Create($url)
    $rq.Method = $method; $rq.UserAgent = 'claude-companion'; $rq.Accept = 'application/vnd.github+json'; $rq.ContentType = 'application/json'; $rq.Timeout = 60000
    if ($cfg.token) { $rq.Headers.Add('Authorization', 'Bearer ' + $cfg.token) }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 6 -Compress))
    $rq.ContentLength = $bytes.Length
    $st = $rq.GetRequestStream(); $st.Write($bytes, 0, $bytes.Length); $st.Close()
    $rs = $rq.GetResponse()
    try { $sr = New-Object System.IO.StreamReader($rs.GetResponseStream()); return ($sr.ReadToEnd() | ConvertFrom-Json) } finally { $rs.Close() }
}
function Get-GitHubRaw([string]$url, $cfg) {
    $rq = [System.Net.HttpWebRequest]::Create($url)
    $rq.UserAgent = 'claude-companion'; $rq.Accept = 'application/vnd.github.raw'; $rq.Timeout = 120000
    if ($cfg.token) { $rq.Headers.Add('Authorization', 'Bearer ' + $cfg.token) }
    $rs = $rq.GetResponse()
    try { $ms = New-Object System.IO.MemoryStream; $rs.GetResponseStream().CopyTo($ms); return ,$ms.ToArray() } finally { $rs.Close() }
}
function Get-Sha256([byte[]]$b) { -join ([System.Security.Cryptography.SHA256]::Create().ComputeHash($b) | ForEach-Object { $_.ToString('x2') }) }
function Push-Save($save, $cfg) {
    $base = "$($cfg.api)/repos/$($cfg.repo)/git"
    $raw = Read-Shared $save.FullName
    $ms = New-Object System.IO.MemoryStream
    $gz = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionMode]::Compress)
    $gz.Write($raw, 0, $raw.Length); $gz.Close()
    $meta = [ordered]@{ device = $devId; host = $env:COMPUTERNAME; os = 'pc'; saveModified = $save.LastWriteTimeUtc.ToString('o'); uploaded = (Get-Date).ToUniversalTime().ToString('o'); sha256 = (Get-Sha256 $raw); size = $raw.Length }
    $entries = @(@{ path = 'save.lua.gz'; content = [Convert]::ToBase64String($ms.ToArray()); encoding = 'base64' })
    $sfile = Join-Path $dataDir 'settings.json'
    if (Test-Path $sfile) {
        $meta.settingsModified = (Get-Item $sfile).LastWriteTimeUtc.ToString('o')
        $entries += @{ path = 'settings.json'; content = [System.IO.File]::ReadAllText($sfile); encoding = 'utf-8' }
    }
    $entries += @{ path = 'meta.json'; content = ($meta | ConvertTo-Json); encoding = 'utf-8' }
    $tree = @()
    foreach ($e in $entries) {
        $b = Send-GitHub 'POST' "$base/blobs" $cfg @{ content = $e.content; encoding = $e.encoding }
        $tree += @{ path = $e.path; mode = '100644'; type = 'blob'; sha = $b.sha }
    }
    $t = Send-GitHub 'POST' "$base/trees" $cfg @{ tree = $tree }
    $c = Send-GitHub 'POST' "$base/commits" $cfg @{ message = "$($devId): save of $($meta.saveModified)"; tree = $t.sha; parents = @() }
    try { [void](Send-GitHub 'PATCH' "$base/refs/heads/sync/$devId" $cfg @{ sha = $c.sha; force = $true }) }
    catch { [void](Send-GitHub 'POST' "$base/refs" $cfg @{ ref = "refs/heads/sync/$devId"; sha = $c.sha }) }
}
function Pull-Peers($cfg) {
    $base = "$($cfg.api)/repos/$($cfg.repo)/git"
    try { $refs = Invoke-GitHub "$base/matching-refs/heads/sync/" $cfg } catch { if ($_.Exception.Message -match '\(404\)') { return }; throw }
    foreach ($r in @($refs)) {
        $dev = ($r.ref -split '/')[-1]
        if ($dev -eq $devId -or $dev -notmatch '^[a-z0-9-]+$') { continue }
        $folder = Join-Path $devicesDir $dev
        $have = Read-Json (Join-Path $folder 'meta.json')
        if ($have -and $have.commit -eq $r.object.sha) { continue }
        $commit = Invoke-GitHub "$base/commits/$($r.object.sha)" $cfg
        $tree = @{}; foreach ($e in @((Invoke-GitHub "$base/trees/$($commit.tree.sha)" $cfg).tree)) { $tree[$e.path] = $e.sha }
        if (-not $tree['save.lua.gz'] -or -not $tree['meta.json']) { continue }
        $meta = [System.Text.Encoding]::UTF8.GetString((Get-GitHubRaw "$base/blobs/$($tree['meta.json'])" $cfg)) | ConvertFrom-Json
        $gzb = Get-GitHubRaw "$base/blobs/$($tree['save.lua.gz'])" $cfg
        $in = New-Object System.IO.Compression.GZipStream((New-Object System.IO.MemoryStream(,$gzb)), [System.IO.Compression.CompressionMode]::Decompress)
        $out = New-Object System.IO.MemoryStream; $in.CopyTo($out); $in.Close()
        $raw = $out.ToArray()
        if ((Get-Sha256 $raw) -ne $meta.sha256) { throw "$($dev): the save arrived damaged" }
        if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
        [System.IO.File]::WriteAllBytes((Join-Path $folder 'save.lua.tmp'), $raw)
        Move-Item -LiteralPath (Join-Path $folder 'save.lua.tmp') -Destination (Join-Path $folder 'save.lua') -Force
        # settings: the computer where they changed last wins; the replaced file is kept as .bak
        $mine = Join-Path $dataDir 'settings.json'
        if ($tree['settings.json'] -and $meta.settingsModified) {
            $mineT = if (Test-Path $mine) { (Get-Item $mine).LastWriteTimeUtc } else { [DateTime]::MinValue }
            if ([DateTime]::Parse($meta.settingsModified).ToUniversalTime() -gt $mineT) {
                $body = Get-GitHubRaw "$base/blobs/$($tree['settings.json'])" $cfg
                [void]([System.Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json)
                if (Test-Path $mine) { Copy-Item -LiteralPath $mine -Destination "$mine.bak" -Force }
                [System.IO.File]::WriteAllBytes("$mine.tmp", $body); Move-Item -LiteralPath "$mine.tmp" -Destination $mine -Force
            }
        }
        $h = @{}; $meta.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value }
        $h.commit = $r.object.sha; $h.downloaded = (Get-Date).ToUniversalTime().ToString('o')
        Write-Json (Join-Path $folder 'meta.json') $h
    }
}
function Get-Peers {
    $out = @()
    if (Test-Path $devicesDir) {
        foreach ($d in (Get-ChildItem -LiteralPath $devicesDir -Directory)) {
            $m = Read-Json (Join-Path $d.FullName 'meta.json')
            if ($m -and (Test-Path (Join-Path $d.FullName 'save.lua'))) { $out += @{ device = $m.device; host = $m.host; os = $m.os; saveModified = $m.saveModified; uploaded = $m.uploaded; downloaded = $m.downloaded } }
        }
    }
    ,$out
}
function Step-Sync {
    $cfg = Get-UpdCfg
    $c = Read-Json $updCfgFile
    if ($c -and $c.PSObject.Properties['sync'] -and -not $c.sync) { return }
    try {
        $s = Get-Save
        $state = Join-Path $devicesDir '.pushed'
        if ($s -and ([DateTime]::UtcNow - $s.LastWriteTimeUtc).TotalSeconds -gt 10) {
            $stamp = $s.LastWriteTimeUtc.ToString('o')
            if (-not $sync.pushed -and (Test-Path $state)) { $sync.pushed = (Get-Content -Raw -LiteralPath $state).Trim() }
            if ($stamp -ne $sync.pushed) {
                Push-Save $s $cfg
                if (-not (Test-Path $devicesDir)) { New-Item -ItemType Directory -Path $devicesDir -Force | Out-Null }
                [System.IO.File]::WriteAllText($state, $stamp)
                $sync.pushed = $stamp; $sync.lastPush = (Get-Date).ToUniversalTime().ToString('o')
            }
        }
        if ((Get-Date) -ge $sync.nextPull) {
            $sync.nextPull = (Get-Date).AddSeconds($syncSecs * 4)
            Pull-Peers $cfg
            $sync.lastPull = (Get-Date).ToUniversalTime().ToString('o')
        }
        $sync.error = $null
    } catch { $sync.error = $_.Exception.Message }
}

# after an update: let this listener go and start the server again, hidden, on the new code
function Restart-Server {
    try { $listener.Stop() } catch { }
    Start-Hidden '-Serve'
    exit
}

$restartAfter = $false
$pending = $listener.GetContextAsync()
while ($listener.IsListening) {
    if ((Get-Date) -ge $bgNext) { try { Check-Background } catch { }; $bgNext = (Get-Date).AddSeconds(5) }
    if ((Get-Date) -ge $sync.next) { $sync.next = (Get-Date).AddSeconds($syncSecs); Step-Sync }
    if ((Get-Date) -ge $updNext) {
        $updNext = (Get-Date).AddMinutes(30)
        try { $st = Get-UpdStatus; if ($st.available -and $st.auto) { $r = Install-Update; if ($r.ok) { Restart-Server } } } catch { }
    }
    if (-not $pending.AsyncWaitHandle.WaitOne(5000)) { continue }
    try { $ctx = $pending.GetAwaiter().GetResult() } catch { break }
    $pending = $listener.GetContextAsync()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
        $res.Headers.Add('Cache-Control', 'no-store')
        $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
        $body = $null
        $type = 'text/plain; charset=utf-8'
        if ($path -eq '/api/ping') {
            $body = [System.Text.Encoding]::UTF8.GetBytes('claude-companion')
        } elseif ($path -eq '/api/stamp' -or $path -eq '/api/data') {
            $save = Get-Save
            if ($path -eq '/api/stamp') {
                $type = 'application/json; charset=utf-8'
                $peerStamp = ((Get-Peers) | ForEach-Object { "$($_.device):$($_.saveModified)" }) -join '|'
                $dev = ',"host":"' + ($env:COMPUTERNAME -replace '[^A-Za-z0-9._-]', '') + '","os":"pc","device":"' + $devId + '","peers":"' + ($peerStamp -replace '"', '') + '"}'
                if ($save) {
                    $json = '{"stamp":"' + $save.LastWriteTimeUtc.ToString('o') + '","size":' + $save.Length + $dev
                } else { $json = '{"stamp":null' + $dev }
                $body = [System.Text.Encoding]::UTF8.GetBytes($json)
            } elseif ($save) {
                $body = Read-Shared $save.FullName
                $type = 'application/octet-stream'
            } else { $res.StatusCode = 404; $body = [System.Text.Encoding]::UTF8.GetBytes('no save yet') }
        } elseif ($path -eq '/api/devices') {
            $type = 'application/json; charset=utf-8'
            $enabled = $true; $c = Read-Json $updCfgFile; if ($c -and $c.PSObject.Properties['sync'] -and -not $c.sync) { $enabled = $false }
            $body = [System.Text.Encoding]::UTF8.GetBytes((@{ here = $devId; enabled = $enabled; peers = (Get-Peers); lastPush = $sync.lastPush; lastPull = $sync.lastPull; error = $sync.error } | ConvertTo-Json -Depth 5))
        } elseif ($path -eq '/api/device-data') {
            $dev = [string]$req.QueryString['dev']
            $f = Join-Path (Join-Path $devicesDir $dev) 'save.lua'
            if ($dev -match '^[a-z0-9-]+$' -and (Test-Path $f)) { $body = Read-Shared $f; $type = 'application/octet-stream' }
            else { $res.StatusCode = 404; $body = [System.Text.Encoding]::UTF8.GetBytes('no such computer') }
        } elseif ($path -eq '/api/update' -and $req.HttpMethod -eq 'GET') {
            $type = 'application/json; charset=utf-8'
            $body = [System.Text.Encoding]::UTF8.GetBytes((Get-UpdStatus -Force:($req.Url.Query -like '*force=1*') | ConvertTo-Json -Depth 5))
        } elseif (($path -eq '/api/update' -or $path -eq '/api/update-auto') -and $req.HttpMethod -eq 'POST') {
            $type = 'application/json; charset=utf-8'
            if ($req.Headers['X-CC'] -ne '1') { $res.StatusCode = 400; $body = [System.Text.Encoding]::UTF8.GetBytes('bad request') }
            elseif ($path -eq '/api/update-auto') {
                $c = Read-Json $updCfgFile
                $h = @{}; if ($c) { $c.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value } }
                $h.auto = ($req.Url.Query -like '*on=1*')
                if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
                Write-Json $updCfgFile $h
                $body = [System.Text.Encoding]::UTF8.GetBytes((Get-UpdStatus | ConvertTo-Json -Depth 5))
            } else {
                $r = Install-Update
                $body = [System.Text.Encoding]::UTF8.GetBytes(($r | ConvertTo-Json -Depth 5))
                if ($r.ok) { $restartAfter = $true }
            }
        } elseif ($files.ContainsKey($path) -and $req.HttpMethod -eq 'GET') {
            # Claude's cards (cards.json, Claude writes it), what you did with them (state.json) and the app's settings
            $f = $files[$path]
            if (Test-Path $f -PathType Leaf) { $body = Read-Shared $f; $type = 'application/json; charset=utf-8' }
            else { $res.StatusCode = 204; $body = [byte[]]@() }   # none yet
        } elseif (($path -eq '/api/snapshot' -or $path -eq '/api/cards-state' -or $path -eq '/api/settings') -and $req.HttpMethod -eq 'POST') {
            # the page's summary for Claude (..\companion-data\snapshot.json) and what you did with
            # Claude's cards (..\companion-data\from-claude\state.json); see SCHEMA.md there.
            # Only this app sends the X-CC header; a web page can't add it without the browser asking first.
            if ($req.Headers['X-CC'] -ne '1' -or $req.ContentLength64 -le 0 -or $req.ContentLength64 -gt 20MB) {
                $res.StatusCode = 400; $body = [System.Text.Encoding]::UTF8.GetBytes('bad request')
            } else {
                $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
                $text = $reader.ReadToEnd(); $reader.Close()
                if ($path -eq '/api/snapshot') { $dir = $dataDir; $name = 'snapshot.json' }
                elseif ($path -eq '/api/settings') { $dir = $dataDir; $name = 'settings.json' }
                else { $dir = $cardsDir; $name = 'state.json' }
                if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
                $tmp = Join-Path $dir ($name + '.tmp')
                [System.IO.File]::WriteAllText($tmp, $text, (New-Object System.Text.UTF8Encoding($false)))
                Move-Item -LiteralPath $tmp -Destination (Join-Path $dir $name) -Force
                $body = [System.Text.Encoding]::UTF8.GetBytes('ok')
            }
        } else {
            if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
            $file = [System.IO.Path]::GetFullPath((Join-Path $webFull ($path.TrimStart('/') -replace '/', '\')))
            # only files inside the app folder, and never the server script itself
            if ($file.StartsWith($webFull, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $file -PathType Leaf) -and -not $file.EndsWith('.ps1')) {
                $body = [System.IO.File]::ReadAllBytes($file)
                $ext = [System.IO.Path]::GetExtension($file).ToLower()
                if ($types.ContainsKey($ext)) { $type = $types[$ext] }
            } else { $res.StatusCode = 404; $body = [System.Text.Encoding]::UTF8.GetBytes('not found') }
        }
        $res.ContentType = $type
        $res.ContentLength64 = $body.Length
        $res.OutputStream.Write($body, 0, $body.Length)
    } catch {
        try { $res.StatusCode = 500 } catch { }
    } finally {
        try { $res.OutputStream.Close() } catch { }
    }
    if ($restartAfter) { Start-Sleep -Milliseconds 300; Restart-Server }
}
