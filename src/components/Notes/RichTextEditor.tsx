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
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Link2,
  Code2,
  ChevronDown,
  SpellCheck,
} from 'lucide-react';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import { TOGGLE_LINK_COMMAND } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from '@lexical/list';
import { CodeHighlightNode, CodeNode } from '@lexical/code';
import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode';
import { HeadingNode, QuoteNode, registerRichText } from '@lexical/rich-text';
import { $generateHtmlFromNodes } from '@lexical/html';
import { $generateNodesFromDOM } from '@lexical/html';
import {
  $getRoot,
  $getNodeByKey,
  $insertNodes,
  EditorState,
  FORMAT_TEXT_COMMAND,
  $getPreviousSelection,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  $createParagraphNode,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  DROP_COMMAND,
} from 'lexical';
import { $setBlocksType } from '@lexical/selection';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $createImageNode, $isImageNode, ImageNode } from './nodes/ImageNode';
import { supabase } from '../../services/supabase';
import { useWorkspaceContext } from '../../context/WorkspaceContext';
import { useToast } from '../Common/ToastProvider';

type Props = {
  initialValue?: string | null;
  editorKey?: string;
  noteId?: string | null;
  onChange: (html: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onAutoCorrect?: () => void | Promise<void>;
};

const editorConfig = {
  namespace: 'ledger-notes',
  nodes: [
    HeadingNode,
    QuoteNode,
    HorizontalRuleNode,
    ListNode,
    ListItemNode,
    LinkNode,
    AutoLinkNode,
    CodeNode,
    CodeHighlightNode,
    ImageNode,
  ],
  theme: {
    text: {
      bold: 'font-bold',
      italic: 'italic',
      underline: 'underline',
    },
    heading: {
      h1: 'mb-4 text-4xl font-semibold tracking-tight text-[var(--ledger-text-primary)]',
      h2: 'mb-3 text-3xl font-semibold tracking-tight text-[var(--ledger-text-primary)]',
      h3: 'mb-2 text-2xl font-semibold tracking-tight text-[var(--ledger-text-primary)]',
    },
    quote: 'my-4 border-l-4 border-[color:var(--ledger-border-subtle)] pl-4 italic text-[var(--ledger-text-secondary)]',
    paragraph: 'mb-4',
    list: {
      nested: {
        listitem: 'ml-4',
      },
      ol: 'list-decimal list-inside',
      ul: 'list-disc list-inside',
      listitem: 'mb-1',
    },
    code: 'rounded bg-[var(--ledger-surface-hover)] px-2 py-1 font-mono text-sm text-[var(--ledger-text-primary)]',
    codeHighlight: {
      aml: 'text-[var(--ledger-danger)]',
      tag: 'text-[var(--ledger-accent)]',
      self: 'text-[var(--ledger-accent)]',
      property: 'text-[color:var(--ledger-accent-hover)]',
      comment: 'text-[var(--ledger-text-muted)]',
    },
  },
  onError: (error: Error) => console.error(error),
};

const LoadHtmlPlugin = ({ html, editorKey }: { html?: string | null; editorKey?: string }) => {
  const [editor] = useLexicalComposerContext();
  const lastLoadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const key = String(editorKey ?? '__default__');
    if (lastLoadedKeyRef.current === key) return;
    lastLoadedKeyRef.current = key;

    editor.update(() => {
      const root = $getRoot();
      root.clear();

      const initialHtml = String(html ?? '').trim();
      if (!initialHtml) {
        return;
      }

      const parser = new DOMParser();
      const dom = parser.parseFromString(initialHtml, 'text/html');
      const nodes = $generateNodesFromDOM(editor, dom);
      if (nodes.length > 0) {
        root.select();
        $insertNodes(nodes);
      }
    });
  }, [editor, editorKey, html]);

  return null;
};

const RichTextBehaviorPlugin = () => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => registerRichText(editor), [editor]);

  return null;
};

const ToolbarButton = ({
  onClick,
  title,
  children,
    isActive = false,
    onMouseDown,
  }: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  isActive?: boolean;
  onMouseDown?: React.MouseEventHandler<HTMLButtonElement>;
}) => (
  <button
    type="button"
    onMouseDown={(event) => {
      event.preventDefault();
      onMouseDown?.(event);
    }}
    onClick={onClick}
    title={title}
    className={`inline-flex h-7 w-7 items-center justify-center rounded-md border outline-none transition focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-border-strong)] focus-visible:ring-offset-0 ${
      isActive
        ? 'border-[color:var(--ledger-border-strong)] bg-[var(--ledger-surface-hover)] text-[var(--ledger-text-primary)]'
        : 'border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-text-secondary)] hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)]'
    }`}
  >
    {children}
  </button>
);

type BlockType = 'paragraph' | 'h1' | 'h2' | 'h3' | 'quote';

const ToolbarPlugin = ({ onAutoCorrect }: { onAutoCorrect?: () => void | Promise<void> }) => {
  const [editor] = useLexicalComposerContext();
  const [blockType, setBlockType] = useState<BlockType>('paragraph');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSticky, setIsSticky] = useState(false);
  const toolbarSentinelRef = useRef<HTMLDivElement | null>(null);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    code: false,
  });
  const savedSelectionRef = useRef<ReturnType<typeof $getSelection> | null>(null);

  const getSelectedText = useCallback(() => {
    let selectedText = '';
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selectedText = selection.getTextContent().trim();
      }
    });
    return selectedText;
  }, [editor]);

  const isProbablyUrl = useCallback((value: string) => {
    const text = String(value ?? '').trim();
    if (!text) return false;
    return /^(https?:\/\/|mailto:|tel:)/i.test(text) || /^[^\s]+\.[^\s]+/.test(text);
  }, []);

  const normalizeUrl = useCallback((value: string) => {
    const text = String(value ?? '').trim();
    if (!text) return '';
    if (/^(https?:\/\/|mailto:|tel:)/i.test(text)) return text;
    if (/^[^\s]+\.[^\s]+/.test(text)) return `https://${text}`;
    return text;
  }, []);

  const captureSelection = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      savedSelectionRef.current = $isRangeSelection(selection) ? selection.clone() : null;
    });
  }, [editor]);

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
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        setActiveFormats({
          bold: selection.hasFormat('bold'),
          italic: selection.hasFormat('italic'),
          underline: selection.hasFormat('underline'),
          code: selection.hasFormat('code'),
        });

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
          else setBlockType('paragraph');
        }
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
          else $setBlocksType(selection, () => $createParagraphNode());
        }
      });
      setBlockType(type);
      setIsDropdownOpen(false);
    },
    [editor]
  );

  const blockTypeLabels: Record<BlockType, string> = {
    paragraph: 'Normal',
    h1: 'H1',
    h2: 'H2',
    h3: 'H3',
    quote: 'Quote',
  };

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      updateToolbar();
    });
  }, [editor, updateToolbar]);

  return (
    <>
      <div ref={toolbarSentinelRef} aria-hidden="true" className="pointer-events-none h-px w-full" />
        <div
        style={{ top: 'var(--notes-toolbar-sticky-top, 0px)' }}
        className={`sticky z-20 mb-2 mx-auto flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-xl px-1.5 py-1 transition-[background-color,border-color,box-shadow,opacity,transform,backdrop-filter] duration-150 ease-out ${
          isSticky
            ? 'border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)] backdrop-blur-[14px]'
            : 'border border-transparent bg-transparent shadow-none backdrop-blur-none'
        }`}
      >
      {/* Block type selector */}
      <div className="relative">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          onBlur={() => setTimeout(() => setIsDropdownOpen(false), 150)}
          className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-2.5 text-[11px] font-medium text-[var(--ledger-text-secondary)] outline-none transition hover:bg-[var(--ledger-surface-hover)] hover:text-[var(--ledger-text-primary)] focus-visible:ring-2 focus-visible:ring-[color:var(--ledger-border-strong)] focus-visible:ring-offset-0"
        >
          {blockTypeLabels[blockType]}
          <ChevronDown size={13} />
        </button>
        {isDropdownOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 min-w-40 rounded-lg border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] shadow-[var(--ledger-shadow)]">
            {(['paragraph', 'h1', 'h2', 'h3', 'quote'] as BlockType[]).map((type) => (
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

      <div className="mx-1 h-5 w-px bg-[var(--ledger-border-subtle)]" />

      <ToolbarButton
        title="Bold (Ctrl+B)"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
        isActive={activeFormats.bold}
      >
        <Bold size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Italic (Ctrl+I)"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
        isActive={activeFormats.italic}
      >
        <Italic size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Underline (Ctrl+U)"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}
        isActive={activeFormats.underline}
      >
        <Underline size={14} />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-[var(--ledger-border-subtle)]" />

      <ToolbarButton
        title="Bullet List"
        onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
      >
        <List size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Numbered List"
        onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
      >
        <ListOrdered size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Inline Code"
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')}
        isActive={activeFormats.code}
      >
        <Code2 size={14} />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-[var(--ledger-border-subtle)]" />

      <ToolbarButton
        title="Add Link"
        onMouseDown={() => {
          captureSelection();
        }}
        onClick={() => {
          const selectedText = getSelectedText();
          const defaultValue = isProbablyUrl(selectedText) ? selectedText : '';
          const enteredUrl = window.prompt('Enter URL', defaultValue);
          const nextUrl = normalizeUrl(enteredUrl?.trim() || defaultValue);
          if (!nextUrl) return;
          editor.focus();
          editor.update(() => {
            if (savedSelectionRef.current) {
              $setSelection(savedSelectionRef.current);
            }
          });
          editor.dispatchCommand(TOGGLE_LINK_COMMAND, nextUrl);
        }}
      >
        <Link2 size={14} />
      </ToolbarButton>

      {onAutoCorrect ? (
        <ToolbarButton title="Auto-correct spelling" onClick={() => void onAutoCorrect()}>
          <SpellCheck size={14} />
        </ToolbarButton>
      ) : null}
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

const ResizableImagePlugin = () => {
  const [editor] = useLexicalComposerContext();
  const observersRef = useRef(
    new Map<
      string,
      {
        observer: ResizeObserver;
        widthTimer: number | null;
        lastWidth: number | null;
      }
    >()
  );

  const syncObservers = useCallback(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    const seenKeys = new Set<string>();
    const wrappers = Array.from(rootElement.querySelectorAll<HTMLElement>('[data-lexical-image-node-key]'));

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

          if (currentState.widthTimer) {
            window.clearTimeout(currentState.widthTimer);
          }

          currentState.widthTimer = window.setTimeout(() => {
            editor.update(() => {
              const node = $getNodeByKey(key);
              if (!$isImageNode(node)) return;
              if (node.getWidth() === nextWidth) return;
              node.setWidth(nextWidth);
            });
          }, 120);
        }),
        widthTimer: null as number | null,
        lastWidth: null as number | null,
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

export function RichTextEditor({
  initialValue,
  editorKey,
  noteId,
  onChange,
  onFocus,
  onBlur,
  onAutoCorrect,
}: Props) {
  const lastChangeTimeRef = React.useRef(0);
  const pendingHtmlRef = React.useRef<string | null>(null);
  const throttleTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleChange = (editorState: EditorState, editor: any) => {
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
      <div>
        <ToolbarPlugin onAutoCorrect={onAutoCorrect} />
        <div className="relative mt-2">
          <RichTextBehaviorPlugin />
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                onFocus={onFocus}
                onBlur={onBlur}
                className="min-h-[calc(100vh-420px)] rounded-2xl border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-card)] px-6 py-5 text-[16px] leading-8 text-[var(--ledger-text-primary)] outline-none transition focus:border-[color:var(--ledger-border-strong)] focus:ring-4 focus:ring-[color:var(--ledger-surface-hover)]/60"
              />
            }
            placeholder={
              <div className="pointer-events-none absolute left-0 right-0 top-0 flex items-start px-6 py-5 text-[16px] leading-8 text-[var(--ledger-text-muted)]">
                Write something...
              </div>
            }
            ErrorBoundary={() => null}
          />
          <LoadHtmlPlugin html={initialValue} editorKey={editorKey} />
          <HistoryPlugin />
          <LinkPlugin />
          <MarkdownShortcutPlugin />
          <TabIndentationPlugin />
          <ListPlugin />
          <ImagePasteDropPlugin noteId={noteId} />
          <ResizableImagePlugin />
          <ImageCopyPlugin />
          <OnChangePlugin onChange={handleChange} />
        </div>
      </div>
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
                await navigator.clipboard.write([new (window as any).ClipboardItem(clipboardItemInput)]);
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
                await (navigator.clipboard as any).write([new (window as any).ClipboardItem({ 'text/html': blob })]);
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
