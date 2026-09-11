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
calculate centering locally; the four angled views are optional. It detects
outer card and inner frame edges, overlays both guides, and reports left/right
and top/bottom margin percentages with a detection confidence. The percentages
are green at 55/45 or better, yellow through 60/40, and red beyond 60/40. This
is a centering estimate only; no grade prediction is produced. Grade prediction
is deferred from the current PWA milestone.

The cyan outer-card and yellow inner-frame overlays are directly editable with
touch or mouse. Each corner moves independently to follow slight perspective or
rotation, recalculating left/right and top/bottom percentages in real time. Each
image can be reset to automatic detection. Users can adjust guide opacity and
corner-handle size. A toggleable magnified preview appears while dragging so the
active corner can be aligned more precisely.

The centering result also includes a local inspection workspace with original,
negative, grayscale, contrast-enhanced, and edge-detail views; image-quality
warnings; perspective-corrected card previews; synchronized zoom and pan;
manual blemish markers and notes; PNG report downloads; and a print view that
can be saved as PDF. Images remain in the current browser tab and are not
uploaded.

Blemish markers are added by holding Ctrl and left-clicking the original
inspection image and removed by right-clicking the marker. Marker size is
adjustable per card side. Mouse-wheel events over either inspection image
control synchronized zoom without scrolling the browser page.

After both sides are analyzed, users can compare their centering and manually
marked blemishes against PSA, TAG, CGC, or Beckett/BGS criteria. The app reports
a conservative unofficial range, likely grade, category ceilings, limiting
factors, evidence gaps, and a question-mark link to the selected grader's
published rubric. It does not claim to reproduce an official grade or TAG's
proprietary score. The grade estimate and local export actions each have their
own collapsible result section.

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

The app uses native ONNX Runtime code, so use an Expo development build rather
than Expo Go. After adding or updating native dependencies or changing
`app.json`, regenerate native projects before rebuilding:

```powershell
npx expo prebuild --clean
npx expo run:android
```

Do not commit card photos, training data, private API keys, or unlicensed model
artifacts.
