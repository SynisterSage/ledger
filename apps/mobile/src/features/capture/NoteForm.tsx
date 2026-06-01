import { AppButton } from '@/components/AppButton';
import { AppTextInput } from '@/components/AppTextInput';
import { Row } from '@/components/Row';
import { Section } from '@/components/Section';

type NoteFormProps = {
  onSave?: () => void;
};

export function NoteForm({ onSave }: NoteFormProps) {
  return (
    <Section>
      <AppTextInput label="Title" placeholder="Capture note" />
      <AppTextInput label="Body" placeholder="Write a plain text note" multiline />
      <Row title="Workspace" subtitle="Personal" />
      <Row title="Project" subtitle="Optional" />
      <AppButton title="Save note" onPress={onSave} />
    </Section>
  );
}
