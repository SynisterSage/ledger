import {
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  $applyNodeReplacement,
} from 'lexical';
import { createSignedStorageUrl, getStorageObjectUrl } from '../../../../services/privateStorage';

export type SerializedFileAttachmentNode = SerializedLexicalNode & {
  type: 'ledger-file-attachment';
  version: 1;
  storagePath: string;
  url: string;
  fileName: string;
  label: string;
  mimeType: string;
  sizeBytes: number;
};

type FileAttachmentArgs = Omit<SerializedFileAttachmentNode, 'type' | 'version'>;
const NOTE_FILE_BUCKET = 'note-files';

const resolveAttachmentUrl = (storagePath: string, url: string) =>
  storagePath ? getStorageObjectUrl(NOTE_FILE_BUCKET, storagePath) || url : url;

const formatBytes = (size: number) => {
  if (!Number.isFinite(size) || size < 1024) return `${Math.max(0, Math.round(size))} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const convertAttachmentElement = (domNode: Node): DOMConversionOutput | null => {
  if (!(domNode instanceof HTMLElement) || !domNode.hasAttribute('data-ledger-file-attachment'))
    return null;
  return {
    node: $createFileAttachmentNode({
      storagePath: domNode.dataset.storagePath || '',
      url: domNode.dataset.url || domNode.querySelector('a')?.getAttribute('href') || '',
      fileName: domNode.dataset.fileName || 'Attached file',
      label: domNode.dataset.label || domNode.dataset.fileName || 'Attached file',
      mimeType: domNode.dataset.mimeType || 'application/octet-stream',
      sizeBytes: Number(domNode.dataset.sizeBytes || 0),
    }),
  };
};

export class FileAttachmentNode extends DecoratorNode<null> {
  __storagePath: string;
  __url: string;
  __fileName: string;
  __label: string;
  __mimeType: string;
  __sizeBytes: number;

  static getType(): string {
    return 'ledger-file-attachment';
  }

  static clone(node: FileAttachmentNode): FileAttachmentNode {
    return new FileAttachmentNode(
      node.__storagePath,
      node.__url,
      node.__fileName,
      node.__label,
      node.__mimeType,
      node.__sizeBytes,
      node.__key
    );
  }

  static importJSON(serializedNode: SerializedFileAttachmentNode): FileAttachmentNode {
    return $createFileAttachmentNode(serializedNode);
  }

  static importDOM(): DOMConversionMap | null {
    return { div: () => ({ conversion: convertAttachmentElement, priority: 4 }) };
  }

  constructor(
    storagePath: string,
    url: string,
    fileName: string,
    label: string,
    mimeType: string,
    sizeBytes: number,
    key?: NodeKey
  ) {
    super(key);
    this.__storagePath = storagePath;
    this.__url = url;
    this.__fileName = fileName;
    this.__label = label;
    this.__mimeType = mimeType;
    this.__sizeBytes = sizeBytes;
  }

  getLabel(): string {
    return this.getLatest().__label;
  }
  setLabel(label: string): this {
    const writable = this.getWritable();
    writable.__label = label.trim() || writable.__fileName;
    return writable;
  }
  getUrl(): string {
    return this.getLatest().__url;
  }
  getStoragePath(): string {
    return this.getLatest().__storagePath;
  }

  exportJSON(): SerializedFileAttachmentNode {
    return {
      ...super.exportJSON(),
      type: 'ledger-file-attachment',
      version: 1,
      storagePath: this.__storagePath,
      url: this.__url,
      fileName: this.__fileName,
      label: this.__label,
      mimeType: this.__mimeType,
      sizeBytes: this.__sizeBytes,
    };
  }

  static createElement(node: FileAttachmentNode): HTMLElement {
    const element = document.createElement('div');
    element.dataset.ledgerFileAttachment = 'true';
    element.dataset.lexicalFileAttachmentKey = node.getKey();
    element.dataset.storagePath = node.__storagePath;
    element.dataset.url = resolveAttachmentUrl(node.__storagePath, node.__url);
    element.dataset.fileName = node.__fileName;
    element.dataset.label = node.__label;
    element.dataset.mimeType = node.__mimeType;
    element.dataset.sizeBytes = String(node.__sizeBytes);
    element.className = 'ledger-file-attachment';
    element.contentEditable = 'false';
    const icon = document.createElement('span');
    icon.className = 'ledger-file-attachment__icon';
    icon.textContent = '↗';
    const body = document.createElement('span');
    body.className = 'ledger-file-attachment__body';
    const label = document.createElement('span');
    label.className = 'ledger-file-attachment__label';
    label.textContent = node.__label;
    label.setAttribute('role', 'button');
    label.setAttribute('tabindex', '0');
    label.setAttribute('aria-label', `Rename attachment ${node.__label}`);
    const meta = document.createElement('span');
    meta.className = 'ledger-file-attachment__meta';
    meta.textContent = `${node.__mimeType.split('/')[1] || 'file'} · ${formatBytes(
      node.__sizeBytes
    )}`;
    body.append(label, meta);
    const link = document.createElement('a');
    link.href = resolveAttachmentUrl(node.__storagePath, node.__url);
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.className = 'ledger-file-attachment__open';
    link.textContent = 'Open';
    if (node.__storagePath) {
      void createSignedStorageUrl(NOTE_FILE_BUCKET, node.__storagePath)
        .then((signedUrl) => {
          if (link.isConnected) link.href = signedUrl;
        })
        .catch(() => undefined);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ledger-file-attachment__remove';
    remove.dataset.ledgerFileAttachmentRemove = 'true';
    remove.setAttribute('aria-label', `Remove attachment ${node.__label}`);
    remove.textContent = 'Remove';
    element.append(icon, body, link, remove);
    return element;
  }

  createDOM(): HTMLElement {
    return FileAttachmentNode.createElement(this);
  }

  updateDOM(_prevNode: FileAttachmentNode, dom: HTMLElement): boolean {
    const replacement = FileAttachmentNode.createElement(this);
    dom.replaceChildren(...Array.from(replacement.childNodes));
    Object.assign(dom.dataset, replacement.dataset);
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('div');
    element.setAttribute('data-ledger-file-attachment', 'true');
    element.setAttribute('data-storage-path', this.__storagePath);
    element.setAttribute('data-url', resolveAttachmentUrl(this.__storagePath, this.__url));
    element.setAttribute('data-file-name', this.__fileName);
    element.setAttribute('data-label', this.__label);
    element.setAttribute('data-mime-type', this.__mimeType);
    element.setAttribute('data-size-bytes', String(this.__sizeBytes));
    const link = document.createElement('a');
    link.href = resolveAttachmentUrl(this.__storagePath, this.__url);
    link.textContent = this.__label;
    element.appendChild(link);
    return { element };
  }

  decorate(): null {
    return null;
  }
}

export function $createFileAttachmentNode(args: FileAttachmentArgs): FileAttachmentNode {
  return $applyNodeReplacement(
    new FileAttachmentNode(
      args.storagePath,
      args.url,
      args.fileName,
      args.label,
      args.mimeType,
      args.sizeBytes
    )
  );
}

export function $isFileAttachmentNode(
  node: LexicalNode | null | undefined
): node is FileAttachmentNode {
  return node instanceof FileAttachmentNode;
}
