import { AppButton } from '@/components/AppButton';
import { AppTextInput } from '@/components/AppTextInput';
import { Row } from '@/components/Row';
import { Section } from '@/components/Section';

type ReminderFormProps = {
  onSave?: () => void;
};

export function ReminderForm({ onSave }: ReminderFormProps) {
  return (
    <Section>
      <AppTextInput label="Title" placeholder="Submit Alfa hours" />
      <Row title="Date / time" subtitle="Tomorrow at 2:00 PM" />
      <Row title="Workspace" subtitle="Alfa Summer 26" />
      <AppButton title="Save reminder" onPress={onSave} />
    </Section>
  );
}
