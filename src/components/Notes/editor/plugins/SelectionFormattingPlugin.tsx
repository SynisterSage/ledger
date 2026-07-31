import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Check,
  Code2,
  Copy,
  Eraser,
  ExternalLink,
  Highlighter,
  Italic,
  Link2,
  Inbox,
  Bell,
  CalendarDays,
  ListChecks,
  MoreHorizontal,
  Strikethrough,
  Underline,
} from 'lucide-react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
  PASTE_COMMAND,
  SELECTION_CHANGE_COMMAND,
  $isTextNode,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';
import type { SelectedContentAction, SelectedContentPayload } from '../types/selectedContent';
import { $isSmartDateNode } from '../../nodes/SmartDateNode';

type Props = {
  noteId?: string | null;
  onCreateTask?: SelectedContentAction;
  onCreateReminder?: SelectedContentAction;
  onCreateEvent?: SelectedContentAction;
  onSendToIntake?: SelectedContentAction;
  onLinkContext?: SelectedContentAction;
};

type SelectionState = {
  selection: RangeSelection;
  top: number;
  left: number;
  width: number;
  linkUrl: string | null;
  formats: Record<'bold' | 'italic' | 'underline' | 'strikethrough' | 'code', boolean>;
  style: string;
  smartDates: Array<{ text: string; date: string; state?: string }>;
};

const TEXT_COLORS = [
  { label: 'Default', value: '' },
  { label: 'Muted', value: 'var(--ledger-text-muted)' },
  { label: 'Accent', value: 'var(--ledger-accent)' },
  { label: 'Blue', value: 'var(--ledger-link)' },
  { label: 'Green', value: 'var(--ledger-success)' },
];

const HIGHLIGHTS = [
  { label: 'None', value: '' },
  { label: 'Soft orange', value: 'color-mix(in srgb, var(--ledger-accent) 18%, transparent)' },
  { label: 'Soft yellow', value: 'color-mix(in srgb, var(--ledger-warning) 18%, transparent)' },
  { label: 'Soft blue', value: 'color-mix(in srgb, var(--ledger-link) 15%, transparent)' },
];

const normalizeUrl = (value: string) => {
  const url = value.trim();
  if (!url) return '';
  if (/^(?:https?:\/\/|mailto:|tel:|\/|#|ledger:)/i.test(url)) return url;
  if (/^[^\s]+\.[^\s]+/.test(url)) return `https://${url}`;
  return '';
};

const closestLinkUrl = (selection: RangeSelection) => {
  const node = selection.anchor.getNode();
  const parent = node.getParent();
  if ($isLinkNode(parent)) return parent.getURL();
  if ($isLinkNode(node)) return node.getURL();
  return null;
};

const getSelectionStyle = (selection: RangeSelection) => {
  const textNode = selection.getNodes().find($isTextNode);
  return textNode?.getStyle() ?? '';
};

const readSelection = (editor: LexicalEditor): SelectionState | null => {
  let state: SelectionState | null = null;
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (
      !$isRangeSelection(selection) ||
      selection.isCollapsed() ||
      !selection.getTextContent().trim()
    )
      return;
    const nativeSelection = window.getSelection();
    const range = nativeSelection?.rangeCount
      ? nativeSelection.getRangeAt(0).getBoundingClientRect()
      : null;
    if (!range) return;
    state = {
      selection: selection.clone(),
      top: Math.max(8, range.top - 48),
      left: Math.max(8, Math.min(range.left + range.width / 2 - 170, window.innerWidth - 352)),
      width: range.width,
      linkUrl: closestLinkUrl(selection),
      formats: {
        bold: selection.hasFormat('bold'),
        italic: selection.hasFormat('italic'),
        underline: selection.hasFormat('underline'),
        strikethrough: selection.hasFormat('strikethrough'),
        code: selection.hasFormat('code'),
      },
      style: getSelectionStyle(selection),
      smartDates: selection
        .getNodes()
        .filter($isSmartDateNode)
        .map((node) => ({
          text: node.getTextContent(),
          date: node.getSmartDateKey(),
          state: node.getSmartDateState(),
        })),
    };
  });
  return state;
};

const styleValue = (style: string, property: string) => {
  const match = style.match(new RegExp(`${property}\\s*:\\s*([^;]+)`));
  return match?.[1]?.trim() ?? '';
};

export const SelectionFormattingPlugin = ({
  noteId,
  onCreateTask,
  onCreateReminder,
  onCreateEvent,
  onSendToIntake,
  onLinkContext,
}: Props) => {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<SelectionState | null>(null);
  const [palette, setPalette] = useState<'color' | 'highlight' | null>(null);
  const [more, setMore] = useState(false);
  const [linkEditor, setLinkEditor] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const savedSelection = useRef<RangeSelection | null>(null);

  const refresh = () => {
    const next = readSelection(editor);
    setState(next);
    if (next) savedSelection.current = next.selection;
    if (!next) {
      setPalette(null);
      setMore(false);
      setLinkEditor(false);
    }
  };

  useEffect(() => {
    const unregisterUpdate = editor.registerUpdateListener(refresh);
    const unregisterSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        refresh();
        return false;
      },
      COMMAND_PRIORITY_HIGH
    );
    const unregisterKeyboard = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return false;
        const current = readSelection(editor);
        if (!current) return false;
        event.preventDefault();
        savedSelection.current = current.selection;
        setState(current);
        setLinkUrl(current.linkUrl ?? '');
        setLinkEditor(true);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
    const unregisterPaste = editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const current = readSelection(editor);
        const pasted =
          event instanceof ClipboardEvent ? event.clipboardData?.getData('text/plain') ?? '' : '';
        const normalized = normalizeUrl(pasted);
        if (!current || !normalized) return false;
        event.preventDefault();
        editor.update(() => {
          $setSelection(current.selection.clone());
          editor.dispatchCommand(TOGGLE_LINK_COMMAND, normalized);
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
    return () => {
      unregisterUpdate();
      unregisterSelection();
      unregisterKeyboard();
      unregisterPaste();
    };
  }, [editor]);

  const applyFormat = (format: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code') => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    refresh();
  };

  const applyStyle = (property: 'color' | 'background-color', value: string) => {
    editor.update(() => {
      const selection = savedSelection.current?.clone() ?? $getSelection();
      if ($isRangeSelection(selection)) {
        $setSelection(selection);
        // RangeSelection.setStyle() controls the style used for future
        // typing; it does not reliably mutate an already-selected range.
        // Extracting first gives us exact text-node boundaries, so a partial
        // selection does not recolor the whole surrounding text node.
        selection.extract().forEach((node) => {
          if (!$isTextNode(node)) return;
          const next = node
            .getStyle()
            .replace(new RegExp(`${property}\\s*:\\s*[^;]+;?`, 'gi'), '')
            .trim();
          node.setStyle(`${next}${next ? '; ' : ''}${value ? `${property}: ${value};` : ''}`);
        });
        selection.setStyle(value ? `${property}: ${value};` : '');
      }
    });
    setPalette(null);
    refresh();
  };

  const saveLink = () => {
    const normalized = normalizeUrl(linkUrl);
    if (!normalized || !savedSelection.current) return;
    editor.update(() => {
      const selection = savedSelection.current;
      if (!selection) return;
      $setSelection(selection.clone());
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, normalized);
    });
    setLinkEditor(false);
    refresh();
  };

  const runLedgerAction = (action?: SelectedContentAction) => {
    if (!action || !noteId || !state) return;
    const selection = savedSelection.current?.clone() ?? state.selection.clone();
    let payload: SelectedContentPayload | null = null;

    // The floating toolbar steals focus when its menu is clicked. Restore the
    // Lexical selection before opening the Ledger modal, matching the native
    // editor context-menu action path.
    editor.focus();
    editor.update(() => {
      $setSelection(selection.clone());
      const activeSelection = $getSelection();
      if (!$isRangeSelection(activeSelection)) return;
      const plainText = activeSelection.getTextContent().trim();
      if (!plainText) return;
      payload = {
        noteId,
        plainText,
        blockKey: activeSelection.anchor.getNode().getTopLevelElementOrThrow().getKey(),
        source: 'selection',
        smartDates: state.smartDates,
      };
    });
    if (payload) void action(payload);
    setMore(false);
  };

  const linkActions = useMemo(() => {
    if (!state?.linkUrl) return null;
    return (
      <div className="ledger-selection-link-actions">
        <button
          type="button"
          onClick={() => window.open(state.linkUrl ?? '', '_blank', 'noopener,noreferrer')}
        >
          <ExternalLink size={12} /> Open
        </button>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(state.linkUrl ?? '')}
        >
          <Copy size={12} /> Copy
        </button>
        <button
          type="button"
          onClick={() => {
            editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
            refresh();
          }}
        >
          <Eraser size={12} /> Remove
        </button>
      </div>
    );
  }, [editor, state]);

  if (!state) return null;
  const color = styleValue(state.style, 'color');
  const highlight = styleValue(state.style, 'background-color');
  const button = (label: string, icon: React.ReactNode, active = false, onClick?: () => void) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={`ledger-selection-button${active ? ' is-active' : ''}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );

  return (
    <div
      className="ledger-selection-menu fixed z-[90]"
      style={{ top: state.top, left: state.left }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {button('Bold', <Bold size={14} />, state.formats.bold, () => applyFormat('bold'))}
      {button('Italic', <Italic size={14} />, state.formats.italic, () => applyFormat('italic'))}
      {button('Underline', <Underline size={14} />, state.formats.underline, () =>
        applyFormat('underline')
      )}
      {button('Strikethrough', <Strikethrough size={14} />, state.formats.strikethrough, () =>
        applyFormat('strikethrough')
      )}
      {button('Inline code', <Code2 size={14} />, state.formats.code, () => applyFormat('code'))}
      {button('Link', <Link2 size={14} />, Boolean(state.linkUrl), () => {
        setLinkUrl(state.linkUrl ?? '');
        setLinkEditor(true);
      })}
      <button
        type="button"
        aria-label="Text color"
        className={`ledger-selection-button${color ? ' is-active' : ''}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setPalette(palette === 'color' ? null : 'color')}
      >
        <span className="ledger-format-dot" style={{ background: color || 'currentColor' }} />
      </button>
      <button
        type="button"
        aria-label="Highlight"
        className={`ledger-selection-button${highlight ? ' is-active' : ''}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setPalette(palette === 'highlight' ? null : 'highlight')}
      >
        <Highlighter size={14} />
      </button>
      <button
        type="button"
        aria-label="More formatting"
        className="ledger-selection-button"
        onClick={() => setMore((value) => !value)}
      >
        <MoreHorizontal size={14} />
      </button>
      {palette && (
        <div className="ledger-selection-popover">
          {(palette === 'color' ? TEXT_COLORS : HIGHLIGHTS).map((item) => (
            <button
              key={item.label}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                applyStyle(palette === 'color' ? 'color' : 'background-color', item.value)
              }
            >
              <span
                className="ledger-format-swatch"
                style={{ background: item.value || 'transparent' }}
              />
              {item.label}
              {(palette === 'color' ? color : highlight) === item.value && <Check size={12} />}
            </button>
          ))}
        </div>
      )}
      {more && (
        <div className="ledger-selection-popover ledger-selection-popover--more">
          {linkActions}
          {(onCreateTask ||
            onCreateReminder ||
            onCreateEvent ||
            onSendToIntake ||
            onLinkContext) && (
            <>
              <div className="ledger-selection-group-label">Ledger</div>
              {onCreateTask && (
                <button type="button" onClick={() => runLedgerAction(onCreateTask)}>
                  <ListChecks size={12} /> Create task
                </button>
              )}
              {onCreateReminder && (
                <button type="button" onClick={() => runLedgerAction(onCreateReminder)}>
                  <Bell size={12} /> Create reminder
                </button>
              )}
              {onCreateEvent && (
                <button type="button" onClick={() => runLedgerAction(onCreateEvent)}>
                  <CalendarDays size={12} /> Create event
                </button>
              )}
              {onSendToIntake && (
                <button type="button" onClick={() => runLedgerAction(onSendToIntake)}>
                  <Inbox size={12} /> Send to Intake
                </button>
              )}
              {onLinkContext && (
                <button type="button" onClick={() => runLedgerAction(onLinkContext)}>
                  <Link2 size={12} /> Link context
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => {
              editor.update(() => {
                const selection = $getSelection();
                if ($isRangeSelection(selection)) {
                  selection.setFormat(0);
                  selection.setStyle('');
                }
              });
              setMore(false);
            }}
          >
            <Eraser size={12} /> Clear formatting
          </button>
        </div>
      )}
      {linkEditor && (
        <form
          className="ledger-selection-link-editor"
          onSubmit={(event) => {
            event.preventDefault();
            saveLink();
          }}
        >
          <input
            autoFocus
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="Paste a link"
          />
          <button type="submit" aria-label="Save link">
            <Check size={13} />
          </button>
        </form>
      )}
    </div>
  );
};
