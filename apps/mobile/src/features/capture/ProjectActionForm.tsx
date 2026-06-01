import { AppButton } from '@/components/AppButton';
import { AppTextInput } from '@/components/AppTextInput';
import { Row } from '@/components/Row';
import { Section } from '@/components/Section';

type ProjectActionFormProps = {
  onSave?: () => void;
};

export function ProjectActionForm({ onSave }: ProjectActionFormProps) {
  return (
    <Section>
      <AppTextInput label="Action" placeholder="Send client mockup" />
      <Row title="Project" subtitle="Pigmented Perceptions" />
      <Row title="Workspace" subtitle="Inferred from project" />
      <Row title="Due date" subtitle="Tomorrow" />
      <AppButton title="Save action" onPress={onSave} />
    </Section>
  );
}
