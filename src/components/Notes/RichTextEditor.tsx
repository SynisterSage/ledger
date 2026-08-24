import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { AutoLinkPlugin, createLinkMatcherWithRegExp } from '@lexical/react/LexicalAutoLinkPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  List,
  ListOrdered,
  Bold,
  ChevronDown,
  CheckSquare,
  Italic,
  MoreHorizontal,
  Redo2,
  SpellCheck,
  Underline,
  Undo2,
} from 'lucide-react';
import { AutoLinkNode, LinkNode, $createLinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin';
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from '@lexical/list';
import { CodeHighlightNode, CodeNode } from '@lexical/code';
import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode';
import { HeadingNode, QuoteNode, registerRichText } from '@lexical/rich-text';
import { $generateHtmlFromNodes } from '@lexical/html';
import { $generateNodesFromDOM } from '@lexical/html';
import {
  $getRoot,
  $getNodeByKey,
  $getNearestNodeFromDOMNode,
  $insertNodes,
  EditorState,
  type LexicalNode,
  FORMAT_TEXT_COMMAND,
  $getPreviousSelection,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $createRangeSelection,
  $isElementNode,
  $setSelection,
  $createParagraphNode,
  $createTextNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  PASTE_COMMAND,
  DROP_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  SELECT_ALL_COMMAND,
  CAN_UNDO_COMMAND,
  CAN_REDO_COMMAND,
  CLEAR_HISTORY_COMMAND,
  HISTORIC_TAG,
  HISTORY_PUSH_TAG,
} from 'lexical';
import { $setBlocksType } from '@lexical/selection';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $createCodeNode } from '@lexical/code';
import { $createImageNode, $isImageNode, ImageNode } from './nodes/ImageNode';
import { $isSmartDateNode, SmartDateNode } from './nodes/SmartDateNode';
import { SmartDatePlugin } from './SmartDatePlugin';
import { SmartPersonNode } from './nodes/SmartPersonNode';
import {
  $createExternalEmbedNode,
  ExternalEmbedNode,
  ExternalEmbedProvider,
} from '../ExternalEmbeds/ExternalEmbedNode';
import { SmartPersonPlugin } from './SmartPersonPlugin';
import { supabase } from '../../services/supabase';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../Common/ToastProvider';
import { NotesEditorContextMenu, type EditorContextMenuPosition } from './NotesEditorContextMenu';
import type {
  SelectedContentAction,
  SelectedContentPayload,
  SelectedContentPersonAction,
} from './editor/types/selectedContent';
import type {
  EditorExternalEmbedRequest,
  EditorExternalEmbedResult,
} from './editor/types/externalEmbed';
import { BlockInsertionPlugin } from './editor/plugins/BlockInsertionPlugin';
import { SlashCommandPlugin } from './editor/plugins/SlashCommandPlugin';
import { BlockHandlePlugin } from './editor/plugins/BlockHandlePlugin';
import { SelectionFormattingPlugin } from './editor/plugins/SelectionFormattingPlugin';
import { INSERT_IMAGE_COMMAND, SET_CALLOUT_TYPE_COMMAND } from './editor/commands/blocks';
import {
  INSERT_LINKED_RESOURCE_BADGE_COMMAND,
  OPEN_LINKED_RESOURCES_COMMAND,
  type LinkedResourceBadgeRequest,
} from './editor/commands/linkedResources';
import { CalloutNode, $isCalloutNode } from './editor/nodes/CalloutNode';
import type { CalloutType } from './editor/types/blocks';
import { ToggleNode } from './editor/nodes/ToggleNode';
import { FileAttachmentNode } from './editor/nodes/FileAttachmentNode';
import { LinkedResourceBadgeNode, $createLinkedResourceBadgeNode, $isLinkedResourceBadgeNode } from './editor/nodes/LinkedResourceBadgeNode';
import type {
  AttachmentRemoveRequest,
  AttachmentUploadRequest,
  AttachmentUploadResult,
} from './editor/types/blocks';
import { sanitizeEditorHtml } from './editor/utils/html';

type Props = {
  initialValue?: string | null;
  editorKey?: string;
  noteId?: string | null;
  targetType?: 'note' | 'meetingNote';
  noteTitle?: string | null;
  noteProjectId?: string | null;
  onChange: (html: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onAutoCorrect?: () => void | Promise<void>;
  onCreateTask?: SelectedContentAction;
  onPersonTaskAction?: (
    action: 'task' | 'follow-up',
    person: { id: string; name: string; sourceText: string }
  ) => void;
  onCreateReminder?: SelectedContentAction;
  onCreateEvent?: SelectedContentAction;
  onSendToIntake?: SelectedContentAction;
  onLinkProject?: SelectedContentAction;
  onLinkPerson?: SelectedContentPersonAction;
  onSearch?: SelectedContentAction;
  onCreateExternalEmbed?: (
    request: EditorExternalEmbedRequest
  ) => Promise<EditorExternalEmbedResult>;
  onOpenLinkedResources?: () => void;
  linkedResourceBadge?: { resourceType: 'project' | 'note' | 'task' | 'event' | 'reminder' | 'external'; resourceId: string; title: string; url: string } | null;
  onLinkedResourceBadgeInserted?: () => void;
  linkedExternalReference?: { id: string; url: string } | null;
  onLinkedExternalReferenceInserted?: () => void;
  onUploadAttachment?: (request: AttachmentUploadRequest) => Promise<AttachmentUploadResult>;
  onRemoveAttachment?: (request: AttachmentRemoveRequest) => void | Promise<void>;
  showToolbar?: boolean;
};

const getSelectedContentPayload = (
  noteId: string | null | undefined,
  selection: ReturnType<typeof $getSelection>
): SelectedContentPayload | null => {
  if (!noteId || !$isRangeSelection(selection)) return null;
  const plainText = selection.getTextContent().trim();
  if (!plainText) return null;

  const anchorNode = selection.anchor.getNode();
  const blockKey =
    anchorNode.getKey() === 'root' ? undefined : anchorNode.getTopLevelElementOrThrow().getKey();

  const smartDates = selection
    .getNodes()
    .filter($isSmartDateNode)
    .map((node) => ({
      text: node.getTextContent(),
      date: node.getSmartDateKey(),
      state: node.getSmartDateState(),
    }));

  return { noteId, plainText, blockKey, source: 'selection', smartDates };
};

const editorConfig = {
  namespace: 'ledger-notes',
  nodes: [
    HeadingNode,
    QuoteNode,
    HorizontalRuleNode,
    ListNode,
    ListItemNode,
    TableNode,
    TableCellNode,
    TableRowNode,
    LinkNode,
    AutoLinkNode,
    CodeNode,
    CodeHighlightNode,
    ImageNode,
    SmartDateNode,
    SmartPersonNode,
    ExternalEmbedNode,
    CalloutNode,
    ToggleNode,
    FileAttachmentNode,
    LinkedResourceBadgeNode,
  ],
  theme: {
    text: {
      bold: 'font-bold',
      italic: 'italic',
      underline: 'underline',
    },
    link: 'cursor-pointer text-blue-600 underline decoration-blue-600 underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:decoration-blue-400 dark:hover:text-blue-300',
    heading: {
      h1: 'mb-4 text-4xl font-semibold tracking-tight text-[var(--ledger-text-primary)]',
      h2: 'mb-3 text-3xl font-semibold tracking-tight text-[var(--ledger-text-primary)]',
      h3: 'mb-2 text-2xl font-semibold tracking-tight text-[var(--ledger-text-primary)]',
    },
    quote:
      'my-4 border-l-4 border-[color:var(--ledger-border-subtle)] pl-4 italic text-[var(--ledger-text-secondary)]',
    paragraph: 'mb-4',
    list: {
      nested: {
        listitem: 'ml-4',
      },
      ol: 'list-decimal list-inside',
      ul: 'list-disc list-inside',
      listitem: 'mb-1',
      checklist: 'ledger-checklist',
      listitemChecked: 'ledger-listitem-checked',
      listitemUnchecked: 'ledger-listitem-unchecked',
    },
    code: 'ledger-code-block',
    codeHighlight: {
      aml: 'ledger-code-token-aml',
      tag: 'ledger-code-token-tag',
      self: 'ledger-code-token-self',
      property: 'ledger-code-token-property',
      comment: 'ledger-code-token-comment',
    },
  },
  onError: (error: Error) => console.error(error),
};

const URL_MATCHERS = [
  createLinkMatcherWithRegExp(/(?:https?:\/\/|www\.)[^\s<]+/i, (text) =>
    text.startsWith('www.') ? `https://${text}` : text
  ),
];

const openExternalLink = (value: string) => {
  const href = String(value ?? '').trim();
  if (!/^(?:https?:\/\/|mailto:|tel:)/i.test(href)) return;
  if (window.desktopWindow?.openExternal) {
    void window.desktopWindow.openExternal(href);
  } else {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
};

const LoadHtmlPlugin = ({ html, editorKey }: { html?: string | null; editorKey?: string }) => {
  const [editor] = useLexicalComposerContext();
  const lastLoadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const key = String(editorKey ?? '__default__');
    if (lastLoadedKeyRef.current === key) return;
    lastLoadedKeyRef.current = key;

    editor.update(
      () => {
        const root = $getRoot();
        root.clear();

        const initialHtml = String(html ?? '').trim();
        if (!initialHtml) {
          return;
        }

        const parser = new DOMParser();
        const dom = parser.parseFromString(sanitizeEditorHtml(initialHtml), 'text/html');
        const nodes = $generateNodesFromDOM(editor, dom);
        if (nodes.length > 0) {
          // Loading a note must not move Lexical's selection to the end of the
          // document, otherwise opening a long note scrolls the editor to the
          // bottom.
          root.select();
          $insertNodes(nodes);
        }
        $setSelection(null);
      },
      {
        tag: ['smart-date-load', HISTORIC_TAG],
        onUpdate: () => editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined),
      }
    );
  }, [editor, editorKey, html]);

  return null;
};

const RichTextBehaviorPlugin = () => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => registerRichText(editor), [editor]);

  return null;
};

const LinkInteractionPlugin = () => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || !root.contains(anchor)) return;
      const href = anchor.href.trim();
      if (!/^(?:https?:\/\/|mailto:|tel:)/i.test(href)) return;
      event.preventDefault();
      event.stopPropagation();
      openExternalLink(href);
    };

    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [editor]);

  return null;
};

const LinkScanPlugin = ({ editorKey }: { editorKey?: string }) => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      editor.update(
        () => {
          $getRoot()
            .getAllTextNodes()
            .forEach((textNode) => textNode.markDirty());
        },
        { tag: ['smart-date-load', 'link-scan', HISTORIC_TAG] }
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [editor, editorKey]);

  return null;
};

const ToolbarButton = ({
  onClick,
  title,
  children,
  isActive = false,
  onMouseDown,
  className = '',
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  isActive?: boolean;
  onMouseDown?: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
}) => (
  <button
    type="button"
    onMouseDown={(event) => {
      event.preventDefault();
      onMouseDown?.(event);
    }}
    onClick={onClick}
    title={title}
    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-border-strong)] focus-visible:ring-offset-0 ${
      isActive
        ? 'bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
        : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] active:bg-[var(--ledger-surface-hover)]'
    } ${className}`}
  >
    {children}
  </button>
);

type BlockType = 'paragraph' | 'h1' | 'h2' | 'h3' | 'quote' | 'code';

const ToolbarPlugin = ({
  onAutoCorrect,
  noteId,
  targetType,
  onCreateExternalEmbed,
  onOpenLinkedResources,
  onUploadAttachment,
  onRemoveAttachment,
}: {
  onAutoCorrect?: () => void | Promise<void>;
  noteId?: string | null;
  targetType?: 'note' | 'meetingNote';
  onCreateExternalEmbed?: (
    request: EditorExternalEmbedRequest
  ) => Promise<EditorExternalEmbedResult>;
  onOpenLinkedResources?: () => void;
  onUploadAttachment?: (request: AttachmentUploadRequest) => Promise<AttachmentUploadResult>;
  onRemoveAttachment?: (request: AttachmentRemoveRequest) => void | Promise<void>;
}) => {
  const [editor] = useLexicalComposerContext();
  const [blockType, setBlockType] = useState<BlockType>('paragraph');
  const [isBlockTypeDropdownOpen, setIsBlockTypeDropdownOpen] = useState(false);
  const [isMoreDropdownOpen, setIsMoreDropdownOpen] = useState(false);
  const [isSticky, setIsSticky] = useState(false);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const toolbarSentinelRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const sentinel = toolbarSentinelRef.current;
    if (!sentinel) return;

    const findScrollParent = (node: HTMLElement | null) => {
      let current: HTMLElement | null = node;
      while (current) {
        const style = window.getComputedStyle(current);
        const overflowY = style.overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    };

    const root = findScrollParent(sentinel.parentElement);
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsSticky(!entry.isIntersecting);
      },
      {
        root,
        threshold: 0,
        rootMargin: '-12px 0px 0px 0px',
      }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, []);

  const updateToolbar = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        setIsBold(selection.hasFormat('bold'));
        setIsItalic(selection.hasFormat('italic'));
        setIsUnderline(selection.hasFormat('underline'));
        const anchorNode = selection.anchor.getNode();
        let element = anchorNode;
        if (anchorNode.getKey() === 'root') {
          element = anchorNode;
        } else {
          element = anchorNode.getTopLevelElementOrThrow();
        }
        const elementKey = element.getKey();
        const elementDOM = editor.getElementByKey(elementKey);
        if (elementDOM !== null) {
          const tag = elementDOM.tagName.toLowerCase();
          if (tag === 'h1') setBlockType('h1');
          else if (tag === 'h2') setBlockType('h2');
          else if (tag === 'h3') setBlockType('h3');
          else if (tag === 'blockquote') setBlockType('quote');
          else if (tag === 'pre') setBlockType('code');
          else setBlockType('paragraph');
        }
      } else {
        setIsBold(false);
        setIsItalic(false);
        setIsUnderline(false);
      }
    });
  }, [editor]);

  const changeBlockType = useCallback(
    (type: BlockType) => {
      editor.focus();
      editor.update(() => {
        const selection = $getSelection() || $getPreviousSelection();
        if (selection && $isRangeSelection(selection)) {
          if (type === 'h1') $setBlocksType(selection, () => $createHeadingNode('h1'));
          else if (type === 'h2') $setBlocksType(selection, () => $createHeadingNode('h2'));
          else if (type === 'h3') $setBlocksType(selection, () => $createHeadingNode('h3'));
          else if (type === 'quote') $setBlocksType(selection, () => $createQuoteNode());
          else if (type === 'code') $setBlocksType(selection, () => $createCodeNode());
          else $setBlocksType(selection, () => $createParagraphNode());
        }
      });
      setBlockType(type);
      setIsBlockTypeDropdownOpen(false);
    },
    [editor]
  );

  const blockTypeLabels: Record<BlockType, string> = {
    paragraph: 'Text',
    h1: 'H1',
    h2: 'H2',
    h3: 'H3',
    quote: 'Quote',
    code: 'Code block',
  };

  const insertChecklist = () => {
    editor.focus();
    editor.update(() => {
      const selection = $getSelection() || $getPreviousSelection();
      if ($isRangeSelection(selection)) $setSelection(selection);
    });
    editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
  };

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      updateToolbar();
    });
  }, [editor, updateToolbar]);

  useEffect(() => {
    const closeMenusOnOutsidePointer = (event: PointerEvent) => {
      if (toolbarRef.current?.contains(event.target as Node)) return;
      setIsBlockTypeDropdownOpen(false);
      setIsMoreDropdownOpen(false);
    };
    document.addEventListener('pointerdown', closeMenusOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeMenusOnOutsidePointer);
  }, []);

  return (
    <>
      <div
        ref={toolbarSentinelRef}
        aria-hidden="true"
        className="pointer-events-none h-px w-full"
      />
      <div
        ref={toolbarRef}
        style={{ top: 'var(--notes-toolbar-sticky-top, 0px)' }}
        className={`sticky z-20 mb-3 flex w-full max-w-full flex-nowrap items-center gap-1 overflow-visible border-b border-[color:var(--ledger-border-subtle)] px-0 pb-2 pt-1 transition-[background-color,opacity,backdrop-filter] duration-150 ease-out ${
          isSticky
            ? 'bg-[color:color-mix(in_srgb,var(--ledger-surface)_92%,transparent)] backdrop-blur-sm'
            : 'bg-transparent backdrop-blur-none'
        }`}
      >
        {/* Block type selector */}
        <div className="relative">
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setIsBlockTypeDropdownOpen((value) => !value);
              setIsMoreDropdownOpen(false);
            }}
            onBlur={() => setTimeout(() => setIsBlockTypeDropdownOpen(false), 150)}
            className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-medium text-[var(--ledger-text-secondary)] outline-none transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] active:bg-[var(--ledger-surface-hover)] focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-border-strong)] focus-visible:ring-offset-0"
          >
            {blockTypeLabels[blockType]}
            <ChevronDown size={13} />
          </button>
          {isBlockTypeDropdownOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-40 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]">
              {(['paragraph', 'h1', 'h2', 'h3', 'quote', 'code'] as BlockType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => changeBlockType(type)}
                  className={`w-full px-3 py-2 text-left text-sm ${
                    blockType === type
                      ? 'bg-[var(--ledger-surface-hover)] font-medium text-[var(--ledger-text-primary)]'
                      : 'text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
                  }`}
                >
                  {blockTypeLabels[type]}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <ToolbarButton
            title="Bold (Ctrl+B)"
            isActive={isBold}
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
          >
            <Bold size={14} />
          </ToolbarButton>
          <ToolbarButton
            title="Italic (Ctrl+I)"
            isActive={isItalic}
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
          >
            <Italic size={14} />
          </ToolbarButton>
          <ToolbarButton
            title="Underline (Ctrl+U)"
            isActive={isUnderline}
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}
          >
            <Underline size={14} />
          </ToolbarButton>
        </div>
        <div className="mx-0.5 h-4 w-px shrink-0 bg-[var(--ledger-border-subtle)]" />

        <BlockInsertionPlugin
          noteId={noteId}
          targetType={targetType}
          onCreateExternalEmbed={onCreateExternalEmbed}
          onOpenLinkedResources={() => {
            if (onOpenLinkedResources) editor.dispatchCommand(OPEN_LINKED_RESOURCES_COMMAND, undefined);
          }}
          onUploadAttachment={onUploadAttachment}
          onRemoveAttachment={onRemoveAttachment}
          onMenuOpen={() => {
            setIsBlockTypeDropdownOpen(false);
            setIsMoreDropdownOpen(false);
          }}
        />

        <div className="notes-toolbar-structure-divider mx-0.5 h-4 w-px shrink-0 bg-[var(--ledger-border-subtle)]" />
        <ToolbarButton
          title="Bulleted list"
          onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
          className="notes-toolbar-structure"
        >
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Numbered list"
          onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
          className="notes-toolbar-structure"
        >
          <ListOrdered size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Checklist"
          onClick={insertChecklist}
          className="notes-toolbar-structure"
        >
          <CheckSquare size={14} />
        </ToolbarButton>
        <div className="relative">
          <ToolbarButton
            title="More"
            onClick={() => {
              setIsMoreDropdownOpen((value) => !value);
              setIsBlockTypeDropdownOpen(false);
            }}
          >
            <MoreHorizontal size={14} />
          </ToolbarButton>
          {isMoreDropdownOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-40 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]">
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code');
                  setIsMoreDropdownOpen(false);
                }}
              >
                Inline code
              </button>
              <button
                type="button"
                className="notes-toolbar-more-structure w-full rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
                  setIsMoreDropdownOpen(false);
                }}
              >
                Bulleted list
              </button>
              <button
                type="button"
                className="notes-toolbar-more-structure w-full rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
                  setIsMoreDropdownOpen(false);
                }}
              >
                Numbered list
              </button>
              <button
                type="button"
                className="notes-toolbar-more-structure w-full rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  insertChecklist();
                  setIsMoreDropdownOpen(false);
                }}
              >
                Checklist
              </button>
              {onAutoCorrect && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    void onAutoCorrect();
                    setIsMoreDropdownOpen(false);
                  }}
                >
                  <SpellCheck size={13} /> Auto-correct
                </button>
              )}
            </div>
          )}
        </div>
        <div className="mx-0.5 h-4 w-px shrink-0 bg-[var(--ledger-border-subtle)]" />
        <div className="flex shrink-0 items-center gap-0.5">
          <ToolbarButton
            title="Undo (Ctrl+Z)"
            onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
          >
            <Undo2 size={14} />
          </ToolbarButton>
          <ToolbarButton
            title="Redo (Ctrl+Shift+Z)"
            onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
          >
            <Redo2 size={14} />
          </ToolbarButton>
        </div>
      </div>
    </>
  );
};

const NOTE_IMAGE_BUCKET = 'note-images';

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });

const loadImageDimensions = (src: string) =>
  new Promise<{ width: number; height: number } | null>((resolve) => {
    const image = new window.Image();
    image.onload = () =>
      resolve({
        width: image.naturalWidth || image.width || 0,
        height: image.naturalHeight || image.height || 0,
      });
    image.onerror = () => resolve(null);
    image.src = src;
  });

const getImageFilesFromClipboard = (event: ClipboardEvent): File[] => {
  const directFiles = Array.from(event.clipboardData?.files ?? []).filter((file) =>
    file.type.startsWith('image/')
  );
  if (directFiles.length > 0) return directFiles;

  const itemFiles = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item, index) => {
      const file = item.getAsFile();
      if (!file) return null;
      if (file.name) return file;
      const ext = file.type.split('/')[1] || 'png';
      return new File([file], `pasted-image-${Date.now()}-${index}.${ext}`, { type: file.type });
    })
    .filter((file): file is File => Boolean(file));

  return itemFiles;
};

const getImageFilesFromDataTransfer = (dataTransfer: DataTransfer | null): File[] => {
  if (!dataTransfer) return [];

  const directFiles = Array.from(dataTransfer.files ?? []).filter((file) =>
    file.type.startsWith('image/')
  );
  if (directFiles.length > 0) return directFiles;

  return Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
};

const ImagePasteDropPlugin = ({ noteId }: { noteId?: string | null }) => {
  const [editor] = useLexicalComposerContext();
  const { activeWorkspaceId } = useWorkspaceContext();

  const toast = useToast();

  const uploadAndInsert = useCallback(
    async (file: File) => {
      // validation: workspace and file
      if (!activeWorkspaceId) return;

      const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
      const maxBytes = 10 * 1024 * 1024; // 10MB
      if (!allowed.includes(file.type.toLowerCase())) {
        toast.show('Unsupported image type', { variant: 'error' });
        return;
      }
      if (file.size > maxBytes) {
        toast.show('Image too large (max 10MB)', { variant: 'error' });
        return;
      }

      const ext = file.name.includes('.') ? file.name.split('.').pop() : file.type.split('/').pop();
      const random = Math.random().toString(36).slice(2, 8);
      const timestamp = Date.now();
      const safeNoteId = noteId ?? 'unassigned';
      const storagePath = `workspaces/${activeWorkspaceId}/notes/${safeNoteId}/images/${timestamp}-${random}.${ext}`;
      const localDataUrl = await fileToDataUrl(file);
      const imageDimensions = await loadImageDimensions(localDataUrl);
      const initialWidth = imageDimensions?.width
        ? Math.min(Math.max(imageDimensions.width, 180), 720)
        : 560;

      try {
        const { error: uploadError } = await supabase.storage
          .from(NOTE_IMAGE_BUCKET)
          .upload(storagePath, file, { cacheControl: '3600', upsert: false });
        if (uploadError) {
          console.error('Image upload failed', uploadError);
          toast.show('Image upload failed', { variant: 'error' });
          return;
        }

        // Insert with the local data URL so the image is visible immediately.
        // The node serializes to the public storage URL on save, so we avoid persisting base64.
        editor.update(() => {
          $insertNodes([
            $createImageNode({
              src: localDataUrl,
              altText: file.name || 'Pasted image',
              storagePath,
              width: initialWidth,
            }),
            $createParagraphNode(),
          ]);
        });
      } catch (uploadError) {
        console.error('Image upload failed', uploadError);
        toast.show('Image upload failed', { variant: 'error' });
      }
    },
    [activeWorkspaceId, editor, noteId, toast]
  );

  useEffect(() => {
    return editor.registerCommand(
      INSERT_IMAGE_COMMAND,
      () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => {
          const file = input.files?.[0];
          if (file) void uploadAndInsert(file);
        };
        input.click();
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor, uploadAndInsert]);

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const files = getImageFilesFromClipboard(event);
        if (files.length === 0) return false;
        event.preventDefault();
        for (const file of files) {
          void uploadAndInsert(file);
        }
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor, uploadAndInsert]);

  useEffect(() => {
    return editor.registerCommand(
      DROP_COMMAND,
      (event: DragEvent) => {
        const files = getImageFilesFromDataTransfer(event.dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        for (const file of files) {
          void uploadAndInsert(file);
        }
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor, uploadAndInsert]);

  useEffect(() => {
    return editor.registerRootListener((rootElement, prevRootElement) => {
      const onDragOver = (event: DragEvent) => {
        const files = getImageFilesFromDataTransfer(event.dataTransfer);
        if (files.length === 0) return;
        event.preventDefault();
      };

      prevRootElement?.removeEventListener('dragover', onDragOver as EventListener);
      rootElement?.addEventListener('dragover', onDragOver as EventListener);
    });
  }, [editor]);

  return null;
};

const isLikelyFigmaUrl = (value: string) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const route = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    return (
      url.protocol === 'https:' &&
      (host === 'figma.com' || host === 'www.figma.com') &&
      ['design', 'file', 'board'].includes(route ?? '')
    );
  } catch {
    return false;
  }
};
const isLikelyGithubUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      ['github.com', 'www.github.com'].includes(url.hostname.toLowerCase()) &&
      url.pathname.split('/').filter(Boolean).length >= 2
    );
  } catch {
    return false;
  }
};
const isLikelyGoogleDriveUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      [
        'drive.google.com',
        'docs.google.com',
        'sheets.google.com',
        'slides.google.com',
        'forms.google.com',
        'drawings.google.com',
      ].includes(url.hostname.toLowerCase()) &&
      Boolean(url.searchParams.get('id') || url.pathname.match(/\/d\/[-\w]+/))
    );
  } catch {
    return false;
  }
};

const FigmaPastePlugin = ({
  noteId,
  targetType = 'note',
  onCreateExternalEmbed,
}: {
  noteId?: string | null;
  targetType?: 'note' | 'meetingNote';
  onCreateExternalEmbed?: (
    request: EditorExternalEmbedRequest
  ) => Promise<EditorExternalEmbedResult>;
}) => {
  const [editor] = useLexicalComposerContext();
  const toast = useToast();
  const [prompt, setPrompt] = useState<{
    url: string;
    nodeKey: string;
    provider: 'figma' | 'github' | 'google_drive';
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!prompt) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPrompt(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [prompt]);

  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event: ClipboardEvent) => {
          if (!noteId) return false;
          const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
          const provider = isLikelyFigmaUrl(text)
            ? 'figma'
            : isLikelyGithubUrl(text)
            ? 'github'
            : isLikelyGoogleDriveUrl(text)
            ? 'google_drive'
            : null;
          if (!provider) return false;
          event.preventDefault();
          let nodeKey: string | null = null;
          editor.update(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return;
            const linkNode = $createLinkNode(text);
            linkNode.append($createTextNode(text));
            selection.insertNodes([linkNode]);
            nodeKey = linkNode.getKey();
          });
          if (nodeKey) setPrompt({ url: text, nodeKey, provider });
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
    [editor, noteId, targetType]
  );

  const embed = async () => {
    if (!prompt || !noteId || busy) return;
    setBusy(true);
    try {
      if (!onCreateExternalEmbed) return;
      const result = await onCreateExternalEmbed({
        noteId,
        targetType,
        provider: prompt.provider,
        url: prompt.url,
      });
      editor.update(() => {
        const original = $getNodeByKey(prompt.nodeKey);
        if (!original) return;
        const embedNode = $createExternalEmbedNode({
          externalReferenceId: result.externalReferenceId,
          externalUrl: result.externalUrl,
        });
        const topLevel = original.getTopLevelElementOrThrow();
        if (!$isElementNode(topLevel)) return;
        if (topLevel.getChildrenSize() === 1) topLevel.replace(embedNode);
        else {
          original.remove();
          topLevel.insertAfter(embedNode);
        }
      });
      setPrompt(null);
    } catch (error) {
      toast.show(
        error instanceof Error
          ? error.message
          : `Could not embed this ${
              prompt.provider === 'github'
                ? 'GitHub item'
                : prompt.provider === 'google_drive'
                ? 'Google Drive file'
                : 'Figma design'
            }.`,
        { variant: 'error' }
      );
    } finally {
      setBusy(false);
    }
  };

  if (!prompt) return null;
  return (
    <div
      className="absolute right-4 top-3 z-20 flex max-w-[min(420px,calc(100%-2rem))] items-center gap-2 rounded-xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-3 py-2 text-xs text-[var(--ledger-text-secondary)] shadow-[0_12px_30px_rgba(15,23,42,0.12)]"
      role="dialog"
      aria-label="External link detected"
    >
      <div className="min-w-0">
        <span className="font-medium">
          {prompt.provider === 'github'
            ? 'GitHub link detected'
            : prompt.provider === 'google_drive'
            ? 'Google Drive link detected'
            : 'Figma link detected'}
        </span>
        <span className="mt-0.5 block text-[10px] leading-4 text-[var(--ledger-text-muted)]">
          Add a compact linked reference to this note.
        </span>
      </div>
      <button
        type="button"
        onClick={() => void embed()}
        disabled={busy}
        className="h-7 shrink-0 rounded-full bg-[var(--ledger-accent)] px-2.5 text-[11px] font-medium text-white disabled:opacity-60"
      >
        {busy
          ? 'Embedding…'
          : prompt.provider === 'github'
          ? 'Embed item'
          : prompt.provider === 'google_drive'
          ? 'Embed file'
          : 'Embed design'}
      </button>
      <button
        type="button"
        onClick={() => setPrompt(null)}
        disabled={busy}
        className="h-7 shrink-0 rounded-full border border-[color:var(--ledger-border-subtle)] px-2.5 text-[11px] font-medium hover:bg-[var(--ledger-surface-hover)]"
      >
        Keep as link
      </button>
    </div>
  );
};

const LinkedResourceInsertionPlugin = ({
  reference,
  badge,
  onReferenceInserted,
  onBadgeInserted,
  onOpenLinkedResources,
}: {
  reference?: { id: string; url: string } | null;
  badge?: Props['linkedResourceBadge'];
  onReferenceInserted?: () => void;
  onBadgeInserted?: () => void;
  onOpenLinkedResources?: () => void;
}) => {
  const [editor] = useLexicalComposerContext();
  const savedSelectionRef = useRef<ReturnType<typeof $getSelection>>(null);

  const insertBadge = useCallback((item: LinkedResourceBadgeRequest) => {
    editor.update(() => {
      const selection = savedSelectionRef.current || $getSelection() || $getPreviousSelection();
      savedSelectionRef.current = null;
      const badgeNode = $createLinkedResourceBadgeNode(item);
      const hasLivePoints = $isRangeSelection(selection)
        && Boolean($getNodeByKey(selection.anchor.key))
        && Boolean($getNodeByKey(selection.focus.key));
      if (hasLivePoints && $isRangeSelection(selection)) {
        $setSelection(selection);
        selection.insertNodes([badgeNode]);
      } else {
        $getRoot().append(badgeNode, $createParagraphNode());
      }
    });
  }, [editor]);

  useEffect(
    () =>
      editor.registerCommand(
        OPEN_LINKED_RESOURCES_COMMAND,
        () => {
          editor.getEditorState().read(() => {
            const selection = $getSelection();
            savedSelectionRef.current = $isRangeSelection(selection) ? selection.clone() : null;
          });
          onOpenLinkedResources?.();
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
    [editor, onOpenLinkedResources]
  );

  useEffect(() => editor.registerCommand(
    INSERT_LINKED_RESOURCE_BADGE_COMMAND,
    (item) => {
      insertBadge(item);
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  ), [editor, insertBadge]);

  useEffect(() => {
    const handleDirectInsert = (event: Event) => {
      const item = (event as CustomEvent<LinkedResourceBadgeRequest>).detail;
      if (item?.resourceId) {
        editor.dispatchCommand(INSERT_LINKED_RESOURCE_BADGE_COMMAND, {
          ...item,
          url: item.url || `#external-resource-${item.resourceId}`,
        });
      }
    };
    window.addEventListener('ledger:insert-linked-resource', handleDirectInsert);
    return () => window.removeEventListener('ledger:insert-linked-resource', handleDirectInsert);
  }, [editor]);

  useEffect(() => {
    const item = badge ?? (reference?.id
      ? { resourceType: 'external' as const, resourceId: reference.id, title: reference.url, url: reference.url }
      : null);
    if (!item) return;

    insertBadge(item);
    if (badge) onBadgeInserted?.();
    else onReferenceInserted?.();
  }, [badge, insertBadge, onBadgeInserted, onReferenceInserted, reference]);
  return null;
};

const LinkedResourceBadgeHydrationPlugin = ({ noteId, targetType, editorKey }: { noteId?: string | null; targetType?: 'note' | 'meetingNote'; editorKey?: string }) => {
  const [editor] = useLexicalComposerContext();
  const api = useApi();

  useEffect(() => {
    if (!noteId) return;
    let cancelled = false;
    const hydrate = async () => {
      try {
        const rows = await api.getExternalReferencesForTarget(targetType ?? 'note', noteId) as Array<{ external_reference_id?: string; external_references?: Record<string, any> | Record<string, any>[] }>;
        const references = new Map<string, Record<string, any>>();
        for (const row of rows) {
          const reference = Array.isArray(row.external_references) ? row.external_references[0] : row.external_references;
          if (row.external_reference_id && reference) references.set(row.external_reference_id, reference);
        }
        if (cancelled || references.size === 0) return;
        editor.update(() => {
          const visit = (node: LexicalNode) => {
            if ($isLinkedResourceBadgeNode(node)) {
              const reference = references.get(node.getExternalReferenceId());
              if (reference) {
                const metadata = (reference.metadata ?? {}) as Record<string, unknown>;
                const provider = String(reference.provider ?? 'external');
                const title = String(provider === 'figma'
                  ? metadata.name ?? metadata.nodeName ?? metadata.fileName ?? 'Figma design'
                  : provider === 'github'
                  ? metadata.title ?? metadata.repositoryFullName ?? 'GitHub resource'
                  : provider === 'google_drive'
                  ? metadata.name ?? metadata.fileName ?? 'Google Drive file'
                  : metadata.name ?? metadata.title ?? 'Linked resource');
                node.setPresentation({ title, provider, externalType: String(reference.external_type ?? metadata.nodeType ?? metadata.fileType ?? ''), metadata });
              }
            }
            if ($isElementNode(node)) node.getChildren().forEach(visit);
          };
          $getRoot().getChildren().forEach(visit);
        }, { tag: 'linked-resource-hydration' });
      } catch {
        // The inspector remains the source of truth if enrichment is unavailable.
      }
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [api, editor, editorKey, noteId, targetType]);
  return null;
};

const ResizableImagePlugin = () => {
  const [editor] = useLexicalComposerContext();
  const observersRef = useRef(
    new Map<
      string,
      {
        observer: ResizeObserver;
        widthTimer: number | null;
        lastWidth: number | null;
        userResize: boolean;
      }
    >()
  );

  const syncObservers = useCallback(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    const seenKeys = new Set<string>();
    const wrappers = Array.from(
      rootElement.querySelectorAll<HTMLElement>('[data-lexical-image-node-key]')
    );

    for (const wrapper of wrappers) {
      const key = wrapper.getAttribute('data-lexical-image-node-key');
      if (!key) continue;
      seenKeys.add(key);

      if (observersRef.current.has(key)) continue;

      const observerState = {
        observer: new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry) return;

          const nextWidth = Math.round(entry.contentRect.width);
          if (!nextWidth) return;

          const currentState = observersRef.current.get(key);
          if (!currentState) return;
          if (currentState.lastWidth === nextWidth) return;

          currentState.lastWidth = nextWidth;
          currentState.userResize ||= wrapper.dataset.resizing === 'true';

          if (currentState.widthTimer) {
            window.clearTimeout(currentState.widthTimer);
          }

          currentState.widthTimer = window.setTimeout(() => {
            const isUserResize = currentState.userResize;
            currentState.userResize = false;
            editor.update(
              () => {
                const node = $getNodeByKey(key);
                if (!$isImageNode(node)) return;
                if (node.getWidth() === nextWidth) return;
                node.setWidth(nextWidth);
              },
              { tag: isUserResize ? HISTORY_PUSH_TAG : HISTORIC_TAG }
            );
          }, 120);
        }),
        widthTimer: null as number | null,
        lastWidth: null as number | null,
        userResize: false,
      };

      observerState.lastWidth = Math.round(wrapper.getBoundingClientRect().width);
      observerState.observer.observe(wrapper);
      observersRef.current.set(key, observerState);
    }

    for (const [key, state] of observersRef.current.entries()) {
      if (seenKeys.has(key)) continue;
      state.observer.disconnect();
      if (state.widthTimer) {
        window.clearTimeout(state.widthTimer);
      }
      observersRef.current.delete(key);
    }
  }, [editor]);

  useEffect(() => {
    const rafSync = () => {
      window.requestAnimationFrame(syncObservers);
    };

    rafSync();
    const unregister = editor.registerUpdateListener(rafSync);

    return () => {
      unregister();
      for (const state of observersRef.current.values()) {
        state.observer.disconnect();
        if (state.widthTimer) {
          window.clearTimeout(state.widthTimer);
        }
      }
      observersRef.current.clear();
    };
  }, [editor, syncObservers]);

  return null;
};

const EditorContextMenuPlugin = ({
  noteId,
  canEdit = true,
  onCreateTask,
  onCreateReminder,
  onCreateEvent,
  onSendToIntake,
  onLinkProject,
  onLinkPerson,
  onSearch,
}: Pick<
  Props,
  | 'noteId'
  | 'onCreateTask'
  | 'onCreateReminder'
  | 'onCreateEvent'
  | 'onSendToIntake'
  | 'onLinkProject'
  | 'onLinkPerson'
  | 'onSearch'
> & { canEdit?: boolean }) => {
  const [editor] = useLexicalComposerContext();
  const [position, setPosition] = useState<EditorContextMenuPosition | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [selectedBlockKey, setSelectedBlockKey] = useState<string | undefined>();
  const [calloutType, setCalloutType] = useState<CalloutType | null>(null);
  const [hasSmartDate, setHasSmartDate] = useState(false);
  const [personId, setPersonId] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [spellcheck, setSpellcheck] = useState<{
    x: number;
    y: number;
    misspelledWord: string;
    dictionarySuggestions: string[];
  } | null>(null);
  const pendingSpellcheckRef = useRef<{
    x: number;
    y: number;
    misspelledWord: string;
    dictionarySuggestions: string[];
  } | null>(null);
  const spellcheckRangeRef = useRef<{
    textNode: Text;
    startOffset: number;
    endOffset: number;
  } | null>(null);
  const contextPositionRef = useRef<{ x: number; y: number } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const savedSelectionRef = useRef<any>(null);

  const close = useCallback(() => setPosition(null), []);

  useEffect(() => {
    const onSpellcheckContext = (_event: unknown, payload: unknown) => {
      const value = payload as Partial<NonNullable<typeof spellcheck>> | null;
      if (!value?.misspelledWord) return;
      const next = {
        x: Number(value.x ?? 0),
        y: Number(value.y ?? 0),
        misspelledWord: String(value.misspelledWord),
        dictionarySuggestions: Array.isArray(value.dictionarySuggestions)
          ? value.dictionarySuggestions.map(String).slice(0, 6)
          : [],
      };
      pendingSpellcheckRef.current = next;
      const position = contextPositionRef.current;
      if (position && Math.abs(position.x - next.x) <= 8 && Math.abs(position.y - next.y) <= 8) {
        setSpellcheck(next);
      }
    };
    window.ledgerIpc?.events?.onSpellcheckContextMenu(onSpellcheckContext as any);
    return () => {
      window.ledgerIpc?.events?.offSpellcheckContextMenu(onSpellcheckContext as any);
    };
  }, []);

  useEffect(() => {
    const unregisterUndo = editor.registerCommand(
      CAN_UNDO_COMMAND,
      (value) => {
        setCanUndo(value);
        return false;
      },
      COMMAND_PRIORITY_LOW
    );
    const unregisterRedo = editor.registerCommand(
      CAN_REDO_COMMAND,
      (value) => {
        setCanRedo(value);
        return false;
      },
      COMMAND_PRIORITY_LOW
    );
    return () => {
      unregisterUndo();
      unregisterRedo();
    };
  }, [editor]);

  useEffect(() => {
    if (!position) return;
    const onPointerDown = (event: globalThis.MouseEvent) => {
      if (!menuContains(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [close, position]);

  const getSelectedContent = useCallback(() => {
    const result: { value: SelectedContentPayload | null } = { value: null };
    editor.getEditorState().read(() => {
      result.value = getSelectedContentPayload(noteId, $getSelection());
    });
    return result.value;
  }, [editor, noteId]);

  useEffect(() => {
    const onContextMenu = (root: HTMLElement, event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !target ||
        target.closest(
          '[data-lexical-image-node-key], [data-ledger-smart-person-popover], [data-ledger-smart-date-popover]'
        )
      )
        return;
      if (!root.contains(target)) return;

      event.preventDefault();
      event.stopPropagation();
      const content = getSelectedContent();
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        savedSelectionRef.current = selection?.clone?.() ?? null;
      });
      const smartDate = Boolean(target.closest('[data-ledger-smart-date-key]'));
      const calloutElement = target.closest('[data-ledger-callout]') as HTMLElement | null;
      let nextCalloutType: CalloutType | null = null;
      if (calloutElement) {
        const node = $getNearestNodeFromDOMNode(calloutElement);
        if ($isCalloutNode(node)) {
          nextCalloutType = node.getCalloutType();
        } else {
          const persistedType = calloutElement.dataset.calloutType;
          if (persistedType === 'info' || persistedType === 'note' || persistedType === 'warning' || persistedType === 'success') {
            nextCalloutType = persistedType;
          }
        }
      }
      const person = target.closest('[data-ledger-smart-person-key]');
      const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
      setSelectedText(content?.plainText ?? '');
      setSelectedBlockKey(content?.blockKey);
      setHasSmartDate(smartDate);
      setCalloutType(nextCalloutType);
      setPersonId(person?.getAttribute('data-ledger-smart-person-user-id') ?? null);
      setLinkUrl(
        anchor?.href && /^(?:https?:\/\/|mailto:|tel:)/i.test(anchor.href) ? anchor.href : null
      );
      setPosition({ x: event.clientX, y: event.clientY });
      contextPositionRef.current = { x: event.clientX, y: event.clientY };
      const pending = pendingSpellcheckRef.current;
      setSpellcheck(
        pending &&
          Math.abs(pending.x - event.clientX) <= 8 &&
          Math.abs(pending.y - event.clientY) <= 8
          ? pending
          : null
      );

      const wordRange = wordAtEditorPoint(root, event.clientX, event.clientY);
      spellcheckRangeRef.current = wordRange
        ? {
            textNode: wordRange.textNode,
            startOffset: wordRange.startOffset,
            endOffset: wordRange.endOffset,
          }
        : null;
      if (wordRange?.word && window.ledgerIpc?.commands?.spellcheckSuggestions) {
        const requestedPosition = { x: event.clientX, y: event.clientY };
        void Promise.resolve(window.ledgerIpc?.commands?.spellcheckSuggestions({ word: wordRange.word }))
          .then((result: unknown) => {
            const value = result as { word?: unknown; suggestions?: unknown } | null;
            const currentPosition = contextPositionRef.current;
            if (
              !currentPosition ||
              currentPosition.x !== requestedPosition.x ||
              currentPosition.y !== requestedPosition.y
            )
              return;
            const suggestions = Array.isArray(value?.suggestions)
              ? value.suggestions.map(String).slice(0, 6)
              : [];
            setSpellcheck({
              x: requestedPosition.x,
              y: requestedPosition.y,
              misspelledWord: String(value?.word ?? wordRange.word),
              dictionarySuggestions: suggestions,
            });
          })
          .catch(() => {
            // Browser/web mode may not expose the Electron spellchecker.
          });
      }
    };

    return editor.registerRootListener((root, previousRoot) => {
      const previousListener = (previousRoot as (HTMLElement & { __ledgerContextMenuListener?: (event: MouseEvent) => void }) | null)?.__ledgerContextMenuListener;
      if (previousRoot && previousListener) {
        previousRoot.removeEventListener('contextmenu', previousListener);
        delete (previousRoot as HTMLElement & { __ledgerContextMenuListener?: (event: MouseEvent) => void }).__ledgerContextMenuListener;
      }
      if (root) {
        const listener = (event: MouseEvent) => onContextMenu(root, event);
        root.addEventListener('contextmenu', listener);
        (root as HTMLElement & { __ledgerContextMenuListener?: (event: MouseEvent) => void }).__ledgerContextMenuListener = listener;
      }
    });
  }, [editor, getSelectedContent]);

  if (!position) return null;

  const dispatch = (command: any) => {
    editor.focus();
    editor.dispatchCommand(command, undefined);
  };

  const restoreSavedSelection = () => {
    const savedSelection = savedSelectionRef.current;
    if (!savedSelection) return;
    editor.focus();
    editor.update(
      () => {
        $setSelection(savedSelection.clone());
      },
      { tag: HISTORIC_TAG }
    );
  };

  const withSavedSelection = (callback: (selection: any) => void) => {
    const savedSelection = savedSelectionRef.current;
    if (!savedSelection) return;
    editor.focus();
    editor.update(() => {
      const selection = savedSelection.clone();
      $setSelection(selection);
      callback(selection);
    });
  };

  const copySelectedText = async () => {
    try {
      await navigator.clipboard.writeText(selectedText);
      restoreSavedSelection();
    } catch (error) {
      console.error('[notes] clipboard copy failed', error);
    }
  };

  const cutSelectedText = async () => {
    await copySelectedText();
    withSavedSelection((selection) => selection.removeText());
  };

  const pasteTextFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      withSavedSelection((selection) => selection.insertText(text));
    } catch (error) {
      console.error('[notes] clipboard paste failed', error);
    }
  };
  const hasSelection = Boolean(selectedText);
  const selectedContent: SelectedContentPayload | null =
    noteId && selectedText
      ? { noteId, plainText: selectedText, blockKey: selectedBlockKey, source: 'selection' }
      : null;

  return (
    <NotesEditorContextMenu
      position={position}
      hasSelection={hasSelection}
      hasSmartDate={hasSmartDate}
      hasSmartPerson={Boolean(personId)}
      canUndo={canUndo}
      canRedo={canRedo}
      canCut={hasSelection}
      canPaste={canEdit}
      canEdit={canEdit}
      onUndo={() => dispatch(UNDO_COMMAND)}
      onRedo={() => dispatch(REDO_COMMAND)}
      onCut={() => void cutSelectedText()}
      onCopy={() => void copySelectedText()}
      onPaste={() => void pasteTextFromClipboard()}
      onSelectAll={() => dispatch(SELECT_ALL_COMMAND)}
      onCreateTask={() => {
        if (selectedContent) void onCreateTask?.(selectedContent);
      }}
      onCreateReminder={() => {
        if (selectedContent) void onCreateReminder?.(selectedContent);
      }}
      onCreateEvent={() => {
        if (selectedContent) void onCreateEvent?.(selectedContent);
      }}
      onSendToIntake={() => {
        if (selectedContent) void onSendToIntake?.(selectedContent);
      }}
      onLinkProject={() => {
        if (selectedContent) void onLinkProject?.(selectedContent);
      }}
      onLinkPerson={() => {
        if (personId && selectedContent) void onLinkPerson?.(selectedContent, personId);
      }}
      onSearch={() => {
        if (selectedContent) void onSearch?.(selectedContent);
      }}
      calloutType={calloutType}
      onChangeCalloutType={(type) => {
        restoreSavedSelection();
        editor.dispatchCommand(SET_CALLOUT_TYPE_COMMAND, type);
      }}
      spellcheck={spellcheck}
      onReplaceMisspelling={(suggestion) => {
        const range = spellcheckRangeRef.current;
        let replaced = false;
        if (range) {
          editor.update(() => {
            const node = $getNearestNodeFromDOMNode(range.textNode);
            if (!$isTextNode(node)) return;
            const selection = $createRangeSelection();
            selection.setTextNodeRange(node, range.startOffset, node, range.endOffset);
            $setSelection(selection);
            selection.insertText(suggestion);
            replaced = true;
          });
        }
        if (!replaced) window.ledgerIpc?.commands?.spellcheckReplace(suggestion);
        spellcheckRangeRef.current = null;
      }}
      onAddMisspelledWord={() => {
        if (spellcheck?.misspelledWord) {
          window.ledgerIpc?.commands?.spellcheckAddWord(spellcheck.misspelledWord);
        }
      }}
      linkUrl={linkUrl}
      onOpenLink={() => {
        if (linkUrl) openExternalLink(linkUrl);
      }}
      onClose={close}
    />
  );
};

const menuContains = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest('[role="menu"][aria-label="Editor actions"]'));

const wordAtEditorPoint = (root: HTMLElement, x: number, y: number) => {
  const range = document.caretRangeFromPoint?.(x, y);
  if (!range || !root.contains(range.startContainer) || range.startContainer.nodeType !== 3) {
    return null;
  }
  const text = range.startContainer.textContent ?? '';
  const offset = Math.min(range.startOffset, text.length);
  const isWordCharacter = (value: string) => /[\p{L}\p{N}'’-]/u.test(value);
  let start = offset;
  let end = offset;
  while (start > 0 && isWordCharacter(text[start - 1])) start -= 1;
  while (end < text.length && isWordCharacter(text[end])) end += 1;
  const word = text.slice(start, end).trim();
  return word
    ? { word, textNode: range.startContainer as Text, startOffset: start, endOffset: end }
    : null;
};

export function RichTextEditor({
  initialValue,
  editorKey,
  noteId,
  targetType = 'note',
  noteTitle,
  noteProjectId,
  onChange,
  onFocus,
  onBlur,
  onAutoCorrect,
  onCreateTask,
  onPersonTaskAction,
  onCreateReminder,
  onCreateEvent,
  onSendToIntake,
  onLinkProject,
  onLinkPerson,
  onSearch,
  onCreateExternalEmbed,
  onOpenLinkedResources,
  linkedResourceBadge,
  onLinkedResourceBadgeInserted,
  linkedExternalReference,
  onLinkedExternalReferenceInserted,
  onUploadAttachment,
  onRemoveAttachment,
  showToolbar = true,
}: Props) {
  const lastChangeTimeRef = React.useRef(0);
  const pendingHtmlRef = React.useRef<string | null>(null);
  const throttleTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleChange = (editorState: EditorState, editor: any, tags?: Set<string>) => {
    // Smart entities update Lexical programmatically. Those updates must never
    // be serialized into the note autosave path as user edits.
    if (
      tags?.has('smart-date-load') ||
      tags?.has('smart-date-scan') ||
      tags?.has('smart-date-sync') ||
      tags?.has('smart-person-load') ||
      tags?.has('smart-person-scan') ||
      tags?.has('smart-person-sync') ||
      tags?.has('link-scan') ||
      tags?.has('linked-resource-hydration')
    ) {
      return;
    }

    try {
      editorState.read(() => {
        const html = $generateHtmlFromNodes(editor, null);
        pendingHtmlRef.current = html;

        const now = Date.now();
        const elapsed = now - lastChangeTimeRef.current;

        if (elapsed >= 300) {
          // Enough time has passed, fire immediately
          lastChangeTimeRef.current = now;
          onChange(html);

          // Clear any pending throttle
          if (throttleTimerRef.current) {
            clearTimeout(throttleTimerRef.current);
            throttleTimerRef.current = null;
          }
        } else if (!throttleTimerRef.current) {
          // Schedule onChange for later (after throttle window)
          throttleTimerRef.current = setTimeout(() => {
            if (pendingHtmlRef.current !== null) {
              lastChangeTimeRef.current = Date.now();
              onChange(pendingHtmlRef.current);
            }
            throttleTimerRef.current = null;
          }, 300 - elapsed);
        }
      });
    } catch (e) {
      console.error('Editor change error', e);
    }
  };

  // Drop queued HTML when switching notes so an old editor cannot save into a
  // newly selected note after its blur/unmount sequence.
  useEffect(() => {
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    pendingHtmlRef.current = null;
    lastChangeTimeRef.current = Date.now();
  }, [editorKey]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
      }
    };
  }, []);

  return (
    <LexicalComposer initialConfig={editorConfig}>
      <ExternalEmbedProvider targetType={targetType} targetId={noteId ?? null} canEdit>
        <div>
          {showToolbar && <ToolbarPlugin
            onAutoCorrect={onAutoCorrect}
            noteId={noteId}
            targetType={targetType}
            onCreateExternalEmbed={onCreateExternalEmbed}
            onOpenLinkedResources={onOpenLinkedResources}
            onUploadAttachment={onUploadAttachment}
            onRemoveAttachment={onRemoveAttachment}
          />}
          <div className="relative">
            <RichTextBehaviorPlugin />
            {/* Meeting notes use the transcript as their separate capture surface.
              The automatic text-entity scanners can repeatedly re-transform
              imported meeting content, so keep them off this editor variant. */}
            {targetType !== 'meetingNote' && (
              <SmartDatePlugin
                noteId={noteId}
                noteTitle={noteTitle}
                noteProjectId={noteProjectId}
              />
            )}
            {targetType !== 'meetingNote' && (
              <SmartPersonPlugin
                noteId={noteId}
                onAssignTask={(person) => onPersonTaskAction?.('task', person)}
                onCreateFollowUp={(person) => onPersonTaskAction?.('follow-up', person)}
              />
            )}
            <EditorContextMenuPlugin
              noteId={noteId}
              onCreateTask={onCreateTask}
              onCreateReminder={onCreateReminder}
              onCreateEvent={onCreateEvent}
              onSendToIntake={onSendToIntake}
              onLinkProject={onLinkProject}
              onLinkPerson={onLinkPerson}
              onSearch={onSearch}
            />
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  onFocus={onFocus}
                  onBlur={onBlur}
                  className="notes-rich-text-editor min-h-[calc(100vh-390px)] px-0 py-2 text-[16px] font-normal text-[var(--ledger-text-primary)] outline-none"
                />
              }
              placeholder={
                <div className="pointer-events-none absolute left-0 right-0 top-0 flex items-start px-0 py-2 text-[16px] leading-[1.7] text-[var(--ledger-text-muted)]">
                  Type / for commands
                </div>
              }
              ErrorBoundary={() => null}
            />
            <HistoryPlugin />
            <LinkPlugin />
            <AutoLinkPlugin matchers={URL_MATCHERS} />
            <LinkInteractionPlugin />
            <LinkScanPlugin editorKey={editorKey} />
            <LoadHtmlPlugin html={initialValue} editorKey={editorKey} />
            <LinkedResourceBadgeHydrationPlugin noteId={noteId} targetType={targetType} editorKey={editorKey} />
            <MarkdownShortcutPlugin />
            <TabIndentationPlugin />
            <ListPlugin />
            <CheckListPlugin />
            <TablePlugin hasTabHandler hasHorizontalScroll />
            <HorizontalRulePlugin />
            <SlashCommandPlugin
              noteId={noteId}
              targetType={targetType}
              onCreateExternalEmbed={onCreateExternalEmbed}
              onOpenLinkedResources={onOpenLinkedResources}
            />
            <LinkedResourceInsertionPlugin
              reference={linkedExternalReference}
              badge={linkedResourceBadge}
              onReferenceInserted={onLinkedExternalReferenceInserted}
              onBadgeInserted={onLinkedResourceBadgeInserted}
              onOpenLinkedResources={onOpenLinkedResources}
            />
            <BlockHandlePlugin
              noteId={noteId}
              onCreateTask={onCreateTask}
              onCreateReminder={onCreateReminder}
              onCreateEvent={onCreateEvent}
              onSendToIntake={onSendToIntake}
              onLinkContext={onLinkProject}
            />
            <SelectionFormattingPlugin
              noteId={noteId}
              onCreateTask={onCreateTask}
              onCreateReminder={onCreateReminder}
              onCreateEvent={onCreateEvent}
              onSendToIntake={onSendToIntake}
              onLinkContext={onLinkProject}
            />
            <ImagePasteDropPlugin noteId={noteId} />
            <FigmaPastePlugin
              noteId={noteId}
              targetType={targetType}
              onCreateExternalEmbed={onCreateExternalEmbed}
            />
            <ResizableImagePlugin />
            <ImageCopyPlugin />
            <OnChangePlugin onChange={handleChange} />
          </div>
        </div>
      </ExternalEmbedProvider>
    </LexicalComposer>
  );
}

const ImageCopyPlugin = () => {
  const [editor] = useLexicalComposerContext();
  const toast = useToast();

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    const onContextMenu: EventListener = (evt) => {
      const event = evt as MouseEvent;
      const target = event.target as HTMLElement | null;
      const wrapper = target?.closest?.('[data-lexical-image-node-key]') as HTMLElement | null;
      if (!wrapper) return;

      // Right-clicked on an image node — copy it.
      event.preventDefault();
      void (async () => {
        try {
          const img = wrapper.querySelector('img') as HTMLImageElement | null;
          const src = img?.src ?? '';
          if (!src) {
            toast.show('No image source found to copy', { variant: 'error' });
            return;
          }

          // Try to fetch the image as a blob and write as an image ClipboardItem
          let copied = false;
          try {
            const response = await fetch(src, { cache: 'no-store' });
            if (response.ok) {
              const blob = await response.blob();
              // Some environments may not support writing images; try best-effort
              if (navigator.clipboard && (window as any).ClipboardItem) {
                const clipboardItemInput: any = {};
                clipboardItemInput[blob.type || 'image/png'] = blob;
                await navigator.clipboard.write([
                  new (window as any).ClipboardItem(clipboardItemInput),
                ]);
                copied = true;
              }
            }
          } catch (e) {
            // ignore fetch errors and fall back to HTML/text copy
          }

          if (!copied) {
            // Fallback: write HTML and plain text (image tag + URL)
            const html = `<img src="${src}" alt="${img?.alt ?? ''}" />`;
            try {
              if (navigator.clipboard && (navigator.clipboard as any).write) {
                const blob = new Blob([html], { type: 'text/html' });
                await (navigator.clipboard as any).write([
                  new (window as any).ClipboardItem({ 'text/html': blob }),
                ]);
              } else if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(src);
              }
              copied = true;
            } catch (e) {
              // final fallback: try writeText
              try {
                await navigator.clipboard.writeText(src);
                copied = true;
              } catch (err) {
                copied = false;
              }
            }
          }

          if (copied) {
            toast.show('Copied image to clipboard', { variant: 'success' });
          } else {
            toast.show('Could not copy image to clipboard', { variant: 'error' });
          }
        } catch (err) {
          console.error('[image-copy] failed', err);
          toast.show('Could not copy image', { variant: 'error' });
        }
      })();
    };

    root.addEventListener('contextmenu', onContextMenu);
    return () => {
      root.removeEventListener('contextmenu', onContextMenu);
    };
  }, [editor, toast]);

  return null;
};
