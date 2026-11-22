# Claude Companion installer for Windows (run by "Install Claude Companion.bat" from the release zip).
# Finds World of Warcraft's _forever_ folder, copies the addon into Interface\AddOns\ClaudeCompanion,
# then runs the app's own setup (Start menu entry, server at sign-in, opens the app). Run it again to
# repair or reinstall: your data is never touched (the game's WTF folder and the addon's companion-data).
#   -GameDir <path>  the _forever_ folder (or the World of Warcraft folder above it); else it is found
#   -Quiet           no dialogs, don't open the app (for tests); also CC_GAME_DIR / CC_NO_OPEN
param([string]$GameDir = $env:CC_GAME_DIR, [switch]$Quiet)
$ErrorActionPreference = 'Stop'
if ($env:CC_NO_OPEN) { $Quiet = $true }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$payload = Join-Path $here 'ClaudeCompanion'
Add-Type -AssemblyName System.Windows.Forms

function Say([string]$text, [string]$icon = 'Information') {
    if ($Quiet) { Write-Output $text } else { [void][System.Windows.Forms.MessageBox]::Show($text, 'Claude Companion', 'OK', $icon) }
}

if (-not (Test-Path -LiteralPath (Join-Path $payload 'ClaudeCompanion.toc'))) {
    Say "Unzip the download first: right-click the zip, choose Extract All, then open Install Claude Companion in the extracted folder." 'Warning'
    exit 1
}

# a _forever_ folder, given either itself or the World of Warcraft folder that holds it
function Resolve-Forever([string]$d) {
    if (-not $d) { return $null }
    $d = $d.TrimEnd('\')
    if ((Split-Path -Leaf $d) -ieq '_forever_' -and (Test-Path -LiteralPath $d -PathType Container)) { return $d }
    $f = Join-Path $d '_forever_'
    if (Test-Path -LiteralPath $f -PathType Container) { return $f }
    return $null
}

function Find-Forever {
    $c = New-Object System.Collections.Generic.List[string]
    # Blizzard's own registry entry names the World of Warcraft folder (it holds _retail_, _forever_, ...)
    foreach ($k in 'HKLM:\SOFTWARE\WOW6432Node\Blizzard Entertainment\World of Warcraft', 'HKLM:\SOFTWARE\Blizzard Entertainment\World of Warcraft') {
        try {
            $p = [string](Get-ItemProperty -LiteralPath $k -ErrorAction Stop).InstallPath
            if ($p) { $p = $p.TrimEnd('\'); $c.Add($p); $c.Add((Split-Path -Parent $p)) }
        } catch { }
    }
    foreach ($drv in (Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
        $r = $drv.Root
        if ($r -notmatch '^[A-Za-z]:\\$') { continue }
        foreach ($s in 'World of Warcraft', 'Program Files (x86)\World of Warcraft', 'Program Files\World of Warcraft', 'Games\World of Warcraft') { $c.Add((Join-Path $r $s)) }
        # one folder deeper, e.g. C:\WoW Forever\World of Warcraft
        Get-ChildItem -LiteralPath $r -Directory -ErrorAction SilentlyContinue | ForEach-Object { $c.Add((Join-Path $_.FullName 'World of Warcraft')) }
    }
    $hits = @($c | ForEach-Object { Resolve-Forever $_ } | Where-Object { $_ } | Select-Object -Unique)
    # several installs: the one played most recently (its WTF folder changed last)
    $hits | Sort-Object { $w = Join-Path $_ 'WTF'; if (Test-Path -LiteralPath $w) { (Get-Item -LiteralPath $w).LastWriteTimeUtc } else { [DateTime]::MinValue } } -Descending | Select-Object -First 1
}

$forever = Resolve-Forever $GameDir
if (-not $forever -and -not $GameDir) { $forever = Find-Forever }
if (-not $forever) {
    if ($Quiet) { Write-Output "No _forever_ folder found ($GameDir)."; exit 1 }
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = "Choose your World of Warcraft folder (the one that has _forever_ inside)."
    $dlg.ShowNewFolderButton = $false
    while (-not $forever) {
        if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }
        $forever = Resolve-Forever $dlg.SelectedPath
        if (-not $forever) { Say "That folder has no _forever_ folder in it. Choose the World of Warcraft folder that WoW Forever is installed in." 'Warning' }
    }
}

$dest = Join-Path $forever 'Interface\AddOns\ClaudeCompanion'
New-Item -ItemType Directory -Force -Path (Join-Path $dest 'companion-data') | Out-Null

# the build's file list: copy exactly these, and remove what an older install had (never companion-data)
$ship = @{}
foreach ($l in (Get-Content -LiteralPath (Join-Path $here 'FILES.txt'))) { if ($l.Trim()) { $ship[$l.Trim()] = $true } }
foreach ($rel in $ship.Keys) {
    if ($rel -like 'companion-data/*' -and $rel -ne 'companion-data/SCHEMA.md') { continue }
    $to = Join-Path $dest ($rel -replace '/', '\')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
    Copy-Item -LiteralPath (Join-Path $payload ($rel -replace '/', '\')) -Destination $to -Force
}
$root = [System.IO.Path]::GetFullPath($dest).TrimEnd('\')
foreach ($f in (Get-ChildItem -LiteralPath $root -Recurse -File -Force)) {
    $rel = $f.FullName.Substring($root.Length).TrimStart('\') -replace '\\', '/'
    if ($rel -like 'companion-data/*') { continue }
    if (-not $ship.ContainsKey($rel)) { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue }
}
# a file downloaded from the internet carries a "from the web" mark; the copies don't need it
Get-ChildItem -LiteralPath $root -Recurse -File -Force | Unblock-File -ErrorAction SilentlyContinue
# which build this is, so the updater doesn't install the same one again
$info = Join-Path $here 'install-info.json'
if (Test-Path -LiteralPath $info) { Copy-Item -LiteralPath $info -Destination (Join-Path $dest 'companion-data\installed.json') -Force }

if ($Quiet) { Write-Output "Installed into $dest"; exit 0 }
# the app's own setup: Start menu entry, server at sign-in (hidden), and open the app
Start-Process -FilePath (Join-Path $dest 'web\Claude Companion.bat') -WindowStyle Hidden
Say ("Claude Companion is installed in`n$dest`n`n" +
     "The app opens in your browser in a moment, and from now on it's in the Start menu and updates by itself.`n`n" +
     "In game: if WoW Forever is running, type /reload. Then /cc sync saves everything for the app.")
