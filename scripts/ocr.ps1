param(
  [Parameter(Mandatory=$true)][string]$ImagePath,
  # 1보다 크면 WinRT 디코더가 확대한 뒤 인식한다. 좌표는 원본 픽셀로 되돌려 돌려준다.
  [double]$Scale = 1.0,
  # 애니메이션 GIF는 프레임마다 다른 글자가 있어 앞쪽 프레임을 모두 읽는다.
  [int]$MaxFrames = 12
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] > $null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime] > $null
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] > $null
[Windows.Graphics.Imaging.BitmapInterpolationMode,Windows.Foundation,ContentType=WindowsRuntime] > $null
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await($Operation, $ResultType) {
  $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.GetAwaiter().GetResult()
}
$lang = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Where-Object { $_.LanguageTag -like 'ko*' } | Select-Object -First 1
if (!$lang) { throw 'Korean Windows OCR language is not installed.' }
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync([IO.Path]::GetFullPath($ImagePath))) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $limit = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  # BitmapTransform은 확대 후 Bounds를 적용하므로 스트립 계산도 확대 좌표에서 한다.
  $scaledWidth = [int][Math]::Round($decoder.PixelWidth * $Scale)
  $scaledHeight = [int][Math]::Round($decoder.PixelHeight * $Scale)
  if ($scaledWidth -gt $limit) { throw 'Image width exceeds Windows OCR limit.' }
  $frameCount = [Math]::Min([int]$decoder.FrameCount, $MaxFrames)
  $lines = @()
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  for ($frameIndex = 0; $frameIndex -lt $frameCount; $frameIndex++) {
    $frame = if ($frameIndex -eq 0) { $decoder } else { Await ($decoder.GetFrameAsync($frameIndex)) ([Windows.Graphics.Imaging.BitmapFrame]) }
    # Overlap strips so text crossing a crop boundary is retained.
    $strip = [Math]::Min(2000, $limit)
    for ($top = 0; $top -lt $scaledHeight; $top += ($strip - 160)) {
      $height = [Math]::Min($strip, $scaledHeight - $top)
      $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
      # 확대 품질이 판독을 좌우한다. Fant는 WinRT에서 가장 품질이 좋은 보간이다.
      $transform.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Fant
      $transform.ScaledWidth = $scaledWidth
      $transform.ScaledHeight = $scaledHeight
      $bounds = New-Object Windows.Graphics.Imaging.BitmapBounds
      $bounds.X = 0; $bounds.Y = $top; $bounds.Width = $scaledWidth; $bounds.Height = $height
      $transform.Bounds = $bounds
      $bitmap = Await ($frame.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $transform, [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
      try {
        $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        foreach ($line in $result.Lines) {
          $words = @($line.Words | ForEach-Object {
            @{ text=$_.Text
               x=($_.BoundingRect.X / $Scale)
               y=(($_.BoundingRect.Y + $top) / $Scale)
               width=($_.BoundingRect.Width / $Scale)
               height=($_.BoundingRect.Height / $Scale) }
          })
          if (!$words.Count) { continue }
          # 프레임/스트립이 겹쳐 같은 줄이 여러 번 나오면 한 번만 남긴다.
          $marker = ($line.Text -replace '\s','') + '@' + [int]($words[0].y / 4) + ',' + [int]($words[0].x / 4)
          if ($seen.Add($marker)) { $lines += @{ text=$line.Text; words=$words } }
        }
      } finally { $bitmap.Dispose() }
      if ($top + $height -ge $scaledHeight) { break }
    }
  }
  @{ width=$decoder.PixelWidth; height=$decoder.PixelHeight; scale=$Scale; frames=$frameCount; lines=$lines } | ConvertTo-Json -Depth 8 -Compress
} finally { $stream.Dispose() }
