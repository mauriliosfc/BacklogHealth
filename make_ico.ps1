Add-Type -AssemblyName System.Drawing

function C([string]$h) {
    [System.Drawing.Color]::FromArgb(255,
        [Convert]::ToInt32($h.Substring(0,2),16),
        [Convert]::ToInt32($h.Substring(2,2),16),
        [Convert]::ToInt32($h.Substring(4,2),16))
}
function B([string]$h) { New-Object System.Drawing.SolidBrush (C $h) }

function FillRR($g, $brush, $x, $y, $w, $h, $r) {
    if ($w -le 0 -or $h -le 0) { return }
    $r = [Math]::Min($r, [Math]::Min([int]($w/2), [int]($h/2)))
    if ($r -le 1) { $g.FillRectangle($brush, $x, $y, $w, $h); return }
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x,           $y,           $r*2, $r*2, 180, 90)
    $p.AddArc($x+$w-$r*2,  $y,           $r*2, $r*2, 270, 90)
    $p.AddArc($x+$w-$r*2,  $y+$h-$r*2,  $r*2, $r*2,   0, 90)
    $p.AddArc($x,           $y+$h-$r*2,  $r*2, $r*2,  90, 90)
    $p.CloseAllFigures()
    $g.FillPath($brush, $p)
    $p.Dispose()
}

# Full-detail render for large sizes (256, 48)
function Get-IconBytesLarge([int]$sz) {
    $sc = $sz / 512.0
    function S([float]$v) { [Math]::Max(1, [int]($v * $sc)) }

    $bmp = New-Object System.Drawing.Bitmap($sz, $sz, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    FillRR $g (B "0f172a") 0       0      $sz    $sz    (S 80)
    FillRR $g (B "1e293b") (S 136) (S 96) (S 240) (S 320) (S 20)
    FillRR $g (B "334155") (S 200) (S 76) (S 112) (S 44)  (S 14)

    $bars = @(("60a5fa",168,176,176),("475569",168,214,130),("475569",168,252,150),("22c55e",168,290,176),("f59e0b",168,328,100))
    foreach ($bar in $bars) {
        FillRR $g (B $bar[0]) (S $bar[1]) (S $bar[2]) ([Math]::Max(2,(S $bar[3]))) ([Math]::Max(2,(S 14))) (S 7)
    }
    $circles = @(("60a5fa",152,183),("475569",152,221),("475569",152,259),("22c55e",152,297),("f59e0b",152,335))
    foreach ($c in $circles) {
        $cr = [Math]::Max(2, (S 9))
        $g.FillEllipse((B $c[0]), (S $c[1])-$cr, (S $c[2])-$cr, $cr*2, $cr*2)
    }

    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $bytes = $ms.ToArray(); $ms.Dispose()
    return ,$bytes
}

# Simplified bold render for small sizes (32, 16) — thick bars, no circles
function Get-IconBytesSmall([int]$sz) {
    $bmp = New-Object System.Drawing.Bitmap($sz, $sz, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # tudo em coordenadas absolutas proporcional a 32px
    $f = $sz / 32.0
    function P([float]$v) { [Math]::Max(1, [int]($v * $f)) }

    # fundo arredondado
    FillRR $g (B "0f172a") 0      0      $sz      $sz      (P 4)
    # documento
    FillRR $g (B "1e293b") (P 4)  (P 3)  (P 24)   (P 26)   (P 2)
    # notch
    FillRR $g (B "334155") (P 10) (P 1)  (P 12)   (P 4)    (P 2)
    # 4 barras bold com cores vibrantes
    FillRR $g (B "60a5fa") (P 6)  (P 8)  (P 20)   (P 3)    (P 1)
    FillRR $g (B "475569") (P 6)  (P 13) (P 15)   (P 3)    (P 1)
    FillRR $g (B "22c55e") (P 6)  (P 18) (P 20)   (P 3)    (P 1)
    FillRR $g (B "f59e0b") (P 6)  (P 23) (P 12)   (P 3)    (P 1)

    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $bytes = $ms.ToArray(); $ms.Dispose()
    return ,$bytes
}

$imgs = @{}
$imgs[256] = Get-IconBytesLarge 256
$imgs[48]  = Get-IconBytesLarge 48
$imgs[40]  = Get-IconBytesSmall 40
$imgs[32]  = Get-IconBytesSmall 32
$imgs[24]  = Get-IconBytesSmall 24
$imgs[16]  = Get-IconBytesSmall 16

$sizes = @(256, 48, 40, 32, 24, 16)
foreach ($sz in $sizes) {
    Write-Host "  Rendered ${sz}x${sz} ($($imgs[$sz].Length) bytes)"
}

# Build ICO binary
$count   = $sizes.Count
$hdrSize = 6 + $count * 16
$curOff  = $hdrSize
$offs    = @()
foreach ($sz in $sizes) { $offs += $curOff; $curOff += $imgs[$sz].Length }

$outStream = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($outStream)

$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$count)

for ($i = 0; $i -lt $count; $i++) {
    $sz  = $sizes[$i]; $img = $imgs[$sz]
    $dim = if ($sz -eq 256) { 0 } else { $sz }
    $bw.Write([byte]$dim); $bw.Write([byte]$dim)
    $bw.Write([byte]0);    $bw.Write([byte]0)
    $bw.Write([uint16]1);  $bw.Write([uint16]32)
    $bw.Write([uint32]$img.Length)
    $bw.Write([uint32]$offs[$i])
}
foreach ($sz in $sizes) { $bw.Write($imgs[$sz]) }
$bw.Flush()

$icoBytes = $outStream.ToArray()
$dest = Join-Path $PSScriptRoot "wrapper\app.ico"
[System.IO.File]::WriteAllBytes($dest, $icoBytes)
$bw.Dispose(); $outStream.Dispose()

Write-Host "Saved: $dest ($($icoBytes.Length) bytes)"
