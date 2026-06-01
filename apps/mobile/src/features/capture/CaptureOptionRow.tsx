import { Row } from '@/components/Row';

type CaptureOptionRowProps = {
  title: string;
  subtitle: string;
  onPress?: () => void;
};

export function CaptureOptionRow({ title, subtitle, onPress }: CaptureOptionRowProps) {
  return <Row title={title} subtitle={subtitle} onPress={onPress} />;
}
