import { Row } from '@/components/Row';

type TodayItemProps = {
  title: string;
  meta: string;
};

export function TodayItem({ title, meta }: TodayItemProps) {
  return <Row title={title} subtitle={meta} />;
}
