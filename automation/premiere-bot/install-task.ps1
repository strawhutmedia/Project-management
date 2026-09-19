# Installs the Premiere Bot watcher as a headless Windows scheduled task.
# Run ONCE from an elevated (admin) PowerShell on the edit PC, from this
# folder (e.g. C:\Users\editbot\premiere-bot):
#
#   powershell -ExecutionPolicy Bypass -File .\install-task.ps1
#
# What it sets up (matches the plan in the repo's CLAUDE.md — headless task,
# no autologon needed):
#   - Task "PremiereBot" running  node poll.mjs  as the `editbot` account,
#     "run whether user is logged on or not" (it prompts once for editbot's
#     password to store the credential).
#   - Starts at machine boot and restarts every minute if it ever exits,
#     so it self-recovers from reboots and crashes.
#
# Manage it later: Task Scheduler GUI, or
#   Start-ScheduledTask -TaskName PremiereBot
#   Stop-ScheduledTask  -TaskName PremiereBot
#   Unregister-ScheduledTask -TaskName PremiereBot
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path (Join-Path $here '.env'))) {
  Write-Error "No .env in $here — copy .env.example to .env and paste in QA_SERVICE_TOKEN first."
}

$action = New-ScheduledTaskAction -Execute $node -Argument 'poll.mjs' -WorkingDirectory $here

# At boot, and again every minute if it's not running (self-heal after a
# crash or a Node update). The task itself loops forever.
$boot = New-ScheduledTaskTrigger -AtStartup
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration ([TimeSpan]::MaxValue)

$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Write-Host "Registering task 'PremiereBot' to run as editbot (you'll be asked for editbot's password)…"
$cred = Get-Credential -UserName "$env:COMPUTERNAME\editbot" -Message "Password for the editbot account (stored by Task Scheduler)"

Register-ScheduledTask -TaskName 'PremiereBot' `
  -Action $action -Trigger $boot, $repeat -Settings $settings `
  -User $cred.UserName -Password $cred.GetNetworkCredential().Password `
  -RunLevel Limited -Force | Out-Null

Start-ScheduledTask -TaskName 'PremiereBot'
Write-Host "Done. PremiereBot is running headless — check the '🤖 Edit bot' panel on slate.strawhutmedia.com/qa for its 'online' message."
