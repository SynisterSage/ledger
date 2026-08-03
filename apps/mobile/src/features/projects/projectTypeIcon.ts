import type { ComponentProps } from 'react';
import { SymbolView } from 'expo-symbols';

export type ProjectTypeIconName = ComponentProps<typeof SymbolView>['name'];

export function projectTypeIcon(projectType?: string | null): ProjectTypeIconName {
  switch (String(projectType ?? '').toLowerCase()) {
    case 'code': return { ios: 'chevron.left.forwardslash.chevron.right', android: 'code', web: 'code' };
    case 'design': return { ios: 'paintbrush', android: 'brush', web: 'brush' };
    case 'personal': return { ios: 'person', android: 'person', web: 'person' };
    case 'ops': return { ios: 'briefcase', android: 'business_center', web: 'business_center' };
    case 'writing': return { ios: 'doc.text', android: 'description', web: 'description' };
    default: return { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' };
  }
}
