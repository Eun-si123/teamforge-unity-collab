param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath
)

$ErrorActionPreference = "Stop"
$archive = [System.IO.Path]::GetFullPath($ArchivePath)
if (-not [System.IO.File]::Exists($archive)) {
    throw "WP4 archive does not exist: $archive"
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
try {
    $fileEntries = @{}
    $caseNames = @{}
    $canonicalKinds = @{}
    $rootName = $null
    [long]$totalBytes = 0
    [int]$entryCount = 0
    foreach ($entry in $zip.Entries) {
        $entryCount += 1
        if ($entryCount -gt 20000) { throw "WP4 ZIP contains too many entries." }
        $name = $entry.FullName
        if ([string]::IsNullOrWhiteSpace($name) -or $name.Contains("\") -or $name.StartsWith("/") -or
            $name.Contains(":") -or $name.Length -gt 240) {
            throw "Unsafe ZIP entry path: $name"
        }
        $isDirectoryEntry = $name.EndsWith("/", [System.StringComparison]::Ordinal)
        $trimmedName = if ($isDirectoryEntry) { $name.Substring(0, $name.Length - 1) } else { $name }
        $parts = $trimmedName.Split('/')
        $unsafeParts = @($parts | Where-Object { $_ -eq "." -or $_ -eq ".." -or $_.EndsWith(".") -or $_.EndsWith(" ") })
        $canonicalName = ($parts -join '/') + $(if ($isDirectoryEntry) { '/' } else { '' })
        if ($parts.Count -eq 0 -or $parts -contains '' -or $unsafeParts.Count -gt 0 -or $name -cne $canonicalName) {
            throw "Unsafe ZIP entry path segment: $name"
        }
        if ($isDirectoryEntry -and $entry.Length -ne 0) { throw "ZIP directory entry has data: $name" }
        $objectKey = $trimmedName.ToLowerInvariant()
        $objectKind = if ($isDirectoryEntry) { "directory" } else { "file" }
        if ($canonicalKinds.ContainsKey($objectKey) -and $canonicalKinds[$objectKey] -cne $objectKind) {
            throw "ZIP path is both a file and directory: $trimmedName"
        }
        $canonicalKinds[$objectKey] = $objectKind
        foreach ($part in $parts) {
            if ($part -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') {
                throw "Windows reserved ZIP entry name: $name"
            }
        }
        if ($null -eq $rootName) { $rootName = $parts[0] }
        if ($parts[0] -cne $rootName) { throw "ZIP must contain one exact candidate root folder." }
        if ($rootName.Length -gt 48) {
            throw "Candidate root folder is too long for the Windows Runtime path budget: $rootName"
        }

        $folded = $name.ToLowerInvariant()
        if ($caseNames.ContainsKey($folded)) { throw "Case-insensitive duplicate ZIP entry: $name" }
        $caseNames[$folded] = $true
        $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
        if ($unixType -eq 0xA000) { throw "Symbolic link entry is forbidden: $name" }
        if ($entry.Length -gt 400MB) { throw "ZIP entry is too large: $name" }
        if ($entry.CompressedLength -eq 0 -and $entry.Length -gt 0) { throw "Invalid compressed size: $name" }
        if ($entry.CompressedLength -gt 0 -and ($entry.Length / $entry.CompressedLength) -gt 2000) {
            throw "Suspicious ZIP compression ratio: $name"
        }
        $totalBytes += $entry.Length
        if ($totalBytes -gt 1500MB) { throw "WP4 ZIP uncompressed total is unexpectedly large." }
        if (-not $isDirectoryEntry) {
            $relative = ($parts | Select-Object -Skip 1) -join "/"
            if ([string]::IsNullOrWhiteSpace($relative)) { throw "File cannot be the candidate root itself." }
            if ($fileEntries.ContainsKey($relative)) { throw "Duplicate normalized ZIP file path: $relative" }
            $fileEntries[$relative] = $entry
        }
    }

    foreach ($relative in $fileEntries.Keys) {
        $segments = $relative.Split('/')
        for ($index = 1; $index -lt $segments.Count; $index += 1) {
            $ancestor = ($segments | Select-Object -First $index) -join '/'
            if ($fileEntries.ContainsKey($ancestor)) {
                throw "ZIP file is also an ancestor path: $ancestor"
            }
        }
    }

    if (-not $fileEntries.ContainsKey("release-manifest.json")) { throw "release-manifest.json is missing from the candidate." }
    if (-not $fileEntries.ContainsKey("release-contract.json")) { throw "release-contract.json is missing from the candidate." }
    $contractEntry = $fileEntries["release-contract.json"]
    if ($contractEntry.Length -gt 1MB) { throw "Release contract is too large." }
    $contractReader = [System.IO.StreamReader]::new($contractEntry.Open(), [System.Text.Encoding]::UTF8, $true)
    try { $contract = ($contractReader.ReadToEnd() | ConvertFrom-Json) } finally { $contractReader.Dispose() }
    $manifestEntry = $fileEntries["release-manifest.json"]
    if ($manifestEntry.Length -gt 5MB) { throw "Release manifest is too large." }
    $reader = [System.IO.StreamReader]::new($manifestEntry.Open(), [System.Text.Encoding]::UTF8, $true)
    try { $manifest = ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() }
    if ($contract.schemaVersion -ne 1 -or
        $contract.product -cne "Unity TeamForge" -or
        ([string]$contract.productVersion) -cnotmatch '^\d+\.\d+\.\d+$' -or
        $contract.releaseId -cne "$($contract.productVersion)-wp5-diagnostics-recovery-ux" -or
        $contract.workPackage -cne "WP5 Diagnostics & Recovery UX" -or
        $contract.target -cne "win-x64" -or
        $contract.status -cne "FIELD_BLOCKED" -or
        $contract.protocols.realtime -ne 1 -or
        $contract.protocols.projectTransfer -ne 1 -or
        $contract.protocols.projectManifest -ne 1) {
        throw "Release contract identity is invalid."
    }
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

    $requiredFiles = @(
        "launcher/win-x64/TeamForge.Launcher.exe",
        "launcher/win-x64/runtime-loader.mjs",
        "launcher/win-x64/launcher-manifest.json",
        "launcher/win-x64/Runtime/runtime-manifest.json",
        "unity-package/com.eunsung.teamforge/Runtime~/runtime-manifest.json",
        "release-contract.json",
        "WP4-Field-Hotfix-Report.md",
        "Release-Integrity-Audit.md",
        "changed-files-wp4-release-integrity-hotfix.md",
        "supported-entrypoints-inventory.md",
        "dependency-runtime-version-audit.md",
        "executable-smoke-results.md",
        "historical-files-retained.txt",
        "removed-deprecated-obsolete-files.md",
        "Windows-Field-Test-Checklist-WP4-Hotfix.md"
        "WP5-Diagnostics-Recovery-UX-Report.md"
        "changed-files-wp5.md"
        "Windows-Field-Test-Checklist-WP5.md"
        "executable-smoke-results-wp5.md"
    )
    foreach ($required in $requiredFiles) {
        if ($fileEntries.Keys -cnotcontains $required) {
            throw "Required WP4 candidate file is missing or has the wrong case: $required"
        }
    }

    $runtimeContractReader = [System.IO.StreamReader]::new(
        $fileEntries["unity-package/com.eunsung.teamforge/Runtime~/runtime-manifest.json"].Open(),
        [System.Text.Encoding]::UTF8,
        $true)
    try { $runtimeContract = ($runtimeContractReader.ReadToEnd() | ConvertFrom-Json) }
    finally { $runtimeContractReader.Dispose() }
    if ($runtimeContract.schemaVersion -ne $contract.protocols.runtimeManifest -or
        $runtimeContract.productVersion -cne $contract.productVersion -or
        $runtimeContract.nodeVersion -cne $contract.node.version -or
        $runtimeContract.wsVersion -cne $contract.ws.version -or
        $runtimeContract.wsIntegrity -cne $contract.ws.integrity) {
        throw "Nested Runtime identity differs from release-contract.json."
    }

    $launcherContractReader = [System.IO.StreamReader]::new(
        $fileEntries["launcher/win-x64/launcher-manifest.json"].Open(),
        [System.Text.Encoding]::UTF8,
        $true)
    try { $launcherContract = ($launcherContractReader.ReadToEnd() | ConvertFrom-Json) }
    finally { $launcherContractReader.Dispose() }
    if ($launcherContract.schemaVersion -ne $contract.protocols.launcherManifest -or
        $launcherContract.productVersion -cne $contract.productVersion -or
        $launcherContract.target -cne $contract.target -or
        $launcherContract.targetFramework -cne $contract.dotnet.targetFramework -or
        $launcherContract.dotnetRuntimeVersion -cne $contract.dotnet.runtimeVersion -or
        $launcherContract.signed -ne $contract.launcher.signed) {
        throw "Nested Launcher identity differs from release-contract.json."
    }

    $expected = @{}
    foreach ($record in $manifest.files) {
        $relative = [string]$record.path
        if ([string]::IsNullOrWhiteSpace($relative) -or
            $relative.Contains("\") -or
            $relative.StartsWith("/") -or
            $relative.Contains(":") -or
            ([string]$record.sha256) -cnotmatch '^[0-9a-f]{64}$' -or
            ([long]$record.size) -lt 0 -or
            $expected.ContainsKey($relative.ToLowerInvariant())) {
            throw "Release manifest contains a duplicate/invalid path: $relative"
        }
        $expected[$relative.ToLowerInvariant()] = $record
    }
    if ($fileEntries.Count -ne ($expected.Count + 1)) {
        throw "Archive file set differs from the explicit release manifest."
    }

    $actualHashes = @{}
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        foreach ($relative in $fileEntries.Keys) {
            if ($relative -ceq "release-manifest.json") { continue }
            $key = $relative.ToLowerInvariant()
            if (-not $expected.ContainsKey($key)) { throw "Unmanifested archive file: $relative" }
            $record = $expected[$key]
            if ([string]$record.path -cne $relative) { throw "Archive path case differs from release manifest: $relative" }
            $entry = $fileEntries[$relative]
            if ([long]$record.size -ne $entry.Length) { throw "Archive size mismatch: $relative" }
            $stream = $entry.Open()
            try {
                $actual = ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
            }
            finally { $stream.Dispose() }
            if ($actual -cne [string]$record.sha256) { throw "Archive hash mismatch: $relative" }
            $actualHashes[$relative] = $actual
        }
    } finally {
        $sha256.Dispose()
    }

    $unityRuntimeManifest = "unity-package/com.eunsung.teamforge/Runtime~/runtime-manifest.json"
    $launcherRuntimeManifest = "launcher/win-x64/Runtime/runtime-manifest.json"
    $launcherManifest = "launcher/win-x64/launcher-manifest.json"
    if ($actualHashes[$unityRuntimeManifest] -cne [string]$manifest.runtimeManifestSha256 -or
        $actualHashes[$launcherRuntimeManifest] -cne [string]$manifest.runtimeManifestSha256) {
        throw "Nested Runtime manifest hash differs from the release pin."
    }
    if ($actualHashes[$launcherManifest] -cne [string]$manifest.launcherManifestSha256) {
        throw "Nested Launcher manifest hash differs from the release pin."
    }
    if ($actualHashes["release-contract.json"] -cne [string]$manifest.releaseContractSha256) {
        throw "Release contract hash differs from the release pin."
    }

    [pscustomobject]@{
        verified = $true
        root = $rootName
        files = $fileEntries.Count
        uncompressedBytes = $totalBytes
        runtimeManifestSha256 = $manifest.runtimeManifestSha256
        launcherManifestSha256 = $manifest.launcherManifestSha256
    } | ConvertTo-Json
} finally {
    $zip.Dispose()
}
