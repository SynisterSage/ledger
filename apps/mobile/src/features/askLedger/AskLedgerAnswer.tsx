import type { ReactNode } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';

type Block = { kind: 'heading' | 'paragraph' | 'bullets' | 'numbered'; lines: string[] };

function parseAnswer(value: string): Block[] {
  const blocks: Block[] = [];
  let currentKind: Block['kind'] | null = null;
  let currentLines: string[] = [];
  const flush = () => {
    if (currentKind && currentLines.length) blocks.push({ kind: currentKind, lines: currentLines });
    currentKind = null;
    currentLines = [];
  };

  for (const line of value.trim().split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    const kind: Block['kind'] = /^#{1,3}\s/.test(trimmed)
      ? 'heading'
      : /^[-*]\s/.test(trimmed)
      ? 'bullets'
      : /^\d+[.)]\s/.test(trimmed)
      ? 'numbered'
      : 'paragraph';
    if (kind === 'heading' || currentKind !== kind) flush();
    currentKind = kind;
    currentLines.push(trimmed);
    if (kind === 'heading') flush();
  }
  flush();
  return blocks;
}

function inlineText(value: string, strongColor: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) =>
    part.startsWith('**') && part.endsWith('**')
      ? <AppText key={index} variant="bodyStrong" style={{ color: strongColor }}>{part.slice(2, -2)}</AppText>
      : part,
  );
}

export function AskLedgerAnswer({ text }: { text: string }) {
  const theme = useLedgerTheme();
  return (
    <View style={{ gap: 10 }}>
      {parseAnswer(text).map((block, blockIndex) => {
        if (block.kind === 'heading') {
          return <AppText key={blockIndex} variant="bodyStrong" style={{ color: theme.colors.textPrimary, marginTop: blockIndex ? 4 : 0 }}>{inlineText(block.lines[0].replace(/^#{1,3}\s+/, ''), theme.colors.textPrimary)}</AppText>;
        }
        if (block.kind === 'paragraph') {
          return <AppText key={blockIndex} variant="body" style={{ color: theme.colors.textPrimary }}>{inlineText(block.lines.join(' '), theme.colors.textPrimary)}</AppText>;
        }
        return (
          <View key={blockIndex} style={{ gap: 7 }}>
            {block.lines.map((line, lineIndex) => (
              <View key={lineIndex} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <AppText variant="body" style={{ color: theme.colors.textSecondary, minWidth: block.kind === 'numbered' ? 20 : 8 }}>
                  {block.kind === 'numbered' ? line.match(/^\d+/)?.[0] + '.' : '•'}
                </AppText>
                <AppText variant="body" style={{ color: theme.colors.textPrimary, flex: 1 }}>
                  {inlineText(line.replace(/^(?:[-*]|\d+[.)])\s+/, ''), theme.colors.textPrimary)}
                </AppText>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}
