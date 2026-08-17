param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath
)

$ErrorActionPreference = "Stop"
$sourceArchive = [System.IO.Path]::GetFullPath($ArchivePath)
if (-not [System.IO.File]::Exists($sourceArchive)) {
    throw "WP4 source archive does not exist: $sourceArchive"
}

$archiveDirectory = [System.IO.Path]::GetDirectoryName($sourceArchive)
$adversarialArchive = [System.IO.Path]::Combine(
    $archiveDirectory,
    ".wp4-adversarial-$([Guid]::NewGuid().ToString('N')).zip")
if ([System.IO.Path]::GetDirectoryName($adversarialArchive) -cne $archiveDirectory) {
    throw "Adversarial archive escaped its disposable directory."
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
    $source = [System.IO.Compression.ZipFile]::OpenRead($sourceArchive)
    try {
        $destination = [System.IO.Compression.ZipFile]::Open(
            $adversarialArchive,
            [System.IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($entry in $source.Entries) {
                $copy = $destination.CreateEntry(
                    $entry.FullName,
                    [System.IO.Compression.CompressionLevel]::Optimal)
                if (-not $entry.FullName.EndsWith("/", [System.StringComparison]::Ordinal)) {
                    $inputStream = $entry.Open()
                    $outputStream = $copy.Open()
                    try { $inputStream.CopyTo($outputStream) }
                    finally {
                        $outputStream.Dispose()
                        $inputStream.Dispose()
                    }
                }
            }
            $first = $source.Entries | Where-Object {
                -not $_.FullName.EndsWith("/", [System.StringComparison]::Ordinal)
            } | Select-Object -First 1
            if ($null -eq $first) { throw "WP4 source archive contains no file entry." }
            $slash = $first.FullName.IndexOf('/')
            if ($slash -lt 1) { throw "WP4 source archive has no candidate root folder." }
            $nonCanonical = $first.FullName.Substring(0, $slash + 1) + "/" +
                            $first.FullName.Substring($slash + 1)
            $attack = $destination.CreateEntry(
                $nonCanonical,
                [System.IO.Compression.CompressionLevel]::NoCompression)
            $writer = [System.IO.StreamWriter]::new($attack.Open())
            try { $writer.Write("noncanonical duplicate path regression") }
            finally { $writer.Dispose() }
        } finally {
            $destination.Dispose()
        }
    } finally {
        $source.Dispose()
    }

    $verifier = Join-Path $PSScriptRoot "verify-wp4-archive.ps1"
    $rejected = $false
    try {
        & $verifier -ArchivePath $adversarialArchive | Out-Null
    } catch {
        $rejected = $_.Exception.Message -match "Unsafe ZIP entry path segment|Duplicate normalized ZIP file path"
    }
    if (-not $rejected) {
        throw "Archive verifier accepted a noncanonical duplicate ZIP path."
    }
    [pscustomobject]@{
        passed = $true
        regression = "noncanonical_duplicate_zip_path_rejected"
    } | ConvertTo-Json
} finally {
    if ([System.IO.File]::Exists($adversarialArchive)) {
        [System.IO.File]::Delete($adversarialArchive)
    }
}
