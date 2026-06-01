import { AppButton } from '@/components/AppButton';
import { AppTextInput } from '@/components/AppTextInput';
import { Row } from '@/components/Row';
import { Section } from '@/components/Section';

type TaskFormProps = {
  onSave?: () => void;
};

export function TaskForm({ onSave }: TaskFormProps) {
  return (
    <Section>
      <AppTextInput label="Title" placeholder="Export homepage video" />
      <Row title="Workspace" subtitle="Ledger" />
      <Row title="Project" subtitle="Homepage Feature Showcase" />
      <Row title="Due date" subtitle="Optional" />
      <AppButton title="Save task" onPress={onSave} />
    </Section>
  );
}
