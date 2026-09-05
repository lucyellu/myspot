# myspot — one-time Tailscale setup for private mobile access.
#
# Run once:  powershell -ExecutionPolicy Bypass -File .\tools\setup_tailscale.ps1
# It self-elevates (UAC), installs Tailscale if missing, opens an inbound
# firewall hole on TCP 7777 restricted to Tailscale peers ONLY (100.64.0.0/10),
# brings Tailscale up (browser login on first run), and prints the phone URL.
#
# After this: install the Tailscale app on your phone, log in with the SAME
# account, then open the printed http://<name>:7777 URL from anywhere.

$ErrorActionPreference = 'Stop'

# --- self-elevate to admin -------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Requesting administrator rights (UAC)..."
  Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File', $PSCommandPath)
  return
}

# --- 1. install Tailscale if missing --------------------------------------
$tsExe = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $tsExe -and (Test-Path 'C:\Program Files\Tailscale\tailscale.exe')) {
  $tsExe = 'C:\Program Files\Tailscale\tailscale.exe'
}
if (-not $tsExe) {
  Write-Host "Tailscale not found. Installing via winget..."
  winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements
  $tsExe = 'C:\Program Files\Tailscale\tailscale.exe'
  if (-not (Test-Path $tsExe)) {
    throw "Tailscale install did not complete. Install manually from https://tailscale.com/download and re-run."
  }
}
Write-Host ("Tailscale: " + $tsExe)

# --- 2. firewall: allow inbound TCP 7777 from Tailscale peers only ---------
$ruleName = 'myspot (Tailscale 7777)'
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 7777 -RemoteAddress '100.64.0.0/10' -Profile Any | Out-Null
Write-Host "Firewall: inbound TCP 7777 allowed from Tailscale peers (100.64.0.0/10) only."

# --- 3. bring Tailscale up (auth in browser on first run) -----------------
Write-Host "Bringing Tailscale up (a browser may open for login the first time)..."
& $tsExe up

# --- 4. report the phone URL ----------------------------------------------
$ip = $null
try { $ip = (& $tsExe ip -4 2>$null | Select-Object -First 1) } catch {}
$dns = $null
try {
  $status = & $tsExe status --json 2>$null | ConvertFrom-Json
  if ($status -and $status.Self -and $status.Self.DNSName) { $dns = $status.Self.DNSName.TrimEnd('.') }
} catch {}

Write-Host ""
Write-Host "=================================================================="
Write-Host " Tailscale is set up on this PC."
Write-Host ""
Write-Host " On your phone: install the Tailscale app, log in with the SAME"
Write-Host " account, then (with myspot running via the 'myspot (phone)'"
Write-Host " shortcut) open:"
Write-Host ""
if ($dns) { Write-Host ("    http://{0}:7777" -f $dns) }
if ($ip)  { Write-Host ("    http://{0}:7777    (IP fallback)" -f $ip) }
Write-Host ""
Write-Host " Bookmark it. The name never changes, works on cellular, and is"
Write-Host " reachable only from your own Tailscale devices."
Write-Host "=================================================================="
Write-Host ""
Write-Host "Press Enter to close..."
[void][System.Console]::ReadLine()
