# Card Grader

Card Grader is a local-first iOS and Android app for guided Pokémon card
photography and eventual on-device condition analysis. Predictions will be
unofficial estimates and will not authenticate cards or guarantee grades from
PSA, Beckett/BGS, or CGC.

The repository now also contains a provider-agnostic static PWA prototype under
`apps/web`. It uses browser camera APIs with a photo-picker fallback and shares
platform-neutral capture and grading contracts with the native app. Users can
upload one image for the current view or select/drop multiple pictures to fill
the remaining six-view capture sequence. Preview labels are editable; assigning
a picture to an occupied view swaps the two labels so every view remains unique.
Any uploaded picture can be removed; the workflow then requests the missing
view and accepts a replacement upload or camera capture.

The capture page starts with a camera-or-upload choice. Camera, upload, review,
and centering are collapsible sections, and successful captures automatically
open and smoothly scroll to the next required capture or analysis action.
A shortcut rail appears to the left on wide screens and becomes a horizontally
scrollable bar on smaller screens, allowing direct navigation to every
available workflow and result section.

As soon as the front and back straight-on views are present, the PWA can
calculate centering locally; the four angled views are optional. The detector
uses the camera guide as a search hint, compares luminance and color-gradient
variants, robustly fits tilted card edges across multiple scan lines, and
perspective-normalizes the card before looking for its inner frame. It reports
bordered, uncertain, or borderless/full-art frame status and overlays editable
outer and inner guides. Left/right and top/bottom percentages include a
detection confidence and are green at 55/45 or better, yellow through 60/40,
and red beyond 60/40.

For camera captures, the framing guide is the primary outer-edge reference.
The detector first searches close to the guide, requires independent edge and
shape support, and reduces confidence when the fitted card disagrees with the
guide or forms an implausibly skewed quadrilateral. Detected corners refine the
captured guide rather than replacing it outright; the permitted adjustment
increases only when independent edge and geometry evidence is strong. A wider
search is used only when the close guide search cannot produce a reliable
candidate.

While the camera is open, local frame checks warn about blur, glare,
overexposure, underexposure, and weak card/background contrast. Capturing takes
a short three-frame burst and retains only the highest-scoring frame. No burst
frame or diagnostic leaves the browser.

If automatic card-edge detection cannot separate the card from its background,
the user can continue with fully manual overlays without running detection
again. Camera captures use the mapped framing guide when available; uploads and
other captures receive a centered card-shaped starting guide. Both the cyan
card edge and yellow inner frame remain adjustable before using the estimate.

The cyan outer-card and yellow inner-frame overlays are directly editable with
touch or mouse. Each corner moves independently to follow slight perspective or
rotation, recalculating left/right and top/bottom percentages in real time. Each
image can be reset to automatic detection. Users can adjust guide opacity and
corner-handle size. A toggleable magnified preview appears while dragging so the
active corner can be aligned more precisely, with horizontal and vertical
crosshairs extending to the edge of the preview circle.

The centering result also includes a local inspection workspace with original,
negative, grayscale, contrast-enhanced, and edge-detail views; image-quality
warnings; perspective-corrected card previews; synchronized zoom and pan;
manual blemish markers and notes; PNG report downloads; and a print view that
can be saved as PDF. Images remain in the current browser tab and are not
uploaded.

On touchscreens, blemish markers are added with a quick tap on the original
inspection image or placed precisely by touching and dragging. Existing markers
can also be dragged. A second finger cancels pending marker placement and starts
synchronized pinch zoom, so pinching never creates a blemish. Mouse users can
still hold Ctrl and click or drag. Markers can be removed individually or all at
once with Clear all. Marker size is adjustable per card side, and touch-friendly
minus/plus buttons and a range control remain available for zoom. Marker
opacity is also adjustable per card side.

After both sides are analyzed, users can compare their centering and manually
marked blemishes against PSA, TAG, CGC, or Beckett/BGS criteria. The app reports
a conservative unofficial range, likely grade, category ceilings, limiting
factors, evidence gaps, and a question-mark link to the selected grader's
published rubric. It does not claim to reproduce an official grade or TAG's
proprietary score. The grade estimate and local export actions each have their
own collapsible result section.

The service worker checks for updates on startup and whenever the app returns
to the foreground. New workers activate and claim the app immediately so a hard
refresh cannot remain pinned to an obsolete cached shell. When an update prompt
is available, **Update now** applies it and reloads the page; any active,
unexported capture is discarded.

## Current milestone

The repository contains the Expo SDK 57 mobile scaffold, a six-view capture
workflow, versioned grading/model contracts, an ONNX Runtime adapter, and the
production result interface for ranges, evidence overlays, explanations, and
uncertainty. The result interface currently uses an unmistakably watermarked
synthetic preview. Real grading is disabled until a trained model and its
compatibility manifest pass evaluation and physical-device benchmarks.

## Requirements

- Node.js 20.19.4 or newer
- Android Studio for local Android builds
- macOS and Xcode for local iOS builds

## Development

```powershell
npm install
npm run typecheck
npm run android
```

Run the PWA:

```powershell
npm run pwa:dev
```

Build static files for any HTTPS static host:

```powershell
npm run pwa:build
```

The deployable output is `apps\web\dist`.

Detector calibration data must use photographs you own or have permission to
use. Copy `docs\centering-calibration.template.json`, replace the example with
measured expected corners and detector output, then run:

```powershell
npm run calibrate:centering -- path\to\results.json
```

The harness reports mean and p95 normalized corner error, centering percentage
error, automatic-detection rate, and confidence-binned errors. Keep real card
photographs outside the repository unless their redistribution rights are
explicitly documented.

The app uses native ONNX Runtime code, so use an Expo development build rather
than Expo Go. After adding or updating native dependencies or changing
`app.json`, regenerate native projects before rebuilding:

```powershell
npx expo prebuild --clean
npx expo run:android
```

Do not commit card photos, training data, private API keys, or unlicensed model
artifacts.
