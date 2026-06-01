import { AppButton } from '@/components/AppButton';
import { AppTextInput } from '@/components/AppTextInput';
import { Row } from '@/components/Row';
import { Section } from '@/components/Section';

type EventFormProps = {
  onSave?: () => void;
};

export function EventForm({ onSave }: EventFormProps) {
  return (
    <Section>
      <AppTextInput label="Title" placeholder="Remote internship" />
      <Row title="Date / time" subtitle="Thursday · 11:00 AM - 6:00 PM" />
      <Row title="Workspace" subtitle="Alfa Summer 26" />
      <Row title="Notes" subtitle="Optional" />
      <AppButton title="Save event" onPress={onSave} />
    </Section>
  );
}
