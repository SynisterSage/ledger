import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckSquare,
  Code2,
  File,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Link2,
  List,
  ListOrdered,
  Minus,
  Network,
  Quote,
  Table2,
  Type,
  AlertCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from '@lexical/list';
import { INSERT_TABLE_COMMAND } from '@lexical/table';
import { $createCodeNode } from '@lexical/code';
import { $createLinkNode } from '@lexical/link';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $insertNodes,
  COMMAND_PRIORITY_HIGH,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_SPACE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { $createHorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode';
import { $createExternalEmbedNode } from '../../../ExternalEmbeds/ExternalEmbedNode';
import type { EditorExternalEmbedRequest, EditorExternalEmbedResult } from '../types/externalEmbed';
import {
  INSERT_CALLOUT_COMMAND,
  INSERT_FILE_ATTACHMENT_COMMAND,
  INSERT_IMAGE_COMMAND,
  INSERT_TOGGLE_COMMAND,
} from '../commands/blocks';
import { OPEN_LINKED_RESOURCES_COMMAND } from '../commands/linkedResources';

type CommandId =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'number'
  | 'checklist'
  | 'quote'
  | 'toggle'
  | 'callout'
  | 'divider'
  | 'table'
  | 'code'
  | 'image'
  | 'file'
  | 'link';

type CommandItem = {
  id: CommandId;
  title: string;
  aliases?: string[];
  shortcut?: string;
  icon: LucideIcon;
  group: 'Basic' | 'Blocks' | 'Media';
};

const COMMANDS: CommandItem[] = [
  { id: 'text', title: 'Text', icon: Type, group: 'Basic' },
  { id: 'h1', title: 'Heading 1', icon: Heading1, group: 'Basic' },
  { id: 'h2', title: 'Heading 2', icon: Heading2, group: 'Basic' },
  { id: 'h3', title: 'Heading 3', icon: Heading3, group: 'Basic' },
  { id: 'bullet', title: 'Bulleted list', icon: List, group: 'Basic' },
  { id: 'number', title: 'Numbered list', icon: ListOrdered, group: 'Basic' },
  {
    id: 'checklist',
    title: 'Checklist',
    aliases: ['todo', 'checkbox'],
    icon: CheckSquare,
    group: 'Basic',
  },
  { id: 'quote', title: 'Quote', icon: Quote, group: 'Basic' },
  { id: 'toggle', title: 'Toggle', icon: Network, group: 'Blocks' },
  { id: 'callout', title: 'Callout', icon: AlertCircle, group: 'Blocks' },
  { id: 'divider', title: 'Divider', aliases: ['hr'], icon: Minus, group: 'Blocks' },
  { id: 'table', title: 'Table', icon: Table2, group: 'Blocks' },
  { id: 'code', title: 'Code block', icon: Code2, shortcut: '```', group: 'Blocks' },
  { id: 'image', title: 'Image', icon: Image, group: 'Media' },
  { id: 'file', title: 'File attachment', aliases: ['attachment'], icon: File, group: 'Media' },
  { id: 'link', title: 'Link or embed', aliases: ['link', 'embed', 'embedd'], icon: Link2, group: 'Media' },
];

const getCurrentBlock = (node: LexicalNode) => {
  let current: LexicalNode | null = node;
  while (current && !$isElementNode(current)) current = current.getParent();
  if (!current) throw new Error('Expected an element block');
  return current;
};

const replaceCurrentBlock = (create: () => LexicalNode) => {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  const block = getCurrentBlock(selection.anchor.getNode());
  block.replace(create());
  block.getNextSibling()?.selectStart();
};

const insertCommand = (
  editor: LexicalEditor,
  item: CommandItem,
  embedContext?: {
    noteId?: string | null;
    targetType?: 'note' | 'meetingNote';
    onCreateExternalEmbed?: (request: EditorExternalEmbedRequest) => Promise<EditorExternalEmbedResult>;
    onOpenLinkedResources?: () => void;
  }
) => {
  if (item.id === 'toggle') return editor.dispatchCommand(INSERT_TOGGLE_COMMAND, undefined);
  if (item.id === 'callout') return editor.dispatchCommand(INSERT_CALLOUT_COMMAND, 'info');
  if (item.id === 'bullet') return editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
  if (item.id === 'number') return editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
  if (item.id === 'checklist') return editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
  if (item.id === 'table')
    return editor.dispatchCommand(INSERT_TABLE_COMMAND, {
      rows: '2',
      columns: '2',
      includeHeaders: false,
    });
  if (item.id === 'file') return editor.dispatchCommand(INSERT_FILE_ATTACHMENT_COMMAND, undefined);
  if (item.id === 'image') return editor.dispatchCommand(INSERT_IMAGE_COMMAND, undefined);
  if (item.id === 'link') {
    if (embedContext?.onOpenLinkedResources) {
      embedContext.onOpenLinkedResources();
      return;
    }
    const url = window.prompt('Link or embed URL')?.trim();
    if (!url?.trim()) return;
    const provider = (() => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return null;
        const host = parsed.hostname.toLowerCase();
        const route = parsed.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
        if ((host === 'figma.com' || host === 'www.figma.com') && ['design', 'file', 'board'].includes(route ?? '')) return 'figma' as const;
        if (['github.com', 'www.github.com'].includes(host) && parsed.pathname.split('/').filter(Boolean).length >= 2) return 'github' as const;
        if (['drive.google.com', 'docs.google.com', 'sheets.google.com', 'slides.google.com', 'forms.google.com', 'drawings.google.com'].includes(host) && Boolean(parsed.searchParams.get('id') || parsed.pathname.match(/\/d\/[-\w]+/))) return 'google_drive' as const;
      } catch {}
      return null;
    })();
    if (provider && embedContext?.noteId && embedContext.onCreateExternalEmbed) {
      void embedContext.onCreateExternalEmbed({
        noteId: embedContext.noteId,
        targetType: embedContext.targetType ?? 'note',
        provider,
        url,
      }).then((result) => {
        editor.update(() => {
          const embedNode = $createExternalEmbedNode({
            externalReferenceId: result.externalReferenceId,
            externalUrl: result.externalUrl,
          });
          const selection = $getSelection();
          if ($isRangeSelection(selection)) selection.insertNodes([embedNode]);
          else $insertNodes([embedNode]);
        });
      });
      return;
    }
    editor.update(() => {
      const paragraph = $createParagraphNode();
      const link = $createLinkNode(url);
      link.append($createTextNode(url));
      paragraph.append(link);
      $insertNodes([paragraph]);
    });
    return;
  }
  editor.update(() => {
    switch (item.id) {
      case 'text':
        replaceCurrentBlock($createParagraphNode);
        break;
      case 'h1':
        replaceCurrentBlock(() => $createHeadingNode('h1'));
        break;
      case 'h2':
        replaceCurrentBlock(() => $createHeadingNode('h2'));
        break;
      case 'h3':
        replaceCurrentBlock(() => $createHeadingNode('h3'));
        break;
      case 'quote':
        replaceCurrentBlock($createQuoteNode);
        break;
      case 'code':
        replaceCurrentBlock(() => $createCodeNode());
        break;
      case 'divider':
        replaceCurrentBlock($createHorizontalRuleNode);
        break;
      default:
        $insertNodes([$createParagraphNode()]);
    }
  });
};

export const SlashCommandPlugin = ({
  noteId,
  targetType,
  onCreateExternalEmbed,
  onOpenLinkedResources,
}: {
  noteId?: string | null;
  targetType?: 'note' | 'meetingNote';
  onCreateExternalEmbed?: (request: EditorExternalEmbedRequest) => Promise<EditorExternalEmbedResult>;
  onOpenLinkedResources?: () => void;
} = {}) => {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const chooseCommand = (item: CommandItem) => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const block = getCurrentBlock(selection.anchor.getNode());
      block.clear();
      // Keep a real, empty paragraph selected before opening the picker. The
      // picker will steal browser focus, but the insertion command can now
      // restore this stable block instead of a deleted slash text node.
      block.selectStart();
    });
    insertCommand(editor, item, {
      noteId,
      targetType,
      onCreateExternalEmbed,
      onOpenLinkedResources: onOpenLinkedResources
        ? () => editor.dispatchCommand(OPEN_LINKED_RESOURCES_COMMAND, undefined)
        : undefined,
    });
    setOpen(false);
  };

  const filtered = useMemo(() => {
    const needle = query.toLowerCase();
    return COMMANDS.filter(
      (item) =>
        !needle ||
        [item.title, ...(item.aliases ?? [])].some((value) => value.toLowerCase().includes(needle))
    );
  }, [query]);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return setOpen(false);
        const node = selection.anchor.getNode();
        const block = getCurrentBlock(node);
        if (block.getType() !== 'paragraph' || node.getType() !== 'text') return setOpen(false);
        const text = block.getTextContent();
        const match = text.match(/^\/([^\s]*)$/);
        if (!match) return setOpen(false);
        const dom = editor.getElementByKey(block.getKey());
        if (!dom) return;
        // Use the active paragraph's line box. A browser Selection range can
        // briefly report a stale or oversized rect while Lexical is updating,
        // which makes the menu float far below the slash the user just typed.
        const blockRect = dom.getBoundingClientRect();
        const nativeSelection = window.getSelection();
        const nativeRange = nativeSelection?.rangeCount ? nativeSelection.getRangeAt(0) : null;
        const caretRect = nativeRange?.getBoundingClientRect();
        const rect = caretRect && caretRect.height > 0 && caretRect.height < 80 ? caretRect : blockRect;
        const menuWidth = 224;
        const menuHeight = 288;
        const anchorBottom = rect.top + Math.min(Math.max(rect.height, 20), 28);
        const opensBelow = window.innerHeight - anchorBottom >= menuHeight + 12;
        setPosition({
          top: opensBelow
            ? anchorBottom + 6
            : Math.max(8, rect.top - menuHeight - 6),
          left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - menuWidth - 8)),
        });
        setQuery(match[1]);
        setActiveIndex(0);
        setOpen(true);
      });
    });
  }, [editor]);

  useEffect(() => {
    if (!open) return;
    const unregisterDown = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        if (!open) return false;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActiveIndex((value) => Math.min(value + 1, Math.max(0, filtered.length - 1)));
          return true;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveIndex((value) => Math.max(0, value - 1));
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH
    );
    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (!open || !filtered[activeIndex]) return false;
        event?.preventDefault();
        const item = filtered[activeIndex];
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            const block = getCurrentBlock(selection.anchor.getNode());
            block.clear();
          }
        });
        chooseCommand(item);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
    const unregisterEscape = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        setOpen(false);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
    return () => {
      unregisterDown();
      unregisterEnter();
      unregisterEscape();
    };
  }, [activeIndex, editor, filtered, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_SPACE_COMMAND,
      (event) => {
        let transformed = false;
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
          const block = getCurrentBlock(selection.anchor.getNode());
          if (
            !['paragraph', 'listitem'].includes(block.getType()) ||
            block.getTextContent().length > 8
          )
            return;
          const text = block.getTextContent();
          if (/^(?:\[\]|\[ \]|- \[ \])$/.test(text)) {
            block.clear();
            editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
            transformed = true;
          }
        });
        if (transformed) event.preventDefault();
        return transformed;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor]);

  if (!open) return null;
  return createPortal((
    <div
      ref={menuRef}
      role="menu"
      aria-label="Insert command"
      aria-activedescendant={filtered[activeIndex] ? `ledger-slash-${filtered[activeIndex].id}` : undefined}
      className="ledger-slash-menu fixed z-[80] max-h-72 w-56 overflow-y-auto rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]"
      style={{ top: position.top, left: position.left }}
    >
      {filtered.length === 0 ? (
        <div className="px-2 py-3 text-[11px] text-[var(--ledger-text-muted)]">
          No matching commands
        </div>
      ) : (
        filtered.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              id={`ledger-slash-${item.id}`}
              role="menuitem"
              aria-current={index === activeIndex ? 'true' : undefined}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] ${
                index === activeIndex
                  ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
                  : 'text-[var(--ledger-text-secondary)]'
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                chooseCommand(item);
              }}
            >
              <Icon size={14} />
              <span className="flex-1">{item.title}</span>
              {item.shortcut && (
                <span className="text-[10px] text-[var(--ledger-text-muted)]">{item.shortcut}</span>
              )}
            </button>
          );
        })
      )}
    </div>
  ), document.body);
};
