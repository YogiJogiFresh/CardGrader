export const CAPTURE_VIEW_IDS = [
  'front-straight',
  'back-straight',
  'front-oblique-left',
  'front-oblique-right',
  'back-oblique-left',
  'back-oblique-right',
] as const;

export type CaptureViewId = (typeof CAPTURE_VIEW_IDS)[number];

export interface CaptureStep {
  id: CaptureViewId;
  title: string;
  instruction: string;
}

export interface CapturedImage {
  uri: string;
  width: number;
  height: number;
}

export interface Capture {
  id: string;
  viewId: CaptureViewId;
  uri: string;
  width: number;
  height: number;
  capturedAt: string;
}

export const CAPTURE_STEPS: readonly CaptureStep[] = [
  {
    id: 'front-straight',
    title: 'Front, straight on',
    instruction: 'Hold the camera parallel to the card and fill the guide.',
  },
  {
    id: 'back-straight',
    title: 'Back, straight on',
    instruction: 'Flip the card without changing the light or distance.',
  },
  {
    id: 'front-oblique-left',
    title: 'Front, light from left',
    instruction: 'Tilt slowly until the light reveals the surface texture.',
  },
  {
    id: 'front-oblique-right',
    title: 'Front, light from right',
    instruction: 'Use the opposite tilt to reveal scratches and print lines.',
  },
  {
    id: 'back-oblique-left',
    title: 'Back, light from left',
    instruction: 'Keep every corner visible while tilting the card.',
  },
  {
    id: 'back-oblique-right',
    title: 'Back, light from right',
    instruction: 'Use the opposite tilt and avoid covering an edge.',
  },
] as const;

export function createCapture(
  viewId: CaptureViewId,
  image: CapturedImage,
): Capture {
  const capturedAt = new Date().toISOString();

  return {
    id: `${viewId}-${capturedAt}`,
    viewId,
    uri: image.uri,
    width: image.width,
    height: image.height,
    capturedAt,
  };
}
