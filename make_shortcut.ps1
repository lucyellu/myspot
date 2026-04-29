# Re-creates the two myspot desktop shortcuts. Run with:
#   powershell -ExecutionPolicy Bypass -File .\make_shortcut.ps1
$ws = New-Object -ComObject WScript.Shell

function New-MyspotShortcut($name, $target, $description) {
  $path = "C:\Users\lucyl\Desktop\$name.lnk"
  $lnk = $ws.CreateShortcut($path)
  $lnk.TargetPath = $target
  $lnk.WorkingDirectory = 'C:\Users\lucyl\Desktop\myspot'
  $lnk.IconLocation = 'C:\Users\lucyl\Desktop\myspot\icon.ico,0'
  $lnk.WindowStyle = 1
  $lnk.Description = $description
  $lnk.Save()
  Write-Output ("shortcut: " + $lnk.FullName)
  Write-Output ("  target:  " + $lnk.TargetPath)
  Write-Output ("  icon:    " + $lnk.IconLocation)
  Write-Output ""
}

# Local-only: backend on 127.0.0.1:7777 (the daily-use shortcut)
New-MyspotShortcut `
  "myspot" `
  "C:\Users\lucyl\Desktop\myspot\start.bat" `
  "Launch myspot - personal music/video AI player (local only)"

# Public mode: backend + Cloudflare tunnel for the Netlify deploy
New-MyspotShortcut `
  "myspot (public)" `
  "C:\Users\lucyl\Desktop\myspot\start_public.bat" `
  "Launch myspot + Cloudflare tunnel so myspot-web.netlify.app can call it"
