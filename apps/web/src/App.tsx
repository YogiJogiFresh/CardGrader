import {
  CAPTURE_STEPS,
  Capture,
  CaptureViewId,
  createCapture,
} from '@cardgrader/domain';
import {
  ChangeEvent,
  DragEvent,
  ReactNode,
  RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  analyzeCentering,
  analyzeCenteringWithOuterBounds,
  CenteringBounds,
  CenteringMeasurement,
} from './centering';
import { CenteringResults } from './CenteringResults';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

type CaptureMethod = 'camera' | 'upload';

type CameraState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'ready'; stream: MediaStream }
  | { status: 'unavailable'; message: string };

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraFrameRef = useRef<HTMLDivElement>(null);
  const cameraGuideRef = useRef<HTMLDivElement>(null);
  const singleFileInputRef = useRef<HTMLInputElement>(null);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);
  const cameraSectionRef = useRef<HTMLDivElement>(null);
  const uploadSectionRef = useRef<HTMLDivElement>(null);
  const reviewSectionRef = useRef<HTMLDivElement>(null);
  const centeringSectionRef = useRef<HTMLDivElement>(null);
  const previousCaptureCountRef = useRef(0);
  const previousCenteringReadyRef = useRef(false);
  const [camera, setCamera] = useState<CameraState>({ status: 'idle' });
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [captureMethod, setCaptureMethod] = useState<CaptureMethod | null>(
    null,
  );
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [centeringOpen, setCenteringOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzingCentering, setIsAnalyzingCentering] = useState(false);
  const [centeringMeasurements, setCenteringMeasurements] = useState<
    CenteringMeasurement[] | null
  >(null);
  const [centeringError, setCenteringError] = useState<string | null>(null);
  const [cameraGuideBounds, setCameraGuideBounds] = useState<
    Record<string, CenteringBounds>
  >({});
  const [failedCenteringCaptureIds, setFailedCenteringCaptureIds] = useState<
    string[]
  >([]);
  const [uploadFeedback, setUploadFeedback] = useState<{
    kind: 'error' | 'success';
    message: string;
  } | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const assignedViewIds = new Set(
    captures.map((capture) => capture.viewId),
  );
  const currentStep = CAPTURE_STEPS.find(
    (step) => !assignedViewIds.has(step.id),
  );
  const canCalculateCentering =
    assignedViewIds.has('front-straight') &&
    assignedViewIds.has('back-straight');

  useEffect(() => {
    const onUpdate = () => setUpdateAvailable(true);
    window.addEventListener('cardgrader:update-available', onUpdate);
    return () =>
      window.removeEventListener('cardgrader:update-available', onUpdate);
  }, []);

  useEffect(() => {
    if (camera.status === 'ready' && videoRef.current) {
      videoRef.current.srcObject = camera.stream;
    }

    return () => {
      if (camera.status === 'ready') {
        camera.stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [camera]);

  useEffect(() => {
    if (!currentStep && camera.status === 'ready') {
      camera.stream.getTracks().forEach((track) => track.stop());
      setCamera({ status: 'idle' });
    }
  }, [camera, currentStep]);

  useEffect(() => {
    const captureAdded = captures.length > previousCaptureCountRef.current;
    const centeringJustBecameReady =
      canCalculateCentering && !previousCenteringReadyRef.current;

    previousCaptureCountRef.current = captures.length;
    previousCenteringReadyRef.current = canCalculateCentering;

    if (!captureAdded) {
      return;
    }

    setReviewOpen(true);
    if (centeringJustBecameReady || !currentStep) {
      setCenteringOpen(true);
      scrollToSection(centeringSectionRef);
      return;
    }

    if (captureMethod === 'camera') {
      setCameraOpen(true);
      scrollToSection(cameraSectionRef);
    } else {
      setUploadOpen(true);
      scrollToSection(uploadSectionRef);
    }
  }, [canCalculateCentering, captureMethod, captures.length, currentStep]);

  function chooseCaptureMethod(method: CaptureMethod) {
    setCaptureMethod(method);
    setCameraOpen(method === 'camera');
    setUploadOpen(method === 'upload');
    if (method === 'upload') {
      stopCamera();
      scrollToSection(uploadSectionRef);
    } else {
      scrollToSection(cameraSectionRef);
    }
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera({
        status: 'unavailable',
        message: 'Live camera is unavailable. Use the photo picker instead.',
      });
      return;
    }

    setCamera({ status: 'starting' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      setCamera({ status: 'ready', stream });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Camera permission failed.';
      setCamera({
        status: 'unavailable',
        message: `${message} You can still select a photo.`,
      });
    }
  }

  function stopCamera() {
    if (camera.status === 'ready') {
      camera.stream.getTracks().forEach((track) => track.stop());
    }
    setCamera({ status: 'idle' });
  }

  async function captureFrame() {
    const video = videoRef.current;
    if (!video || !currentStep || video.videoWidth === 0) {
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setCamera({
        status: 'unavailable',
        message: 'This browser cannot prepare camera images.',
      });
      return;
    }

    context.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.95),
    );
    if (!blob) {
      return;
    }

    const guideBounds = calculateCameraGuideBounds(
      video,
      cameraFrameRef.current,
      cameraGuideRef.current,
    );
    addCapture(
      currentStep.id,
      blob,
      canvas.width,
      canvas.height,
      guideBounds ?? undefined,
    );
  }

  async function chooseCurrentPhoto(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    await uploadFiles(files.slice(0, 1));
  }

  async function chooseRemainingPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    await uploadFiles(files);
  }

  async function dropPhotos(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (isUploading) {
      return;
    }

    await uploadFiles(Array.from(event.dataTransfer.files));
  }

  async function uploadFiles(files: File[]) {
    const assignedViews = new Set(
      captures.map((capture) => capture.viewId),
    );
    const availableSteps = CAPTURE_STEPS.filter(
      (step) => !assignedViews.has(step.id),
    );
    if (availableSteps.length === 0 || files.length === 0) {
      return;
    }

    const validFiles = files.filter(
      (file) =>
        file.type.startsWith('image/') && file.size <= MAX_IMAGE_BYTES,
    );
    const rejectedCount = files.length - validFiles.length;
    const selectedFiles = validFiles.slice(0, availableSteps.length);
    const overflowCount = validFiles.length - selectedFiles.length;

    if (selectedFiles.length === 0) {
      setUploadFeedback({
        kind: 'error',
        message:
          'No usable images were selected. Choose image files no larger than 25 MB each.',
      });
      return;
    }

    stopCamera();
    setIsUploading(true);
    setUploadFeedback(null);
    try {
      const settled = await Promise.allSettled(
        selectedFiles.map((file, index) =>
          createCaptureFromFile(availableSteps[index].id, file),
        ),
      );
      const uploaded = settled.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const unreadableCount = settled.length - uploaded.length;

      setCaptures((current) => [...current, ...uploaded]);
      clearCentering();

      const skippedCount = rejectedCount + overflowCount + unreadableCount;
      setUploadFeedback({
        kind: skippedCount > 0 ? 'error' : 'success',
        message:
          skippedCount > 0
            ? `Added ${uploaded.length} photo${
                uploaded.length === 1 ? '' : 's'
              }. Skipped ${skippedCount} invalid, oversized, unreadable, or extra file${
                skippedCount === 1 ? '' : 's'
              }.`
            : `Added ${uploaded.length} photo${
                uploaded.length === 1 ? '' : 's'
              } to the remaining capture views.`,
      });
    } finally {
      setIsUploading(false);
    }
  }

  function addCapture(
    viewId: CaptureViewId,
    blob: Blob,
    width: number,
    height: number,
    guideBounds?: CenteringBounds,
  ) {
    const uri = URL.createObjectURL(blob);
    const capture = createCapture(viewId, { uri, width, height });
    setCaptures((current) => [...current, capture]);
    if (guideBounds) {
      setCameraGuideBounds((current) => ({
        ...current,
        [capture.id]: guideBounds,
      }));
    }
    clearCentering();
  }

  function removeLastCapture() {
    const last = captures.at(-1);
    if (last) {
      URL.revokeObjectURL(last.uri);
      setCameraGuideBounds((bounds) => withoutKey(bounds, last.id));
    }
    setCaptures((current) => current.slice(0, -1));
    clearCentering();
  }

  function removeCapture(captureId: string) {
    const removed = captures.find((capture) => capture.id === captureId);
    if (removed) {
      URL.revokeObjectURL(removed.uri);
      setCameraGuideBounds((bounds) => withoutKey(bounds, removed.id));
    }
    setCaptures((current) =>
      current.filter((capture) => capture.id !== captureId),
    );
    setUploadFeedback({
      kind: 'success',
      message: 'Picture removed. Upload or capture a replacement for its view.',
    });
    clearCentering();
  }

  function reassignCapture(captureId: string, targetViewId: CaptureViewId) {
    setCaptures((current) => {
      const selected = current.find((capture) => capture.id === captureId);
      if (!selected || selected.viewId === targetViewId) {
        return current;
      }

      const conflicting = current.find(
        (capture) => capture.viewId === targetViewId,
      );

      return current.map((capture) => {
        if (capture.id === captureId) {
          return { ...capture, viewId: targetViewId };
        }

        if (conflicting && capture.id === conflicting.id) {
          return { ...capture, viewId: selected.viewId };
        }

        return capture;
      });
    });
    clearCentering();
  }

  function reset() {
    captures.forEach((capture) => URL.revokeObjectURL(capture.uri));
    setCaptures([]);
    setCameraGuideBounds({});
    setCaptureMethod(null);
    setCameraOpen(false);
    setUploadOpen(false);
    setReviewOpen(false);
    setCenteringOpen(false);
    previousCaptureCountRef.current = 0;
    previousCenteringReadyRef.current = false;
    setUploadFeedback(null);
    clearCentering();
  }

  function clearCentering() {
    setCenteringMeasurements(null);
    setCenteringError(null);
    setFailedCenteringCaptureIds([]);
  }

  async function calculateCentering(useCameraGuides = false) {
    const straightCaptures = ['front-straight', 'back-straight'].map(
      (viewId) =>
        captures.find((capture) => capture.viewId === viewId),
    );

    if (straightCaptures.some((capture) => !capture)) {
      setCenteringError(
        'Front and back straight-on pictures are required for centering.',
      );
      return;
    }

    setIsAnalyzingCentering(true);
    setCenteringError(null);
    try {
      const results = await Promise.allSettled(
        straightCaptures.map((capture) => {
          const resolvedCapture = capture!;
          const guideBounds = cameraGuideBounds[resolvedCapture.id];
          return useCameraGuides && guideBounds
            ? analyzeCenteringWithOuterBounds(resolvedCapture, guideBounds)
            : analyzeCentering(resolvedCapture);
        }),
      );
      const failedIds = results.flatMap((result, index) =>
        result.status === 'rejected' ? [straightCaptures[index]!.id] : [],
      );
      if (failedIds.length > 0) {
        setFailedCenteringCaptureIds(failedIds);
        const failure = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected',
        );
        throw failure?.reason;
      }
      const measurements = results.map(
        (result) =>
          (result as PromiseFulfilledResult<CenteringMeasurement>).value,
      );
      setFailedCenteringCaptureIds([]);
      setCenteringMeasurements(measurements);
      setCenteringOpen(true);
      scrollToSection(centeringSectionRef);
    } catch (error) {
      setCenteringMeasurements(null);
      setCenteringError(
        error instanceof Error
          ? error.message
          : 'Centering analysis could not be completed.',
      );
    } finally {
      setIsAnalyzingCentering(false);
    }
  }

  function navigateToSection(id: string) {
    if (id === 'capture-camera') {
      setCaptureMethod('camera');
      setCameraOpen(true);
      setUploadOpen(false);
    } else if (id === 'capture-upload') {
      setCaptureMethod('upload');
      setUploadOpen(true);
      setCameraOpen(false);
      stopCamera();
    } else if (id === 'capture-review') {
      setReviewOpen(true);
    } else if (
      id === 'centering-analysis' ||
      id === 'front-inspection' ||
      id === 'back-inspection' ||
      id === 'grade-estimate' ||
      id === 'local-results'
    ) {
      setCenteringOpen(true);
    }

    scrollToElement(id);
  }

  const shortcutItems: WorkflowShortcut[] = [
    ...(currentStep
      ? [
          { id: 'capture-method', label: 'Choose input' },
          { id: 'capture-camera', label: 'Camera' },
          { id: 'capture-upload', label: 'Upload' },
        ]
      : []),
    ...(captures.length > 0
      ? [{ id: 'capture-review', label: 'Review photos' }]
      : []),
    ...(canCalculateCentering
      ? [{ id: 'centering-analysis', label: 'Centering' }]
      : []),
    ...(centeringMeasurements
      ? [
          { id: 'front-inspection', label: 'Front inspection' },
          { id: 'back-inspection', label: 'Back inspection' },
          { id: 'grade-estimate', label: 'Grade estimate' },
          { id: 'local-results', label: 'Local results' },
        ]
      : []),
  ];

  if (!currentStep) {
    return (
      <>
        <WorkflowShortcuts
          items={shortcutItems}
          onNavigate={navigateToSection}
        />
        <main className="shell completion">
          <p className="eyebrow">CAPTURE COMPLETE</p>
          <h1>{captures.length} views collected</h1>
          <p>
            Review the pictures, calculate centering, inspect blemishes, and
            compare the evidence against an unofficial grading range.
          </p>
          <div className="notice">
            <strong>Images remain local.</strong>
            <span>
            These previews remain temporary in this browser tab. Export a
            report before closing the page if you want to keep the results.
            </span>
          </div>
          <CollapsibleSection
            eyebrow="REVIEW"
            id="capture-review"
            onOpenChange={setReviewOpen}
            open={reviewOpen}
            sectionRef={reviewSectionRef}
            summary={`${captures.length} assigned view${captures.length === 1 ? '' : 's'}`}
            title="Added pictures"
          >
            <CapturePreviews
            captures={captures}
            onRemove={removeCapture}
            onReassign={reassignCapture}
            />
          </CollapsibleSection>
          <CollapsibleSection
            eyebrow="ANALYZE"
            id="centering-analysis"
            onOpenChange={setCenteringOpen}
            open={centeringOpen}
            sectionRef={centeringSectionRef}
            summary={
            centeringMeasurements
              ? 'Results and inspection tools ready'
              : 'Front and back ready'
            }
            title="Centering and inspection"
          >
            <CenteringAnalysisPanel
            captures={captures}
            error={centeringError}
            isAnalyzing={isAnalyzingCentering}
            measurements={centeringMeasurements}
            canOverride={
              failedCenteringCaptureIds.length > 0 &&
              failedCenteringCaptureIds.every(
                (captureId) => cameraGuideBounds[captureId],
              )
            }
            onCalculate={() => void calculateCentering()}
            onOverride={() => void calculateCentering(true)}
            />
          </CollapsibleSection>
          <button className="primary" onClick={reset}>
            Start another capture
          </button>
        </main>
      </>
    );
  }

  return (
    <>
      <WorkflowShortcuts items={shortcutItems} onNavigate={navigateToSection} />
      <main className="shell">
        {updateAvailable ? (
          <div className="update">
            A new version is available. Finish this capture before refreshing.
          </div>
        ) : null}
        <header>
          <p className="eyebrow">
            VIEW {captures.length + 1} OF {CAPTURE_STEPS.length}
          </p>
          <h1>{currentStep.title}</h1>
          <p>{currentStep.instruction}</p>
        </header>

        <section className="capture-method-picker" id="capture-method">
          <div>
            <p className="eyebrow">CHOOSE INPUT</p>
            <h2>How would you like to add this picture?</h2>
            <p>You can switch methods at any time without losing added photos.</p>
          </div>
          <div className="capture-method-options">
            <button
            aria-pressed={captureMethod === 'camera'}
            className={
              captureMethod === 'camera'
                ? 'method-card selected'
                : 'method-card'
            }
            onClick={() => chooseCaptureMethod('camera')}
            type="button"
            >
            <strong>Use camera</strong>
            <span>Take each required view in the browser.</span>
            </button>
            <button
            aria-pressed={captureMethod === 'upload'}
            className={
              captureMethod === 'upload'
                ? 'method-card selected'
                : 'method-card'
            }
            onClick={() => chooseCaptureMethod('upload')}
            type="button"
            >
            <strong>Upload photos</strong>
            <span>Select one picture or add several in capture order.</span>
            </button>
          </div>
        </section>

        <CollapsibleSection
          eyebrow="CAMERA"
          id="capture-camera"
          onOpenChange={(open) => {
            setCameraOpen(open);
            if (open) {
            setCaptureMethod('camera');
            setUploadOpen(false);
            }
            if (!open) {
            stopCamera();
            }
          }}
          open={cameraOpen}
          sectionRef={cameraSectionRef}
          summary={currentStep.title}
          title="Take the next picture"
        >
          <div className="camera-panel">
            {camera.status === 'ready' ? (
            <div className="camera-frame" ref={cameraFrameRef}>
              <video ref={videoRef} autoPlay muted playsInline />
              <div
                className="card-guide"
                aria-hidden="true"
                ref={cameraGuideRef}
              />
            </div>
            ) : (
            <div className="camera-placeholder">
              <span>Camera preview</span>
              <small>
                HTTPS or localhost is required. No image leaves this device.
              </small>
            </div>
            )}

            {camera.status === 'unavailable' ? (
            <p className="error" role="alert">
              {camera.message}
            </p>
            ) : null}

            <div className="actions">
            {camera.status === 'ready' ? (
              <>
                <button className="primary" onClick={captureFrame}>
                  Capture this view
                </button>
                <button className="secondary" onClick={stopCamera}>
                  Stop camera
                </button>
              </>
            ) : (
              <button
                className="primary"
                disabled={camera.status === 'starting'}
                onClick={startCamera}
              >
                {camera.status === 'starting'
                  ? 'Starting camera...'
                  : 'Start camera'}
              </button>
            )}
            {captures.length > 0 ? (
              <button className="link" onClick={removeLastCapture}>
                Retake previous view
              </button>
            ) : null}
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          eyebrow="UPLOAD"
          id="capture-upload"
          onOpenChange={(open) => {
            setUploadOpen(open);
            if (open) {
            setCaptureMethod('upload');
            setCameraOpen(false);
            stopCamera();
            }
          }}
          open={uploadOpen}
          sectionRef={uploadSectionRef}
          summary={`${CAPTURE_STEPS.length - assignedViewIds.size} view${
            CAPTURE_STEPS.length - assignedViewIds.size === 1 ? '' : 's'
          } remaining`}
          title="Upload card pictures"
        >
          <div className="upload-panel">
            <button
            className="primary"
            disabled={isUploading}
            onClick={() => singleFileInputRef.current?.click()}
            >
            Upload {currentStep.title}
            </button>
            <input
            ref={singleFileInputRef}
            className="visually-hidden"
            type="file"
            accept="image/*"
            onChange={chooseCurrentPhoto}
            />
            <div>
            <h3>Add several pictures at once</h3>
            <p>
              Select up to {CAPTURE_STEPS.length - assignedViewIds.size}{' '}
              remaining photos in capture order. Each file is assigned to the
              next required view.
            </p>
            </div>
            <div
            className={`drop-zone${isUploading ? ' drop-zone-busy' : ''}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={dropPhotos}
            >
            <strong>
              {isUploading ? 'Preparing photos...' : 'Drop card photos here'}
            </strong>
            <span>
              JPEG, PNG, HEIC, or another browser-supported image format
            </span>
            <button
              className="secondary"
              disabled={isUploading}
              onClick={() => bulkFileInputRef.current?.click()}
            >
              {isUploading ? 'Uploading...' : 'Choose multiple pictures'}
            </button>
            <input
              ref={bulkFileInputRef}
              className="visually-hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={chooseRemainingPhotos}
            />
            </div>
            {uploadFeedback ? (
            <p
              className={`upload-feedback upload-feedback-${uploadFeedback.kind}`}
              role="status"
            >
              {uploadFeedback.message}
            </p>
            ) : null}
          </div>
        </CollapsibleSection>

        {captures.length > 0 ? (
          <CollapsibleSection
            eyebrow="REVIEW"
            id="capture-review"
            onOpenChange={setReviewOpen}
            open={reviewOpen}
            sectionRef={reviewSectionRef}
            summary={`${captures.length} of ${CAPTURE_STEPS.length} views added`}
            title="Review added pictures"
          >
            <p>
            Use the selector below a picture to correct its assigned view.
            Existing assignments are swapped automatically.
            </p>
            <CapturePreviews
            captures={captures}
            onRemove={removeCapture}
            onReassign={reassignCapture}
            />
          </CollapsibleSection>
        ) : null}

        {canCalculateCentering ? (
          <CollapsibleSection
            eyebrow="ANALYZE"
            id="centering-analysis"
            onOpenChange={setCenteringOpen}
            open={centeringOpen}
            sectionRef={centeringSectionRef}
            summary={
            centeringMeasurements
              ? 'Results and inspection tools ready'
              : 'Front and back ready'
            }
            title="Centering and inspection"
          >
            <CenteringAnalysisPanel
            captures={captures}
            error={centeringError}
            isAnalyzing={isAnalyzingCentering}
            measurements={centeringMeasurements}
            canOverride={
              failedCenteringCaptureIds.length > 0 &&
              failedCenteringCaptureIds.every(
                (captureId) => cameraGuideBounds[captureId],
              )
            }
            onCalculate={() => void calculateCentering()}
            onOverride={() => void calculateCentering(true)}
            />
          </CollapsibleSection>
        ) : null}

        <footer>
          Remove sleeves and top loaders. Use a dark matte background and avoid
          glare.
        </footer>
      </main>
    </>
  );
}

interface WorkflowShortcut {
  id: string;
  label: string;
}

function WorkflowShortcuts({
  items,
  onNavigate,
}: {
  items: WorkflowShortcut[];
  onNavigate: (id: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <nav className="workflow-shortcuts" aria-label="Workflow shortcuts">
      <strong>Jump to</strong>
      <div>
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function CollapsibleSection({
  children,
  eyebrow,
  id,
  onOpenChange,
  open,
  sectionRef,
  summary,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  id: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  sectionRef: RefObject<HTMLDivElement | null>;
  summary: string;
  title: string;
}) {
  return (
    <div className="workflow-section" id={id} ref={sectionRef}>
      <button
        aria-expanded={open}
        className="workflow-section-toggle"
        onClick={() => onOpenChange(!open)}
        type="button"
      >
        <span>
          <small>{eyebrow}</small>
          <strong>{title}</strong>
          <span>{summary}</span>
        </span>
        <span aria-hidden="true" className="workflow-toggle-icon">
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? <div className="workflow-section-content">{children}</div> : null}
    </div>
  );
}

function scrollToSection(sectionRef: RefObject<HTMLDivElement | null>) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  });
}

function scrollToElement(id: string) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent<string>('cardgrader:open-section', { detail: id }),
      );
      document.getElementById(id)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  });
}

function calculateCameraGuideBounds(
  video: HTMLVideoElement,
  frame: HTMLDivElement | null,
  guide: HTMLDivElement | null,
): CenteringBounds | null {
  if (!frame || !guide || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return null;
  }

  const frameRect = frame.getBoundingClientRect();
  const guideRect = guide.getBoundingClientRect();
  if (frameRect.width <= 0 || frameRect.height <= 0) {
    return null;
  }

  const scale = Math.max(
    frameRect.width / video.videoWidth,
    frameRect.height / video.videoHeight,
  );
  const renderedWidth = video.videoWidth * scale;
  const renderedHeight = video.videoHeight * scale;
  const renderedLeft = (frameRect.width - renderedWidth) / 2;
  const renderedTop = (frameRect.height - renderedHeight) / 2;

  return {
    left: clampUnit(
      (guideRect.left - frameRect.left - renderedLeft) / renderedWidth,
    ),
    top: clampUnit(
      (guideRect.top - frameRect.top - renderedTop) / renderedHeight,
    ),
    right: clampUnit(
      (guideRect.right - frameRect.left - renderedLeft) / renderedWidth,
    ),
    bottom: clampUnit(
      (guideRect.bottom - frameRect.top - renderedTop) / renderedHeight,
    ),
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function withoutKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

function CenteringAnalysisPanel({
  canOverride,
  captures,
  error,
  isAnalyzing,
  measurements,
  onCalculate,
  onOverride,
}: {
  canOverride: boolean;
  captures: Capture[];
  error: string | null;
  isAnalyzing: boolean;
  measurements: CenteringMeasurement[] | null;
  onCalculate: () => void;
  onOverride: () => void;
}) {
  return (
    <section className="centering-analysis-panel">
      {!measurements ? (
        <div className="notice">
          <strong>Front and back are ready.</strong>
          <span>
            You can calculate centering now. The four angled pictures are
            optional for this measurement.
          </span>
        </div>
      ) : null}
      {measurements ? (
        <CenteringResults captures={captures} measurements={measurements} />
      ) : null}
      {error ? (
        <>
          <p className="error" role="alert">
            {error}
          </p>
          {canOverride ? (
            <div className="centering-override">
              <p>
                Continue with the guide that was visible over the camera
                preview. It will become the cyan card-edge overlay and can be
                adjusted before using the estimate.
              </p>
              <button
                className="secondary"
                disabled={isAnalyzing}
                onClick={onOverride}
                type="button"
              >
                Use camera guides and continue
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      <button
        className="primary"
        disabled={isAnalyzing}
        onClick={onCalculate}
        type="button"
      >
        {isAnalyzing
          ? 'Calculating centering...'
          : measurements
            ? 'Recalculate centering'
            : 'Calculate centering'}
      </button>
    </section>
  );
}

function CapturePreviews({
  captures,
  onRemove,
  onReassign,
}: {
  captures: Capture[];
  onRemove: (captureId: string) => void;
  onReassign: (captureId: string, viewId: CaptureViewId) => void;
}) {
  return (
    <div className="thumbnail-grid">
      {captures.map((capture) => (
        <figure key={capture.id}>
          <img src={capture.uri} alt={viewLabel(capture.viewId)} />
          <figcaption>
            <label>
              <span>Assigned view</span>
              <select
                aria-label={`Assigned view for ${viewLabel(capture.viewId)}`}
                value={capture.viewId}
                onChange={(event) =>
                  onReassign(
                    capture.id,
                    event.target.value as CaptureViewId,
                  )
                }
              >
                {CAPTURE_STEPS.map((step) => (
                  <option key={step.id} value={step.id}>
                    {step.title}
                  </option>
                ))}
              </select>
              <button
                className="remove-picture"
                type="button"
                onClick={() => onRemove(capture.id)}
              >
                Remove picture
              </button>
            </label>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function viewLabel(viewId: CaptureViewId): string {
  return (
    CAPTURE_STEPS.find((step) => step.id === viewId)?.title ??
    viewId.replaceAll('-', ' ')
  );
}

async function createCaptureFromFile(
  viewId: CaptureViewId,
  file: File,
): Promise<Capture> {
  const dimensions = await readImageDimensions(file);
  const uri = URL.createObjectURL(file);
  return createCapture(viewId, {
    uri,
    width: dimensions.width,
    height: dimensions.height,
  });
}

async function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
    });
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () =>
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('The selected image is invalid.'));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
