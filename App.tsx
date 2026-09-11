import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  CAPTURE_STEPS,
  Capture,
  createCapture,
} from './src/domain/capture';
import { GradingResultScreen } from './src/components/GradingResultScreen';
import { GradingResult } from './src/domain/grading';
import { createDemoResult } from './src/fixtures/demoResult';

export default function App() {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [result, setResult] = useState<GradingResult | null>(null);
  const currentStep = CAPTURE_STEPS[captures.length];

  async function takePicture() {
    if (!camera.current || !currentStep || isCapturing) {
      return;
    }

    setIsCapturing(true);
    try {
      const photo = await camera.current.takePictureAsync({
        quality: 1,
        skipProcessing: false,
      });

      if (!photo) {
        throw new Error('The camera did not return an image.');
      }

      setCaptures((current) => [
        ...current,
        createCapture(currentStep.id, photo),
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to capture this view.';
      console.error('Card capture failed:', message);
    } finally {
      setIsCapturing(false);
    }
  }

  if (!permission) {
    return (
      <Screen>
        <ActivityIndicator color="#f4b942" />
        <Text style={styles.muted}>Checking camera permission...</Text>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <Text style={styles.eyebrow}>PRIVATE BY DEFAULT</Text>
        <Text style={styles.title}>Photograph cards on your device</Text>
        <Text style={styles.body}>
          Camera access is required for guided capture. Images are not uploaded
          by this app.
        </Text>
        <ActionButton label="Allow camera access" onPress={requestPermission} />
      </Screen>
    );
  }

  if (result) {
    return (
      <GradingResultScreen
        captures={captures}
        result={result}
        onClose={() => setResult(null)}
      />
    );
  }

  if (!currentStep) {
    return (
      <Screen>
        <Text style={styles.eyebrow}>CAPTURE COMPLETE</Text>
        <Text style={styles.title}>{captures.length} views collected</Text>
        <Text style={styles.body}>
          The capture contract is ready. Grading remains disabled until a
          validated, versioned model is bundled and passes physical-device
          benchmarks.
        </Text>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>No grade has been fabricated</Text>
          <Text style={styles.noticeText}>
            Future results will be unofficial estimates, not authentication or
            a guarantee from PSA, BGS, or CGC.
          </Text>
        </View>
        <ActionButton
          label="Preview result interface"
          onPress={() => setResult(createDemoResult(captures))}
          variant="secondary"
        />
        <ActionButton label="Start over" onPress={() => setCaptures([])} />
      </Screen>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        flash="off"
        mode="picture"
        onMountError={(event) =>
          console.error('Camera failed to start:', event.message)
        }
      />
      <SafeAreaView style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.step}>
            View {captures.length + 1} of {CAPTURE_STEPS.length}
          </Text>
          <Text style={styles.captureTitle}>{currentStep.title}</Text>
          <Text style={styles.instruction}>{currentStep.instruction}</Text>
        </View>

        <View style={styles.cardGuide}>
          <View style={styles.cornerTopLeft} />
          <View style={styles.cornerTopRight} />
          <View style={styles.cornerBottomLeft} />
          <View style={styles.cornerBottomRight} />
        </View>

        <View style={styles.captureFooter}>
          <Text style={styles.captureHint}>
            Remove sleeves and top loaders. Use a dark matte background.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Capture ${currentStep.title}`}
            disabled={isCapturing}
            onPress={takePicture}
            style={({ pressed }) => [
              styles.shutter,
              pressed && styles.shutterPressed,
              isCapturing && styles.disabled,
            ]}
          >
            {isCapturing ? (
              <ActivityIndicator color="#101820" />
            ) : (
              <View style={styles.shutterInner} />
            )}
          </Pressable>
          {captures.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setCaptures((current) => current.slice(0, -1))}
            >
              <Text style={styles.retake}>Retake previous view</Text>
            </Pressable>
          ) : (
            <View style={styles.retakePlaceholder} />
          )}
        </View>
      </SafeAreaView>
      <StatusBar style="light" />
    </View>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.screenContent}>{children}</View>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

function ActionButton({
  label,
  onPress,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        variant === 'secondary' && styles.actionButtonSecondary,
        pressed && styles.actionButtonPressed,
      ]}
    >
      <Text
        style={[
          styles.actionButtonText,
          variant === 'secondary' && styles.actionButtonTextSecondary,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101820',
  },
  screen: {
    flex: 1,
    backgroundColor: '#101820',
  },
  screenContent: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: 28,
    gap: 18,
  },
  eyebrow: {
    color: '#f4b942',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
  },
  title: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 40,
  },
  body: {
    color: '#cbd5df',
    fontSize: 17,
    lineHeight: 25,
  },
  muted: {
    color: '#9cabb8',
    fontSize: 15,
  },
  actionButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: '#f4b942',
    borderRadius: 14,
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  actionButtonPressed: {
    backgroundColor: '#dca62f',
  },
  actionButtonSecondary: {
    backgroundColor: '#1b2a36',
    borderColor: '#f4b942',
    borderWidth: 1,
  },
  actionButtonText: {
    color: '#101820',
    fontSize: 17,
    fontWeight: '800',
  },
  actionButtonTextSecondary: {
    color: '#f4b942',
  },
  notice: {
    alignSelf: 'stretch',
    backgroundColor: '#1b2a36',
    borderColor: '#344756',
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  noticeTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  noticeText: {
    color: '#b7c4ce',
    fontSize: 14,
    lineHeight: 21,
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(5, 12, 18, 0.22)',
  },
  header: {
    backgroundColor: 'rgba(10, 20, 28, 0.88)',
    paddingHorizontal: 24,
    paddingBottom: 18,
    paddingTop: 12,
  },
  step: {
    color: '#f4b942',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  captureTitle: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    marginTop: 6,
  },
  instruction: {
    color: '#d9e1e7',
    fontSize: 15,
    lineHeight: 21,
    marginTop: 5,
  },
  cardGuide: {
    alignSelf: 'center',
    aspectRatio: 2.5 / 3.5,
    borderColor: 'rgba(255, 255, 255, 0.65)',
    borderRadius: 13,
    borderWidth: 1,
    width: '76%',
  },
  cornerTopLeft: {
    position: 'absolute',
    left: -2,
    top: -2,
    width: 34,
    height: 34,
    borderLeftWidth: 4,
    borderTopWidth: 4,
    borderColor: '#f4b942',
    borderTopLeftRadius: 13,
  },
  cornerTopRight: {
    position: 'absolute',
    right: -2,
    top: -2,
    width: 34,
    height: 34,
    borderRightWidth: 4,
    borderTopWidth: 4,
    borderColor: '#f4b942',
    borderTopRightRadius: 13,
  },
  cornerBottomLeft: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 34,
    height: 34,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderColor: '#f4b942',
    borderBottomLeftRadius: 13,
  },
  cornerBottomRight: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 34,
    height: 34,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderColor: '#f4b942',
    borderBottomRightRadius: 13,
  },
  captureFooter: {
    alignItems: 'center',
    backgroundColor: 'rgba(10, 20, 28, 0.88)',
    gap: 12,
    paddingBottom: 16,
    paddingHorizontal: 24,
    paddingTop: 14,
  },
  captureHint: {
    color: '#d9e1e7',
    fontSize: 13,
    textAlign: 'center',
  },
  shutter: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#f4b942',
    borderRadius: 40,
    borderWidth: 4,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  shutterInner: {
    backgroundColor: '#f4b942',
    borderRadius: 27,
    height: 54,
    width: 54,
  },
  shutterPressed: {
    transform: [{ scale: 0.96 }],
  },
  disabled: {
    opacity: 0.6,
  },
  retake: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  retakePlaceholder: {
    height: 17,
  },
});
