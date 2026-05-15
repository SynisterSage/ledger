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
  $insertNodes,
  EditorState,
  FORMAT_TEXT_COMMAND,
  $getPreviousSelection,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  COMMAND_PRIORITY_EDITOR,
  PASTE_COMMAND,
  DROP_COMMAND,
} from 'lexical';
import { $setBlocksType } from '@lexical/selection';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $createImageNode, ImageNode } from './nodes/ImageNode';
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
      h1: 'mb-4 text-4xl font-semibold tracking-tight text-gray-900',
      h2: 'mb-3 text-3xl font-semibold tracking-tight text-gray-900',
      h3: 'mb-2 text-2xl font-semibold tracking-tight text-gray-900',
    },
    quote: 'my-4 border-l-4 border-gray-300 pl-4 italic text-gray-600',
    paragraph: 'mb-4',
    list: {
      nested: {
        listitem: 'ml-4',
      },
      ol: 'list-decimal list-inside',
      ul: 'list-disc list-inside',
      listitem: 'mb-1',
    },
    code: 'bg-gray-100 px-2 py-1 rounded font-mono text-sm',
    codeHighlight: {
      aml: 'text-red-600',
      tag: 'text-blue-600',
      self: 'text-blue-600',
      property: 'text-orange-600',
      comment: 'text-green-600',
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
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  isActive?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={`h-7 w-7 rounded-md border transition inline-flex items-center justify-center ${
      isActive
        ? 'border-gray-900 bg-gray-900 text-white'
        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
    }`}
  >
    {children}
  </button>
);

type BlockType = 'paragraph' | 'h1' | 'h2' | 'h3' | 'quote';

const ToolbarPlugin = () => {
  const [editor] = useLexicalComposerContext();
  const [blockType, setBlockType] = useState<BlockType>('paragraph');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    code: false,
  });

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
    <div className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200/80 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur">
      {/* Block type selector */}
      <div className="relative">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          onBlur={() => setTimeout(() => setIsDropdownOpen(false), 150)}
          className="h-7 px-2.5 rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 inline-flex items-center justify-center gap-1 text-[11px] font-medium transition"
        >
          {blockTypeLabels[blockType]}
          <ChevronDown size={13} />
        </button>
        {isDropdownOpen && (
          <div className="absolute top-full mt-1 left-0 z-50 rounded-lg border border-gray-200 bg-white shadow-lg min-w-40">
            {(['paragraph', 'h1', 'h2', 'h3', 'quote'] as BlockType[]).map((type) => (
              <button
                key={type}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => changeBlockType(type)}
                className={`w-full text-left px-3 py-2 text-sm ${
                  blockType === type
                    ? 'bg-gray-100 font-medium text-gray-900'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {blockTypeLabels[type]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mx-1 h-5 w-px bg-gray-200" />

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

      <div className="mx-1 h-5 w-px bg-gray-200" />

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

      <div className="mx-1 h-5 w-px bg-gray-200" />

      <ToolbarButton
        title="Add Link"
        onClick={() => {
          const url = window.prompt('Enter URL');
          if (!url) return;
          editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
        }}
      >
        <Link2 size={14} />
      </ToolbarButton>
    </div>
  );
};

const NOTE_IMAGE_BUCKET = 'note-images';

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

      try {
        const { error: uploadError } = await supabase.storage
          .from(NOTE_IMAGE_BUCKET)
          .upload(storagePath, file, { cacheControl: '3600', upsert: false });
        if (uploadError) {
          console.error('Image upload failed', uploadError);
          toast.show('Image upload failed', { variant: 'error' });
          return;
        }

        // TEMP MVP: using public URL for rendering. Replace with signed URL resolution
        // when moving to private buckets / per-workspace access control.
        const { data } = supabase.storage.from(NOTE_IMAGE_BUCKET).getPublicUrl(storagePath);
        const imageUrl = data?.publicUrl;
        if (!imageUrl) {
          toast.show('Could not retrieve image URL', { variant: 'error' });
          return;
        }

        // only insert after successful upload and valid render URL
        editor.update(() => {
          $insertNodes([
            $createImageNode({ src: imageUrl, altText: file.name || 'Pasted image', storagePath }),
            $createParagraphNode(),
          ]);
        });
      } catch (uploadError) {
        console.error('Image upload failed', uploadError);
        toast.show('Image upload failed', { variant: 'error' });
      }
    },
    [activeWorkspaceId, editor, noteId]
  );

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
          file.type.startsWith('image/')
        );
        if (files.length === 0) return false;
        event.preventDefault();
        for (const file of files) {
          void uploadAndInsert(file);
        }
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor, uploadAndInsert]);

  useEffect(() => {
    return editor.registerCommand(
      DROP_COMMAND,
      (event: DragEvent) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
          file.type.startsWith('image/')
        );
        if (files.length === 0) return false;
        event.preventDefault();
        for (const file of files) {
          void uploadAndInsert(file);
        }
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor, uploadAndInsert]);

  return null;
};

export function RichTextEditor({ initialValue, editorKey, noteId, onChange, onFocus, onBlur }: Props) {
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
        <ToolbarPlugin />
        <div className="relative mt-2">
          <RichTextBehaviorPlugin />
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                onFocus={onFocus}
                onBlur={onBlur}
                className="outline-none min-h-[calc(100vh-420px)] rounded-2xl border border-gray-200/70 bg-[#fcfcfd] px-6 py-5 text-[16px] leading-8 text-gray-800 shadow-[0_1px_2px_rgba(15,23,42,0.03)] focus:border-gray-300 focus:ring-1 focus:ring-gray-200 transition"
              />
            }
            placeholder={
              <div className="pointer-events-none absolute left-0 right-0 top-0 flex items-start px-6 py-5 text-gray-400 text-[16px] leading-8">
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
          <OnChangePlugin onChange={handleChange} />
        </div>
      </div>
    </LexicalComposer>
  );
}
