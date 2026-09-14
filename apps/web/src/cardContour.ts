import type { CenteringCorners } from './centering';

export interface CardContourDiagnostics {
  score: number;
  sideCoverage: [number, number, number, number];
  minimumSideCoverage: number;
  meanSideCoverage: number;
  aspectScore: number;
  geometryScore: number;
  rectangularity: number;
  guideScore: number;
  guideDistance: number;
  agreementScore: number;
  variantCount: number;
}

export interface CardContourResult {
  corners: CenteringCorners;
  diagnostics: CardContourDiagnostics;
}

interface ContourWorkerRequest {
  id: number;
  pixels: ArrayBuffer;
  width: number;
  height: number;
  guide?: CenteringCorners;
}

interface ContourWorkerResponse {
  id: number;
  result?: CardContourResult | null;
  error?: string;
}

interface PendingRequest {
  resolve: (result: CardContourResult | null) => void;
  reject: (error: Error) => void;
  timer: number;
}

let worker: Worker | undefined;
let nextRequestId = 1;
const pendingRequests = new Map<number, PendingRequest>();

export function detectCardContour(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  guide?: CenteringCorners,
): Promise<CardContourResult | null> {
  const activeWorker = getWorker();
  const id = nextRequestId;
  nextRequestId += 1;
  const transferablePixels = pixels.slice().buffer;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      failWorker(
        new Error(
          'The local card contour worker did not respond within 30 seconds.',
        ),
      );
    }, 30_000);
    pendingRequests.set(id, { resolve, reject, timer });
    const request: ContourWorkerRequest = {
      id,
      pixels: transferablePixels,
      width,
      height,
      guide,
    };
    activeWorker.postMessage(request, [transferablePixels]);
  });
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./cardContour.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', (event) => {
    failWorker(
      new Error(event.message || 'The local card contour worker failed.'),
    );
  });
  worker.addEventListener('messageerror', () => {
    failWorker(
      new Error('The local card contour worker returned an unreadable result.'),
    );
  });
  return worker;
}

function handleWorkerMessage(event: MessageEvent<ContourWorkerResponse>) {
  const request = pendingRequests.get(event.data.id);
  if (!request) return;
  pendingRequests.delete(event.data.id);
  window.clearTimeout(request.timer);
  if (event.data.error) {
    request.reject(new Error(event.data.error));
    return;
  }
  request.resolve(event.data.result ?? null);
}

function failWorker(error: Error) {
  for (const request of pendingRequests.values()) {
    window.clearTimeout(request.timer);
    request.reject(error);
  }
  pendingRequests.clear();
  worker?.terminate();
  worker = undefined;
}
