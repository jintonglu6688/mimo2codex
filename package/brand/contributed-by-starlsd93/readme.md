# Contributed branding assets — @starlsd93-sudo

Source: [PR #43](https://github.com/7as0nch/mimo2codex/pull/43) (2026-05-27).

## What's here

- `Mimo_Orange_{64,128,256,512}.ico` — orange variant, 4 sizes
- `Mimo_Purple_{64,128,256,512}.ico` — purple variant, 4 sizes

## Active wire-up (as of v0.5.6)

- `Mimo_Orange_256.ico` → `package/win/icon.ico` (Windows app icon).
- `Mimo_Orange_64.ico` → `package/win/tray.ico` (Windows system-tray icon — 64×64 is the smallest size the contribution provided; Windows downscales to 16×16 / 20×20 at render time).
- macOS icons (`package/mac/icon.icns`, `package/mac/tray-Template*.png`) and the docweb `favicon.svg` are maintained separately to match the orange branding — see the v0.5.6 release commit for the actual swap.
