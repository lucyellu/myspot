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

$backend = Start-Process -FilePath $python `
  -ArgumentList @("-m", "backend.app") `
  -WorkingDirectory $root `
  -PassThru

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
    $api = [uri]::EscapeDataString($publicUrl)
    $target = "$($SiteUrl.TrimEnd('/'))/?api=$api$Route"
    Write-Host "Public API: $publicUrl"
    Write-Host "Opening: $target"
    Start-Process $target
  } else {
    Write-Host "Tunnel URL was not detected yet."
    Write-Host "Open $SiteUrl and paste the trycloudflare URL from:"
    Write-Host "  $tunnelErr"
  }

  Write-Host ""
  Write-Host "Public mode is running. Close this window to stop backend and tunnel."
  Wait-Process -Id $backend.Id
} finally {
  if ($backend -and -not $backend.HasExited) { Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue }
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
}
