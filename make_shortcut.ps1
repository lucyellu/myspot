# Re-creates myspot shortcuts. Run with:
#   powershell -ExecutionPolicy Bypass -File .\make_shortcut.ps1
$ws = New-Object -ComObject WScript.Shell
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ShortcutDir = "C:\Users\lucyl\Desktop\hold"

function New-MyspotShortcut($name, $target, $arguments, $description) {
  $path = Join-Path $ShortcutDir "$name.lnk"
  $lnk = $ws.CreateShortcut($path)
  $lnk.TargetPath = $target
  $lnk.Arguments = $arguments
  $lnk.WorkingDirectory = $ProjectDir
  $lnk.IconLocation = (Join-Path $ProjectDir "icon.ico") + ",0"
  $lnk.WindowStyle = 1
  $lnk.Description = $description
  $lnk.Save()
  Write-Output ("shortcut: " + $lnk.FullName)
  Write-Output ("  target:  " + $lnk.TargetPath)
  Write-Output ("  args:    " + $lnk.Arguments)
  Write-Output ("  icon:    " + $lnk.IconLocation)
  Write-Output ""
}

# One local/LAN launcher. It opens localhost on the PC and prints the phone URL.
New-MyspotShortcut `
  "myspot (phone)" `
  (Join-Path $ProjectDir "start.bat") `
  "`"#/`"" `
  "Launch regular myspot; phone/LAN URL is printed in the launch window"

# AI Radio is just an entry route into the same app, not a separate server.
New-MyspotShortcut `
  "myspot AI Radio" `
  (Join-Path $ProjectDir "start.bat") `
  "`"#/radio`"" `
  "Launch regular myspot directly to AI Radio"

# Public mode: backend + Cloudflare tunnel for the Netlify deploy
New-MyspotShortcut `
  "myspot (public)" `
  (Join-Path $ProjectDir "start_public.bat") `
  "" `
  "Launch myspot + Cloudflare tunnel so myspot-web.netlify.app can call it"
