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
$files = @{ '/api/cards' = (Join-Path $cardsDir 'cards.json'); '/api/cards-state' = (Join-Path $cardsDir 'state.json'); '/api/settings' = (Join-Path $dataDir 'settings.json')
            # js/sync.js: this computer's sync key and its copy of the other computers' history
            '/api/sync' = (Join-Path $dataDir 'sync.json'); '/api/sync-cache' = (Join-Path $dataDir 'sync-cache.json')
            # js/combatlog.js: its per-creature counts from the game's combat log
            '/api/combat' = (Join-Path $dataDir 'combat.json') }
$logsDir = Join-Path $forever 'Logs'
$combatLogName = '^WoWCombatLog[A-Za-z0-9_.-]*\.txt\z'
# what the page may write (POST): the snapshot for Claude, plus the files above except Claude's cards
$writable = @{ '/api/snapshot' = (Join-Path $dataDir 'snapshot.json')
               # every card the app has, for a background Claude run to rewrite (js/runner.js)
               '/api/claude-cards' = (Join-Path $dataDir 'claude-run\cards-now.json') }
foreach ($k in $files.Keys) { if ($k -ne '/api/cards') { $writable[$k] = $files[$k] } }
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

# this install's sync device key (js/sync.js), made once, here: one place makes it, so an app window
# and the hidden browser starting at the same moment can't each make their own
function Ensure-SyncKey([string]$f) {
    $st = Read-Json $f
    if ($st -and $st.key -and ([string]$st.key).Length -ge 32) { return }
    $b = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    $key = -join ($b | ForEach-Object { $_.ToString('x2') })
    if ($st) { $st | Add-Member -NotePropertyName key -NotePropertyValue $key -Force } else { $st = [pscustomobject]@{ key = $key } }
    Write-Json $f $st
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
$bgTried = $null; $bgProc = $null; $bgStart = $null; $bgNext = [DateTime]::MinValue; $bgForce = $false
# Has an app window loaded the page since this server started? (same as server.py: a window left open
# through an update runs the old page; until a window loads the new one, the hidden browser runs after
# each save even when a window wrote snapshot.json)
$script:pageLoaded = $false
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
    # a Claude run wrote cards.json: a page has to send it through the gate (Check-ClaudeRun)
    $forced = $script:bgForce; $script:bgForce = $false
    # already tried, or saved under 10 s ago (an open app window writes it within seconds)
    if (-not $forced -and ($stamp -eq $script:bgTried -or ([DateTime]::UtcNow - $s.LastWriteTimeUtc).TotalSeconds -lt 10)) { return }
    $snapFile = Join-Path $dataDir 'snapshot.json'
    $have = if (Test-Path $snapFile) { [regex]::Match([System.IO.File]::ReadAllText($snapFile), '"saveModified":\s*"([^"]*)"').Groups[1].Value } else { '' }
    if (-not $forced -and $script:pageLoaded -and $stamp -eq $have) { return }
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
# is this game client running? (the app says "in game" instead of only "saved N ago"); checked at most every 10 s
$script:gameAt = [DateTime]::MinValue; $script:gameOn = 'null'
function Test-Game {
    if (((Get-Date) - $script:gameAt).TotalSeconds -lt 10) { return $script:gameOn }
    $script:gameAt = Get-Date
    try {
        $hit = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($forever, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
        $script:gameOn = if ($hit) { 'true' } else { 'false' }
    } catch { $script:gameOn = 'null' }
    $script:gameOn
}

function Read-Json([string]$f) { if (Test-Path $f) { try { return (Get-Content -Raw -LiteralPath $f | ConvertFrom-Json) } catch { } }; $null }
function Write-Json([string]$f, $o) {
    $tmp = "$f.tmp"; [System.IO.File]::WriteAllText($tmp, ($o | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $f -Force
}
function Get-UpdCfg {
    # where updates come from: web\channel.json, written by the build; update.json can override
    $c = Read-Json $updCfgFile
    $ch = Read-Json (Join-Path $web 'channel.json')
    $repo = if ($c -and $c.repo) { $c.repo } elseif ($ch -and $ch.repo) { $ch.repo } else { 'saikyr/claude-companion' }
    $auto = if ($c -and $null -ne $c.auto) { [bool]$c.auto } else { $true }
    $tok = if ($c -and $c.token) { $c.token } elseif ($env:CC_GITHUB_TOKEN) { $env:CC_GITHUB_TOKEN } else { $null }
    if (-not $tok) { $gh = Get-Command gh -ErrorAction SilentlyContinue; if ($gh) { try { $t = (& $gh.Source auth token 2>$null); if ($LASTEXITCODE -eq 0 -and $t) { $tok = ([string]$t).Trim() } } catch { } } }
    $api = if ($c -and $c.api) { $c.api } else { 'https://api.github.com' }   # api: only changed for testing
    $branch = if ($c -and $c.branch) { $c.branch } elseif ($ch -and $ch.branch) { $ch.branch } else { 'stable' }
    # the public download folder (latest.json + the zip): no token is ever sent there
    $url = if ($c -and $c.url) { [string]$c.url } elseif ($ch -and $ch.url) { [string]$ch.url } else { $null }
    if ($url) { $tok = $null; if (-not $url.EndsWith('/')) { $url += '/' } }
    @{ repo = $repo; auto = $auto; token = $tok; api = $api; branch = $branch; url = $url }
}
function Invoke-GitHub([string]$url, $cfg, [switch]$Raw) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $rq = [System.Net.HttpWebRequest]::Create($url)
    $rq.UserAgent = 'claude-companion'; $rq.Timeout = 30000
    $rq.Accept = if ($Raw) { '*/*' } else { 'application/vnd.github+json' }   # zipballs answer 415 to application/octet-stream
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
    if ($cfg.url) {
        try {
            $m = Invoke-GitHub "$($cfg.url)latest.json" $cfg
            $name = [string]$m.name; if ($name.Length -gt 120) { $name = $name.Substring(0, 120) }
            $upd.latest = @{ tag = [string]$m.tag; sha = $m.sha; name = $(if ($name) { $name } else { [string]$m.tag }); published = $m.published; notes = [string]$m.name; build = $m.build; zip = "$($cfg.url)$($m.zip)" }
            $upd.error = $null
        } catch {
            $msg = $_.Exception.Message
            if ($msg -match '\((400|404)\)') { $upd.latest = $null; $upd.error = $null; return $null }   # nothing published there yet
            $upd.error = "Could not reach the download folder: $msg"
        }
        return $upd.latest
    }
    try {
        $c = Invoke-GitHub "$($cfg.api)/repos/$($cfg.repo)/commits/$($cfg.branch)" $cfg
        $msg = [string]$c.commit.message; if ($msg.Length -gt 3000) { $msg = $msg.Substring(0, 3000) }
        $first = ($msg -split "`n")[0]; if ($first.Length -gt 120) { $first = $first.Substring(0, 120) }
        $latest = @{ tag = $c.sha.Substring(0, 12); sha = $c.sha; name = $(if ($first) { $first } else { $c.sha.Substring(0, 12) }); published = $c.commit.committer.date; notes = $msg }
        $upd.latest = $latest; $upd.error = $null
    } catch {
        $msg = $_.Exception.Message
        if ($msg -match '\(422\)') { $upd.latest = $null; $upd.error = $null; return $null }   # no build published yet
        $upd.error = if ($msg -match '\((401|403|404)\)') { "GitHub said no ($($Matches[1])). The repository is private: add a token to companion-data\update.json, or sign in with the GitHub CLI (gh auth login)." } else { "Could not reach GitHub: $msg" }
    }
    $upd.latest
}
$gameBuild = @{ key = $null; build = $null }
# which build the app runs (web\channel.json, written by the build) and which the game ran at its last
# save (the addon writes ClaudeCompanionDB.addonBuild): they differ until a /reload in game
function Get-Builds {
    $ch = Read-Json (Join-Path $web 'channel.json')
    $app = if ($ch -and $ch.build) { [string]$ch.build } else { $null }
    $sv = Get-Save
    if ($sv) {
        $key = $sv.FullName + '|' + $sv.LastWriteTimeUtc.Ticks
        if ($gameBuild.key -ne $key) {
            $b = ''   # '': a save from before 1.5
            try { $m = [regex]::Match([System.Text.Encoding]::ASCII.GetString((Read-Shared $sv.FullName)), '\["addonBuild"\]\s*=\s*"([0-9A-Za-z]{1,40})"'); if ($m.Success) { $b = $m.Groups[1].Value } } catch { }
            $gameBuild.key = $key; $gameBuild.build = $b
        }
    }
    @{ app = $app; game = $gameBuild.build }
}
function Get-UpdStatus([switch]$Force) {
    $latest = Check-Update -Force:$Force
    $inst = Read-Json $installedFile
    $cfg = Get-UpdCfg
    @{ installed = $inst; latest = $latest; available = [bool]($latest -and (-not $inst -or $latest.tag -ne $inst.tag)); auto = $cfg.auto; builds = (Get-Builds)
       busy = $false; error = $upd.error; last = $upd.last; checked = $(if ($upd.checked -ne [DateTime]::MinValue) { $upd.checked.ToUniversalTime().ToString('o') } else { $null }) }
}
function Install-Update {
    $work = $null
    try {
        $latest = Check-Update -Force
        if (-not $latest) { return @{ ok = $false; error = $(if ($upd.error) { $upd.error } else { 'No build found.' }) } }
        $cfg = Get-UpdCfg
        $bytes = if ($latest.zip) { Invoke-GitHub $latest.zip $cfg -Raw } else { Invoke-GitHub "$($cfg.api)/repos/$($cfg.repo)/zipball/$($latest.sha)" $cfg -Raw }
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
        if ($latest.build -and $build.build -ne $latest.build) { throw 'the download is a different build than announced; trying again later' }
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
        # copy exactly the build's files (BUILD.json), then remove what an earlier build had and this one
        # doesn't, so no old file lingers; companion-data\ is yours and only its SCHEMA.md is the build's
        $ship = @{}
        foreach ($p in $build.files.PSObject.Properties) { $ship[$p.Name] = $true }
        $copied = 0
        foreach ($rel in $ship.Keys) {
            if ($rel -like 'companion-data/*' -and $rel -ne 'companion-data/SCHEMA.md') { continue }
            $from = Join-Path $src ($rel -replace '/', '\')
            $dest = Join-Path $addonDir ($rel -replace '/', '\')
            $dd = Split-Path -Parent $dest
            if (-not (Test-Path $dd)) { New-Item -ItemType Directory -Path $dd -Force | Out-Null }
            Copy-Item -LiteralPath $from -Destination $dest -Force
            $copied++
        }
        $removed = 0
        $root = [System.IO.Path]::GetFullPath($addonDir).TrimEnd('\')
        foreach ($f in (Get-ChildItem -LiteralPath $root -Recurse -File -Force)) {
            $rel = $f.FullName.Substring($root.Length).TrimStart('\') -replace '\\', '/'
            if ($rel -like 'companion-data/*') { continue }
            if (-not $ship.ContainsKey($rel)) { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue; if (-not (Test-Path -LiteralPath $f.FullName)) { $removed++ } }
        }
        Get-ChildItem -LiteralPath $root -Recurse -Directory -Force | Where-Object { $_.FullName.Substring($root.Length).TrimStart('\') -notlike 'companion-data*' } |
            Sort-Object { $_.FullName.Length } -Descending | Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force) } | Remove-Item -Force -ErrorAction SilentlyContinue
        $info = @{ tag = $latest.tag; sha = $latest.sha; version = $build.version; build = $build.build; at = (Get-Date).ToUniversalTime().ToString('o'); backup = $backup; files = $copied; removed = $removed }
        Write-Json $installedFile $info
        $upd.last = $info
        return @{ ok = $true; tag = $info.tag; at = $info.at; backup = $backup; files = $copied }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message }
    } finally {
        if ($work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
# after an update: let this listener go and start the server again, hidden, on the new code
# ---------------------------------------------------------------- Claude updates the cards (#169, same as server.py)
# Opt-in, per computer. After a save worth it the page posts it (POST /api/claude {action: 'save'}); this server
# starts the player's own Claude Code (signed in with their own Claude plan) hidden in the addon folder: it reads
# the folder, writes only companion-data\from-claude\ (--restricted: no commands, no web), and leaves the whole card
# list in cards.draft.json. When it exits the draft becomes cards.json, which the page sends through the account's
# card gate; a refusal goes back to the same session (--resume), at most twice. One run at a time, RUN_CAP a day.
# Everything it keeps: companion-data\claude-run\ (SCHEMA.md, "Claude updates the cards").
$runDir = Join-Path $dataDir 'claude-run'
$runStateFile = Join-Path $runDir 'state.json'
$runCap = 24; $runTimeout = 900; $runFixes = 2; $runGateWait = 180; $runTurns = 40
$runPrompt = 'The game saved. Follow claude/REFRESH.md exactly.'
$runFix = 'The card check refused your cards (now companion-data/from-claude/cards.json). Read companion-data/claude-run/run.json (refusal), fix exactly what it names, and write the whole list to companion-data/from-claude/cards.draft.json again.'
$runArgs = @('--restricted', '--strict-mcp-config', '--tools', 'Read,Glob,Grep,Write,Edit',
             '--allowedTools', 'Read', 'Glob', 'Grep', 'Edit(./companion-data/from-claude/**)',
             '--permission-mode', 'dontAsk', '--max-turns', "$runTurns", '--output-format', 'json')
# a key in the environment would bill an API account instead of the player's plan (claude -p always uses one)
foreach ($k in @('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN')) { Remove-Item -LiteralPath "Env:$k" -ErrorAction SilentlyContinue }
$run = @{ proc = $null; job = $null; started = [DateTime]::MinValue; queue = $null; gate = $null; signed = $null; signedAt = [DateTime]::MinValue }
$runNext = [DateTime]::MinValue
function Utc-Now { [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'") }
function Write-RunJson([string]$f, $o) {
    $dir = Split-Path -Parent $f
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $tmp = "$f.tmp"; [System.IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $o -Depth 30), (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $f -Force
}
# state.json as a hashtable (its values stay as read)
function Get-RunState {
    $h = @{}; $o = Read-Json $runStateFile
    if ($o) { $o.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value } }
    $h
}
function Find-Claude {
    # CC_CLAUDE: only for tests. The installer puts it in %USERPROFILE%\.local\bin and doesn't change PATH
    foreach ($p in @($env:CC_CLAUDE, ((Get-Command claude -ErrorAction SilentlyContinue | Select-Object -First 1).Source), (Join-Path $env:USERPROFILE '.local\bin\claude.exe'))) {
        if ($p -and (Test-Path -LiteralPath $p -PathType Leaf)) { return $p }
    }
    $null
}
function Test-SignedIn([switch]$Force) {
    $exe = Find-Claude
    if (-not $exe) { return $null }
    if (-not $Force -and ((Get-Date) - $script:run.signedAt).TotalSeconds -lt 60) { return $script:run.signed }
    $ok = $false
    try { $o = (& $exe auth status 2>$null | Out-String); $ok = ($LASTEXITCODE -eq 0) -and [bool](($o | ConvertFrom-Json).loggedIn) } catch { $ok = $false }
    $script:run.signed = $ok; $script:run.signedAt = Get-Date
    $ok
}
function Get-RunStatus([switch]$Check) {
    $st = Get-RunState; $exe = Find-Claude
    $today = $st['today']; $day = (Utc-Now).Substring(0, 10)
    @{ on = [bool]$st['on']; claude = [bool]$exe; signedIn = $(if ($exe) { Test-SignedIn -Force:$Check } else { $null })
       running = $null -ne $script:run.proc; started = $(if ($script:run.proc) { $st['started'] } else { $null })
       queued = $null -ne $script:run.queue; checking = $null -ne $script:run.gate; last = $st['last']
       runs = $(if ($today -and $today.date -eq $day) { [int]$today.n } else { 0 }); cap = $runCap
       digests = $(if ($st['digests']) { $st['digests'] } else { @{} }) }
}
function Test-SyncOff { $o = Read-Json (Join-Path $dataDir 'sync.json'); [bool]($o -and $o.off) }
function Add-RunJob($job) {
    # one run waits at most: a newer save replaces what it carries (the run reads the newest snapshot anyway)
    $q = $script:run.queue
    if ($q -and $q.why -eq 'refused' -and $job.why -ne 'refused') { return }
    $script:run.queue = $job
}
function Quote-Arg([string]$a) { '"' + $a + '"' }
function Start-ClaudeRun($job) {
    $st = Get-RunState
    $last = { param($why) $st['last'] = @{ at = (Utc-Now); ok = $false; why = $job.why; error = $why }; Write-RunJson $runStateFile $st }
    if (-not $st['on']) { return }
    $exe = Find-Claude
    if (-not $exe) { & $last 'Claude Code is not installed on this computer (System tab: Connect)'; return }
    if (Test-SyncOff) { & $last 'sync is off on this computer: the cards are checked online, so turn sync on'; return }
    $day = (Utc-Now).Substring(0, 10)
    $today = if ($st['today'] -and $st['today'].date -eq $day) { @{ date = $day; n = [int]$st['today'].n } } else { @{ date = $day; n = 0 } }
    if ($today.n -ge $runCap -and $job.why -ne 'refused') { & $last "$runCap runs today already: the next one waits for tomorrow (UTC)"; return }
    if (-not (Test-Path $runDir)) { New-Item -ItemType Directory -Path $runDir -Force | Out-Null }
    $draft = Join-Path $cardsDir 'cards.draft.json'
    if ($job.why -ne 'refused' -and (Test-Path -LiteralPath $draft)) { Remove-Item -LiteralPath $draft -Force }
    Write-RunJson (Join-Path $runDir 'run.json') @{ schema = 1; now = (Utc-Now); why = $job.why; wake = $job.wake; refusal = $job.refusal; fix = [int]$job.fixes }
    $all = @($exe, '-p', $(if ($job.resume) { $runFix } else { $runPrompt })) + $runArgs
    if ($job.resume) { $all += @('--resume', $job.resume) }
    $out = Join-Path $runDir 'out.json'; $err = Join-Path $runDir 'err.txt'
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $env:ComSpec
    # cmd only writes the output to the two files; no window (CreateNoWindow)
    $psi.Arguments = '/d /s /c "' + (($all | ForEach-Object { Quote-Arg $_ }) -join ' ') + ' > ' + (Quote-Arg $out) + ' 2> ' + (Quote-Arg $err) + '"'
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.WorkingDirectory = $addonDir
    try { $p = [System.Diagnostics.Process]::Start($psi) } catch { & $last ('Claude Code did not start: ' + $_.Exception.Message); return }
    $today.n++
    $st['today'] = $today; $st['started'] = (Utc-Now)
    Write-RunJson $runStateFile $st
    $script:run.proc = $p; $script:run.job = $job; $script:run.started = Get-Date
}
function Complete-ClaudeRun {
    $p = $script:run.proc; $job = $script:run.job
    $res = Read-Json (Join-Path $runDir 'out.json')
    $err = ''; try { $err = [System.IO.File]::ReadAllText((Join-Path $runDir 'err.txt')) } catch { }
    if ($err.Length -gt 2000) { $err = $err.Substring($err.Length - 2000) }
    $resText = if ($res -and $res.result) { [string]$res.result } else { '' }
    $text = ($resText + ' ' + $err).ToLower()
    $st = Get-RunState
    $last = @{ at = (Utc-Now); started = $st['started']; why = $job.why; code = $p.ExitCode
               session = $(if ($res) { $res.session_id } else { $null }); turns = $(if ($res) { $res.num_turns } else { $null })
               denied = $(if ($res -and $res.permission_denials) { @($res.permission_denials).Count } else { 0 }) }
    $signedOut = $false
    foreach ($x in @('/login', 'not logged in', 'login expired', 'invalid api key', 'oauth token')) { if ($text.Contains($x)) { $signedOut = $true } }
    $draft = Join-Path $cardsDir 'cards.draft.json'; $wrote = $false
    $isError = $res -and $res.is_error
    if ($p.ExitCode -eq 0 -and -not $isError -and (Test-Path -LiteralPath $draft)) {
        try {
            $bytes = [System.IO.File]::ReadAllBytes($draft)
            $d = [System.Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
            if (-not $d -or $null -eq $d.cards) { throw 'no cards list' }
            $target = Join-Path $cardsDir 'cards.json'
            $same = $false
            if (Test-Path -LiteralPath $target) { $same = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($target)) -eq [Convert]::ToBase64String($bytes) }
            Move-Item -LiteralPath $draft -Destination $target -Force
            $wrote = -not $same; $last.cards = @($d.cards).Count
            if ($same) { $last.gate = 'no change' }
        } catch {
            $last.error = "the cards Claude wrote could not be read ($($_.Exception.Message))"
            Move-Item -LiteralPath $draft -Destination (Join-Path $cardsDir 'cards.draft.bad.json') -Force
        }
    } elseif ($p.ExitCode -ne 0 -or $isError) {
        $why = if ($resText) { $resText } else { $err }
        $why = $why.Trim(); if ($why.Length -gt 300) { $why = $why.Substring(0, 300) }
        $last.error = if ($signedOut) { 'signed out of Claude: System tab, Connect' } elseif ($why) { 'Claude stopped: ' + $why } else { "Claude stopped: exit $($p.ExitCode)" }
    }
    $last.ok = -not $last.ContainsKey('error'); $last.wrote = $wrote
    $st['last'] = $last; Write-RunJson $runStateFile $st
    $script:run.proc = $null; $script:run.job = $null
    if ($signedOut) { $script:run.signed = $false; $script:run.signedAt = Get-Date }
    if ($wrote) {
        # the page sends the new file through the gate; no window open: the hidden browser does it
        $script:run.gate = @{ since = $last.at; until = (Get-Date).AddSeconds($runGateWait); session = $last.session; fixes = [int]$job.fixes }
        $script:bgForce = $true
    }
}
function Check-RunGate {
    # how the gate took the new cards.json: from-claude\state.json `upload`, written by the page after the send
    $g = $script:run.gate
    if (-not $g) { return }
    $o = Read-Json (Join-Path $cardsDir 'state.json')
    $up = if ($o) { $o.upload } else { $null }
    $fresh = $up -and ([string]$up.at) -ge $g.since.TrimEnd('Z').Substring(0, 19)
    if (-not $fresh) {
        if ((Get-Date) -gt $g.until) {
            $st = Get-RunState
            if ($st['last']) { $st['last'] | Add-Member -NotePropertyName gate -NotePropertyValue 'not sent yet: it goes with the next sync' -Force; Write-RunJson $runStateFile $st }
            $script:run.gate = $null
        }
        return
    }
    $script:run.gate = $null
    $st = Get-RunState
    $e = [string]$up.error
    $gate = if ($up.ok) { 'ok' } elseif ($up.refused) { 'refused: ' + $(if ($e.Length -gt 500) { $e.Substring(0, 500) } else { $e }) } else { 'not sent: ' + $(if ($e.Length -gt 300) { $e.Substring(0, 300) } else { $e }) }
    if ($st['last']) { $st['last'] | Add-Member -NotePropertyName gate -NotePropertyValue $gate -Force; Write-RunJson $runStateFile $st }
    if ($up.refused -and $g.session -and $g.fixes -lt $runFixes) { Add-RunJob @{ why = 'refused'; refusal = $up.error; resume = $g.session; fixes = $g.fixes + 1 } }
}
function Check-ClaudeRun {
    $p = $script:run.proc
    if ($p) {
        if (-not $p.HasExited) {
            if (((Get-Date) - $script:run.started).TotalSeconds -gt $runTimeout) { & taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null }
            return
        }
        Complete-ClaudeRun
    }
    Check-RunGate
    if ($script:run.queue -and -not $script:run.gate) { $job = $script:run.queue; $script:run.queue = $null; Start-ClaudeRun $job }
}
function Save-RunDigest($b) {
    # the page's news after a save: this character's digest (kept for the next save's change) and whether the
    # change is worth a run (the page wrote every card it has to claude-run\cards-now.json just before)
    $st = Get-RunState
    $name = [string]$b.name; $digest = $b.digest
    if (-not $name -or -not $digest) { return }
    $digests = @{}
    if ($st['digests']) { $st['digests'].PSObject.Properties | ForEach-Object { $digests[$_.Name] = $_.Value } }
    $prev = $digests[$name]
    $pt = if ($prev -and $prev.t) { [double]$prev.t } else { 0 }
    $dt = if ($digest.t) { [double]$digest.t } else { 0 }
    if ($dt -le $pt) { return }   # another window already told this save
    $digests[$name] = $digest; $st['digests'] = $digests; Write-RunJson $runStateFile $st
    if ($b.worth -and $st['on']) { Add-RunJob @{ why = 'save'; wake = $b.wake } }
}
function Connect-Claude {
    # the player's own sign-in, in a window they can see: install Claude Code first if it isn't here
    $exe = Find-Claude
    $login = if ($exe) { "& '" + $exe.Replace("'", "''") + "' auth login" } else { 'irm https://claude.ai/install.ps1 | iex; & (Join-Path $env:USERPROFILE ''.local\bin\claude.exe'') auth login' }
    $cmd = "Write-Host 'Claude Companion: signing in to Claude, for the cards updates.'; " + $login
    $enc = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($cmd))
    Start-Process -FilePath $psExe -ArgumentList @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $enc) | Out-Null
    $script:run.signedAt = [DateTime]::MinValue
    @{ ok = $true }
}
function Invoke-ClaudePost($b) {
    switch ([string]$b.action) {
        'on' { $st = Get-RunState; $st['on'] = $true; Write-RunJson $runStateFile $st }
        'off' { $st = Get-RunState; $st['on'] = $false; Write-RunJson $runStateFile $st }
        'connect' { return (Connect-Claude) }
        'run' { Add-RunJob @{ why = 'asked' } }
        'save' { Save-RunDigest $b }
        default { return $null }
    }
    Get-RunStatus
}

function Restart-Server {
    try { $listener.Stop() } catch { }
    Start-Hidden '-Serve'
    exit
}

$restartAfter = $false
$pending = $listener.GetContextAsync()
while ($listener.IsListening) {
    if ($env:CC_BACKGROUND -ne '0' -and (Get-Date) -ge $bgNext) { try { Check-Background } catch { }; $bgNext = (Get-Date).AddSeconds(5) }   # CC_BACKGROUND=0: tests only
    if ((Get-Date) -ge $runNext) { try { Check-ClaudeRun } catch { }; $runNext = (Get-Date).AddSeconds(2) }
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
                $dev = ',"host":"' + ($env:COMPUTERNAME -replace '[^A-Za-z0-9._-]', '') + '","os":"pc","game":' + (Test-Game) + '}'
                if ($save) {
                    $json = '{"stamp":"' + $save.LastWriteTimeUtc.ToString('o') + '","size":' + $save.Length + $dev
                } else { $json = '{"stamp":null' + $dev }
                $body = [System.Text.Encoding]::UTF8.GetBytes($json)
            } elseif ($save) {
                $body = Read-Shared $save.FullName
                $type = 'application/octet-stream'
            } else { $res.StatusCode = 404; $body = [System.Text.Encoding]::UTF8.GetBytes('no save yet') }
        } elseif ($path -eq '/api/combatlog' -and $req.HttpMethod -eq 'GET') {
            # the game's combat log, read only (same as server.py): no file= lists the logs, newest first;
            # file=<name>&from=<byte> gives up to 4 MB from there. Only the game's own log names, only that folder.
            $q = @{}
            foreach ($kv in $req.Url.Query.TrimStart('?').Split('&')) { $i = $kv.IndexOf('='); if ($i -gt 0) { $q[[Uri]::UnescapeDataString($kv.Substring(0, $i))] = [Uri]::UnescapeDataString($kv.Substring($i + 1)) } }
            $name = $q['file']
            if (-not $name) {
                $type = 'application/json; charset=utf-8'
                $list = @()
                if (Test-Path $logsDir) {
                    $list = @(Get-ChildItem -LiteralPath $logsDir -Filter 'WoWCombatLog*.txt' -File -ErrorAction SilentlyContinue |
                        Where-Object { $_.Name -cmatch $combatLogName } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 20 |
                        ForEach-Object { '{"name":"' + $_.Name + '","size":' + $_.Length + ',"mtime":' + [int64][Math]::Floor(($_.LastWriteTimeUtc - [DateTime]'1970-01-01').TotalSeconds) + '}' })
                }
                $body = [System.Text.Encoding]::UTF8.GetBytes('{"files":[' + ($list -join ',') + ']}')
            } else {
                $from = [int64]0
                $full = Join-Path $logsDir $name
                $fromText = if ($q.ContainsKey('from')) { [string]$q['from'] } else { '0' }
                if (-not [int64]::TryParse($fromText, [ref]$from) -or $from -lt 0) { $res.StatusCode = 400; $body = [System.Text.Encoding]::UTF8.GetBytes('bad from') }
                elseif ($name -cnotmatch $combatLogName -or -not (Test-Path -LiteralPath $full -PathType Leaf)) { $res.StatusCode = 404; $body = [System.Text.Encoding]::UTF8.GetBytes('no such log') }
                else {
                    $fs = [System.IO.File]::Open($full, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                    try {
                        $n = [int][Math]::Max(0, [Math]::Min(4MB, $fs.Length - $from))
                        $buf = New-Object byte[] $n
                        if ($n -gt 0) { [void]$fs.Seek($from, [System.IO.SeekOrigin]::Begin); $read = 0
                            while ($read -lt $n) { $k = $fs.Read($buf, $read, $n - $read); if ($k -le 0) { break }; $read += $k }
                            if ($read -lt $n) { $short = New-Object byte[] $read; [Array]::Copy($buf, $short, $read); $buf = $short } }
                        $body = [byte[]]$buf; $type = 'application/octet-stream'
                    } finally { $fs.Close() }
                }
            }
        } elseif ($path -eq '/api/claude' -and $req.HttpMethod -eq 'GET') {
            # Claude updating the cards in the background: where it stands
            $type = 'application/json; charset=utf-8'
            $body = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject (Get-RunStatus -Check:($req.Url.Query -like '*check=1*')) -Depth 30))
        } elseif ($path -eq '/api/claude' -and $req.HttpMethod -eq 'POST') {
            $type = 'application/json; charset=utf-8'
            $r = $null
            if ($req.Headers['X-CC'] -eq '1' -and $req.ContentLength64 -gt 0 -and $req.ContentLength64 -le 2MB) {
                $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
                $text = $reader.ReadToEnd(); $reader.Close()
                try { $r = Invoke-ClaudePost ($text | ConvertFrom-Json) } catch { $r = $null }
            }
            if ($null -eq $r) { $res.StatusCode = 400; $body = [System.Text.Encoding]::UTF8.GetBytes('bad request') }
            else { $body = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $r -Depth 30)) }
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
            if ($path -eq '/api/sync') { Ensure-SyncKey $f }
            if (Test-Path $f -PathType Leaf) { $body = Read-Shared $f; $type = 'application/json; charset=utf-8' }
            else { $res.StatusCode = 204; $body = [byte[]]@() }   # none yet
        } elseif ($writable.ContainsKey($path) -and $req.HttpMethod -eq 'POST') {
            # the page's summary for Claude (..\companion-data\snapshot.json) and what you did with
            # Claude's cards (..\companion-data\from-claude\state.json); see SCHEMA.md there.
            # Only this app sends the X-CC header; a web page can't add it without the browser asking first.
            if ($req.Headers['X-CC'] -ne '1' -or $req.ContentLength64 -le 0 -or $req.ContentLength64 -gt 20MB) {
                $res.StatusCode = 400; $body = [System.Text.Encoding]::UTF8.GetBytes('bad request')
            } else {
                $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
                $text = $reader.ReadToEnd(); $reader.Close()
                $dir = Split-Path -Parent $writable[$path]; $name = Split-Path -Leaf $writable[$path]
                if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
                $tmp = Join-Path $dir ($name + '.tmp')
                [System.IO.File]::WriteAllText($tmp, $text, (New-Object System.Text.UTF8Encoding($false)))
                Move-Item -LiteralPath $tmp -Destination (Join-Path $dir $name) -Force
                $body = [System.Text.Encoding]::UTF8.GetBytes('ok')
            }
        } else {
            if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
            if ($path -eq '/index.html' -and $req.Url.Query -notmatch 'background=1') { $script:pageLoaded = $true }
            $file = [System.IO.Path]::GetFullPath((Join-Path $webFull ($path.TrimStart('/') -replace '/', '\')))
            # only files inside the app folder, and never the server script itself
            if ($file.StartsWith($webFull.TrimEnd([char]92) + [char]92, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $file -PathType Leaf) -and -not $file.EndsWith('.ps1')) {
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
