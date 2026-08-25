param(
    [Parameter(Mandatory = $true)]
    [string]$ZipPath,

    [string]$PluginPath = "C:\Program Files\iiko\iikoRMS\Front.Net\Plugins\Reservly.IikoFrontBridge",

    [string]$SettingsPath = "",

    [switch]$StopPluginHost
)

$ErrorActionPreference = "Stop"

function Unblock-Tree {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (!(Test-Path $Path)) {
        return
    }

    Get-ChildItem -LiteralPath $Path -Recurse -File | ForEach-Object {
        Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $_.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue
    }
}

function Get-BlockedFiles {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (!(Test-Path $Path)) {
        return @()
    }

    return @(
        Get-ChildItem -LiteralPath $Path -Recurse -File | ForEach-Object {
            Get-Item -LiteralPath $_.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue
        }
    )
}

if (!(Test-Path $ZipPath)) {
    throw "Artifact zip not found: $ZipPath"
}

if ($StopPluginHost) {
    Stop-Process -Name "Resto.Front.Api.Host" -Force -ErrorAction SilentlyContinue
}

$zip = (Resolve-Path $ZipPath).Path
Unblock-File -LiteralPath $zip -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $zip -Stream Zone.Identifier -ErrorAction SilentlyContinue

$tempRoot = Join-Path $env:TEMP ("reservly-iiko-front-bridge-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

try {
    Expand-Archive -LiteralPath $zip -DestinationPath $tempRoot -Force
    Unblock-Tree -Path $tempRoot

    $pluginDll = Get-ChildItem -LiteralPath $tempRoot -Recurse -File -Filter "Reservly.IikoFrontBridge.dll" |
        Select-Object -First 1
    if ($null -eq $pluginDll) {
        throw "Reservly.IikoFrontBridge.dll was not found inside artifact zip."
    }

    $sourceDir = $pluginDll.Directory.FullName
    if (!(Test-Path (Join-Path $sourceDir "Manifest.xml"))) {
        throw "Manifest.xml was not found near Reservly.IikoFrontBridge.dll in $sourceDir"
    }

    if (Test-Path $PluginPath) {
        Remove-Item -LiteralPath $PluginPath -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $PluginPath | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceDir "*") -Destination $PluginPath -Recurse -Force

    Get-ChildItem -LiteralPath $PluginPath -Recurse -File | Where-Object {
        $_.Name -in @("System.Text.Json.dll", "System.Runtime.CompilerServices.Unsafe.dll") -or
        $_.Name -like "Resto.Front.Api*.dll"
    } | Remove-Item -Force

    if ($SettingsPath) {
        if (!(Test-Path $SettingsPath)) {
            throw "bridge.settings.json source not found: $SettingsPath"
        }
        Copy-Item -LiteralPath $SettingsPath -Destination (Join-Path $PluginPath "bridge.settings.json") -Force
    }

    if (!(Test-Path (Join-Path $PluginPath "bridge.settings.json"))) {
        Write-Warning "bridge.settings.json is missing. Copy the real config from Reservly admin before starting iikoFront."
    }

    Unblock-Tree -Path $PluginPath
    $blocked = Get-BlockedFiles -Path $PluginPath
    if ($blocked.Count -gt 0) {
        Write-Error "Some files are still blocked by Zone.Identifier:"
        $blocked | ForEach-Object { Write-Error $_.FileName }
        exit 2
    }

    Write-Host "Reservly iikoFront bridge installed to:"
    Write-Host "  $PluginPath"
    Write-Host ""
    Write-Host "Installed files:"
    Get-ChildItem -LiteralPath $PluginPath -File | Sort-Object Name | ForEach-Object {
        Write-Host ("  " + $_.Name)
    }
    Write-Host ""
    Write-Host "No Zone.Identifier streams found."
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
