param(
  [string]$SiteUrl = "https://myspot-web.netlify.app",
  [string]$Route = "#/radio"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$python = "C:\Users\lucyl\AppData\Local\Programs\Python\Python311\python.exe"
$logDir = Join-Path $root "data\public"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$tunnelOut = Join-Path $logDir "cloudflared.out.log"
$tunnelErr = Join-Path $logDir "cloudflared.err.log"
Remove-Item -LiteralPath $tunnelOut, $tunnelErr -Force -ErrorAction SilentlyContinue

$staleTunnels = Get-CimInstance Win32_Process -Filter "name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*tunnel*--url*127.0.0.1:7777*" -or $_.CommandLine -like "*tunnel*--url*http://127.0.0.1:7777*" }
foreach ($proc in $staleTunnels) {
  Write-Host "Stopping stale myspot Cloudflare tunnel process $($proc.ProcessId)..."
  Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "========================================="
Write-Host " myspot public"
Write-Host " Netlify UI: $SiteUrl"
Write-Host " Local API:  http://127.0.0.1:7777"
Write-Host "========================================="
Write-Host ""

try {
  $tunnel = Start-Process -FilePath "cloudflared" `
    -ArgumentList @("tunnel", "--url", "http://127.0.0.1:7777") `
    -RedirectStandardOutput $tunnelOut `
    -RedirectStandardError $tunnelErr `
    -PassThru `
    -WindowStyle Hidden
} catch {
  Write-Host "cloudflared could not start. Install it or use the backend URL gear in the Netlify UI."
  throw
}

$backend = $null
$existingBackend = Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existingBackend) {
  Write-Host "Using existing local backend process $($existingBackend.OwningProcess) on port 7777."
} else {
  $backend = Start-Process -FilePath $python `
    -ArgumentList @("-m", "backend.app") `
    -WorkingDirectory $root `
    -PassThru
  Write-Host "Started local backend process $($backend.Id)."
}

try {
  Write-Host "Waiting for Cloudflare tunnel URL..."
  $publicUrl = $null
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline -and -not $publicUrl) {
    Start-Sleep -Milliseconds 700
    $text = ""
    if (Test-Path $tunnelOut) { $text += Get-Content -LiteralPath $tunnelOut -Raw -ErrorAction SilentlyContinue }
    if (Test-Path $tunnelErr) { $text += Get-Content -LiteralPath $tunnelErr -Raw -ErrorAction SilentlyContinue }
    $match = [regex]::Match($text, "https://[-a-z0-9]+\.trycloudflare\.com")
    if ($match.Success) { $publicUrl = $match.Value }
  }

  if ($publicUrl) {
    Write-Host "Public API: $publicUrl"
    Write-Host "Waiting for tunnel health..."
    $healthy = $false
    $healthDeadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $healthDeadline -and -not $healthy) {
      Start-Sleep -Seconds 2
      try {
        $resp = Invoke-WebRequest -Uri "$publicUrl/api/health" -UseBasicParsing -TimeoutSec 8
        $healthy = $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500
      } catch {
        $healthy = $false
      }
    }

    if ($healthy) {
      $api = [uri]::EscapeDataString($publicUrl)
      $target = "$($SiteUrl.TrimEnd('/'))/?api=$api$Route"
      Write-Host "Opening: $target"
      Start-Process $target
    } else {
      Write-Host "Tunnel URL was created but /api/health did not become reachable yet."
      Write-Host "Try again, or paste this URL into Netlify's backend gear once it resolves:"
      Write-Host "  $publicUrl"
    }
  } else {
    Write-Host "Tunnel URL was not detected yet."
    Write-Host "Open $SiteUrl and paste the trycloudflare URL from:"
    Write-Host "  $tunnelErr"
  }

  Write-Host ""
  Write-Host "Public mode is running. Close this window to stop backend and tunnel."
  if ($backend) {
    Wait-Process -Id $backend.Id
  } else {
    Wait-Process -Id $tunnel.Id
  }
} finally {
  if ($backend -and -not $backend.HasExited) { Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue }
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
}
