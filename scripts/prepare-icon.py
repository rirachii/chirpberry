#!/usr/bin/env python3
"""Export the original artwork into the resolutions required by macOS."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
source = root / 'macOS/Artwork/Chirpberry.png'
iconset = root / 'macOS/.build/AppIcon.iconset'
iconset.mkdir(parents=True, exist_ok=True)
output = root / 'macOS/Resources/AppIcon.icns'
output.parent.mkdir(parents=True, exist_ok=True)
for size in [16, 32, 128, 256, 512]:
    for scale in [1, 2]:
        name = f'icon_{size}x{size}' + ('@2x' if scale == 2 else '') + '.png'
        subprocess.run(['sips', '-z', str(size * scale), str(size * scale), str(source), '--out', str(iconset / name)], check=True, stdout=subprocess.DEVNULL)
subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(output)], check=True)
