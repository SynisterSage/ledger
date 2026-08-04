import {
  $applyNodeReplacement,
  $getNodeByKey,
  createCommand,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
} from 'lexical';

export type LedgerImageResizePayload = { nodeKey: string; width: number };
export const RESIZE_IMAGE_COMMAND = createCommand<LedgerImageResizePayload>('LEDGER_RESIZE_IMAGE');

const MIN_IMAGE_WIDTH = 160;
const MAX_IMAGE_WIDTH = 960;
const DEFAULT_IMAGE_WIDTH = 560;

const parseWidth = (value: string | null | undefined) => {
  const width = Number.parseFloat(value ?? '');
  return Number.isFinite(width) && width > 0 ? Math.round(width) : null;
};

function imageFromElement(element: HTMLElement) {
  const image = element.matches('img') ? element as HTMLImageElement : element.querySelector('img');
  if (!image) return null;
  return {
    src: image.getAttribute('src') ?? '',
    altText: image.getAttribute('alt') ?? '',
    width: parseWidth(image.getAttribute('width')) ?? parseWidth(image.getAttribute('data-width')) ?? parseWidth(image.style.width),
  };
}

export class LedgerImageNode extends DecoratorNode<null> {
  __src: string;
  __altText: string;
  __width: number | null;

  constructor(src: string, altText = '', width: number | null = null, key?: NodeKey) {
    super(key);
    this.__src = src;
    this.__altText = altText;
    this.__width = width;
  }

  static getType() { return 'ledger-image'; }
  static clone(node: LedgerImageNode) { return new LedgerImageNode(node.__src, node.__altText, node.__width, node.__key); }

  static importDOM() {
    const convert = (element: HTMLElement) => {
      if (element.matches('figure') && element.getAttribute('data-ledger-kind') !== 'image') return null;
      const image = imageFromElement(element);
      return image ? { conversion: () => ({ node: new LedgerImageNode(image.src, image.altText, image.width) }), priority: 6 } : null;
    };
    return { img: convert, figure: convert };
  }

  static importJSON(serializedNode: { src?: string; altText?: string; width?: number | null }) {
    return $createLedgerImageNode({ src: serializedNode.src ?? '', altText: serializedNode.altText ?? '', width: serializedNode.width ?? null });
  }

  getWidth() { return this.getLatest().__width; }

  setWidth(width: number) {
    this.getWritable().__width = Math.max(MIN_IMAGE_WIDTH, Math.min(MAX_IMAGE_WIDTH, Math.round(width)));
    return this;
  }

  createDOM() {
    const wrapper = document.createElement('div');
    wrapper.className = 'editor-image';
    wrapper.dataset.lexicalImageNodeKey = this.getKey();
    wrapper.contentEditable = 'false';
    wrapper.style.width = `${this.__width ?? DEFAULT_IMAGE_WIDTH}px`;
    wrapper.style.maxWidth = '100%';

    const image = document.createElement('img');
    image.src = this.__src;
    image.alt = this.__altText || 'Note image';
    image.draggable = false;
    image.className = 'editor-image__content';
    if (this.__width) {
      image.width = this.__width;
      image.dataset.width = String(this.__width);
    }
    wrapper.appendChild(image);

    wrapper.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent('ledger-image-copy', { detail: { src: this.__src } }));
    });

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'editor-image__resize-handle';
    handle.setAttribute('aria-label', 'Resize image');
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = wrapper.getBoundingClientRect().width;
      const maxWidth = Math.min(MAX_IMAGE_WIDTH, Math.max(MIN_IMAGE_WIDTH, window.innerWidth - 40));
      wrapper.dataset.resizing = 'true';
      document.body.style.userSelect = 'none';
      const onMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        const width = Math.max(MIN_IMAGE_WIDTH, Math.min(maxWidth, Math.round(startWidth + moveEvent.clientX - startX)));
        wrapper.style.width = `${width}px`;
      };
      const onEnd = () => {
        const width = Math.round(wrapper.getBoundingClientRect().width);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        wrapper.dataset.resizing = 'false';
        document.body.style.userSelect = '';
        window.dispatchEvent(new CustomEvent('ledger-image-resize', { detail: { nodeKey: this.getKey(), width } }));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    });
    wrapper.appendChild(handle);
    return wrapper;
  }

  updateDOM(_previousNode: LedgerImageNode, dom: HTMLElement) {
    const image = dom.querySelector('img');
    if (image) {
      image.src = this.__src;
      image.alt = this.__altText || 'Note image';
      if (this.__width) {
        image.width = this.__width;
        image.dataset.width = String(this.__width);
      }
    }
    dom.style.width = `${this.__width ?? DEFAULT_IMAGE_WIDTH}px`;
    return false;
  }

  exportDOM() {
    const figure = document.createElement('figure');
    figure.dataset.ledgerKind = 'image';
    const image = document.createElement('img');
    image.src = this.__src;
    image.alt = this.__altText;
    if (this.__width) {
      image.width = this.__width;
      image.dataset.width = String(this.__width);
      image.style.width = `${this.__width}px`;
      image.style.height = 'auto';
    }
    figure.appendChild(image);
    return { element: figure };
  }

  decorate(): null { return null; }
  exportJSON() { return { ...super.exportJSON(), type: 'ledger-image' as const, version: 1, src: this.__src, altText: this.__altText, width: this.__width }; }
}

export function $createLedgerImageNode({ src, altText = '', width = null }: { src: string; altText?: string; width?: number | null }) {
  return $applyNodeReplacement(new LedgerImageNode(src, altText, width));
}

export function $isLedgerImageNode(node: LexicalNode | null | undefined): node is LedgerImageNode {
  return node instanceof LedgerImageNode;
}
