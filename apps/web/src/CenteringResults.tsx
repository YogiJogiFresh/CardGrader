import { Capture } from '@cardgrader/domain';
import {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { CenteringBounds, CenteringMeasurement } from './centering';
import {
  ComparisonGrader,
  estimateGrade,
  graderLabel,
  graderRubricUrl,
} from './gradeEstimate';
import {
  analyzeImageQuality,
  BlemishAnnotation,
  CornerName,
  createReportPng,
  EditableGuides,
  GuideCorners,
  InspectionFilter,
  InspectionReportInput,
  PercentagePair,
  printReport,
  QualityCheck,
  renderInspectionImage,
} from './inspection';
type OverlayKind = 'outer' | 'inner';
type BalanceStatus = 'good' | 'fair' | 'poor';
type Point = GuideCorners['topLeft'];
type AsyncState = 'idle' | 'busy' | 'success' | 'error';
type QualityState = 'loading' | 'ready' | 'error';

interface DragState {
  kind: OverlayKind;
  corner: CornerName;
  pointerId: number;
  point: Point;
  frameWidth: number;
  frameHeight: number;
}

interface InspectionViewDrag {
  pointerId: number;
  startX: number;
  startY: number;
  panX: number;
  panY: number;
}

interface AnnotationDrag {
  annotationId: string;
  pointerId: number;
}

interface InspectionPointer {
  pane: HTMLDivElement;
  x: number;
  y: number;
}

interface PendingAnnotation {
  pointerId: number;
  startX: number;
  startY: number;
}

interface InspectionPinch {
  pointerIds: [number, number];
  startCenter: Point;
  startDistance: number;
  startPan: Point;
  startZoom: number;
}

interface SideSnapshot {
  capture: Capture;
  guides: EditableGuides;
  horizontal: PercentagePair;
  vertical: PercentagePair;
  qualityChecks: QualityCheck[];
  qualityState: QualityState;
  annotations: BlemishAnnotation[];
}

const ZOOM_PREVIEW_SIZE = 144;
const ZOOM_SCALE = 3.5;
const ANNOTATION_DRAG_THRESHOLD = 4;
const INSPECTION_FILTERS: { value: InspectionFilter; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'negative', label: 'Negative' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'contrast', label: 'Enhanced contrast' },
  { value: 'edges', label: 'Edge detail' },
];
const BLEMISH_TYPES: BlemishAnnotation['type'][] = [
  'scratch',
  'whitening',
  'dent',
  'stain',
  'print-line',
  'other',
];
const CORNERS: CornerName[] = [
  'topLeft',
  'topRight',
  'bottomRight',
  'bottomLeft',
];

export function CenteringResults({
  captures,
  measurements,
}: {
  captures: Capture[];
  measurements: CenteringMeasurement[];
}) {
  const [overlayOpacity, setOverlayOpacity] = useState(90);
  const [handleSize, setHandleSize] = useState(12);
  const [zoomEnabled, setZoomEnabled] = useState(true);
  const [snapshots, setSnapshots] = useState<Record<string, SideSnapshot>>({});
  const [reportState, setReportState] = useState<AsyncState>('idle');
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [comparisonGrader, setComparisonGrader] =
    useState<ComparisonGrader>('psa');

  const updateSnapshot = useCallback((snapshot: SideSnapshot) => {
    setSnapshots((current) => ({
      ...current,
      [snapshot.capture.id]: snapshot,
    }));
  }, []);

  const frontSnapshot = findSnapshot(
    snapshots,
    measurements,
    'front-straight',
  );
  const backSnapshot = findSnapshot(
    snapshots,
    measurements,
    'back-straight',
  );
  const actionsReady =
    Boolean(frontSnapshot && backSnapshot) &&
    frontSnapshot?.qualityState !== 'loading' &&
    backSnapshot?.qualityState !== 'loading';
  const gradeEstimate =
    frontSnapshot && backSnapshot
      ? estimateGrade(comparisonGrader, frontSnapshot, backSnapshot)
      : null;

  function buildReportInput(): InspectionReportInput {
    if (!frontSnapshot || !backSnapshot || !actionsReady) {
      throw new Error(
        'Both front and back inspections must finish before creating a report.',
      );
    }
    return {
      createdAt: new Date(),
      gradeComparison: gradeEstimate
        ? {
            graderLabel: gradeEstimate.graderLabel,
            minimum: gradeEstimate.minimum,
            maximum: gradeEstimate.maximum,
            mostLikely: gradeEstimate.mostLikely,
            confidence: gradeEstimate.confidence,
            methodologyNote: gradeEstimate.methodologyNote,
          }
        : undefined,
      sides: [
        snapshotToReportSide(frontSnapshot),
        snapshotToReportSide(backSnapshot),
      ],
    };
  }

  async function handleDownloadReport() {
    setReportState('busy');
    setReportMessage('Rendering PNG report…');
    try {
      const blob = await createReportPng(buildReportInput());
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cardgrader-inspection-${new Date()
        .toISOString()
        .slice(0, 10)}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setReportState('success');
      setReportMessage('PNG report downloaded.');
    } catch (error) {
      setReportState('error');
      setReportMessage(errorMessage(error, 'The PNG report could not be created.'));
    }
  }

  async function handlePrintReport() {
    setReportState('busy');
    setReportMessage('Opening printable report…');
    try {
      await printReport(buildReportInput());
      setReportState('success');
      setReportMessage('Print dialog opened. Choose Save as PDF to keep a PDF.');
    } catch (error) {
      setReportState('error');
      setReportMessage(errorMessage(error, 'The print dialog could not be opened.'));
    }
  }

  return (
    <section className="centering-results">
      <div>
        <p className="eyebrow">CENTERING ESTIMATE</p>
        <h2>Front and back measurements</h2>
        <p>
          Cyan marks the card edge. Yellow marks the inner frame. Drag any
          corner to match a slightly tilted card and update the percentages
          instantly.
        </p>
      </div>

      <div className="centering-score-legend" aria-label="Centering color key">
        <span className="score-good">Green: 55/45 or better</span>
        <span className="score-fair">Yellow: up to 60/40</span>
        <span className="score-poor">Red: beyond 60/40</span>
      </div>

      <div className="centering-overlay-controls">
        <label>
          <span>
            Overlay opacity <strong>{overlayOpacity}%</strong>
          </span>
          <input
            aria-label="Overlay opacity"
            max="100"
            min="20"
            onChange={(event) =>
              setOverlayOpacity(Number(event.target.value))
            }
            type="range"
            value={overlayOpacity}
          />
        </label>
        <label>
          <span>
            Corner size <strong>{handleSize}px</strong>
          </span>
          <input
            aria-label="Corner handle size"
            max="24"
            min="5"
            onChange={(event) => setHandleSize(Number(event.target.value))}
            type="range"
            value={handleSize}
          />
        </label>
        <label className="centering-zoom-toggle">
          <input
            checked={zoomEnabled}
            onChange={(event) => setZoomEnabled(event.target.checked)}
            type="checkbox"
          />
          <span>Show zoom preview while dragging</span>
        </label>
      </div>

      {measurements.map((measurement) => {
        const capture = captures.find(
          (candidate) => candidate.id === measurement.captureId,
        );
        if (!capture) {
          return null;
        }

        return (
          <EditableCenteringCard
            capture={capture}
            handleSize={handleSize}
            measurement={measurement}
            overlayOpacity={overlayOpacity / 100}
            zoomEnabled={zoomEnabled}
            onSnapshot={updateSnapshot}
            key={measurement.captureId}
          />
        );
      })}

      <CollapsibleResultSection
        eyebrow="GRADE ESTIMATE"
        id="grade-estimate"
        summary={`${graderLabel(comparisonGrader)} comparison`}
        title="Estimated grading range"
      >
        <section
          className="grade-comparison"
          aria-labelledby="grade-comparison-title"
        >
          <div className="grade-comparison-heading">
            <div>
              <p className="eyebrow">UNOFFICIAL COMPARISON</p>
              <h2 id="grade-comparison-title">Estimated grading range</h2>
              <p>
                Compare the measured centering and your blemish markers against
                a selected grader&apos;s published rubric.
              </p>
            </div>
            <div className="grader-selector">
              <label>
                Compare against
                <select
                  onChange={(event) =>
                    setComparisonGrader(
                      event.target.value as ComparisonGrader,
                    )
                  }
                  value={comparisonGrader}
                >
                  {(['psa', 'tag', 'cgc', 'beckett'] as ComparisonGrader[]).map(
                    (grader) => (
                      <option key={grader} value={grader}>
                        {graderLabel(grader)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <a
                aria-label={`Open ${graderLabel(comparisonGrader)} grading rubric`}
                className="grader-help-link"
                data-tooltip={`View ${graderLabel(comparisonGrader)} grading criteria`}
                href={graderRubricUrl(comparisonGrader)}
                rel="noreferrer"
                target="_blank"
              >
                ?
              </a>
            </div>
          </div>
          {gradeEstimate ? (
            <>
              <div className="grade-range-card">
                <span>{gradeEstimate.graderLabel} estimated range</span>
                <strong>
                  {formatEstimatedGrade(gradeEstimate.minimum)}–
                  {formatEstimatedGrade(gradeEstimate.maximum)}
                </strong>
                <small>
                  Most likely {formatEstimatedGrade(gradeEstimate.mostLikely)} ·{' '}
                  {Math.round(gradeEstimate.confidence * 100)}% evidence
                  confidence
                </small>
              </div>
              <div className="grade-category-grid">
                <GradeCategory
                  label="Centering ceiling"
                  value={gradeEstimate.centeringMaximum}
                />
                <GradeCategory
                  label="Corners ceiling"
                  value={gradeEstimate.categoryMaximums.corners}
                />
                <GradeCategory
                  label="Edges ceiling"
                  value={gradeEstimate.categoryMaximums.edges}
                />
                <GradeCategory
                  label="Surface ceiling"
                  value={gradeEstimate.categoryMaximums.surface}
                />
              </div>
              <div className="grade-explanation-grid">
                <div>
                  <h3>Limiting factors</h3>
                  <ul>
                    {gradeEstimate.limitingFactors.map((factor) => (
                      <li key={factor}>{factor}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>Evidence gaps</h3>
                  <ul>
                    {gradeEstimate.evidenceGaps.map((gap) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="grade-methodology">
                {gradeEstimate.methodologyNote}{' '}
                <a
                  href={gradeEstimate.sourceUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  View published rubric
                </a>
              </p>
            </>
          ) : (
            <p role="status">
              Preparing front and back evidence for the comparison…
            </p>
          )}
          <div className="notice">
            <strong>Not an official grade</strong>
            <span>
              This range is a pre-screening estimate generated from photographs
              and user-entered blemishes. The selected grading company has not
              reviewed or endorsed it.
            </span>
          </div>
        </section>
      </CollapsibleResultSection>

      <CollapsibleResultSection
        eyebrow="LOCAL RESULTS"
        id="local-results"
        summary="Save or export this inspection"
        title="Local results"
      >
        <section
          className="inspection-actions"
          aria-labelledby="inspection-actions-title"
        >
          <div>
            <p className="eyebrow">LOCAL RESULTS</p>
            <h2 id="inspection-actions-title">Export this inspection</h2>
            <p>
              Actions become available after quality checks finish for both card
              sides.
            </p>
          </div>
          <div className="inspection-action-buttons">
            <button
              className="primary"
              disabled={!actionsReady || reportState === 'busy'}
              onClick={() => void handleDownloadReport()}
              type="button"
            >
              Download PNG report
            </button>
            <button
              className="secondary"
              disabled={!actionsReady || reportState === 'busy'}
              onClick={() => void handlePrintReport()}
              type="button"
            >
              Print / Save PDF
            </button>
          </div>
          {reportMessage ? (
            <p
              className={`operation-status status-${reportState}`}
              role={reportState === 'error' ? 'alert' : 'status'}
            >
              {reportMessage}
            </p>
          ) : null}
          <p className="storage-note">
            Reports are generated locally and downloaded or printed only when
            you request them. Images are not uploaded by these controls.
          </p>
        </section>
      </CollapsibleResultSection>

      <div className="notice">
        <strong>Inspection aid only</strong>
        <span>
          Centering and image checks are estimates, not a grade prediction,
          authentication, or guarantee. Review the source images yourself.
        </span>
      </div>
    </section>
  );
}

function GradeCategory({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{formatEstimatedGrade(value)}</strong>
    </div>
  );
}

function CollapsibleResultSection({
  children,
  defaultOpen = true,
  eyebrow,
  id,
  summary,
  title,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  eyebrow: string;
  id: string;
  summary: string;
  title: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const openRequestedSection = (event: Event) => {
      if ((event as CustomEvent<string>).detail === id) {
        setOpen(true);
      }
    };
    window.addEventListener(
      'cardgrader:open-section',
      openRequestedSection,
    );
    return () =>
      window.removeEventListener(
        'cardgrader:open-section',
        openRequestedSection,
      );
  }, [id]);

  return (
    <section className="result-section" id={id}>
      <button
        aria-expanded={open}
        className="workflow-section-toggle"
        onClick={() => setOpen((current) => !current)}
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
      {open ? <div className="result-section-content">{children}</div> : null}
    </section>
  );
}

function formatEstimatedGrade(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function EditableCenteringCard({
  capture,
  handleSize,
  measurement,
  onSnapshot,
  overlayOpacity,
  zoomEnabled,
}: {
  capture: Capture;
  handleSize: number;
  measurement: CenteringMeasurement;
  onSnapshot: (snapshot: SideSnapshot) => void;
  overlayOpacity: number;
  zoomEnabled: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const filteredUrlRef = useRef<string | null>(null);
  const [guides, setGuides] = useState<EditableGuides>(() =>
    guidesFromMeasurement(measurement),
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  const [manuallyAdjusted, setManuallyAdjusted] = useState(false);
  const [filter, setFilter] = useState<InspectionFilter>('original');
  const [perspectiveCorrected, setPerspectiveCorrected] = useState(false);
  const [filteredUrl, setFilteredUrl] = useState<string | null>(null);
  const [filterLoading, setFilterLoading] = useState(true);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [qualityChecks, setQualityChecks] = useState<QualityCheck[]>([]);
  const [qualityState, setQualityState] = useState<QualityState>('loading');
  const [qualityError, setQualityError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<BlemishAnnotation[]>([]);
  const [annotationType, setAnnotationType] =
    useState<BlemishAnnotation['type']>('scratch');
  const [annotationNote, setAnnotationNote] = useState('');
  const [annotationMarkerSize, setAnnotationMarkerSize] = useState(26);
  const [annotationMarkerOpacity, setAnnotationMarkerOpacity] = useState(100);
  const [inspectionZoom, setInspectionZoom] = useState(1);
  const [inspectionPan, setInspectionPan] = useState({ x: 0, y: 0 });
  const inspectionDragRef = useRef<InspectionViewDrag | null>(null);
  const annotationDragRef = useRef<AnnotationDrag | null>(null);
  const inspectionPointersRef = useRef(
    new Map<number, InspectionPointer>(),
  );
  const pendingAnnotationRef = useRef<PendingAnnotation | null>(null);
  const inspectionPinchRef = useRef<InspectionPinch | null>(null);
  const suppressTouchRef = useRef(false);
  const percentages = useMemo(() => calculatePercentages(guides), [guides]);
  const horizontalStatus = balanceStatus(percentages.horizontal.first);
  const verticalStatus = balanceStatus(percentages.vertical.first);

  useEffect(() => {
    setGuides(guidesFromMeasurement(measurement));
    setManuallyAdjusted(false);
  }, [measurement]);

  useEffect(() => {
    let cancelled = false;
    setQualityState('loading');
    setQualityError(null);
    setQualityChecks([]);
    void analyzeImageQuality(capture.uri, capture.width, capture.height)
      .then((checks) => {
        if (cancelled) return;
        setQualityChecks(checks);
        setQualityState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setQualityError(errorMessage(error, 'Image quality could not be analyzed.'));
        setQualityState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [capture.height, capture.uri, capture.width]);

  useEffect(() => {
    let cancelled = false;
    const previousUrl = filteredUrlRef.current;
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
      filteredUrlRef.current = null;
    }
    setFilteredUrl(null);
    setFilterLoading(true);
    setFilterError(null);

    const timer = window.setTimeout(() => {
      void renderInspectionImage(
        capture.uri,
        filter,
        perspectiveCorrected ? guides.outer : undefined,
      )
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          filteredUrlRef.current = url;
          setFilteredUrl(url);
          setFilterLoading(false);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setFilterError(
            errorMessage(error, 'The inspection preview could not be rendered.'),
          );
          setFilterLoading(false);
        });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [capture.uri, filter, guides.outer, perspectiveCorrected]);

  useEffect(
    () => () => {
      if (filteredUrlRef.current) {
        URL.revokeObjectURL(filteredUrlRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    onSnapshot({
      capture,
      guides,
      horizontal: percentages.horizontal,
      vertical: percentages.vertical,
      qualityChecks,
      qualityState,
      annotations,
    });
  }, [
    annotations,
    capture,
    guides,
    onSnapshot,
    percentages,
    qualityChecks,
    qualityState,
  ]);

  function beginDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    kind: OverlayKind,
    corner: CornerName,
  ) {
    event.preventDefault();
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const rectangle = frame.getBoundingClientRect();
    frame.setPointerCapture(event.pointerId);
    setDrag({
      kind,
      corner,
      pointerId: event.pointerId,
      point: guides[kind][corner],
      frameWidth: rectangle.width,
      frameHeight: rectangle.height,
    });
  }

  function moveHandle(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const rectangle = frame.getBoundingClientRect();
    const point = {
      x: clamp((event.clientX - rectangle.left) / rectangle.width, 0, 1),
      y: clamp((event.clientY - rectangle.top) / rectangle.height, 0, 1),
    };

    setGuides((current) =>
      updateGuides(current, drag.kind, drag.corner, point),
    );
    setDrag((current) =>
      current && current.pointerId === event.pointerId
        ? { ...current, point }
        : current,
    );
    setManuallyAdjusted(true);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    const frame = frameRef.current;
    if (frame?.hasPointerCapture(event.pointerId)) {
      frame.releasePointerCapture(event.pointerId);
    }
    setDrag(null);
  }

  function resetGuides() {
    setGuides(guidesFromMeasurement(measurement));
    setManuallyAdjusted(false);
  }

  function nudgeHandle(
    kind: OverlayKind,
    corner: CornerName,
    x: number,
    y: number,
  ) {
    setGuides((current) =>
      updateGuides(current, kind, corner, {
        x: clamp(current[kind][corner].x + x, 0, 1),
        y: clamp(current[kind][corner].y + y, 0, 1),
      }),
    );
    setManuallyAdjusted(true);
  }

  function addAnnotationAt(x: number, y: number): string {
    const id = createId();
    setAnnotations((current) => [
      ...current,
      {
        id,
        type: annotationType,
        note: annotationNote.trim(),
        x: clamp(x, 0, 1),
        y: clamp(y, 0, 1),
      },
    ]);
    setAnnotationNote('');
    return id;
  }

  function beginInspectionInteraction(
    event: ReactPointerEvent<HTMLDivElement>,
    originalPane: boolean,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    const pane = event.currentTarget;
    if (event.pointerType === 'touch') {
      inspectionPointersRef.current.set(event.pointerId, {
        pane,
        x: event.clientX,
        y: event.clientY,
      });
      pane.setPointerCapture(event.pointerId);

      if (touchPointersForPane(pane).length >= 2) {
        beginInspectionPinch(pane);
        return;
      }

      if (suppressTouchRef.current) {
        return;
      }

      if (originalPane) {
        pendingAnnotationRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
        };
        return;
      }
    }

    const shouldPlaceAnnotation =
      originalPane && (event.pointerType !== 'mouse' || event.ctrlKey);
    if (shouldPlaceAnnotation) {
      const point = inspectionPoint(
        event.clientX,
        event.clientY,
        pane.getBoundingClientRect(),
        inspectionZoom,
        inspectionPan,
      );
      const annotationId = addAnnotationAt(point.x, point.y);
      pane.setPointerCapture(event.pointerId);
      annotationDragRef.current = {
        annotationId,
        pointerId: event.pointerId,
      };
      return;
    }
    pane.setPointerCapture(event.pointerId);
    inspectionDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: inspectionPan.x,
      panY: inspectionPan.y,
    };
  }

  function moveInspection(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch') {
      const activePointer = inspectionPointersRef.current.get(event.pointerId);
      if (activePointer) {
        inspectionPointersRef.current.set(event.pointerId, {
          ...activePointer,
          x: event.clientX,
          y: event.clientY,
        });
      }

      const pinch = inspectionPinchRef.current;
      if (pinch?.pointerIds.includes(event.pointerId)) {
        const [first, second] = pinch.pointerIds.map((pointerId) =>
          inspectionPointersRef.current.get(pointerId),
        );
        if (first && second) {
          const nextDistance = distanceBetweenPointers(first, second);
          const nextCenter = centerBetweenPointers(first, second);
          const nextZoom = clamp(
            pinch.startZoom * (nextDistance / pinch.startDistance),
            1,
            4,
          );
          const rectangle = event.currentTarget.getBoundingClientRect();
          setInspectionZoom(nextZoom);
          setInspectionPan(
            clampPan(
              {
                x:
                  pinch.startPan.x +
                  (nextCenter.x - pinch.startCenter.x),
                y:
                  pinch.startPan.y +
                  (nextCenter.y - pinch.startCenter.y),
              },
              nextZoom,
              rectangle.width,
              rectangle.height,
            ),
          );
        }
        return;
      }

      const pending = pendingAnnotationRef.current;
      if (
        pending?.pointerId === event.pointerId &&
        Math.hypot(
          event.clientX - pending.startX,
          event.clientY - pending.startY,
        ) >= ANNOTATION_DRAG_THRESHOLD
      ) {
        const point = inspectionPoint(
          event.clientX,
          event.clientY,
          event.currentTarget.getBoundingClientRect(),
          inspectionZoom,
          inspectionPan,
        );
        annotationDragRef.current = {
          annotationId: addAnnotationAt(point.x, point.y),
          pointerId: event.pointerId,
        };
        pendingAnnotationRef.current = null;
      }
    }

    const annotationDrag = annotationDragRef.current;
    if (annotationDrag?.pointerId === event.pointerId) {
      const point = inspectionPoint(
        event.clientX,
        event.clientY,
        event.currentTarget.getBoundingClientRect(),
        inspectionZoom,
        inspectionPan,
      );
      setAnnotations((current) =>
        current.map((annotation) =>
          annotation.id === annotationDrag.annotationId
            ? {
                ...annotation,
                x: clamp(point.x, 0, 1),
                y: clamp(point.y, 0, 1),
              }
            : annotation,
        ),
      );
      return;
    }

    const inspectionDrag = inspectionDragRef.current;
    if (!inspectionDrag || inspectionDrag.pointerId !== event.pointerId) return;
    const rectangle = event.currentTarget.getBoundingClientRect();
    setInspectionPan(
      clampPan(
        {
          x:
            inspectionDrag.panX + event.clientX - inspectionDrag.startX,
          y:
            inspectionDrag.panY + event.clientY - inspectionDrag.startY,
        },
        inspectionZoom,
        rectangle.width,
        rectangle.height,
      ),
    );
  }

  function endInspection(event: ReactPointerEvent<HTMLDivElement>) {
    finishInspectionInteraction(event, false);
  }

  function cancelInspection(event: ReactPointerEvent<HTMLDivElement>) {
    finishInspectionInteraction(event, true);
  }

  function finishInspectionInteraction(
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled: boolean,
  ) {
    const pending = pendingAnnotationRef.current;
    const pinch = inspectionPinchRef.current;
    if (
      !cancelled &&
      pending?.pointerId === event.pointerId &&
      !pinch
    ) {
      const point = inspectionPoint(
        event.clientX,
        event.clientY,
        event.currentTarget.getBoundingClientRect(),
        inspectionZoom,
        inspectionPan,
      );
      addAnnotationAt(point.x, point.y);
    }
    if (pending?.pointerId === event.pointerId) {
      pendingAnnotationRef.current = null;
    }

    inspectionPointersRef.current.delete(event.pointerId);
    if (pinch?.pointerIds.includes(event.pointerId)) {
      inspectionPinchRef.current = null;
      suppressTouchRef.current = inspectionPointersRef.current.size > 0;
    }
    if (inspectionPointersRef.current.size === 0) {
      suppressTouchRef.current = false;
    }

    const annotationDrag = annotationDragRef.current;
    const inspectionDrag = inspectionDragRef.current;
    const annotationEnded = annotationDrag?.pointerId === event.pointerId;
    const panEnded = inspectionDrag?.pointerId === event.pointerId;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (annotationEnded) {
      annotationDragRef.current = null;
    }
    if (panEnded) {
      inspectionDragRef.current = null;
    }
  }

  function touchPointersForPane(pane: HTMLDivElement) {
    return Array.from(inspectionPointersRef.current.entries()).filter(
      ([, pointer]) => pointer.pane === pane,
    );
  }

  function beginInspectionPinch(pane: HTMLDivElement) {
    const pointers = touchPointersForPane(pane).slice(0, 2);
    if (pointers.length < 2) return;
    const [[firstId, first], [secondId, second]] = pointers;
    pendingAnnotationRef.current = null;
    annotationDragRef.current = null;
    inspectionDragRef.current = null;
    suppressTouchRef.current = true;
    inspectionPinchRef.current = {
      pointerIds: [firstId, secondId],
      startCenter: centerBetweenPointers(first, second),
      startDistance: Math.max(1, distanceBetweenPointers(first, second)),
      startPan: inspectionPan,
      startZoom: inspectionZoom,
    };
  }

  function beginMarkerInteraction(
    event: ReactPointerEvent<HTMLButtonElement>,
    annotationId: string,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const pane = event.currentTarget.closest(
      '.inspection-pane',
    ) as HTMLDivElement | null;
    if (event.pointerType === 'touch' && pane) {
      inspectionPointersRef.current.set(event.pointerId, {
        pane,
        x: event.clientX,
        y: event.clientY,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      if (touchPointersForPane(pane).length >= 2) {
        beginInspectionPinch(pane);
        return;
      }
      if (suppressTouchRef.current) {
        return;
      }
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    annotationDragRef.current = {
      annotationId,
      pointerId: event.pointerId,
    };
  }

  function zoomInspection(nextZoom: number) {
    const zoom = clamp(nextZoom, 1, 4);
    const previousRange = inspectionZoom - 1;
    const nextRange = zoom - 1;
    setInspectionZoom(zoom);
    setInspectionPan((current) =>
      zoom === 1 || previousRange <= 0
        ? { x: 0, y: 0 }
        : {
            x: current.x * (nextRange / previousRange),
            y: current.y * (nextRange / previousRange),
          },
    );
  }

  function keyboardAnnotate(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const rectangle = event.currentTarget.getBoundingClientRect();
      const point = inspectionPoint(
        rectangle.left + rectangle.width / 2,
        rectangle.top + rectangle.height / 2,
        rectangle,
        inspectionZoom,
        inspectionPan,
      );
      addAnnotationAt(point.x, point.y);
    }
  }

  const inspectionTransform = `translate(${inspectionPan.x}px, ${inspectionPan.y}px) scale(${inspectionZoom})`;

  return (
    <article
      className="centering-card"
      id={
        measurement.viewId === 'front-straight'
          ? 'front-inspection'
          : 'back-inspection'
      }
    >
      <div className="centering-card-heading">
        <h3>{viewTitle(measurement.viewId)}</h3>
        <span
          className={
            measurement.method === 'manual' || manuallyAdjusted
              ? 'manual-badge'
              : 'automatic-badge'
          }
        >
          {measurement.method === 'manual'
            ? manuallyAdjusted
              ? 'Manual overlay adjusted'
              : 'Manual overlay'
            : manuallyAdjusted
              ? 'Manually adjusted'
              : 'Automatic detection'}
        </span>
      </div>
      <div
        className={`centering-image-frame${drag ? ' is-adjusting' : ''}`}
        onPointerCancel={endDrag}
        onPointerMove={moveHandle}
        onPointerUp={endDrag}
        ref={frameRef}
      >
        <img
          className="centering-source-image"
          src={capture.uri}
          alt={viewTitle(measurement.viewId)}
          draggable={false}
        />
        <GuideOverlay
          corners={guides.outer}
          handleSize={handleSize}
          kind="outer"
          onBeginDrag={beginDrag}
          onNudge={nudgeHandle}
          opacity={overlayOpacity}
        />
        <GuideOverlay
          corners={guides.inner}
          handleSize={handleSize}
          kind="inner"
          onBeginDrag={beginDrag}
          onNudge={nudgeHandle}
          opacity={overlayOpacity}
        />
        {zoomEnabled && drag ? (
          <ZoomPreview capture={capture} drag={drag} />
        ) : null}
      </div>
      <div className="centering-values" aria-live="polite">
        <div>
          <span>Left / right</span>
          <strong className={`centering-score score-${horizontalStatus}`}>
            {percentages.horizontal.first.toFixed(1)}% /{' '}
            {percentages.horizontal.second.toFixed(1)}%
          </strong>
        </div>
        <div>
          <span>Top / bottom</span>
          <strong className={`centering-score score-${verticalStatus}`}>
            {percentages.vertical.first.toFixed(1)}% /{' '}
            {percentages.vertical.second.toFixed(1)}%
          </strong>
        </div>
        <div>
          <span>
            {measurement.method === 'manual'
              ? 'Guide source'
              : 'Automatic confidence'}
          </span>
          <strong>
            {measurement.method === 'manual'
              ? 'Manual'
              : `${Math.round(measurement.confidence * 100)}%`}
          </strong>
        </div>
      </div>
      <button
        className="secondary centering-reset"
        disabled={!manuallyAdjusted}
        onClick={resetGuides}
        type="button"
      >
        Reset guides to{' '}
        {measurement.method === 'manual'
          ? 'manual starting position'
          : 'automatic detection'}
      </button>
      {measurement.warnings.map((warning) => (
        <p className="centering-warning" key={warning}>
          {warning}
        </p>
      ))}

      <section className="inspection-section" aria-label={`${viewTitle(measurement.viewId)} image inspection`}>
        <div className="inspection-heading">
          <div>
            <h4>Image inspection</h4>
            <p>
              Compare the source with a generated preview. Preview filters and
              perspective correction never modify the source.
            </p>
          </div>
          <label>
            Preview filter
            <select
              aria-label={`${viewTitle(measurement.viewId)} inspection filter`}
              onChange={(event) =>
                setFilter(event.target.value as InspectionFilter)
              }
              value={filter}
            >
              {INSPECTION_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="inspection-check">
            <input
              checked={perspectiveCorrected}
              onChange={(event) =>
                setPerspectiveCorrected(event.target.checked)
              }
              type="checkbox"
            />
            Perspective-correct preview using current outer guide
          </label>
        </div>

        <div className="inspection-view-controls">
          <div
            aria-label={`${viewTitle(measurement.viewId)} synchronized zoom controls`}
            className="inspection-zoom-controls"
            role="group"
          >
            <span>Synchronized zoom</span>
            <button
              aria-label="Zoom out"
              className="secondary inspection-zoom-button"
              disabled={inspectionZoom <= 1}
              onClick={() => zoomInspection(inspectionZoom - 0.25)}
              type="button"
            >
              −
            </button>
            <input
              aria-label={`${viewTitle(measurement.viewId)} inspection zoom`}
              max="4"
              min="1"
              onChange={(event) => zoomInspection(Number(event.target.value))}
              step="0.25"
              type="range"
              value={inspectionZoom}
            />
            <button
              aria-label="Zoom in"
              className="secondary inspection-zoom-button"
              disabled={inspectionZoom >= 4}
              onClick={() => zoomInspection(inspectionZoom + 0.25)}
              type="button"
            >
              +
            </button>
            <strong>{inspectionZoom.toFixed(2)}×</strong>
          </div>
          <button
            className="secondary compact-button"
            disabled={inspectionZoom === 1 && inspectionPan.x === 0 && inspectionPan.y === 0}
            onClick={() => {
              setInspectionZoom(1);
              setInspectionPan({ x: 0, y: 0 });
            }}
            type="button"
          >
            Reset view
          </button>
        </div>

        <div className="inspection-comparison">
          <figure>
            <figcaption>
              Original · One finger marks · two fingers zoom
            </figcaption>
            <div
              aria-label={`${viewTitle(measurement.viewId)} original inspection pane. Tap or drag with one finger to place a marker, or pinch with two fingers to zoom. Mouse users can hold Control and click or drag. Press Enter to place a marker at the view center.`}
              className="inspection-pane"
              onContextMenu={(event) => {
                if (event.ctrlKey) {
                  event.preventDefault();
                }
              }}
              onKeyDown={keyboardAnnotate}
              onPointerCancel={cancelInspection}
              onPointerDown={(event) =>
                beginInspectionInteraction(event, true)
              }
              onPointerMove={moveInspection}
              onPointerUp={endInspection}
              style={{ aspectRatio: `${capture.width} / ${capture.height}` }}
              tabIndex={0}
            >
              <div
                className="inspection-image-stage"
                style={{ transform: inspectionTransform }}
              >
                <img
                  alt={`${viewTitle(measurement.viewId)} original`}
                  draggable={false}
                  src={capture.uri}
                />
                {annotations.map((annotation, index) => (
                  <button
                    aria-label={`Blemish ${index + 1}: ${formatBlemishType(annotation.type)}. Drag to reposition or use Delete to remove.`}
                    className="blemish-marker"
                    key={annotation.id}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setAnnotations((current) =>
                        current.filter((item) => item.id !== annotation.id),
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Delete' || event.key === 'Backspace') {
                        event.preventDefault();
                        setAnnotations((current) =>
                          current.filter((item) => item.id !== annotation.id),
                        );
                      }
                    }}
                    onPointerDown={(event) =>
                      beginMarkerInteraction(event, annotation.id)
                    }
                    style={{
                      borderWidth: annotationMarkerSize < 14 ? '1px' : '2px',
                      fontSize:
                        annotationMarkerSize < 14
                          ? '0'
                          : `${Math.min(
                              12,
                              Math.max(
                                6,
                                annotationMarkerSize *
                                  (index >= 9 ? 0.26 : 0.34),
                              ),
                            )}px`,
                      height: `${annotationMarkerSize}px`,
                      left: `${annotation.x * 100}%`,
                      opacity: annotationMarkerOpacity / 100,
                      top: `${annotation.y * 100}%`,
                      width: `${annotationMarkerSize}px`,
                    }}
                    title="Drag to reposition; right-click to remove"
                    type="button"
                  >
                    {annotationMarkerSize >= 14 ? index + 1 : null}
                  </button>
                ))}
              </div>
            </div>
          </figure>
          <figure>
            <figcaption>
              Preview · {INSPECTION_FILTERS.find((item) => item.value === filter)?.label}
              {perspectiveCorrected ? ' · corrected' : ''}
              {' · pinch to zoom'}
            </figcaption>
            <div
              aria-label={`${viewTitle(measurement.viewId)} filtered preview. Drag with one finger to pan, pinch with two fingers to zoom, or use the zoom controls above.`}
              className="inspection-pane"
              onPointerCancel={cancelInspection}
              onPointerDown={(event) =>
                beginInspectionInteraction(event, false)
              }
              onPointerMove={moveInspection}
              onPointerUp={endInspection}
              style={{ aspectRatio: `${capture.width} / ${capture.height}` }}
              tabIndex={0}
            >
              {filterLoading ? (
                <span className="inspection-pane-status" role="status">
                  Rendering preview…
                </span>
              ) : null}
              {filterError ? (
                <span className="inspection-pane-status pane-error" role="alert">
                  {filterError}
                </span>
              ) : null}
              {filteredUrl ? (
                <div
                  className="inspection-image-stage"
                  style={{ transform: inspectionTransform }}
                >
                  <img
                    alt={`${viewTitle(measurement.viewId)} filtered preview`}
                    draggable={false}
                    src={filteredUrl}
                  />
                </div>
              ) : null}
            </div>
          </figure>
        </div>

        <section className="annotation-editor" aria-labelledby={`annotations-${capture.id}`}>
          <div className="annotation-heading">
            <h4 id={`annotations-${capture.id}`}>Blemish annotations</h4>
            <button
              className="secondary compact-button"
              disabled={annotations.length === 0}
              onClick={() => setAnnotations([])}
              type="button"
            >
              Clear all
            </button>
          </div>
          <div className="annotation-fields">
            <label>
              Type
              <select
                onChange={(event) =>
                  setAnnotationType(
                    event.target.value as BlemishAnnotation['type'],
                  )
                }
                value={annotationType}
              >
                {BLEMISH_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {formatBlemishType(type)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Note
              <input
                onChange={(event) => setAnnotationNote(event.target.value)}
                placeholder="Optional detail"
                type="text"
                value={annotationNote}
              />
            </label>
            <div className="annotation-marker-controls">
              <label>
                Marker size
                <span className="annotation-size-control">
                  <input
                    aria-label={`${viewTitle(measurement.viewId)} annotation marker size`}
                    max="48"
                    min="8"
                    onChange={(event) =>
                      setAnnotationMarkerSize(Number(event.target.value))
                    }
                    type="range"
                    value={annotationMarkerSize}
                  />
                  <strong>{annotationMarkerSize}px</strong>
                </span>
              </label>
              <label>
                Marker opacity
                <span className="annotation-size-control">
                  <input
                    aria-label={`${viewTitle(measurement.viewId)} annotation marker opacity`}
                    max="100"
                    min="20"
                    onChange={(event) =>
                      setAnnotationMarkerOpacity(Number(event.target.value))
                    }
                    step="5"
                    type="range"
                    value={annotationMarkerOpacity}
                  />
                  <strong>{annotationMarkerOpacity}%</strong>
                </span>
              </label>
            </div>
          </div>
          <p className="annotation-help">
            On the original image, use one finger to tap and add the selected
            blemish or drag for precise placement. Pinch with two fingers on
            either image to zoom without creating a marker. Existing markers
            can also be dragged. Mouse users can hold Ctrl and click or drag.
            Remove one marker with its Delete control or use Clear all. For
            keyboard use, focus the original image and press Enter or Space to
            add at the center.
          </p>
          {annotations.length === 0 ? (
            <p>No blemishes marked.</p>
          ) : (
            <ol className="annotation-list">
              {annotations.map((annotation) => (
                <li key={annotation.id}>
                  <span>
                    <strong>{formatBlemishType(annotation.type)}</strong>
                    {annotation.note ? ` — ${annotation.note}` : ''}
                  </span>
                  <button
                    aria-label={`Delete ${formatBlemishType(annotation.type)} annotation`}
                    className="remove-picture"
                    onClick={() =>
                      setAnnotations((current) =>
                        current.filter((item) => item.id !== annotation.id),
                      )
                    }
                    type="button"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="quality-section" aria-labelledby={`quality-${capture.id}`}>
          <h4 id={`quality-${capture.id}`}>Automatic image quality checks</h4>
          {qualityState === 'loading' ? (
            <p role="status">Analyzing image quality…</p>
          ) : null}
          {qualityError ? (
            <p className="operation-status status-error" role="alert">
              {qualityError}
            </p>
          ) : null}
          <ul className="quality-list">
            {qualityChecks.map((check) => (
              <li className={`quality-${check.severity}`} key={check.id}>
                <strong>{check.label}</strong>
                <span>{check.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      </section>
    </article>
  );
}

function findSnapshot(
  snapshots: Record<string, SideSnapshot>,
  measurements: CenteringMeasurement[],
  viewId: Capture['viewId'],
): SideSnapshot | undefined {
  const measurement = measurements.find((item) => item.viewId === viewId);
  return measurement ? snapshots[measurement.captureId] : undefined;
}

function snapshotToReportSide(snapshot: SideSnapshot) {
  return {
    title: viewTitle(snapshot.capture.viewId),
    sourceUri: snapshot.capture.uri,
    horizontal: snapshot.horizontal,
    vertical: snapshot.vertical,
    qualityChecks: snapshot.qualityChecks,
    annotations: snapshot.annotations,
  };
}

function inspectionPoint(
  clientX: number,
  clientY: number,
  rectangle: DOMRect,
  zoom: number,
  pan: { x: number; y: number },
): Point {
  const centerX = rectangle.left + rectangle.width / 2;
  const centerY = rectangle.top + rectangle.height / 2;
  return {
    x:
      ((clientX - centerX - pan.x) / zoom + rectangle.width / 2) /
      rectangle.width,
    y:
      ((clientY - centerY - pan.y) / zoom + rectangle.height / 2) /
      rectangle.height,
  };
}

function distanceBetweenPointers(
  first: InspectionPointer,
  second: InspectionPointer,
): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function centerBetweenPointers(
  first: InspectionPointer,
  second: InspectionPointer,
): Point {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function clampPan(
  pan: { x: number; y: number },
  zoom: number,
  width: number,
  height: number,
) {
  const maximumX = (width * (zoom - 1)) / 2;
  const maximumY = (height * (zoom - 1)) / 2;
  return {
    x: clamp(pan.x, -maximumX, maximumX),
    y: clamp(pan.y, -maximumY, maximumY),
  };
}

function formatBlemishType(type: BlemishAnnotation['type']): string {
  return type
    .split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function createId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function GuideOverlay({
  corners,
  handleSize,
  kind,
  onBeginDrag,
  onNudge,
  opacity,
}: {
  corners: GuideCorners;
  handleSize: number;
  kind: OverlayKind;
  onBeginDrag: (
    event: ReactPointerEvent<HTMLButtonElement>,
    kind: OverlayKind,
    corner: CornerName,
  ) => void;
  onNudge: (
    kind: OverlayKind,
    corner: CornerName,
    x: number,
    y: number,
  ) => void;
  opacity: number;
}) {
  return (
    <div
      className={`centering-guide ${kind}-guide`}
      style={{ opacity }}
    >
      <svg
        aria-hidden="true"
        className="centering-guide-lines"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <polygon points={polygonPoints(corners)} />
      </svg>
      {CORNERS.map((corner) => (
        <button
          aria-label={`Adjust ${kind === 'outer' ? 'cyan card' : 'yellow inner'} ${cornerLabel(corner)} corner`}
          className="centering-corner-handle"
          key={corner}
          onKeyDown={(event) => {
            const distance = event.shiftKey ? 0.02 : 0.005;
            const movement =
              event.key === 'ArrowLeft'
                ? { x: -distance, y: 0 }
                : event.key === 'ArrowRight'
                  ? { x: distance, y: 0 }
                  : event.key === 'ArrowUp'
                    ? { x: 0, y: -distance }
                    : event.key === 'ArrowDown'
                      ? { x: 0, y: distance }
                      : null;
            if (movement) {
              event.preventDefault();
              onNudge(kind, corner, movement.x, movement.y);
            }
          }}
          onPointerDown={(event) => onBeginDrag(event, kind, corner)}
          style={{
            height: `${handleSize}px`,
            left: `${corners[corner].x * 100}%`,
            top: `${corners[corner].y * 100}%`,
            width: `${handleSize}px`,
          }}
          type="button"
        />
      ))}
    </div>
  );
}

function ZoomPreview({
  capture,
  drag,
}: {
  capture: Capture;
  drag: DragState;
}) {
  const imageWidth = drag.frameWidth * ZOOM_SCALE;
  const imageHeight = drag.frameHeight * ZOOM_SCALE;
  const color = drag.kind === 'outer' ? '#55c2ff' : '#f4b942';

  return (
    <div
      aria-hidden="true"
      className={`centering-zoom-preview ${
        drag.point.x > 0.5 ? 'zoom-preview-left' : 'zoom-preview-right'
      }`}
      style={{ borderColor: color }}
    >
      <img
        alt=""
        className="centering-zoom-image"
        draggable={false}
        src={capture.uri}
        style={{
          height: `${imageHeight}px`,
          left: `${ZOOM_PREVIEW_SIZE / 2 - drag.point.x * imageWidth}px`,
          top: `${ZOOM_PREVIEW_SIZE / 2 - drag.point.y * imageHeight}px`,
          width: `${imageWidth}px`,
        }}
      />
      <span
        className="centering-zoom-crosshair"
        style={{ color }}
      />
    </div>
  );
}

function updateGuides(
  current: EditableGuides,
  kind: OverlayKind,
  corner: CornerName,
  point: Point,
): EditableGuides {
  const candidate = {
    ...current[kind],
    [corner]: point,
  };

  if (!isValidQuadrilateral(candidate)) {
    return current;
  }

  if (
    kind === 'outer' &&
    !CORNERS.every((name) => pointInsideConvex(current.inner[name], candidate))
  ) {
    return current;
  }

  if (
    kind === 'inner' &&
    !CORNERS.every((name) => pointInsideConvex(candidate[name], current.outer))
  ) {
    return current;
  }

  return {
    ...current,
    [kind]: candidate,
  };
}

function calculatePercentages(guides: EditableGuides) {
  const { outer, inner } = guides;
  return {
    horizontal: marginPercentages(
      average([
        distanceToLine(inner.topLeft, outer.topLeft, outer.bottomLeft),
        distanceToLine(inner.bottomLeft, outer.topLeft, outer.bottomLeft),
      ]),
      average([
        distanceToLine(inner.topRight, outer.topRight, outer.bottomRight),
        distanceToLine(inner.bottomRight, outer.topRight, outer.bottomRight),
      ]),
    ),
    vertical: marginPercentages(
      average([
        distanceToLine(inner.topLeft, outer.topLeft, outer.topRight),
        distanceToLine(inner.topRight, outer.topLeft, outer.topRight),
      ]),
      average([
        distanceToLine(inner.bottomLeft, outer.bottomLeft, outer.bottomRight),
        distanceToLine(
          inner.bottomRight,
          outer.bottomLeft,
          outer.bottomRight,
        ),
      ]),
    ),
  };
}

function distanceToLine(point: Point, start: Point, end: Point): number {
  const lineLength = Math.hypot(end.x - start.x, end.y - start.y);
  if (lineLength === 0) {
    return 0;
  }

  return (
    Math.abs(
      (end.y - start.y) * point.x -
        (end.x - start.x) * point.y +
        end.x * start.y -
        end.y * start.x,
    ) / lineLength
  );
}

function isValidQuadrilateral(corners: GuideCorners): boolean {
  const points = CORNERS.map((corner) => corners[corner]);
  const crossProducts = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const afterNext = points[(index + 2) % points.length];
    return cross(point, next, afterNext);
  });
  const direction = Math.sign(crossProducts[0]);

  return (
    direction !== 0 &&
    crossProducts.every(
      (value) => Math.sign(value) === direction && Math.abs(value) > 0.0001,
    ) &&
    points.every(
      (point, index) =>
        distance(point, points[(index + 1) % points.length]) >= 0.03,
    )
  );
}

function pointInsideConvex(point: Point, corners: GuideCorners): boolean {
  const points = CORNERS.map((corner) => corners[corner]);
  const signs = points.map((start, index) =>
    cross(start, points[(index + 1) % points.length], point),
  );
  return (
    signs.every((value) => value >= -0.0001) ||
    signs.every((value) => value <= 0.0001)
  );
}

function cross(start: Point, end: Point, point: Point): number {
  return (
    (end.x - start.x) * (point.y - start.y) -
    (end.y - start.y) * (point.x - start.x)
  );
}

function distance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function balanceStatus(firstPercent: number): BalanceStatus {
  const deviation = Math.abs(firstPercent - 50);
  if (deviation <= 5) {
    return 'good';
  }
  if (deviation <= 10) {
    return 'fair';
  }
  return 'poor';
}

function marginPercentages(firstMargin: number, secondMargin: number) {
  const total = firstMargin + secondMargin;
  if (total <= 0) {
    return { first: 50, second: 50 };
  }

  const first = (firstMargin / total) * 100;
  return {
    first: roundOne(first),
    second: roundOne(100 - first),
  };
}

function guidesFromMeasurement(
  measurement: CenteringMeasurement,
): EditableGuides {
  return {
    outer: cornersFromBounds(measurement.outerBounds),
    inner: cornersFromBounds(measurement.innerBounds),
  };
}

function cornersFromBounds(bounds: CenteringBounds): GuideCorners {
  return {
    topLeft: { x: bounds.left, y: bounds.top },
    topRight: { x: bounds.right, y: bounds.top },
    bottomRight: { x: bounds.right, y: bounds.bottom },
    bottomLeft: { x: bounds.left, y: bounds.bottom },
  };
}

function polygonPoints(corners: GuideCorners): string {
  return CORNERS.map(
    (corner) => `${corners[corner].x * 100},${corners[corner].y * 100}`,
  ).join(' ');
}

function cornerLabel(corner: CornerName): string {
  return corner.replace(/([A-Z])/g, ' $1').toLowerCase();
}

function viewTitle(viewId: Capture['viewId']): string {
  return viewId === 'front-straight'
    ? 'Front, straight on'
    : 'Back, straight on';
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
