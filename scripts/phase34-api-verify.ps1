param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$Username = "admin",
  [string]$Password = "seong89",
  [string]$AppContext = "gambit",
  [string]$MeetingName = "PHASE34_TEST"
)

$ErrorActionPreference = 'Stop'

function Write-Step($text) {
  Write-Host "`n==> $text" -ForegroundColor Cyan
}

function Write-Pass($text) {
  Write-Host "PASS: $text" -ForegroundColor Green
}

function Write-Fail($text) {
  Write-Host "FAIL: $text" -ForegroundColor Red
}

try {
  Write-Step "Login"
  $loginBody = @{ username = $Username; password = $Password; appContext = $AppContext } | ConvertTo-Json
  $login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/login" -ContentType 'application/json' -Body $loginBody
  if (-not $login.token) { throw "No token returned from login." }

  $headers = @{
    Authorization = "Bearer $($login.token)"
    'X-App-Context' = $AppContext
  }
  Write-Pass "Login successful"

  Write-Step "Seed meeting/race"
  $meetingReq = @{
    meetingName = $MeetingName
    races = @(@{ raceNum = 1; raceName = 'R1'; numHorse = 2 })
    selected = $true
    clientRequestId = [guid]::NewGuid().ToString()
    syncBaseUpdatedAt = $null
  } | ConvertTo-Json -Depth 8
  $initResp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/meetings/races" -Headers $headers -ContentType 'application/json' -Body $meetingReq
  if (-not $initResp.success) { throw "Meeting save failed." }
  Write-Pass "Meeting/race seeded"

  Write-Step "Save params baseline"
  $seedParams = @{
    params = @(
      @{ meetingName = $MeetingName; raceNum = 1; horseNum = 1; horseName = 'ALPHA'; special = $null; rule4 = $null; rule4deduct = $null },
      @{ meetingName = $MeetingName; raceNum = 1; horseNum = 2; horseName = 'BRAVO'; special = $null; rule4 = $null; rule4deduct = $null }
    )
    clientRequestId = [guid]::NewGuid().ToString()
    syncBaseUpdatedAt = $null
  } | ConvertTo-Json -Depth 10
  $p1 = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/params" -Headers $headers -ContentType 'application/json' -Body $seedParams
  if (-not $p1.success) { throw "Initial params save failed." }

  $paramsNow = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/params?meetingName=$MeetingName" -Headers $headers
  $oldBase = ($paramsNow | Sort-Object updatedAt | Select-Object -Last 1).updatedAt
  if (-not $oldBase) { throw "Could not determine baseline updatedAt." }
  Write-Pass "Baseline captured: $oldBase"

  Write-Step "Simulate later server update"
  Start-Sleep -Seconds 2
  $serverUpdate = @{
    params = @(
      @{ meetingName = $MeetingName; raceNum = 1; horseNum = 1; horseName = 'ALPHA-SERVER-LATE'; special = $null; rule4 = $null; rule4deduct = $null },
      @{ meetingName = $MeetingName; raceNum = 1; horseNum = 2; horseName = 'BRAVO'; special = $null; rule4 = $null; rule4deduct = $null }
    )
    clientRequestId = [guid]::NewGuid().ToString()
    syncBaseUpdatedAt = $null
  } | ConvertTo-Json -Depth 10
  $p2 = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/params" -Headers $headers -ContentType 'application/json' -Body $serverUpdate
  if (-not $p2.success) { throw "Server-side params update failed." }
  Write-Pass "Server-side update done"

  Write-Step "Submit stale offline payload (expected 409 conflict)"
  $offlineStale = @{
    params = @(
      @{ meetingName = $MeetingName; raceNum = 1; horseNum = 1; horseName = 'ALPHA-OFFLINE-STALE'; special = $null; rule4 = $null; rule4deduct = $null },
      @{ meetingName = $MeetingName; raceNum = 1; horseNum = 2; horseName = 'BRAVO'; special = $null; rule4 = $null; rule4deduct = $null }
    )
    clientRequestId = [guid]::NewGuid().ToString()
    syncBaseUpdatedAt = $oldBase
  } | ConvertTo-Json -Depth 10

  $conflictStatus = 0
  try {
    Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/params" -Headers $headers -ContentType 'application/json' -Body $offlineStale | Out-Null
    $conflictStatus = 200
  } catch {
    $conflictStatus = $_.Exception.Response.StatusCode.value__
  }

  if ($conflictStatus -eq 409) {
    Write-Pass "Conflict detected correctly (409)"
  } else {
    Write-Fail "Expected 409 conflict, got $conflictStatus"
  }

  Write-Step "Verify audit row exists"
  $audit = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/sync/audit?limit=100" -Headers $headers
  $conflictLog = $audit | Where-Object { $_.meetingName -eq $MeetingName -and $_.operation -eq 'save-params' -and $_.status -eq 'conflict' } | Select-Object -First 1

  if ($conflictLog) {
    Write-Pass "Audit conflict row found"
    Write-Host "operation: $($conflictLog.operation)"
    Write-Host "status:    $($conflictLog.status)"
    Write-Host "message:   $($conflictLog.message)"
    Write-Host "createdAt: $($conflictLog.createdAt)"
  } else {
    Write-Fail "Audit conflict row not found"
  }

  Write-Host "`nDone." -ForegroundColor Yellow
  Write-Host "Manual Outbox check (browser): Application > IndexedDB > itb-offline > outbox" -ForegroundColor Yellow
  Write-Host "You should see stale item status as conflict after reconnect sync." -ForegroundColor Yellow
}
catch {
  Write-Host "`nTest script failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
