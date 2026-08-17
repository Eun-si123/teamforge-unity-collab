param(
    [ValidateSet('doctor', 'install', 'server', 'dev', 'test', 'smoke', 'verify', 'unity-test')]
    [string]$Command = 'doctor',
    [switch]$Lan,
    [switch]$GenerateToken,
    [string]$UnityProject = '',
    [string]$UnityEditorPath = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
if (-not $Npm) { $Npm = (Get-Command npm -ErrorAction SilentlyContinue) }
$Node = Get-Command node -ErrorAction SilentlyContinue

function Write-Check([bool]$Ok, [string]$Name, [string]$Detail) {
    $mark = if ($Ok) { '[PASS]' } else { '[FAIL]' }
    Write-Host "$mark $Name - $Detail"
}

function Assert-Tooling {
    if (-not $Node) { throw 'A supported Node.js LTS (22 or 24) is required for developer CLI commands.' }
    if (-not $Npm) { throw 'npm is required. Install Node.js with npm, then run this command again.' }
    $versionText = (& node --version).Trim().TrimStart('v')
    $parsedVersion = [version]$versionText
    $minimumVersions = @{
        22 = [version]'22.23.2'
        24 = [version]'24.18.1'
    }
    if (-not $minimumVersions.ContainsKey($parsedVersion.Major) -or
        $parsedVersion -lt $minimumVersions[$parsedVersion.Major]) {
        throw "A security-patched Node.js LTS is required (>=22.23.2 <23 or >=24.18.1 <25). Current: $versionText"
    }
}

function Ensure-Dependencies {
    Assert-Tooling
    if (-not (Test-Path (Join-Path $Root 'server\node_modules\ws\package.json'))) {
        Write-Host 'Installing TeamForge server dependencies (first run only)...'
        & $Npm.Source --prefix (Join-Path $Root 'server') ci --ignore-scripts --workspaces=false
        if ($LASTEXITCODE -ne 0) { throw 'Server dependency installation failed.' }
    }
    if (($Command -in @('test', 'smoke', 'verify')) -and
        -not (Test-Path (Join-Path $Root 'project-peer\node_modules\ws\package.json'))) {
        Write-Host 'Installing TeamForge project-peer dependencies (first run only)...'
        & $Npm.Source --prefix (Join-Path $Root 'project-peer') ci --ignore-scripts --workspaces=false
        if ($LASTEXITCODE -ne 0) { throw 'Project Peer dependency installation failed.' }
    }
}

function Ensure-LanToken {
    if (-not [string]::IsNullOrWhiteSpace($env:TEAMFORGE_AUTH_TOKEN)) { return }
    if (-not $GenerateToken) {
        throw 'LAN mode requires TEAMFORGE_AUTH_TOKEN. Use -GenerateToken to create a temporary token and copy it to the clipboard.'
    }

    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $env:TEAMFORGE_AUTH_TOKEN = [Convert]::ToBase64String($bytes)
    if (Get-Command Set-Clipboard -ErrorAction SilentlyContinue) {
        $env:TEAMFORGE_AUTH_TOKEN | Set-Clipboard
        Write-Host 'Generated a temporary LAN Bearer token and copied it to the clipboard.'
    } else {
        Write-Host 'Generated a temporary LAN Bearer token for this server process.'
        Write-Host 'Clipboard integration is unavailable; set TEAMFORGE_AUTH_TOKEN yourself before sharing access.'
    }
}

function Resolve-UnityProjectPath {
    if (-not [string]::IsNullOrWhiteSpace($UnityProject)) {
        return (Resolve-Path $UnityProject).Path
    }
    return (Resolve-Path (Join-Path $Root 'unity-project')).Path
}

function Resolve-UnityEditorPath([string]$ProjectPath) {
    if (-not [string]::IsNullOrWhiteSpace($UnityEditorPath)) {
        if (-not (Test-Path $UnityEditorPath)) { throw "Unity Editor not found: $UnityEditorPath" }
        return (Resolve-Path $UnityEditorPath).Path
    }
    if (-not [string]::IsNullOrWhiteSpace($env:UNITY_EDITOR) -and (Test-Path $env:UNITY_EDITOR)) {
        return (Resolve-Path $env:UNITY_EDITOR).Path
    }

    $versionFile = Join-Path $ProjectPath 'ProjectSettings\ProjectVersion.txt'
    $version = ''
    if (Test-Path $versionFile) {
        $line = Get-Content $versionFile | Where-Object { $_ -like 'm_EditorVersion:*' } | Select-Object -First 1
        if ($line) { $version = ($line -split ':', 2)[1].Trim() }
    }

    $programFiles = ${env:ProgramFiles}
    if (-not [string]::IsNullOrWhiteSpace($version) -and -not [string]::IsNullOrWhiteSpace($programFiles)) {
        $exact = Join-Path $programFiles "Unity\Hub\Editor\$version\Editor\Unity.exe"
        if (Test-Path $exact) { return $exact }
    }

    if (-not [string]::IsNullOrWhiteSpace($programFiles)) {
        $hubRoot = Join-Path $programFiles 'Unity\Hub\Editor'
        if (Test-Path $hubRoot) {
            $candidate = Get-ChildItem $hubRoot -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -like '6000.3.*' } |
                Sort-Object Name -Descending |
                ForEach-Object { Join-Path $_.FullName 'Editor\Unity.exe' } |
                Where-Object { Test-Path $_ } |
                Select-Object -First 1
            if ($candidate) { return $candidate }
        }
    }

    throw 'Unity 6000.3 Editor was not found. Pass -UnityEditorPath or set the UNITY_EDITOR environment variable.'
}

function Invoke-UnityEditModeTests {
    $project = Resolve-UnityProjectPath
    $editor = Resolve-UnityEditorPath $project
    $resultsDir = Join-Path $Root 'test-results'
    New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null
    $results = Join-Path $resultsDir 'unity-editmode-results.xml'
    $log = Join-Path $resultsDir 'unity-editmode.log'

    # Never allow a previous passing XML/log to satisfy a later failed launch.
    foreach ($generatedPath in @($results, $log)) {
        if (Test-Path -LiteralPath $generatedPath) {
            Remove-Item -LiteralPath $generatedPath -Force
        }
    }

    Write-Host "Unity:   $editor"
    Write-Host "Project: $project"
    Write-Host 'Running EditMode tests without manual Test Runner clicks...'
    $arguments = @(
        '-batchmode',
        '-nographics',
        '-projectPath', ('"{0}"' -f $project),
        '-runTests',
        '-testPlatform', 'EditMode',
        '-testResults', ('"{0}"' -f $results),
        '-logFile', ('"{0}"' -f $log)
    )

    # WaitForExit on the returned Unity process handle waits for Unity.exe only.
    # The Start-Process tree-wait option can hang on Unity's persistent dotnet
    # helpers after the Editor has already exited.
    $process = Start-Process -FilePath $editor -ArgumentList $arguments -PassThru -WindowStyle Hidden
    try {
        $process.WaitForExit()
        $exitCode = $process.ExitCode
    }
    finally {
        $process.Dispose()
    }
    Write-Host "Results: $results"
    Write-Host "Log:     $log"
    Write-Host "Unity exit code: $exitCode"
    if ($exitCode -ne 0) { throw "Unity EditMode tests failed with exit code $exitCode." }
    if (-not (Test-Path -LiteralPath $results -PathType Leaf)) {
        throw "Unity exited successfully without producing EditMode results: $results"
    }
    [xml]$resultXml = Get-Content -LiteralPath $results -Raw -Encoding UTF8
    $testRun = $resultXml.'test-run'
    if ($null -eq $testRun -or -not $testRun.HasAttribute('result')) {
        throw "Unity EditMode results do not contain a valid test-run root: $results"
    }
    foreach ($attribute in @('total', 'passed', 'failed', 'skipped', 'inconclusive')) {
        if (-not $testRun.HasAttribute($attribute)) {
            throw "Unity EditMode results are missing the '$attribute' count: $results"
        }
    }
    $total = [int]$testRun.total
    $passed = [int]$testRun.passed
    $failed = [int]$testRun.failed
    $skipped = [int]$testRun.skipped
    $inconclusive = [int]$testRun.inconclusive
    Write-Host "EditMode result: $($testRun.result) - total $total, passed $passed, failed $failed, skipped $skipped, inconclusive $inconclusive"
    if ($total -le 0 -or $total -ne ($passed + $failed + $skipped + $inconclusive)) {
        throw "Unity EditMode results contain invalid test counts."
    }
    if ($testRun.result -ne 'Passed' -or $failed -ne 0) {
        throw "Unity EditMode results did not pass ($failed failed test(s), result '$($testRun.result)')."
    }
}

function Invoke-DeveloperDoctor {
    Write-Host 'TeamForge Developer Doctor'
    Write-Host '--------------------------'
    Write-Check ([bool]$Node) 'Node' $(if ($Node) { (& node --version).Trim() } else { 'missing' })
    Write-Check ([bool]$Npm) 'npm' $(if ($Npm) { (& $Npm.Source --version).Trim() } else { 'missing' })
    Write-Check (Test-Path (Join-Path $Root 'server\package.json')) 'Coordinator' 'server/package.json'
    Write-Check (Test-Path (Join-Path $Root 'project-peer\package.json')) 'Project Peer' 'project-peer/package.json'
    Write-Check (Test-Path (Join-Path $Root 'unity-package\com.eunsung.teamforge\package.json')) 'Unity package' 'com.eunsung.teamforge'
    Write-Check (Test-Path (Join-Path $Root 'scripts\validate-repository.mjs')) 'Validator' 'scripts/validate-repository.mjs'
    Write-Host ''
    Write-Host 'Common commands:'
    Write-Host "  & '$PSCommandPath' dev"
    Write-Host "  & '$PSCommandPath' verify"
    Write-Host "  & '$PSCommandPath' unity-test"
}

function Start-TeamForgeServer {
    Ensure-Dependencies
    if ($Lan) {
        Ensure-LanToken
        $env:TEAMFORGE_HOST = '0.0.0.0'
        Write-Host 'Starting TeamForge for LAN access with authentication enabled.'
    } else {
        $env:TEAMFORGE_HOST = '127.0.0.1'
        Write-Host 'Starting TeamForge on this PC only (127.0.0.1:5080).'
        if ([string]::IsNullOrWhiteSpace($env:TEAMFORGE_AUTH_TOKEN)) {
            Write-Host 'Authentication is intentionally omitted for loopback-only development.'
        }
    }
    & $Npm.Source --prefix (Join-Path $Root 'server') start
    exit $LASTEXITCODE
}

switch ($Command) {
    'doctor' {
        Invoke-DeveloperDoctor
    }
    'install' {
        Assert-Tooling
        & $Npm.Source --prefix (Join-Path $Root 'server') ci --ignore-scripts --workspaces=false
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & $Npm.Source --prefix (Join-Path $Root 'project-peer') ci --ignore-scripts --workspaces=false
        exit $LASTEXITCODE
    }
    'server' {
        Start-TeamForgeServer
    }
    'dev' {
        Invoke-DeveloperDoctor
        Write-Host ''
        Start-TeamForgeServer
    }
    'test' {
        Ensure-Dependencies
        & $Npm.Source --prefix $Root test
        exit $LASTEXITCODE
    }
    'smoke' {
        Ensure-Dependencies
        & $Npm.Source --prefix $Root run smoke
        exit $LASTEXITCODE
    }
    'verify' {
        Assert-Tooling
        Write-Host 'Running repository validator...'
        & node (Join-Path $Root 'scripts\validate-repository.mjs')
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Ensure-Dependencies
        Write-Host 'Running Node regression suites...'
        & $Npm.Source --prefix $Root test
        exit $LASTEXITCODE
    }
    'unity-test' {
        Invoke-UnityEditModeTests
    }
}
