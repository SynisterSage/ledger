import {
  ElementNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  $applyNodeReplacement,
  $createTextNode,
} from 'lexical';

export type LinkedResourceBadgeType = 'project' | 'note' | 'task' | 'event' | 'reminder' | 'external';
export type SerializedLinkedResourceBadgeNode = SerializedElementNode & {
  type: 'linked-resource-badge';
  version: 1;
  resourceType: LinkedResourceBadgeType;
  resourceId: string;
  title: string;
  url: string;
  provider?: string;
  externalType?: string;
  metadata?: Record<string, unknown>;
};

const isBadge = (node: Node) =>
  node.nodeType === 1 && (node as HTMLElement).getAttribute('data-linked-resource-badge') === 'true';

export class LinkedResourceBadgeNode extends ElementNode {
  __resourceType: LinkedResourceBadgeType;
  __resourceId: string;
  __title: string;
  __url: string;
  __provider: string;
  __externalType: string;
  __metadata: Record<string, unknown>;

  static getType() { return 'linked-resource-badge'; }
  static clone(node: LinkedResourceBadgeNode) {
    return new LinkedResourceBadgeNode(node.__resourceType, node.__resourceId, node.__title, node.__url, node.__provider, node.__externalType, node.__metadata, node.__key);
  }
  static importJSON(node: SerializedLinkedResourceBadgeNode) {
    return $createLinkedResourceBadgeNode(node);
  }
  static importDOM(): DOMConversionMap | null {
    return {
      a: (domNode) => isBadge(domNode)
        ? {
            conversion: () => {
              const element = domNode as HTMLElement;
              const url = element.getAttribute('href') || '#';
              const inferredProvider = (() => { try { const host = new URL(url).hostname.toLowerCase(); return host.includes('figma.com') ? 'figma' : host.includes('github.com') ? 'github' : host.includes('google.com') || host.includes('googleusercontent.com') ? 'google_drive' : 'external'; } catch { return 'external'; } })();
              const provider = element.dataset.linkedResourceProvider && element.dataset.linkedResourceProvider !== 'external' ? element.dataset.linkedResourceProvider : inferredProvider;
              const metadata = (() => { try { return element.dataset.linkedResourceMetadata ? JSON.parse(element.dataset.linkedResourceMetadata) as Record<string, unknown> : undefined; } catch { return undefined; } })();
              const metadataTitle = String(metadata?.name ?? metadata?.nodeName ?? metadata?.fileName ?? metadata?.title ?? '').trim();
              const rawTitle = element.dataset.linkedResourceTitle || element.textContent || '';
              const title = metadataTitle || (url !== '#' && (rawTitle === url || rawTitle.startsWith(`${url} ·`) || rawTitle.split(url).length > 2) ? (provider === 'figma' ? 'Figma design' : provider === 'github' ? 'GitHub resource' : 'Linked resource') : rawTitle);
              return {
                node: $createLinkedResourceBadgeNode({
                  resourceType: (element.dataset.linkedResourceType || 'external') as LinkedResourceBadgeType,
                  resourceId: element.dataset.linkedResourceId || '',
                  title,
                  url,
                  provider,
                  externalType: element.dataset.linkedResourceExternalType,
                  metadata,
                }),
                // The badge owns its complete visual DOM. Do not let Lexical
                // import the anchor's presentation text as editor content.
                forChild: () => null,
              };
            },
            priority: 4,
          }
        : null,
    };
  }

  constructor(resourceType: LinkedResourceBadgeType, resourceId: string, title: string, url: string, provider?: string, externalType?: string, metadata?: Record<string, unknown>, key?: NodeKey) {
    super(key);
    this.__resourceType = resourceType;
    this.__resourceId = resourceId;
    this.__title = title;
    this.__url = url;
    this.__provider = provider || resourceType;
    this.__externalType = externalType || '';
    this.__metadata = metadata || {};
  }

  exportJSON(): SerializedLinkedResourceBadgeNode {
    return {
      ...super.exportJSON(),
      type: 'linked-resource-badge',
      version: 1,
      resourceType: this.__resourceType,
      resourceId: this.__resourceId,
      title: this.__title,
      url: this.__url,
      provider: this.__provider,
      externalType: this.__externalType,
      metadata: this.__metadata,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('a');
    element.className = 'ledger-linked-resource-badge';
    element.href = this.__url;
    element.setAttribute('data-linked-resource-badge', 'true');
    element.setAttribute('data-linked-resource-type', this.__resourceType);
    element.setAttribute('data-linked-resource-id', this.__resourceId);
    element.setAttribute('data-linked-resource-title', this.__title);
    element.setAttribute('data-linked-resource-provider', this.__provider);
    element.setAttribute('data-linked-resource-external-type', this.__externalType);
    element.setAttribute('data-linked-resource-metadata', JSON.stringify(this.__metadata));
    element.contentEditable = 'false';
    const provider = this.__provider === 'google_drive' ? 'Google Drive' : this.__provider === 'github' ? 'GitHub' : this.__provider === 'figma' ? 'Figma' : this.__provider;
    const icon = document.createElement('span');
    icon.className = `ledger-linked-resource-badge__icon ledger-linked-resource-badge__icon--${this.__provider}`;
    icon.setAttribute('aria-hidden', 'true');
    if (this.__provider === 'github' || this.__provider === 'google_drive') {
      const image = document.createElement('img');
      image.src = this.__provider === 'github' ? '/github-mark.svg' : '/drive.svg';
      image.alt = '';
      icon.append(image);
    } else {
      const image = document.createElement('img');
      image.src = this.__provider === 'figma' ? '/Figma-logo.svg' : '';
      image.alt = '';
      if (image.src) icon.append(image);
      else icon.textContent = '↗';
    }
    const content = document.createElement('span');
    content.className = 'ledger-linked-resource-badge__content';
    const title = document.createElement('span');
    title.className = 'ledger-linked-resource-badge__title';
    title.textContent = this.__title || 'Untitled resource';
    const meta = document.createElement('span');
    meta.className = 'ledger-linked-resource-badge__meta';
    const detail = this.__provider === 'figma'
      ? this.__metadata.pageName ?? this.__metadata.fileName ?? this.__metadata.nodeType ?? this.__externalType
      : this.__externalType || this.__metadata.fileType || this.__metadata.nodeType;
    meta.textContent = [provider, String(detail ?? '')].filter(Boolean).join(' · ');
    content.append(title, meta);
    const action = document.createElement('span');
    action.className = 'ledger-linked-resource-badge__action';
    action.textContent = '↗';
    element.append(icon, content, action);
    return element;
  }

  updateDOM() { return true; }

  getExternalReferenceId(): string { return this.__resourceId; }
  setPresentation({ title, provider, externalType, metadata }: { title?: string; provider?: string; externalType?: string; metadata?: Record<string, unknown> }) {
    const writable = this.getWritable();
    if (title) writable.__title = title;
    if (provider) writable.__provider = provider;
    if (externalType) writable.__externalType = externalType;
    if (metadata) writable.__metadata = metadata;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('a');
    element.setAttribute('data-linked-resource-badge', 'true');
    element.setAttribute('data-linked-resource-type', this.__resourceType);
    element.setAttribute('data-linked-resource-id', this.__resourceId);
    element.setAttribute('data-linked-resource-title', this.__title);
    element.setAttribute('data-linked-resource-provider', this.__provider);
    element.setAttribute('data-linked-resource-external-type', this.__externalType);
    element.setAttribute('data-linked-resource-metadata', JSON.stringify(this.__metadata));
    element.href = this.__url;
    element.className = 'ledger-linked-resource-badge';
    return { element };
  }

}

type LinkedResourceBadgeConfig = {
  resourceType: LinkedResourceBadgeType;
  resourceId: string;
  title: string;
  url: string;
  provider?: string;
  externalType?: string;
  metadata?: Record<string, unknown>;
  key?: NodeKey;
};

export const $createLinkedResourceBadgeNode = ({ resourceType, resourceId, title, url, provider, externalType, metadata, key }: LinkedResourceBadgeConfig) => {
  const node = new LinkedResourceBadgeNode(resourceType, resourceId, title, url, provider, externalType, metadata, key);
  node.append($createTextNode('\u200B'));
  return $applyNodeReplacement(node);
};

export const $isLinkedResourceBadgeNode = (node: LexicalNode | null | undefined): node is LinkedResourceBadgeNode =>
  node instanceof LinkedResourceBadgeNode;
