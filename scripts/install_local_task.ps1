# Crée (ou remplace) la tâche planifiée Windows qui lance le fetch Leboncoin chaque jour.
#
# Usage :
#   powershell -File scripts\install_local_task.ps1              # tous les jours à 11:00
#   powershell -File scripts\install_local_task.ps1 -At 09:30    # autre heure
#   powershell -File scripts\install_local_task.ps1 -Remove      # supprime la tâche

param(
  [string]$At = '11:00',
  [switch]$Remove
)

$taskName = 'ImmoBrest - Fetch Leboncoin'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Tâche « $taskName » supprimée."
  exit 0
}

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $PSScriptRoot 'run_local_fetch.ps1'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" `
  -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $At
# StartWhenAvailable : si le PC était éteint à l'heure prévue, la tâche part dès que possible après.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
# Session interactive requise : Chrome a besoin du bureau et du profil connecté à Leboncoin.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Fetch quotidien Leboncoin pour ImmoBrest, mise à jour du site." -Force | Out-Null

$task = Get-ScheduledTask -TaskName $taskName
Write-Host "Tâche « $taskName » enregistrée : tous les jours à $At (état : $($task.State))."
Write-Host 'Test immédiat : Start-ScheduledTask -TaskName "ImmoBrest - Fetch Leboncoin"'
