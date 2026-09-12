import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';

const TOUR_STEPS = [
  {
    eyebrow: 'Today',
    title: 'See what needs your attention',
    description: 'Today brings tasks, reminders, events, and project follow-through into one calm view.',
  },
  {
    eyebrow: 'Capture',
    title: 'Save the thought while it is fresh',
    description: 'Add a task, reminder, event, or note from the Capture tab and send it to the right workspace.',
  },
  {
    eyebrow: 'Workspaces',
    title: 'Keep contexts separate',
    description: 'Switch between Personal and Team workspaces whenever the context changes.',
  },
  {
    eyebrow: 'Follow through',
    title: 'Keep the loop moving',
    description: 'Use notifications when you want Ledger to bring an important next step back to you.',
  },
] as const;

type MobileTourSheetProps = {
  visible: boolean;
  onClose: () => void;
};

export function MobileTourSheet({ visible, onClose }: MobileTourSheetProps) {
  const theme = useLedgerTheme();
  const [mode, setMode] = useState<'prompt' | 'tour'>('prompt');
  const [stepIndex, setStepIndex] = useState(0);
  const step = TOUR_STEPS[stepIndex];

  const close = () => {
    setMode('prompt');
    setStepIndex(0);
    onClose();
  };

  const startTour = () => {
    setMode('tour');
    setStepIndex(0);
  };

  return (
    <AppBottomSheet
      visible={visible}
      onClose={close}
      title={mode === 'prompt' ? 'Want a quick tour?' : step.eyebrow}
      headerAccessory={
        <Pressable accessibilityRole="button" accessibilityLabel="Close tour" onPress={close} hitSlop={8}>
          <AppText variant="caption" style={{ color: theme.colors.textMuted }}>Close</AppText>
        </Pressable>
      }
      snapPoints={mode === 'prompt' ? ['56%', '70%'] : ['56%', '72%']}
      initialSnapPointIndex={0}
    >
      {mode === 'prompt' ? (
        <View style={styles.content}>
          <View style={styles.copy}>
            <AppText variant="body" style={{ color: theme.colors.textSecondary }}>
              Take a few seconds to see how Ledger connects capture, planning, and follow-through.
            </AppText>
          </View>
          <View style={styles.actions}>
            <AppButton title="Take the tour" size="lg" onPress={startTour} />
            <AppButton title="Not now" variant="secondary" size="lg" onPress={close} />
          </View>
        </View>
      ) : (
        <View style={styles.content}>
          <View style={styles.copy}>
            <AppText variant="screenTitle">{step.title}</AppText>
            <AppText variant="body" style={{ color: theme.colors.textSecondary }}>
              {step.description}
            </AppText>
          </View>
          <View style={styles.progressRow}>
            {TOUR_STEPS.map((item, index) => (
              <View
                key={item.eyebrow}
                style={[
                  styles.progressDot,
                  { backgroundColor: index === stepIndex ? theme.colors.accent : theme.colors.borderSubtle },
                ]}
              />
            ))}
          </View>
          <View style={styles.actions}>
            <AppButton
              title={stepIndex === TOUR_STEPS.length - 1 ? 'Done' : 'Next'}
              size="lg"
              onPress={() => {
                if (stepIndex === TOUR_STEPS.length - 1) close();
                else setStepIndex((current) => current + 1);
              }}
            />
            <Pressable accessibilityRole="button" onPress={close} hitSlop={8} style={styles.skipButton}>
              <AppText variant="caption" style={{ color: theme.colors.textMuted }}>Skip tour</AppText>
            </Pressable>
          </View>
        </View>
      )}
    </AppBottomSheet>
  );
}

const styles = {
  content: {
    gap: 24,
  },
  copy: {
    gap: 10,
  },
  actions: {
    gap: 12,
  },
  progressRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  progressDot: {
    width: 24,
    height: 4,
    borderRadius: 999,
  },
  skipButton: {
    alignSelf: 'center' as const,
    paddingVertical: 4,
  },
};
