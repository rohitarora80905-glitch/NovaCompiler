# report/tools/desktop_capture.ps1 - screenshots of the Tkinter desktop viewer.
#
#   powershell -File report/tools/desktop_capture.ps1
#
# Starts the viewer on 05_optimiser.nova once per requested tab, captures the
# window alone with PrintWindow (so nothing else on the desktop is included),
# trims the transparent margin and writes report/figures/desktop-*.png.
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$figures = Join-Path $root 'report\figures'

Add-Type @"
using System; using System.Runtime.InteropServices;
public class NovaWin {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; } }
"@
Add-Type -AssemblyName System.Drawing
[NovaWin]::SetProcessDPIAware() | Out-Null

$script = @'
import os, sys, tkinter as tk
root_dir, example, tab = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, root_dir); os.chdir(root_dir)
from nova.gui import GlassBox, apply_theme
root = tk.Tk(); apply_theme(root)
app = GlassBox(root, os.path.join(root_dir, "examples", example))
widget = {"opt": app.t_opt, "run": app.t_run, "ver": app.t_ver, "sym": app.t_sym, "src": app.src}[tab]
app.nb.select(widget.master)
root.mainloop()
'@
$tmp = Join-Path $env:TEMP 'nova_gui_tab.py'
Set-Content -Path $tmp -Value $script -Encoding utf8

$shots = @(
  @{ tab = 'opt'; example = '05_optimiser.nova'; name = 'desktop-viewer' },
  @{ tab = 'run'; example = '02_fibonacci.nova'; name = 'desktop-run' },
  @{ tab = 'ver'; example = '03_gcd.nova'; name = 'desktop-verifier' }
)
foreach ($s in $shots) {
  $p = Start-Process -FilePath python -ArgumentList ('"' + $tmp + '" "' + $root + '" ' + $s.example + ' ' + $s.tab) -PassThru
  $h = [IntPtr]::Zero
  for ($i = 0; $i -lt 60 -and $h -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 250; $p.Refresh(); $h = $p.MainWindowHandle }
  # The viewer builds the LR tables before it paints; capture again until the
  # client area really has content (a painted table is never a flat colour).
  $bmp = $null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 1500
    $r = New-Object NovaWin+RECT
    [NovaWin]::GetWindowRect($h, [ref]$r) | Out-Null
    $w = $r.R - $r.L; $hh = $r.B - $r.T
    $bmp = New-Object System.Drawing.Bitmap $w, $hh
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc(); [NovaWin]::PrintWindow($h, $hdc, 2) | Out-Null; $g.ReleaseHdc($hdc); $g.Dispose()
    $distinct = @{}
    for ($y = 150; $y -lt 600; $y += 25) { for ($x = 40; $x -lt 900; $x += 25) { $distinct[$bmp.GetPixel($x, $y).ToArgb()] = 1 } }
    if ($distinct.Count -gt 6) { break }
    $bmp.Dispose()
  }
  if ($distinct.Count -le 6) { throw "$($s.name): the window never painted" }
  # trim the transparent resize border PrintWindow includes
  $right = 0; for ($x = $w - 1; $x -ge 0; $x--) { if ($bmp.GetPixel($x, 400).A -gt 10) { $right = $x; break } }
  $bottom = 0; for ($y = $hh - 1; $y -ge 0; $y--) { if ($bmp.GetPixel(400, $y).A -gt 10) { $bottom = $y; break } }
  $left = 0; for ($x = 0; $x -lt $w; $x++) { if ($bmp.GetPixel($x, 400).A -gt 10) { $left = $x; break } }
  $rect = New-Object System.Drawing.Rectangle $left, 0, ($right - $left + 1), ($bottom + 1)
  $out = New-Object System.Drawing.Bitmap $rect.Width, $rect.Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g2 = [System.Drawing.Graphics]::FromImage($out)
  $g2.DrawImage($bmp, (New-Object System.Drawing.Rectangle 0, 0, $rect.Width, $rect.Height), $rect, [System.Drawing.GraphicsUnit]::Pixel)
  $g2.Dispose(); $bmp.Dispose()
  $out.Save((Join-Path $figures ($s.name + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
  Stop-Process -Id $p.Id -Force -Confirm:$false
  "$($s.name).png  $($rect.Width)x$($rect.Height)"
}
