# Claude Companion app.
# A tiny web server on this PC only (http://localhost:47615). It serves the
# app and reads the game's saved file (ClaudeCompanion.lua) directly, so the
# page updates by itself a few seconds after you Sync in game.
# Nothing is sent anywhere: it only answers this computer.
$ErrorActionPreference = 'Continue'
$web = Split-Path -Parent $MyInvocation.MyCommand.Path
$forever = (Resolve-Path (Join-Path $web '..\..\..\..')).Path   # ...\_forever_
$accounts = Join-Path $forever 'WTF\Account'
$port = 47615
$prefix = "http://localhost:$port/"
$host.UI.RawUI.WindowTitle = 'Claude Companion (close this window to stop)'

# The app window opens at a comfortable size for this screen and can be resized
# freely; the page lays itself out for whatever size it gets.
Add-Type -AssemblyName System.Windows.Forms

function Open-App {
    $edge = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $edge) { Start-Process $prefix; return }
    # 85% of the screen's free area, centred
    $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $w = [int]($wa.Width * 0.85); $h = [int]($wa.Height * 0.9)
    $x = $wa.X + [int](($wa.Width - $w) / 2); $y = $wa.Y + [int](($wa.Height - $h) / 2)
    Start-Process -FilePath $edge -ArgumentList "--app=$prefix", "--window-size=$w,$h", "--window-position=$x,$y"
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

# Fallback if the server can't start: the old way (copy the save next to
# the page as data.js every few seconds and open the page as a file).
function Run-FileMode {
    Write-Host '  Could not start the local server, using file mode instead.' -ForegroundColor Yellow
    $out = Join-Path $web 'data.js'
    Start-Process (Join-Path $web 'index.html')
    $lastWrite = $null
    while ($true) {
        $file = Find-Save
        if ($file -and $file.LastWriteTimeUtc -ne $lastWrite) {
            Start-Sleep -Milliseconds 1500
            $file.Refresh()
            try {
                $bytes = Read-Shared $file.FullName
                $b64 = [Convert]::ToBase64String($bytes)
                $stamp = $file.LastWriteTimeUtc.ToString('o')
                [System.IO.File]::WriteAllText($out, "window.CC_DATA = { written: '$stamp', size: $($bytes.Length), b64: '$b64' };", (New-Object System.Text.UTF8Encoding($false)))
                $lastWrite = $file.LastWriteTimeUtc
                Write-Host ("  {0}  page updated" -f (Get-Date -Format 'HH:mm:ss'))
            } catch { }
        }
        Start-Sleep -Seconds 3
    }
}

# Already running? Then just open another window.
try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri ($prefix + 'api/ping')
    if ($r.Content -eq 'claude-companion') { Open-App; exit }
} catch { }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() } catch { Run-FileMode; exit }

Write-Host ''
Write-Host '  Claude Companion is running.' -ForegroundColor Cyan
Write-Host "  App: $prefix"
Write-Host '  Leave this window open (it can stay minimised). Close it to stop.'
Write-Host ''
Open-App

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
        } elseif ($path -eq '/api/snapshot' -and $req.HttpMethod -eq 'POST') {
            # the page's summary for Claude: saved as ..\companion-data\snapshot.json (see SCHEMA.md there).
            # Only this app sends the X-CC header; a web page can't add it without the browser asking first.
            if ($req.Headers['X-CC'] -ne '1' -or $req.ContentLength64 -le 0 -or $req.ContentLength64 -gt 20MB) {
                $res.StatusCode = 400; $body = [System.Text.Encoding]::UTF8.GetBytes('bad request')
            } else {
                $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
                $text = $reader.ReadToEnd(); $reader.Close()
                $dir = Join-Path (Split-Path -Parent $web) 'companion-data'
                if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
                $tmp = Join-Path $dir 'snapshot.json.tmp'
                [System.IO.File]::WriteAllText($tmp, $text, (New-Object System.Text.UTF8Encoding($false)))
                Move-Item -LiteralPath $tmp -Destination (Join-Path $dir 'snapshot.json') -Force
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
