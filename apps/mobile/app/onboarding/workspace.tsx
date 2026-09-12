import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Keyboard, Pressable, TouchableWithoutFeedback, View } from 'react-native';

import { configureMobileWorkspace } from '@/api/workspaces';
import { AppButton } from '@/components/AppButton';
import { AppText } from '@/components/AppText';
import { AppTextInput } from '@/components/AppTextInput';
import { AuthHeader } from '@/components/AuthHeader';
import { Screen } from '@/components/Screen';
import { completeWorkspaceSetup } from '@/store/notificationOnboardingStore';
import { useAuthState } from '@/store/sessionStore';
import { bootstrapWorkspaceState } from '@/store/workspaceStore';
import { concentricRadius, useLedgerTheme } from '@/theme';

type WorkspaceKind = 'personal' | 'team';

export default function WorkspaceOnboardingScreen() {
  const router = useRouter();
  const theme = useLedgerTheme();
  const auth = useAuthState();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<WorkspaceKind>('personal');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Give your workspace a name.');
      return;
    }
    if (isSubmitting) return;

    setError(null);
    setIsSubmitting(true);
    try {
      await configureMobileWorkspace({
        name: trimmedName,
        isPersonal: kind === 'personal',
      });
      await bootstrapWorkspaceState(auth.user?.id ?? undefined);
      completeWorkspaceSetup();
      router.replace('/(tabs)/today');
    } catch (workspaceError) {
      setError(workspaceError instanceof Error ? workspaceError.message : 'Could not create workspace.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Screen contentStyle={{ paddingTop: 0 }} topFade={false}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={[styles.container, { paddingVertical: theme.spacing.lg }]}> 
          <AuthHeader
            title="Set up your workspace"
            subtitle="Give your Ledger a place to keep today together."
            align="left"
          />

          <View style={styles.content}>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.colors.surfaceCard,
                  borderColor: theme.colors.borderSubtle,
                  borderRadius: theme.radius.surface,
                },
              ]}
            >
              <AppTextInput
                label="Workspace name"
                placeholder={kind === 'personal' ? 'Personal' : 'Your team'}
                autoCapitalize="words"
                value={name}
                onChangeText={setName}
                style={styles.cardInput}
              />
            </View>

            <View style={styles.kindSection}>
              <AppText variant="label" style={{ color: theme.colors.textMuted }}>
                Workspace type
              </AppText>
              <View style={styles.kindRow}>
                {([
                  ['personal', 'Personal', 'Just for you'],
                  ['team', 'Team', 'For shared work'],
                ] as const).map(([value, title, description]) => {
                  const selected = kind === value;
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setKind(value)}
                      style={({ pressed }) => [
                        styles.kindCard,
                        {
                          backgroundColor: selected ? 'rgba(255, 95, 64, 0.08)' : theme.colors.surfaceCard,
                          borderColor: selected ? theme.colors.accent : theme.colors.borderSubtle,
                          borderRadius: concentricRadius(theme.radius.surface, theme.spacing.sm),
                          opacity: pressed ? 0.72 : 1,
                        },
                      ]}
                    >
                      <AppText variant="bodyStrong">{title}</AppText>
                      <AppText variant="meta">{description}</AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {error ? <AppText variant="caption" style={{ color: theme.colors.danger }}>{error}</AppText> : null}
          </View>

          <View style={styles.actions}>
            <AppButton
              title={isSubmitting ? 'Creating…' : 'Continue'}
              size="lg"
              onPress={() => void handleContinue()}
              disabled={isSubmitting}
            />
          </View>
        </View>
      </TouchableWithoutFeedback>
    </Screen>
  );
}

const styles = {
  container: {
    flex: 1,
  },
  content: {
    gap: 18,
    marginTop: 36,
  },
  card: {
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cardInput: {
    borderBottomWidth: 0,
  },
  kindSection: {
    gap: 8,
  },
  kindRow: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  kindCard: {
    flex: 1,
    gap: 4,
    borderWidth: 1,
    padding: 14,
  },
  actions: {
    marginTop: 'auto' as const,
  },
};
