import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  File,
  Image,
  Info,
  Link2,
  ListChecks,
  Minus,
  Network,
  Plus,
  Table2,
} from 'lucide-react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { INSERT_CHECK_LIST_COMMAND } from '@lexical/list';
import { $createLinkNode } from '@lexical/link';
import {
  INSERT_TABLE_COMMAND,
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
} from '@lexical/table';
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  PASTE_COMMAND,
  DROP_COMMAND,
  $insertNodes,
  $getNodeByKey,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import {
  $createHorizontalRuleNode,
  INSERT_HORIZONTAL_RULE_COMMAND,
} from '@lexical/react/LexicalHorizontalRuleNode';
import { $createToggleNode, $isToggleNode } from '../nodes/ToggleNode';
import { $createCalloutNode, $isCalloutNode } from '../nodes/CalloutNode';
import { $createFileAttachmentNode, $isFileAttachmentNode } from '../nodes/FileAttachmentNode';
import {
  INSERT_CALLOUT_COMMAND,
  INSERT_DIVIDER_COMMAND,
  INSERT_FILE_ATTACHMENT_COMMAND,
  INSERT_IMAGE_COMMAND,
  INSERT_TOGGLE_COMMAND,
  SET_CALLOUT_TYPE_COMMAND,
  TABLE_ADD_COLUMN_COMMAND,
  TABLE_ADD_ROW_COMMAND,
  TABLE_REMOVE_COLUMN_COMMAND,
  TABLE_REMOVE_ROW_COMMAND,
  TOGGLE_TOGGLE_COMMAND,
} from '../commands/blocks';
import type { AttachmentUploadRequest, AttachmentUploadResult, CalloutType } from '../types/blocks';

const findAncestor = <T extends LexicalNode>(
  selection: ReturnType<typeof $getSelection>,
  predicate: (node: LexicalNode | null | undefined) => node is T
): T | null => {
  if (!$isRangeSelection(selection)) return null;
  let node: LexicalNode | null = selection.anchor.getNode();
  while (node) {
    if (predicate(node)) return node;
    node = node.getParent();
  }
  return null;
};

const insertToggle = (editor: LexicalEditor) => {
  editor.update(() => {
    const toggle = $createToggleNode(true);
    const title = $createParagraphNode();
    title.append($createTextNode('Toggle'));
    toggle.append(title, $createParagraphNode());
    const selection = $getSelection();
    if ($isRangeSelection(selection)) selection.insertNodes([toggle]);
    else $insertNodes([toggle]);
    title.selectEnd();
  });
};

const insertCallout = (editor: LexicalEditor, type: CalloutType) => {
  editor.update(() => {
    const callout = $createCalloutNode({ calloutType: type });
    callout.append($createParagraphNode());
    const selection = $getSelection();
    if ($isRangeSelection(selection)) selection.insertNodes([callout]);
    else $insertNodes([callout]);
    callout.getFirstChild()?.selectEnd();
  });
};

const createTable = (editor: LexicalEditor) => {
  editor.dispatchCommand(INSERT_TABLE_COMMAND, { rows: '2', columns: '2', includeHeaders: false });
};

const InsertMenu = ({ onInsertFile }: { onInsertFile?: () => void }) => {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  const [calloutOpen, setCalloutOpen] = useState(false);
  const itemClass =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]';
  const run = (callback: () => void) => {
    callback();
    setOpen(false);
    setCalloutOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
        title="Insert block"
        className="inline-flex h-7 items-center gap-1 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2 text-[11px] font-medium text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)]"
      >
        <Plus size={13} /> Insert <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]">
          <button
            type="button"
            className={itemClass}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(() => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined))}
          >
            <ListChecks size={13} /> Checklist
          </button>
          <button
            type="button"
            className={itemClass}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(() => insertToggle(editor))}
          >
            <Network size={13} /> Toggle
          </button>
          <div className="relative">
            <button
              type="button"
              className={itemClass}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setCalloutOpen((current) => !current)}
            >
              <Info size={13} /> Callout <ChevronDown className="ml-auto" size={11} />
            </button>
            {calloutOpen && (
              <div className="absolute right-full top-0 mr-1 w-28 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] p-1 shadow-[var(--ledger-shadow)]">
                {(['info', 'note', 'warning', 'success'] as CalloutType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={itemClass}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => run(() => editor.dispatchCommand(INSERT_CALLOUT_COMMAND, type))}
                  >
                    {type[0].toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className={itemClass}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(() => createTable(editor))}
          >
            <Table2 size={13} /> Table
          </button>
          <div className="my-1 border-t border-[color:var(--ledger-border-subtle)]" />
          <button
            type="button"
            className={itemClass}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(() => editor.dispatchCommand(TABLE_ADD_ROW_COMMAND, undefined))}
          >
            Add table row
          </button>
          <button
            type="button"
            className={itemClass}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(() => editor.dispatchCommand(TABLE_REMOVE_ROW_COMMAND, undefined))}
          >
            Remove table row
          </button>
          <button
            type="button"
            className={itemClass}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(() => editor.dispatchCommand(TABLE_ADD_COLUMN_COMMAND, undefined))}
          >
            Add table column
          </button>
          <button
            type="button"
            className={itemClass}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              run(() => editor.dispatchCommand(TABLE_REMOVE_COLUMN_COMMAND, undefined))
            }
          >
            Remove table column
          </button>
          <button
            type="button"
            className={itemClass}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              run(() => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined))
            }
          >
            <Minus size={13} /> Divider
          </button>
          <button
            type="button"
            className={itemClass}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(() => onInsertFile?.())}
          >
            <File size={13} /> File
          </button>
          <button
            type="button"
            className={itemClass}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(() => editor.dispatchCommand(INSERT_IMAGE_COMMAND, undefined))}
          >
            <Image size={13} /> Image
          </button>
          <button
            type="button"
            className={itemClass}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              run(() => {
                const url = window.prompt('Link or embed URL')?.trim();
                if (!url) return;
                editor.update(() => {
                  const paragraph = $createParagraphNode();
                  const link = $createLinkNode(url);
                  link.append($createTextNode(url));
                  paragraph.append(link);
                  $insertNodes([paragraph]);
                });
              })
            }
          >
            <Link2 size={13} /> Link or embed
          </button>
        </div>
      )}
    </div>
  );
};

export const BlockInsertionPlugin = ({
  onUploadAttachment,
  noteId,
}: {
  onUploadAttachment?: (request: AttachmentUploadRequest) => Promise<AttachmentUploadResult>;
  noteId?: string | null;
}) => {
  const [editor] = useLexicalComposerContext();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [retryFile, setRetryFile] = useState<File | null>(null);

  const uploadAttachment = async (file: File) => {
    if (!noteId || !onUploadAttachment) return;
    setUploading(true);
    setUploadError(null);
    setRetryFile(file);
    try {
      const result = await onUploadAttachment({ noteId, file });
      editor.update(() => {
        $insertNodes([
          $createFileAttachmentNode({
            storagePath: result.storagePath,
            url: result.url,
            fileName: result.fileName,
            label: result.fileName,
            mimeType: result.mimeType,
            sizeBytes: result.sizeBytes,
          }),
          $createParagraphNode(),
        ]);
      });
      setRetryFile(null);
      setUploadError(null);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not upload file.');
    } finally {
      setUploading(false);
    }
  };

  const chooseFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '*/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void uploadAttachment(file);
    };
    input.click();
  };

  useEffect(() => {
    const unregister = editor.registerCommand(
      INSERT_TOGGLE_COMMAND,
      () => {
        insertToggle(editor);
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
    const unregisterCallout = editor.registerCommand(
      INSERT_CALLOUT_COMMAND,
      (type) => {
        let changed = false;
        editor.update(() => {
          const existing = findAncestor($getSelection(), $isCalloutNode);
          if (existing) {
            existing.setCalloutType(type);
            changed = true;
          }
        });
        if (!changed) insertCallout(editor, type);
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
    const unregisterDivider = editor.registerCommand(
      INSERT_DIVIDER_COMMAND,
      () => {
        editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined);
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
    const unregisterToggle = editor.registerCommand(
      TOGGLE_TOGGLE_COMMAND,
      () => {
        editor.update(() => {
          const node = findAncestor($getSelection(), $isToggleNode);
          node?.toggleOpen();
        });
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
    const unregisterFile = editor.registerCommand(
      INSERT_FILE_ATTACHMENT_COMMAND,
      () => {
        chooseFile();
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
    const unregisterCalloutType = editor.registerCommand(
      SET_CALLOUT_TYPE_COMMAND,
      (type) => {
        editor.update(() => {
          const node = findAncestor($getSelection(), $isCalloutNode);
          node?.setCalloutType(type);
        });
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
    const unregisterAddRow = editor.registerCommand(
      TABLE_ADD_ROW_COMMAND,
      () => {
        editor.update(() => {
          $insertTableRowAtSelection(true);
        });
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
    const unregisterRemoveRow = editor.registerCommand(
      TABLE_REMOVE_ROW_COMMAND,
      () => {
        editor.update(() => {
          $deleteTableRowAtSelection();
        });
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
    const unregisterAddColumn = editor.registerCommand(
      TABLE_ADD_COLUMN_COMMAND,
      () => {
        editor.update(() => {
          $insertTableColumnAtSelection(true);
        });
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
    const unregisterRemoveColumn = editor.registerCommand(
      TABLE_REMOVE_COLUMN_COMMAND,
      () => {
        editor.update(() => {
          $deleteTableColumnAtSelection();
        });
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
    return () => {
      unregister();
      unregisterCallout();
      unregisterDivider();
      unregisterToggle();
      unregisterFile();
      unregisterCalloutType();
      unregisterAddRow();
      unregisterRemoveRow();
      unregisterAddColumn();
      unregisterRemoveColumn();
    };
  }, [editor]);

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          let dividerShortcut = false;
          editor.getEditorState().read(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
            const block = selection.anchor.getNode().getTopLevelElementOrThrow();
            dividerShortcut =
              block.getType() === 'paragraph' && block.getTextContent().trim() === '---';
          });
          if (!dividerShortcut) return false;
          event?.preventDefault();
          editor.update(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return;
            const block = selection.anchor.getNode().getTopLevelElementOrThrow();
            block.replace($createHorizontalRuleNode());
            const paragraph = $createParagraphNode();
            block.insertAfter(paragraph);
            paragraph.selectStart();
          });
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
    [editor]
  );

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          let action: 'toggle-title' | 'toggle-exit' | 'callout-exit' | null = null;
          editor.getEditorState().read(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
            const topLevel = selection.anchor.getNode().getTopLevelElementOrThrow();
            const toggle = findAncestor(selection, $isToggleNode);
            if (toggle?.getFirstChild() === topLevel) action = 'toggle-title';
            else if (toggle?.getLastChild() === topLevel && !topLevel.getTextContent().trim())
              action = 'toggle-exit';
            const callout = findAncestor(selection, $isCalloutNode);
            if (callout?.getLastChild() === topLevel && !topLevel.getTextContent().trim())
              action = 'callout-exit';
          });
          if (!action) return false;
          event?.preventDefault();
          editor.update(() => {
            const selection = $getSelection();
            if (action === 'toggle-title') {
              const toggle = findAncestor(selection, $isToggleNode);
              const title = toggle?.getFirstChild();
              if (!toggle || !title) return;
              const body = $createParagraphNode();
              title.insertAfter(body);
              body.selectStart();
            } else if (action === 'toggle-exit') {
              const toggle = findAncestor(selection, $isToggleNode);
              if (!toggle) return;
              const paragraph = $createParagraphNode();
              toggle.insertAfter(paragraph);
              paragraph.selectStart();
            } else {
              const callout = findAncestor(selection, $isCalloutNode);
              if (!callout) return;
              const paragraph = $createParagraphNode();
              callout.insertAfter(paragraph);
              paragraph.selectStart();
            }
          });
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
    [editor]
  );

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          let handled = false;
          editor.update(() => {
            const node = findAncestor($getSelection(), $isToggleNode);
            if (node) {
              node.setOpen(true);
              handled = true;
            }
          });
          return handled;
        },
        COMMAND_PRIORITY_LOW
      ),
    [editor]
  );

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const toggleHeader = target?.closest('[data-ledger-toggle-header]');
      if (toggleHeader && root.contains(toggleHeader)) {
        const nodeKey = toggleHeader.getAttribute('data-toggle-node-key');
        if (nodeKey)
          editor.update(() => {
            const node = $getNodeByKey(nodeKey);
            if ($isToggleNode(node)) node.toggleOpen();
          });
        return;
      }
      const attachment = target?.closest('[data-ledger-file-attachment]');
      if (
        attachment &&
        root.contains(attachment) &&
        target?.closest('.ledger-file-attachment__label')
      ) {
        const nodeKey = attachment.getAttribute('data-lexical-file-attachment-key');
        const current = attachment.getAttribute('data-label') || '';
        const next = window.prompt('Attachment label', current);
        if (nodeKey && next !== null)
          editor.update(() => {
            const node = $getNodeByKey(nodeKey);
            if ($isFileAttachmentNode(node)) node.setLabel(next);
          });
      }
    };
    root.addEventListener('click', onClick);
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const attachmentLabel = target?.closest('.ledger-file-attachment__label');
      if (attachmentLabel && root.contains(attachmentLabel) && ['Enter', ' '].includes(event.key)) {
        const attachment = attachmentLabel.closest('[data-ledger-file-attachment]') as HTMLElement | null;
        const nodeKey = attachment?.getAttribute('data-lexical-file-attachment-key');
        if (!nodeKey) return;
        event.preventDefault();
        const current = attachment?.getAttribute('data-label') || '';
        const next = window.prompt('Attachment label', current);
        if (next !== null) {
          editor.update(() => {
            const node = $getNodeByKey(nodeKey);
            if ($isFileAttachmentNode(node)) node.setLabel(next);
          });
        }
        return;
      }
      const toggleHeader = target?.closest('[data-ledger-toggle-header]');
      if (!toggleHeader || !root.contains(toggleHeader) || !['Enter', ' '].includes(event.key))
        return;
      const nodeKey = toggleHeader.getAttribute('data-toggle-node-key');
      if (!nodeKey) return;
      event.preventDefault();
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isToggleNode(node)) node.toggleOpen();
      });
    };
    root.addEventListener('keydown', onKeyDown);
    return () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKeyDown);
    };
  }, [editor]);

  useEffect(
    () =>
      editor.registerRootListener((root, previous) => {
        previous
          ?.querySelectorAll('[data-ledger-toggle]')
          .forEach((element) => element.removeAttribute('data-ledger-toggle-bound'));
        if (!root) return;
        const sync = () => {
          root.querySelectorAll<HTMLElement>('[data-ledger-toggle]').forEach((element) => {
            const first = element.firstElementChild as HTMLElement | null;
            const nodeKey = element.dataset.toggleNodeKey;
            if (first) {
              first.dataset.ledgerToggleHeader = 'true';
              if (nodeKey) first.dataset.toggleNodeKey = nodeKey;
              first.setAttribute('role', 'button');
              first.setAttribute('tabindex', '0');
              const node = nodeKey ? editor.getEditorState().read(() => $getNodeByKey(nodeKey)) : null;
              if ($isToggleNode(node)) {
                const expanded = String(node.isOpen());
                if (first.getAttribute('aria-expanded') !== expanded)
                  first.setAttribute('aria-expanded', expanded);
              }
            }
          });
        };
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(root, { childList: true, subtree: true, attributes: true });
        return () => observer.disconnect();
      }),
    [editor]
  );

  useEffect(() => {
    const unregisterPaste = editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const file = Array.from(event.clipboardData?.files ?? []).find(
          (item) => !item.type.startsWith('image/')
        );
        if (!file) return false;
        event.preventDefault();
        void uploadAttachment(file);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
    const unregisterDrop = editor.registerCommand(
      DROP_COMMAND,
      (event: DragEvent) => {
        const file = Array.from(event.dataTransfer?.files ?? []).find(
          (item) => !item.type.startsWith('image/')
        );
        if (!file) return false;
        event.preventDefault();
        void uploadAttachment(file);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
    return () => {
      unregisterPaste();
      unregisterDrop();
    };
  }, [editor, noteId, onUploadAttachment]);

  return (
    <>
      <InsertMenu onInsertFile={chooseFile} />
      {(uploading || uploadError) && (
        <div className="mt-1 text-center text-[10px] text-[var(--ledger-text-muted)]">
          {uploading ? (
            'Uploading attachment…'
          ) : (
            <>
              <span>{uploadError}</span>{' '}
              <button
                type="button"
                className="underline"
                onClick={() => retryFile && void uploadAttachment(retryFile)}
              >
                Retry
              </button>{' '}
              <button
                type="button"
                className="ml-1 underline"
                onClick={() => {
                  setUploadError(null);
                  setRetryFile(null);
                }}
              >
                Remove
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
};
