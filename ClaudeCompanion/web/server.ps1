# Claude Companion app.
# A tiny web server on this PC only (http://localhost:47615). It serves the
# app and reads the game's saved file (ClaudeCompanion.lua) directly, so the
# page updates by itself a few seconds after you Sync in game.
# Nothing is sent anywhere: it only answers this computer.
#
# Daily use: the app is installed from Edge or Chrome as its own app (Start menu, taskbar), and
# this server starts by itself when you sign in to Windows, hidden (a shortcut in your Startup folder).
# "Claude Companion.bat" runs this script once to set that up, restart the server after an update,
# and open the app.
#   server.ps1             set up the Startup shortcut, (re)start the server hidden, open the app
#   server.ps1 -Serve      just serve (what the Startup shortcut runs)
#   server.ps1 -Uninstall  remove the Startup shortcut and stop the server
param([switch]$Serve, [switch]$Uninstall)
$ErrorActionPreference = 'Continue'
$web = Split-Path -Parent $MyInvocation.MyCommand.Path
$forever = (Resolve-Path (Join-Path $web '..\..\..\..')).Path   # ...\_forever_
$accounts = Join-Path $forever 'WTF\Account'
$dataDir = Join-Path (Split-Path -Parent $web) 'companion-data'
$cardsDir = Join-Path $dataDir 'from-claude'
$port = 47615
$prefix = "http://localhost:$port/"
$self = $MyInvocation.MyCommand.Path
$startup = [Environment]::GetFolderPath('Startup')
$autostart = Join-Path $startup 'Claude Companion server.lnk'
$serveArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$self`" -Serve"

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
    # the app as installed from Edge or Chrome has a Start menu shortcut with its name
    $programs = [Environment]::GetFolderPath('Programs')
    $installed = Get-ChildItem -Path $programs -Filter 'Claude Companion.lnk' -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notlike "$startup*" } | Select-Object -First 1
    if ($installed) { Start-Process $installed.FullName; return }
    # not installed yet: Edge (or the default browser), where the page offers to install it as an app
    $edge = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($edge) { Start-Process -FilePath $edge -ArgumentList '--new-window', $prefix } else { Start-Process $prefix }
}

if ($Uninstall) {
    Remove-Item -LiteralPath $autostart -ErrorAction SilentlyContinue
    Stop-Servers
    exit
}
if (-not $Serve) {
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($autostart)
    $lnk.TargetPath = (Join-Path $PSHOME 'powershell.exe')
    $lnk.Arguments = $serveArgs
    $lnk.WorkingDirectory = $web
    $lnk.WindowStyle = 7                                  # minimised; the server then runs hidden
    $lnk.Description = 'Claude Companion: the local app server'
    $lnk.Save()
    Stop-Servers                                          # so an update takes effect
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $serveArgs -WindowStyle Hidden
    for ($i = 0; $i -lt 40 -and -not (Test-Running); $i++) { Start-Sleep -Milliseconds 250 }
    if (Test-Running) { Open-App } else {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show("Claude Companion couldn't start its server on port $port. Is another program using it?", 'Claude Companion')
    }
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

while ($listener.IsListening) {
    try { $ctx = $listener.GetContext() } catch { break }
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
            # look for the save again at most every 30 seconds (or if it vanished)
            if (-not $save -or -not (Test-Path $save.FullName) -or ((Get-Date) - $lastFind).TotalSeconds -gt 30) {
                $save = Find-Save
                $lastFind = Get-Date
            }
            if ($save) { $save.Refresh() }
            if ($path -eq '/api/stamp') {
                $type = 'application/json; charset=utf-8'
                if ($save) {
                    $json = '{"stamp":"' + $save.LastWriteTimeUtc.ToString('o') + '","size":' + $save.Length + '}'
                } else { $json = '{"stamp":null}' }
                $body = [System.Text.Encoding]::UTF8.GetBytes($json)
            } elseif ($save) {
                $body = Read-Shared $save.FullName
                $type = 'application/octet-stream'
            } else { $res.StatusCode = 404; $body = [System.Text.Encoding]::UTF8.GetBytes('no save yet') }
        } elseif (($path -eq '/api/cards' -or $path -eq '/api/cards-state') -and $req.HttpMethod -eq 'GET') {
            # Claude's cards (cards.json, Claude writes it) and what you did with them (state.json, this app writes it)
            $f = Join-Path $cardsDir $(if ($path -eq '/api/cards') { 'cards.json' } else { 'state.json' })
            if (Test-Path $f -PathType Leaf) { $body = Read-Shared $f; $type = 'application/json; charset=utf-8' }
            else { $res.StatusCode = 204; $body = [byte[]]@() }   # none yet
        } elseif (($path -eq '/api/snapshot' -or $path -eq '/api/cards-state') -and $req.HttpMethod -eq 'POST') {
            # the page's summary for Claude (..\companion-data\snapshot.json) and what you did with
            # Claude's cards (..\companion-data\from-claude\state.json); see SCHEMA.md there.
            # Only this app sends the X-CC header; a web page can't add it without the browser asking first.
            if ($req.Headers['X-CC'] -ne '1' -or $req.ContentLength64 -le 0 -or $req.ContentLength64 -gt 20MB) {
                $res.StatusCode = 400; $body = [System.Text.Encoding]::UTF8.GetBytes('bad request')
            } else {
                $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
                $text = $reader.ReadToEnd(); $reader.Close()
                if ($path -eq '/api/snapshot') { $dir = $dataDir; $name = 'snapshot.json' } else { $dir = $cardsDir; $name = 'state.json' }
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
}
