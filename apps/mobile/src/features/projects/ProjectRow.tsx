import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import type { ProjectAttentionSeverity } from '@/api/projects';
import { projectTypeIcon } from './projectTypeIcon';

export type ProjectRowVariant = 'default' | 'attention' | 'upcoming' | 'paused' | 'completed' | 'compact';

export type MobileProjectRowModel = {
  id: string;
  title: string;
  context: string;
  metadata?: string | null;
  progress?: number;
  color?: string | null;
  projectType?: string | null;
  variant?: ProjectRowVariant;
  attentionSeverity?: ProjectAttentionSeverity;
};

type ProjectRowProps = {
  project: MobileProjectRowModel;
  showOwner?: boolean;
  showProgress?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
};

export const ProjectRow = memo(function ProjectRow({ project, showOwner = false, showProgress = true, selected = false, disabled = false, onPress, onLongPress }: ProjectRowProps) {
  const theme = useLedgerTheme();
  const variant = project.variant ?? 'default';
  const completed = variant === 'completed';
  const attention = variant === 'attention';
  const progress = typeof project.progress === 'number' ? Math.max(0, Math.min(100, project.progress)) : null;
  const identityColor = project.color || theme.colors.accent;
  const attentionColor = project.attentionSeverity === 'critical' ? theme.colors.danger : project.attentionSeverity === 'info' ? theme.colors.textMuted : theme.colors.warning;
  const titleColor = completed || variant === 'paused' ? theme.colors.textSecondary : theme.colors.textPrimary;
  const contextColor = attention ? theme.colors.warning : theme.colors.textSecondary;
  const accessibilityLabel = [
    project.title,
    project.context,
    project.metadata,
    progress === null || !showProgress ? null : `${progress}% complete`,
  ].filter(Boolean).join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={onLongPress ? 'Opens project. Long press for actions.' : 'Opens project.'}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, { backgroundColor: selected ? theme.colors.surfaceSelected : pressed ? theme.colors.surfaceHover : 'transparent', opacity: disabled ? 0.42 : completed ? 0.72 : 1 }]}
    >
      <View style={styles.markerColumn}>
        <View style={[styles.marker, { backgroundColor: identityColor }]}><SymbolView name={projectTypeIcon(project.projectType)} size={13} tintColor="#FFFFFF" />{attention ? <View style={[styles.attentionBadge, { backgroundColor: attentionColor }]}><SymbolView name={{ ios: 'exclamationmark', android: 'priority_high', web: 'priority_high' }} size={8} tintColor="#FFFFFF" /></View> : null}</View>
      </View>
      <View style={styles.body}>
        <View style={styles.titleLine}>
          <AppText variant="bodyStrong" numberOfLines={1} style={{ color: titleColor, flex: 1 }}>{project.title}</AppText>
          {completed ? <SymbolView name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }} size={15} tintColor={theme.colors.success} /> : showProgress && progress !== null ? <AppText variant="caption" style={{ color: titleColor }}>{progress}%</AppText> : null}
        </View>
        <AppText variant="caption" numberOfLines={1} style={{ color: contextColor }}>{project.context}</AppText>
        {project.metadata ? <AppText variant="caption" numberOfLines={1}>{project.metadata}</AppText> : null}
        {showProgress && progress !== null ? <View accessible={false} style={[styles.progressTrack, { backgroundColor: theme.colors.borderSubtle }]}><View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: completed ? theme.colors.success : identityColor }]} /></View> : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: 4, borderRadius: 8 },
  markerColumn: { width: 22, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 5 },
  marker: { width: 20, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  attentionBadge: { position: 'absolute', right: -4, bottom: -4, width: 12, height: 12, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF' },
  body: { minWidth: 0, flex: 1, gap: 3 },
  titleLine: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressTrack: { height: 2, width: '100%', marginTop: 2, overflow: 'hidden' },
  progressFill: { height: 2 },
});
