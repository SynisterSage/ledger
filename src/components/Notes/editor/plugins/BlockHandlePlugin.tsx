import React, { useEffect, useState } from 'react';
import {
  Clipboard,
  Copy,
  GripVertical,
  Link2,
  MoreHorizontal,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Bell,
  CalendarDays,
  Inbox,
  ListChecks,
} from 'lucide-react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  DROP_COMMAND,
  DRAGOVER_COMMAND,
  DRAGSTART_COMMAND,
  DRAGEND_COMMAND,
  type ElementNode,
} from 'lexical';
import { $setBlocksType } from '@lexical/selection';
import { $createHeadingNode } from '@lexical/rich-text';
import type { SelectedContentAction } from '../types/selectedContent';
import { $isSmartDateNode } from '../../nodes/SmartDateNode';

type Props = {
  noteId?: string | null;
  onCreateTask?: SelectedContentAction;
  onCreateReminder?: SelectedContentAction;
  onCreateEvent?: SelectedContentAction;
  onSendToIntake?: SelectedContentAction;
  onLinkContext?: SelectedContentAction;
};

type MenuState = { key: string; top: number; left: number } | null;

export const BlockHandlePlugin = ({
  noteId,
  onCreateTask,
  onCreateReminder,
  onCreateEvent,
  onSendToIntake,
  onLinkContext,
}: Props) => {
  const [editor] = useLexicalComposerContext();
  const [hovered, setHovered] = useState<MenuState>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    const updateFromTarget = (target: EventTarget | null) => {
      const element = (target as HTMLElement | null)?.closest(
        '[data-lexical-node-key]'
      ) as HTMLElement | null;
      if (!element || !root.contains(element)) return setHovered(null);
      const key = element.dataset.lexicalNodeKey;
      if (!key || element.parentElement !== root) return setHovered(null);
      const rect = element.getBoundingClientRect();
      setHovered({ key, top: rect.top + 2, left: Math.max(4, rect.left - 34) });
    };
    const onMove = (event: MouseEvent) => updateFromTarget(event.target);
    const onLeave = (event: MouseEvent) => {
      const related = event.relatedTarget as HTMLElement | null;
      if (related?.closest('.ledger-block-menu')) return;
      if (!root.contains(related)) {
        setHovered(null);
        setMenu(null);
      }
    };
    root.addEventListener('mousemove', onMove);
    root.addEventListener('mouseleave', onLeave);
    return () => {
      root.removeEventListener('mousemove', onMove);
      root.removeEventListener('mouseleave', onLeave);
    };
  }, [editor]);

  useEffect(() => {
    const unregisterStart = editor.registerCommand(
      DRAGSTART_COMMAND,
      (event) => {
        const target = event.target as HTMLElement | null;
        const key = target?.closest('[data-block-handle]')?.getAttribute('data-block-handle');
        if (!key) return false;
        event.dataTransfer?.setData('application/x-ledger-block', key);
        event.dataTransfer?.setData('text/plain', '');
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        setDragKey(key);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
    const unregisterOver = editor.registerCommand(
      DRAGOVER_COMMAND,
      (event) => {
        const target = event.target as HTMLElement | null;
        const element = target?.closest('[data-lexical-node-key]') as HTMLElement | null;
        if (!dragKey || !element || !editor.getRootElement()?.contains(element)) return false;
        const targetKey = element.dataset.lexicalNodeKey;
        if (
          !targetKey ||
          targetKey === dragKey ||
          element.parentElement !== editor.getRootElement()
        )
          return false;
        event.preventDefault();
        setDropKey(targetKey);
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
    const unregisterDrop = editor.registerCommand(
      DROP_COMMAND,
      (event) => {
        const sourceKey = event.dataTransfer?.getData('application/x-ledger-block') || dragKey;
        const target = (event.target as HTMLElement | null)?.closest(
          '[data-lexical-node-key]'
        ) as HTMLElement | null;
        const targetKey = target?.dataset.lexicalNodeKey;
        if (
          !sourceKey ||
          !targetKey ||
          sourceKey === targetKey ||
          target?.parentElement !== editor.getRootElement()
        )
          return false;
        event.preventDefault();
        editor.update(() => {
          const source = $getNodeByKey(sourceKey);
          const destination = $getNodeByKey(targetKey);
          if (
            !source ||
            !destination ||
            source.getParent() !== $getRoot() ||
            destination.getParent() !== $getRoot()
          )
            return;
          const sourceIndex = source.getIndexWithinParent();
          const destinationIndex = destination.getIndexWithinParent();
          if (sourceIndex < destinationIndex) destination.insertAfter(source);
          else destination.insertBefore(source);
          source.selectStart();
        });
        setDragKey(null);
        setDropKey(null);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
    const unregisterEnd = editor.registerCommand(
      DRAGEND_COMMAND,
      () => {
        setDragKey(null);
        setDropKey(null);
        return false;
      },
      COMMAND_PRIORITY_LOW
    );
    return () => {
      unregisterStart();
      unregisterOver();
      unregisterDrop();
      unregisterEnd();
    };
  }, [dragKey, editor]);

  if (!hovered) return null;
  const openMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setMenu({
      key: hovered.key,
      top: Math.min(hovered.top + 26, Math.max(8, window.innerHeight - 480)),
      left: Math.min(Math.max(8, hovered.left), Math.max(8, window.innerWidth - 210)),
    });
  };
  const updateBlock = (
    action:
      | 'duplicate'
      | 'up'
      | 'down'
      | 'delete'
      | 'copy'
      | 'copy-link'
      | 'paragraph'
      | 'h1'
      | 'h2'
  ) => {
    editor.update(() => {
      const node = $getNodeByKey(hovered.key);
      if (!node || node.getParent() !== $getRoot() || !$isElementNode(node)) return;
      if (action === 'duplicate') {
        const copy = (
          node.constructor as typeof ElementNode & {
            clone: (value: ElementNode) => ElementNode;
          }
        ).clone(node);
        node.insertAfter(copy);
        copy.selectStart();
      } else if (action === 'up') node.getPreviousSibling()?.insertBefore(node);
      else if (action === 'down') node.getNextSibling()?.insertAfter(node);
      else if (action === 'delete') node.remove();
      else if (action === 'copy') void navigator.clipboard?.writeText(node.getTextContent());
      else if (action === 'copy-link')
        void navigator.clipboard?.writeText(`#block-${node.getKey()}`);
      else if (action === 'paragraph') $setBlocksType($getSelection(), $createParagraphNode);
      else $setBlocksType($getSelection(), () => $createHeadingNode(action));
    });
    setMenu(null);
  };
  const runLedgerAction = (action?: SelectedContentAction) => {
    if (!action || !noteId) return;
    let payload: Parameters<SelectedContentAction>[0] | null = null;
    editor.update(() => {
      const node = $getNodeByKey(hovered.key);
      if (!node || node.getParent() !== $getRoot()) return;
      const element = $isElementNode(node) ? node : null;
      if (!element) return;
      payload = {
        noteId,
        plainText: element.getTextContent().trim(),
        blockKey: node.getKey(),
        source: 'block',
        smartDates: element
          .getAllTextNodes()
          .filter($isSmartDateNode)
          .map((dateNode) => ({
            text: dateNode.getTextContent(),
            date: dateNode.getSmartDateKey(),
            state: dateNode.getSmartDateState(),
          })),
      };
    });
    if (payload) void action(payload);
    setMenu(null);
  };
  return (
    <>
      <div className="ledger-block-handle" style={{ top: hovered.top, left: hovered.left }}>
        <button
          type="button"
          draggable
          data-block-handle={hovered.key}
          title="Drag block"
          aria-label="Drag block"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <GripVertical size={14} />
        </button>
        <button
          type="button"
          title="Insert block below"
          aria-label="Insert block below"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            editor.update(() => {
              const node = $getNodeByKey(hovered.key);
              if (node) {
                const paragraph = $createParagraphNode();
                node.insertAfter(paragraph);
                paragraph.selectStart();
              }
            })
          }
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          title="Block menu"
          aria-label="Block menu"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openMenu}
        >
          <MoreHorizontal size={13} />
        </button>
      </div>
      {dropKey && (
        <div
          className="ledger-block-drop-line"
          style={{
            top: (editor.getElementByKey(dropKey)?.getBoundingClientRect().top ?? 0) - 2,
            left: editor.getRootElement()?.getBoundingClientRect().left ?? 0,
            width: editor.getRootElement()?.getBoundingClientRect().width ?? 0,
          }}
        />
      )}
      {menu && menu.key === hovered.key && (
        <div
          role="menu"
          aria-label="Block actions"
          className="ledger-block-menu fixed z-[80] w-36 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]"
          style={{ top: menu.top, left: menu.left + 30 }}
          onMouseLeave={() => setMenu(null)}
        >
          <button type="button" onClick={() => updateBlock('duplicate')}>
            <Copy size={12} /> Duplicate
          </button>
          <button type="button" onClick={() => updateBlock('up')}>
            <ChevronUp size={12} /> Move up
          </button>
          <button type="button" onClick={() => updateBlock('down')}>
            <ChevronDown size={12} /> Move down
          </button>
          <div className="ledger-block-menu__separator" />
          <button type="button" onClick={() => updateBlock('copy')}>
            <Clipboard size={12} /> Copy
          </button>
          <button type="button" onClick={() => updateBlock('copy-link')}>
            <Link2 size={12} /> Copy link to block
          </button>
          <div className="ledger-block-menu__separator" />
          {(onCreateTask ||
            onCreateReminder ||
            onCreateEvent ||
            onSendToIntake ||
            onLinkContext) && (
            <>
              <div className="ledger-block-menu__label">Ledger</div>
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
          <div className="ledger-block-menu__separator" />
          <button type="button" onClick={() => updateBlock('paragraph')}>
            Change to text
          </button>
          <button type="button" onClick={() => updateBlock('h1')}>
            Change to heading
          </button>
          <button
            type="button"
            onClick={() => updateBlock('delete')}
            className="ledger-block-menu__danger"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      )}
    </>
  );
};
