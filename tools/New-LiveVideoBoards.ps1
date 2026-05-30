param(
    [string]$LibraryRoot = "L:\Media\Audio\suno_library",
    [string]$AlbumArtRoot = "L:\Media\Audio\suno\albumart",
    [string]$OutputRoot = "data\exports\live_video_boards"
)

$ErrorActionPreference = "Stop"

function Normalize-SongName {
    param([string]$Name)
    $value = $Name
    $value = $value -replace "__[0-9a-fA-F]{8}$", ""
    $value = $value -replace "(?i)\s+v\d+$", ""
    $value = $value -replace "(?i)\s*\((Cover|Remix|Remastered)\)", ""
    $value = $value -replace "\s+", " "
    return $value.Trim()
}

function Get-SafeName {
    param([string]$Name)
    $safe = $Name -replace '[<>:"/\\|?*]', "_"
    $safe = $safe -replace "\s+", " "
    if ($safe.Length -gt 96) {
        $safe = $safe.Substring(0, 96).Trim()
    }
    return $safe.Trim(". ")
}

function Get-CompanionFile {
    param(
        [System.IO.FileInfo]$Audio,
        [string[]]$Extensions,
        [string]$NormalizedName
    )

    foreach ($extension in $Extensions) {
        $direct = Join-Path $Audio.DirectoryName ($Audio.BaseName + $extension)
        if (Test-Path -LiteralPath $direct) {
            return (Get-Item -LiteralPath $direct).FullName
        }
    }

    $normalizedLower = $NormalizedName.ToLowerInvariant()
    $candidates = Get-ChildItem -LiteralPath $Audio.DirectoryName -File |
        Where-Object {
            $Extensions -contains $_.Extension.ToLowerInvariant() -and
            (Normalize-SongName $_.BaseName).ToLowerInvariant() -eq $normalizedLower
        } |
        Sort-Object LastWriteTime -Descending

    if ($candidates.Count -gt 0) {
        return $candidates[0].FullName
    }

    return ""
}

function Get-LyricAnchors {
    param([string]$LyricsPath)

    if (-not $LyricsPath -or -not (Test-Path -LiteralPath $LyricsPath)) {
        return @()
    }

    $lines = Get-Content -LiteralPath $LyricsPath -Encoding UTF8 -ErrorAction SilentlyContinue |
        ForEach-Object { $_.Trim() } |
        Where-Object {
            $_ -and
            $_ -notmatch "^\[.*\]$" -and
            $_ -notmatch "^\(.*\)$" -and
            $_.Length -gt 2
        }

    $unique = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        $clean = $line -replace "\s+", " "
        if ($clean.Length -gt 90) {
            $clean = $clean.Substring(0, 87).Trim() + "..."
        }
        if (-not $unique.Contains($clean)) {
            $unique.Add($clean)
        }
    }

    if ($unique.Count -le 9) {
        return @($unique)
    }

    $anchors = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt 9; $i++) {
        $index = [Math]::Floor(($i * ($unique.Count - 1)) / 8)
        $anchors.Add($unique[$index])
    }
    return @($anchors)
}

function Get-PerformanceFrame {
    param([string]$Title)

    $lower = $Title.ToLowerInvariant()

    if ($lower -match "tiny desk") { return "intimate office concert, warm practical lamps, close microphones, seated players, visible cables" }
    if ($lower -match "snl") { return "late-night studio stage, broadcast cameras, tight host-stage lighting, live television blocking" }
    if ($lower -match "radio") { return "small radio studio session, headphones, red recording light, glass booth reflections" }
    if ($lower -match "piano") { return "solo live piano performance, close hands, felt hammers, soft spotlight and room tone" }
    if ($lower -match "orchestra|julliard|opera") { return "concert hall recording, orchestra risers, tuxedo-black stage, gold acoustic panels" }
    if ($lower -match "lofi|lo-fi") { return "lo-fi handheld camcorder performance, cozy room, tape noise, practical lamps, intimate crowd" }
    if ($lower -match "tomorrowland|ultra|coachella|nye") { return "large festival mainstage, LED walls, lasers, smoke cannons, crowd phones, pyrotechnic light" }
    if ($lower -match "woodstock") { return "muddy outdoor festival field, analog film grain, daylight haze, improvised stage, huge crowd" }
    if ($lower -match "madison square|times square|carnegie|cotton club|le bain|lisbon|glasgow|budapest|garden") { return "venue-specific live recording, audience sightlines, stage truss, handheld documentary energy" }
    if ($lower -match "live set|crowd") { return "DJ live set from inside the crowd, booth lights, bodies moving, phone-video realism" }

    return "live performance video recording, handheld cameras, visible stage, audience energy, real-time lighting shifts"
}

function Get-HashIndex {
    param([string]$Value, [int]$Modulo)
    if ($Modulo -le 0) { return 0 }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    $sum = 0
    foreach ($byte in $bytes) { $sum = ($sum + $byte) % 2147483647 }
    return $sum % $Modulo
}

$performancePattern = "(?i)(\(\s*live\b|\blive\s*[@-]|\blive\s+(recording|lofi|lo-fi|band|radio|piano|crowd|set|vocals|orchestra|from)|\b(recording\s+live|tiny desk|woodstock|coachella|tomorrowland|snl|concert)\b)"

$outputPath = Resolve-Path -LiteralPath "." | ForEach-Object { Join-Path $_.Path $OutputRoot }
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

$albumArtExtensions = @(".jpg", ".jpeg", ".png")
$audioExtensions = @(".mp3", ".wav")

$albumArt = Get-ChildItem -LiteralPath $AlbumArtRoot -File -Recurse |
    Where-Object { $albumArtExtensions -contains $_.Extension.ToLowerInvariant() } |
    Sort-Object FullName

$audioFiles = Get-ChildItem -LiteralPath $LibraryRoot -Recurse -File |
    Where-Object { $audioExtensions -contains $_.Extension.ToLowerInvariant() } |
    Where-Object { $_.BaseName -match $performancePattern }

$groups = $audioFiles |
    Group-Object { (Normalize-SongName $_.BaseName).ToLowerInvariant() } |
    Sort-Object Name

$indexRows = New-Object System.Collections.Generic.List[object]
$readmeLines = New-Object System.Collections.Generic.List[string]
$readmeLines.Add("# Live Video Boards")
$readmeLines.Add("")
$readmeLines.Add("Generated from performance-style songs in `$LibraryRoot`.")
$readmeLines.Add("")
$readmeLines.Add("- Filter: names that imply live recording, concert, festival, radio, Tiny Desk, SNL, live set, live band, live piano, live lofi, or named live venues.")
$readmeLines.Add("- Creative direction: imagine each song as video footage from a live concert/performance, while borrowing visual DNA from the song cover and selected album-art references.")
$readmeLines.Add("- Image safety direction included in every prompt: use fictional performers and avoid recognizable real-artist likenesses, even when filenames mention real artists.")
$readmeLines.Add("")
$readmeLines.Add("## Songs")
$readmeLines.Add("")

foreach ($group in $groups) {
    $audio = $group.Group | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $title = Normalize-SongName $audio.BaseName
    $safeName = Get-SafeName $title
    $songDir = Join-Path $outputPath $safeName
    New-Item -ItemType Directory -Force -Path $songDir | Out-Null

    $lyrics = Get-CompanionFile -Audio $audio -Extensions @(".txt") -NormalizedName $title
    $cover = Get-CompanionFile -Audio $audio -Extensions @(".jpg", ".jpeg", ".png") -NormalizedName $title
    $anchors = Get-LyricAnchors -LyricsPath $lyrics

    if ($anchors.Count -eq 0) {
        $anchors = @(
            "Opening atmosphere from the title",
            "First performance gesture",
            "Audience reaction",
            "Instrument or controller detail",
            "Lead vocal close-up",
            "Lighting shift",
            "Crowd-wide hook moment",
            "Backstage or side-stage glimpse",
            "Final iconic live frame"
        )
    }

    $start = Get-HashIndex -Value $title -Modulo ([Math]::Max(1, $albumArt.Count))
    $referenceArt = New-Object System.Collections.Generic.List[string]
    if ($cover) { $referenceArt.Add($cover) }
    for ($i = 0; $i -lt [Math]::Min(5, $albumArt.Count); $i++) {
        $referenceArt.Add($albumArt[($start + ($i * 17)) % $albumArt.Count].FullName)
    }

    $frame = Get-PerformanceFrame -Title $title
    $shotIdeas = @(
        "establishing view of the venue before the song fully lands",
        "performer close-up captured by a shoulder camera",
        "instrument, mixer, mic, or hand detail matching the groove",
        "side-stage angle with lights cutting through haze",
        "audience POV with phones and bodies framing the performer",
        "surreal album-art motif physically appearing on stage",
        "wide crowd reaction at the hook",
        "imperfect live-video artifact: flare, focus hunt, scanline, tape noise, or compression bloom",
        "final poster-worthy frame that could also be the thumbnail"
    )

    $promptLines = New-Object System.Collections.Generic.List[string]
    $promptLines.Add("# $title")
    $promptLines.Add("")
    $promptLines.Add("## Source")
    $promptLines.Add("")
    $promptLines.Add("- Audio: $($audio.FullName)")
    if ($lyrics) { $promptLines.Add("- Lyrics/style text: $lyrics") }
    if ($cover) { $promptLines.Add("- Song cover: $cover") }
    $promptLines.Add("- Variants grouped: $($group.Count)")
    $promptLines.Add("")
    $promptLines.Add("## Reference Album Art")
    $promptLines.Add("")
    foreach ($art in $referenceArt) {
        $promptLines.Add("- $art")
    }
    $promptLines.Add("")
    $promptLines.Add("## Live Performance Niche")
    $promptLines.Add("")
    $promptLines.Add($frame)
    $promptLines.Add("")
    $promptLines.Add("## Lyric / Moment Anchors")
    $promptLines.Add("")
    for ($i = 0; $i -lt 9; $i++) {
        $anchor = $anchors[$i % $anchors.Count]
        $promptLines.Add("$($i + 1). $anchor")
    }
    $promptLines.Add("")
    $promptLines.Add("## 9-Grid Contact Sheet Prompt")
    $promptLines.Add("")
    $promptLines.Add("Create a 3x3 cinematic storyboard contact sheet for a music video imagined as live performance footage for `"$title`".")
    $promptLines.Add("")
    $promptLines.Add("Use the attached/reference album art as visual DNA: palette, texture, symbols, surreal motifs, and mood. Translate those references into a believable video recording of a concert or live session, not a flat album-cover remake.")
    $promptLines.Add("")
    $promptLines.Add("Performance setting: $frame.")
    $promptLines.Add("")
    $promptLines.Add("Camera language: handheld concert video, broadcast cutaways, documentary side-stage angles, shallow focus, lens flare, haze, crowd phones, stage LEDs, imperfect live-video artifacts, energetic but coherent continuity.")
    $promptLines.Add("")
    $promptLines.Add("Important: no text, no captions, no logos. Use fictional performers only; do not depict or imitate recognizable real artists, celebrities, or public figures even if the song filename mentions them.")
    $promptLines.Add("")
    $promptLines.Add("Panels:")
    for ($i = 0; $i -lt 9; $i++) {
        $anchor = $anchors[$i % $anchors.Count]
        $promptLines.Add("$($i + 1). $($shotIdeas[$i]) inspired by: `"$anchor`"")
    }
    $promptLines.Add("")
    $promptLines.Add("## Individual 16:9 Keyframe Template")
    $promptLines.Add("")
    $promptLines.Add("Generate one 16:9 cinematic still from panel [NUMBER] of the live-performance storyboard for `"$title`". Keep the same fictional performer, venue, wardrobe, color grade, lens style, and album-art motif from the 9-grid. No text. No real-artist likeness.")
    $promptLines.Add("")
    $promptLines.Add("## Video Motion Notes")
    $promptLines.Add("")
    $promptLines.Add("- Favor push-ins, rack focus, crowd-phone parallax, LED flicker, smoke drift, handheld sway, and cutaway inserts.")
    $promptLines.Add("- Keep complex action minimal; make it feel like a real captured performance with a heightened album-art dream layer.")
    $promptLines.Add("- Reuse the same stage layout across panels so the final video feels continuous.")

    $promptPath = Join-Path $songDir "shotlist.md"
    Set-Content -LiteralPath $promptPath -Value $promptLines -Encoding UTF8

    $indexRows.Add([pscustomobject]@{
        Title = $title
        Variants = $group.Count
        Audio = $audio.FullName
        Lyrics = $lyrics
        Cover = $cover
        PromptPack = $promptPath
    })

    $readmeLines.Add("- [$title]($safeName/shotlist.md) - variants: $($group.Count)")
}

$csvPath = Join-Path $outputPath "index.csv"
$indexRows | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8

$readmePath = Join-Path $outputPath "README.md"
Set-Content -LiteralPath $readmePath -Value $readmeLines -Encoding UTF8

Write-Host "Wrote $($groups.Count) live video board prompt packs to $outputPath"
Write-Host "Index: $csvPath"
Write-Host "README: $readmePath"
