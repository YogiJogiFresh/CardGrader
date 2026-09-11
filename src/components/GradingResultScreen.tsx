import { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Capture } from '../domain/capture';
import {
  buildPredictionExplanation,
  formatGrade,
} from '../domain/explanations';
import {
  ConditionCategory,
  GradeEvidence,
  Grader,
  GradingResult,
} from '../domain/grading';

const CATEGORY_COLORS: Record<ConditionCategory, string> = {
  centering: '#55c2ff',
  corners: '#f4b942',
  edges: '#f47c7c',
  surface: '#b792f4',
};

export function GradingResultScreen({
  captures,
  result,
  onClose,
}: {
  captures: Capture[];
  result: GradingResult;
  onClose: () => void;
}) {
  const [selectedGrader, setSelectedGrader] = useState<Grader>(
    result.predictions[0]?.grader ?? 'psa',
  );
  const prediction = result.predictions.find(
    (candidate) => candidate.grader === selectedGrader,
  );
  const explanation = useMemo(
    () => (prediction ? buildPredictionExplanation(prediction) : null),
    [prediction],
  );
  const evidenceByCapture = useMemo(
    () => groupEvidenceByCapture(prediction?.evidence ?? []),
    [prediction],
  );

  if (!prediction || !explanation) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.empty}>
          <Text style={styles.title}>No compatible prediction</Text>
          <Text style={styles.body}>
            The result did not contain a prediction for a supported grader.
          </Text>
          <Action label="Return to capture" onPress={onClose} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {result.source === 'demo' ? (
          <View style={styles.demoBanner}>
            <Text style={styles.demoTitle}>DEMO RESULT - NOT A REAL GRADE</Text>
            <Text style={styles.demoText}>
              Values and highlighted regions are synthetic and do not describe
              the photographed card.
            </Text>
          </View>
        ) : null}

        <Text style={styles.eyebrow}>UNOFFICIAL CONDITION ESTIMATE</Text>
        <Text style={styles.title}>Likely grade range</Text>

        <View style={styles.tabs}>
          {result.predictions.map((candidate) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{
                selected: candidate.grader === selectedGrader,
              }}
              key={candidate.grader}
              onPress={() => setSelectedGrader(candidate.grader)}
              style={[
                styles.tab,
                candidate.grader === selectedGrader && styles.tabSelected,
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  candidate.grader === selectedGrader &&
                    styles.tabTextSelected,
                ]}
              >
                {candidate.grader.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.gradeCard}>
          <View>
            <Text style={styles.gradeRange}>
              {formatGrade(prediction.range.minimum)}-
              {formatGrade(prediction.range.maximum)}
            </Text>
            <Text style={styles.likely}>
              Most likely {formatGrade(prediction.range.mostLikely)}
            </Text>
          </View>
          <View style={styles.confidence}>
            <Text style={styles.confidenceValue}>
              {Math.round(prediction.confidence * 100)}%
            </Text>
            <Text style={styles.confidenceLabel}>
              {explanation.confidenceLabel}
            </Text>
          </View>
        </View>

        <Section title="Why this range">
          <Text style={styles.body}>{explanation.summary}</Text>
          {explanation.categoryLines.map((line) => (
            <Text key={line} style={styles.categoryLine}>
              {line}
            </Text>
          ))}
        </Section>

        <Section title="Evidence">
          <View style={styles.legend}>
            {(Object.keys(CATEGORY_COLORS) as ConditionCategory[]).map(
              (category) => (
                <View key={category} style={styles.legendItem}>
                  <View
                    style={[
                      styles.legendSwatch,
                      { backgroundColor: CATEGORY_COLORS[category] },
                    ]}
                  />
                  <Text style={styles.legendText}>{capitalize(category)}</Text>
                </View>
              ),
            )}
          </View>
          {captures
            .filter((capture) => evidenceByCapture.has(capture.id))
            .map((capture) => (
              <EvidenceImage
                capture={capture}
                evidence={evidenceByCapture.get(capture.id) ?? []}
                key={capture.id}
              />
            ))}
        </Section>

        {prediction.limitations.length > 0 ? (
          <Section title="Uncertainty and limitations">
            {prediction.limitations.map((limitation) => (
              <Text key={limitation} style={styles.limitation}>
                {`\u2022 ${limitation}`}
              </Text>
            ))}
          </Section>
        ) : null}

        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerTitle}>Not professional grading</Text>
          <Text style={styles.disclaimerText}>
            This estimate cannot authenticate a card and does not guarantee a
            grade from PSA, BGS, CGC, or any other grading company.
          </Text>
        </View>

        <Action label="Return to capture" onPress={onClose} />
      </ScrollView>
    </SafeAreaView>
  );
}

function EvidenceImage({
  capture,
  evidence,
}: {
  capture: Capture;
  evidence: GradeEvidence[];
}) {
  return (
    <View style={styles.evidenceBlock}>
      <Text style={styles.evidenceTitle}>
        {capture.viewId.replaceAll('-', ' ')}
      </Text>
      <View style={styles.imageFrame}>
        <Image resizeMode="contain" source={{ uri: capture.uri }} style={styles.image} />
        {evidence
          .filter((item) => item.region)
          .map((item) => {
            const region = item.region!;
            return (
              <View
                key={item.id}
                style={[
                  styles.evidenceRegion,
                  {
                    borderColor: CATEGORY_COLORS[item.category],
                    left: `${region.x * 100}%`,
                    top: `${region.y * 100}%`,
                    width: `${region.width * 100}%`,
                    height: `${region.height * 100}%`,
                  },
                ]}
              />
            );
          })}
      </View>
      {evidence.map((item) => (
        <View key={item.id} style={styles.evidenceLine}>
          <View
            style={[
              styles.legendSwatch,
              { backgroundColor: CATEGORY_COLORS[item.category] },
            ]}
          />
          <Text style={styles.evidenceText}>
            {item.description} {Math.round(item.confidence * 100)}% confidence
          </Text>
        </View>
      ))}
    </View>
  );
}

function Section({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        pressed && styles.actionPressed,
      ]}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function groupEvidenceByCapture(
  evidence: GradeEvidence[],
): Map<string, GradeEvidence[]> {
  return evidence.reduce((grouped, item) => {
    const items = grouped.get(item.captureId) ?? [];
    items.push(item);
    grouped.set(item.captureId, items);
    return grouped;
  }, new Map<string, GradeEvidence[]>());
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#101820',
  },
  content: {
    gap: 18,
    padding: 24,
    paddingBottom: 44,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    gap: 18,
    padding: 24,
  },
  eyebrow: {
    color: '#f4b942',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  title: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
  },
  body: {
    color: '#cbd5df',
    fontSize: 16,
    lineHeight: 23,
  },
  demoBanner: {
    backgroundColor: '#523d0b',
    borderColor: '#f4b942',
    borderRadius: 12,
    borderWidth: 1,
    gap: 5,
    padding: 14,
  },
  demoTitle: {
    color: '#ffe29a',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  demoText: {
    color: '#fff1c9',
    fontSize: 13,
    lineHeight: 19,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    borderColor: '#415260',
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 11,
  },
  tabSelected: {
    backgroundColor: '#f4b942',
    borderColor: '#f4b942',
  },
  tabText: {
    color: '#d9e1e7',
    fontWeight: '800',
  },
  tabTextSelected: {
    color: '#101820',
  },
  gradeCard: {
    alignItems: 'center',
    backgroundColor: '#1b2a36',
    borderColor: '#344756',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
  },
  gradeRange: {
    color: '#ffffff',
    fontSize: 50,
    fontWeight: '900',
    letterSpacing: -2,
  },
  likely: {
    color: '#b7c4ce',
    fontSize: 14,
    marginTop: 2,
  },
  confidence: {
    alignItems: 'flex-end',
  },
  confidenceValue: {
    color: '#f4b942',
    fontSize: 28,
    fontWeight: '800',
  },
  confidenceLabel: {
    color: '#cbd5df',
    fontSize: 12,
  },
  section: {
    backgroundColor: '#16232d',
    borderRadius: 14,
    gap: 11,
    padding: 17,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '800',
  },
  categoryLine: {
    color: '#d9e1e7',
    fontSize: 14,
    lineHeight: 20,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  legendSwatch: {
    borderRadius: 4,
    height: 9,
    width: 9,
  },
  legendText: {
    color: '#cbd5df',
    fontSize: 12,
  },
  evidenceBlock: {
    gap: 9,
    marginTop: 5,
  },
  evidenceTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  imageFrame: {
    aspectRatio: 3 / 4,
    backgroundColor: '#091016',
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  image: {
    height: '100%',
    width: '100%',
  },
  evidenceRegion: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 5,
    borderWidth: 3,
    position: 'absolute',
  },
  evidenceLine: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
  },
  evidenceText: {
    color: '#cbd5df',
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  limitation: {
    color: '#efc9c9',
    fontSize: 14,
    lineHeight: 20,
  },
  disclaimer: {
    backgroundColor: '#251d1d',
    borderColor: '#654141',
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  disclaimerTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  disclaimerText: {
    color: '#dfc4c4',
    fontSize: 13,
    lineHeight: 19,
  },
  action: {
    alignItems: 'center',
    backgroundColor: '#f4b942',
    borderRadius: 14,
    padding: 16,
  },
  actionPressed: {
    backgroundColor: '#dca62f',
  },
  actionText: {
    color: '#101820',
    fontSize: 16,
    fontWeight: '800',
  },
});
