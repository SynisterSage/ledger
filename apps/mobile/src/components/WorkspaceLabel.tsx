import { AppText } from './AppText';

type WorkspaceLabelProps = {
  name: string;
};

export function WorkspaceLabel({ name }: WorkspaceLabelProps) {
  return <AppText variant="caption">{name}</AppText>;
}
