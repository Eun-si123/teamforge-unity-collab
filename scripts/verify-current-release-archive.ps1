param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath
)

$ErrorActionPreference = "Stop"
$archive = [System.IO.Path]::GetFullPath($ArchivePath)
if (-not [System.IO.File]::Exists($archive)) {
    throw "Release archive does not exist: $archive"
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-ZipJson([System.IO.Compression.ZipArchiveEntry]$Entry, [long]$MaximumBytes, [string]$Label) {
    if ($Entry.Length -gt $MaximumBytes) { throw "$Label is too large." }
    $reader = [System.IO.StreamReader]::new($Entry.Open(), [System.Text.Encoding]::UTF8, $true)
    try { return ($reader.ReadToEnd() | ConvertFrom-Json) }
    finally { $reader.Dispose() }
}

function Get-EntrySha256([System.IO.Compression.ZipArchiveEntry]$Entry) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = $Entry.Open()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant() }
    finally {
        $stream.Dispose()
        $sha.Dispose()
    }
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
try {
    $files = @{}
    $caseFolded = @{}
    $rootName = $null
    [long]$totalBytes = 0
    [int]$entryCount = 0

    foreach ($entry in $zip.Entries) {
        $entryCount += 1
        if ($entryCount -gt 25000) { throw "Release ZIP contains too many entries." }
        $name = $entry.FullName
        if ([string]::IsNullOrWhiteSpace($name) -or $name.Contains("\") -or $name.StartsWith("/") -or
            $name.Contains(":") -or $name.Length -gt 260) {
            throw "Unsafe ZIP entry path: $name"
        }

        $isDirectory = $name.EndsWith("/", [System.StringComparison]::Ordinal)
        $trimmed = if ($isDirectory) { $name.Substring(0, $name.Length - 1) } else { $name }
        $parts = $trimmed.Split('/')
        if ($parts.Count -eq 0 -or $parts -contains '') { throw "Unsafe ZIP entry path segment: $name" }
        foreach ($part in $parts) {
            if ($part -eq "." -or $part -eq ".." -or $part.EndsWith(".") -or $part.EndsWith(" ")) {
                throw "Unsafe ZIP entry path segment: $name"
            }
            if ($part -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') {
                throw "Windows reserved ZIP entry name: $name"
            }
        }

        if ($null -eq $rootName) { $rootName = $parts[0] }
        if ($parts[0] -cne $rootName) { throw "Release ZIP must contain one exact candidate root folder." }
        if ($rootName.Length -gt 48) { throw "Candidate root folder is too long for the Windows path budget." }

        $folded = $name.ToLowerInvariant()
        if ($caseFolded.ContainsKey($folded)) { throw "Case-insensitive duplicate ZIP entry: $name" }
        $caseFolded[$folded] = $true

        $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
        if ($unixType -eq 0xA000) { throw "Symbolic link entry is forbidden: $name" }
        if ($entry.Length -gt 500MB) { throw "ZIP entry is unexpectedly large: $name" }
        if ($entry.CompressedLength -eq 0 -and $entry.Length -gt 0) { throw "Invalid compressed size: $name" }
        if ($entry.CompressedLength -gt 0 -and ($entry.Length / $entry.CompressedLength) -gt 2000) {
            throw "Suspicious ZIP compression ratio: $name"
        }
        $totalBytes += $entry.Length
        if ($totalBytes -gt 1800MB) { throw "Release ZIP uncompressed total is unexpectedly large." }

        if (-not $isDirectory) {
            $relative = ($parts | Select-Object -Skip 1) -join "/"
            if ([string]::IsNullOrWhiteSpace($relative)) { throw "File cannot be the candidate root itself." }
            if ($files.ContainsKey($relative)) { throw "Duplicate normalized ZIP file path: $relative" }
            $files[$relative] = $entry
        }
    }

    if ([string]::IsNullOrWhiteSpace($rootName)) { throw "Release ZIP is empty." }
    foreach ($required in @(
        "release-contract.json",
        "release-manifest.json",
        "launcher/win-x64/TeamForge.Launcher.exe",
        "launcher/win-x64/runtime-loader.mjs",
        "launcher/win-x64/launcher-manifest.json",
        "launcher/win-x64/Runtime/runtime-manifest.json",
        "unity-package/com.eunsung.teamforge/Runtime~/runtime-manifest.json"
    )) {
        if ($files.Keys -cnotcontains $required) { throw "Required release file is missing or has wrong case: $required" }
    }

    $contract = Read-ZipJson $files["release-contract.json"] 1MB "release-contract.json"
    if ($contract.schemaVersion -ne 1 -or
        $contract.product -cne "Unity TeamForge" -or
        ([string]$contract.productVersion) -cnotmatch '^\d+\.\d+\.\d+$' -or
        [string]::IsNullOrWhiteSpace([string]$contract.releaseId) -or
        -not ([string]$contract.releaseId).StartsWith("$($contract.productVersion)-", [System.StringComparison]::Ordinal) -or
        [string]::IsNullOrWhiteSpace([string]$contract.workPackage) -or
        $contract.target -cne "win-x64" -or
        $contract.status -cne "FIELD_BLOCKED" -or
        $contract.protocols.realtime -lt 1 -or
        $contract.protocols.projectTransfer -lt 1 -or
        $contract.protocols.projectManifest -lt 1 -or
        $contract.protocols.runtimeManifest -lt 1 -or
        $contract.protocols.launcherManifest -lt 1 -or
        $contract.protocols.releaseManifest -lt 1) {
        throw "Release contract identity is invalid."
    }

    $manifest = Read-ZipJson $files["release-manifest.json"] 8MB "release-manifest.json"
    if ($manifest.schemaVersion -ne $contract.protocols.releaseManifest -or
        $manifest.product -cne $contract.product -or
        $manifest.productVersion -cne $contract.productVersion -or
        $manifest.releaseId -cne $contract.releaseId -or
        $manifest.workPackage -cne $contract.workPackage -or
        $manifest.target -cne $contract.target -or
        $manifest.status -cne $contract.status -or
        $null -eq $manifest.files -or
        ([string]$manifest.releaseContractSha256) -cnotmatch '^[0-9a-f]{64}$' -or
        ([string]$manifest.runtimeManifestSha256) -cnotmatch '^[0-9a-f]{64}$' -or
        ([string]$manifest.launcherManifestSha256) -cnotmatch '^[0-9a-f]{64}$') {
        throw "Release manifest contract is invalid."
    }

    $expected = @{}
    foreach ($record in $manifest.files) {
        $relative = [string]$record.path
        $key = $relative.ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($relative) -or $relative.Contains("\") -or $relative.StartsWith("/") -or
            $relative.Contains(":") -or ([string]$record.sha256) -cnotmatch '^[0-9a-f]{64}$' -or
            ([long]$record.size) -lt 0 -or $expected.ContainsKey($key)) {
            throw "Release manifest contains a duplicate/invalid path: $relative"
        }
        $expected[$key] = $record
    }

    if ($files.Count -ne ($expected.Count + 1)) {
        throw "Archive file set differs from release-manifest.json. ZIP files=$($files.Count), manifest files=$($expected.Count)."
    }

    $actualHashes = @{}
    foreach ($relative in $files.Keys) {
        if ($relative -ceq "release-manifest.json") { continue }
        $key = $relative.ToLowerInvariant()
        if (-not $expected.ContainsKey($key)) { throw "Unmanifested archive file: $relative" }
        $record = $expected[$key]
        if ([string]$record.path -cne $relative) { throw "Archive path case differs from manifest: $relative" }
        $entry = $files[$relative]
        if ([long]$record.size -ne $entry.Length) { throw "Archive size mismatch: $relative" }
        $actual = Get-EntrySha256 $entry
        if ($actual -cne [string]$record.sha256) { throw "Archive hash mismatch: $relative" }
        $actualHashes[$relative] = $actual
    }

    if ($actualHashes["release-contract.json"] -cne [string]$manifest.releaseContractSha256) {
        throw "Release contract hash differs from release manifest pin."
    }
    $unityRuntimeManifest = "unity-package/com.eunsung.teamforge/Runtime~/runtime-manifest.json"
    $launcherRuntimeManifest = "launcher/win-x64/Runtime/runtime-manifest.json"
    $launcherManifest = "launcher/win-x64/launcher-manifest.json"
    if ($actualHashes[$unityRuntimeManifest] -cne [string]$manifest.runtimeManifestSha256 -or
        $actualHashes[$launcherRuntimeManifest] -cne [string]$manifest.runtimeManifestSha256) {
        throw "Nested Runtime manifest hash differs from release manifest pin."
    }
    if ($actualHashes[$launcherManifest] -cne [string]$manifest.launcherManifestSha256) {
        throw "Launcher manifest hash differs from release manifest pin."
    }

    $runtime = Read-ZipJson $files[$unityRuntimeManifest] 8MB "runtime-manifest.json"
    $launcher = Read-ZipJson $files[$launcherManifest] 8MB "launcher-manifest.json"
    if ($runtime.productVersion -cne $contract.productVersion -or
        $runtime.nodeVersion -cne $contract.node.version -or
        $runtime.wsVersion -cne $contract.ws.version -or
        $runtime.wsIntegrity -cne $contract.ws.integrity) {
        throw "Runtime identity differs from release-contract.json."
    }
    if ($launcher.productVersion -cne $contract.productVersion -or
        $launcher.target -cne $contract.target -or
        $launcher.targetFramework -cne $contract.dotnet.targetFramework -or
        $launcher.dotnetRuntimeVersion -cne $contract.dotnet.runtimeVersion -or
        $launcher.signed -ne $contract.launcher.signed) {
        throw "Launcher identity differs from release-contract.json."
    }

    [pscustomobject]@{
        verified = $true
        root = $rootName
        files = $files.Count
        uncompressedBytes = $totalBytes
        productVersion = $contract.productVersion
        releaseId = $contract.releaseId
        status = $contract.status
        runtimeManifestSha256 = $manifest.runtimeManifestSha256
        launcherManifestSha256 = $manifest.launcherManifestSha256
    } | ConvertTo-Json
}
finally {
    $zip.Dispose()
}
