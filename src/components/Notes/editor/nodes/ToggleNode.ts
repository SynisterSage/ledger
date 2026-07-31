import {
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  ElementNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  $applyNodeReplacement,
} from 'lexical';

export type SerializedToggleNode = SerializedElementNode & {
  type: 'ledger-toggle';
  version: 1;
  open: boolean;
};

const convertToggleElement = (domNode: Node): DOMConversionOutput | null => {
  if (!(domNode instanceof HTMLElement)) return null;
  return {
    node: $createToggleNode(domNode.getAttribute('open') !== 'false'),
  };
};

export class ToggleNode extends ElementNode {
  __open: boolean;

  static getType(): string {
    return 'ledger-toggle';
  }

  static clone(node: ToggleNode): ToggleNode {
    return new ToggleNode(node.__open, node.__key);
  }

  static importJSON(serializedNode: SerializedToggleNode): ToggleNode {
    return $createToggleNode(serializedNode.open);
  }

  static importDOM(): DOMConversionMap | null {
    return {
      details: () => ({ conversion: convertToggleElement, priority: 4 }),
      div: (domNode) =>
        domNode.hasAttribute('data-ledger-toggle')
          ? { conversion: convertToggleElement, priority: 4 }
          : null,
    };
  }

  constructor(open = true, key?: NodeKey) {
    super(key);
    this.__open = open;
  }

  isOpen(): boolean {
    return this.getLatest().__open;
  }

  setOpen(open: boolean): this {
    const writable = this.getWritable();
    writable.__open = open;
    return writable;
  }

  toggleOpen(): this {
    return this.setOpen(!this.isOpen());
  }

  exportJSON(): SerializedToggleNode {
    return {
      ...super.exportJSON(),
      type: 'ledger-toggle',
      version: 1,
      open: this.isOpen(),
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('div');
    element.dataset.ledgerToggle = 'true';
    element.dataset.toggleNodeKey = this.getKey();
    element.dataset.toggleOpen = String(this.__open);
    element.className = 'ledger-toggle';
    return element;
  }

  updateDOM(prevNode: ToggleNode, dom: HTMLElement): boolean {
    if (prevNode.__open !== this.__open) {
      dom.dataset.toggleOpen = String(this.__open);
    }
    dom.dataset.toggleNodeKey = this.getKey();
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('details');
    element.setAttribute('data-ledger-toggle', 'true');
    if (this.isOpen()) element.setAttribute('open', '');
    return { element };
  }
}

export function $createToggleNode(open = true): ToggleNode {
  return $applyNodeReplacement(new ToggleNode(open));
}

export function $isToggleNode(node: LexicalNode | null | undefined): node is ToggleNode {
  return node instanceof ToggleNode;
}
