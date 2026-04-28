$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut('C:\Users\lucyl\Desktop\myspot.lnk')
$lnk.TargetPath = 'C:\Users\lucyl\Desktop\myspot\start.bat'
$lnk.WorkingDirectory = 'C:\Users\lucyl\Desktop\myspot'
$lnk.IconLocation = 'C:\Users\lucyl\Desktop\myspot\icon.ico,0'
$lnk.WindowStyle = 1
$lnk.Description = 'Launch myspot - personal music/video AI player'
$lnk.Save()
Write-Output ("shortcut: " + $lnk.FullName)
Write-Output ("  target:  " + $lnk.TargetPath)
Write-Output ("  icon:    " + $lnk.IconLocation)
Write-Output ("  workdir: " + $lnk.WorkingDirectory)
