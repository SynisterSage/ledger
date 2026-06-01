import { Row } from '@/components/Row';

type TodayItemProps = {
  title: string;
  subtitle: string;
};

export function TodayItem({ title, subtitle }: TodayItemProps) {
  return <Row title={title} subtitle={subtitle} />;
}
