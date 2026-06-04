import type { ReactNode } from 'react';
import { SymbolView } from 'expo-symbols';

import { AppBottomSheet } from '@/components/AppBottomSheet';
import { Row } from '@/components/Row';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import type { MobileProjectOption } from '@/types/ledger';

type ProjectPickerSheetProps = {
  visible: boolean;
  projects: MobileProjectOption[];
  selectedProjectId: string | null;
  onSelect: (projectId: string | null) => void;
  onClose: () => void;
  loading?: boolean;
  title?: string;
  footer?: ReactNode;
};

export function ProjectPickerSheet({
  visible,
  projects,
  selectedProjectId,
  onSelect,
  onClose,
  loading = false,
  title = 'Project',
  footer,
}: ProjectPickerSheetProps) {
  const theme = useLedgerTheme();

  return (
    <AppBottomSheet visible={visible} onClose={onClose} title={title} snapPoints={['42%', '72%']} initialSnapPointIndex={1}>
      <AppText variant="meta" style={{ marginBottom: theme.spacing.xs }}>
        Choose a project or leave it unlinked.
      </AppText>
      {loading ? (
        <AppText variant="body" style={{ color: theme.colors.textSecondary }}>
          Loading projects...
        </AppText>
      ) : (
        <>
          <Row
            title="No project"
            subtitle="Keep this capture unlinked"
            onPress={() => {
              onSelect(null);
              onClose();
            }}
            right={
              selectedProjectId === null ? (
                <SymbolView name="checkmark" size={15} weight="regular" tintColor={theme.colors.accent} />
              ) : null
            }
          />
          {projects.length ? (
            projects.map((project) => (
              <Row
                key={project.id}
                title={project.name}
                subtitle={project.description ?? project.status ?? undefined}
                onPress={() => {
                  onSelect(project.id);
                  onClose();
                }}
                right={
                  selectedProjectId === project.id ? (
                    <SymbolView name="checkmark" size={15} weight="regular" tintColor={theme.colors.accent} />
                  ) : null
                }
              />
            ))
          ) : (
            <AppText variant="meta" style={{ paddingVertical: theme.spacing.md }}>
              No projects in this workspace yet.
            </AppText>
          )}
          {footer ? <>{footer}</> : null}
        </>
      )}
    </AppBottomSheet>
  );
}
