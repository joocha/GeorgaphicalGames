---
title: What's New in This Version
description: Changes in GeoAIGames version 2.3.0, the initial documentation release.
version: 2.3.0
lastUpdated: 2026-11-19
releaseDate: 2026-11-18
---
# What's New in This Version

**Version:** 2.3.0
**Release date:** 2026-11-18

**Initial documentation release.** Version 2.3.0 is the first version with public documentation. The other sections of this version document the complete game as implemented at version 2.3.0; they are the baseline for all later versions. The changes below are the changes made in the 2.3.0 release itself. Earlier releases are summarized in the [changelog](../../changelog/index.md).

## New Features

- **Pinch-to-zoom in Level 1** on touch screens (iOS and Android). Two fingers zoom around the point between them, and moving two fingers moves the map.
- One finger still only taps, so answering works exactly as before. A pinch never counts as an answer.
- Every new round starts from its own zoomed view of the right area.

## Improvements

- **All levels:** when pinching, the point under the fingers now stays in place, and a two-finger drag moves the map. Before, zoom was centred only on the point where the pinch started.
- **All levels:** the map can no longer be pushed out of sight. Its centre always stays on the map, and zooming out is limited.
- **All levels:** smoother map movement (the map is redrawn at most once per screen frame).
- **iOS:** the page itself no longer zooms while the map's gestures are active.

## Bug Fixes

- No bug fixes in this release.

## Technical Updates

- The change affects only the app. There is no change to scoring, levels, unlocking, the server or stored data.
- Desktop behaviour in Level 1 is unchanged: a mouse click answers, and the mouse wheel and mouse drag do not zoom or move the map.
- Public documentation (this website) and a machine-readable documentation index for AI systems were introduced with this version.

## Breaking Changes

- None.

## Known Issues

- In Level 1, a zoomed map cannot be moved with one finger, because one finger is reserved for tapping. Use two fingers to move the map.
