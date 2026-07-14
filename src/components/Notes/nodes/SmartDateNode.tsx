import {
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  $applyNodeReplacement,
  type EditorConfig,
  type LexicalEditor,
  TextNode,
  type NodeKey,
  type SerializedTextNode,
} from 'lexical';

export type SmartDateNodeState = 'detected' | 'linked-event' | 'linked-reminder' | 'dismissed';

export type SerializedSmartDateNode = SerializedTextNode & {
  type: 'ledger-smart-date';
  version: 1;
  smartDateKey: string;
  smartDateState: SmartDateNodeState;
};

type ConvertableSmartDateElement = HTMLElement & {
  dataset: DOMStringMap & {
    ledgerSmartDate?: string;
    ledgerSmartDateKey?: string;
    ledgerSmartDateState?: SmartDateNodeState;
  };
};

const STATE_CLASS_NAMES: Record<SmartDateNodeState, string> = {
  detected:
    'underline decoration-solid decoration-1 decoration-[color:var(--ledger-accent)] underline-offset-[0.16em]',
  'linked-event':
    'underline decoration-solid decoration-[color:var(--ledger-accent)] underline-offset-[0.16em] decoration-2',
  'linked-reminder':
    'underline decoration-solid decoration-[color:var(--ledger-accent-hover)] underline-offset-[0.16em] decoration-2',
  dismissed: 'no-underline',
};

const STATE_ARIA_PREFIX: Record<SmartDateNodeState, string> = {
  detected: 'Date detected',
  'linked-event': 'Linked date event',
  'linked-reminder': 'Linked date reminder',
  dismissed: 'Dismissed date phrase',
};

function convertSmartDateElement(domNode: Node): DOMConversionOutput | null {
  if (!(domNode instanceof HTMLElement)) return null;
  const element = domNode as ConvertableSmartDateElement;
  if (element.dataset.ledgerSmartDate !== 'true') return null;
  const text = element.textContent ?? '';
  const smartDateKey = element.dataset.ledgerSmartDateKey ?? '';
  const smartDateState = element.dataset.ledgerSmartDateState ?? 'detected';
  return {
    node: $createSmartDateNode(text, smartDateKey, smartDateState),
  };
}

export class SmartDateNode extends TextNode {
  __smartDateKey: string;
  __smartDateState: SmartDateNodeState;

  static getType(): string {
    return 'ledger-smart-date';
  }

  static clone(node: SmartDateNode): SmartDateNode {
    return new SmartDateNode(node.__text, node.__smartDateKey, node.__smartDateState, node.__key);
  }

  static importJSON(serializedNode: SerializedSmartDateNode): SmartDateNode {
    return $createSmartDateNode(
      serializedNode.text,
      serializedNode.smartDateKey,
      serializedNode.smartDateState
    );
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: () => ({
        conversion: convertSmartDateElement,
        priority: 2,
      }),
    };
  }

  constructor(
    text: string,
    smartDateKey: string,
    smartDateState: SmartDateNodeState = 'detected',
    key?: NodeKey
  ) {
    super(text, key);
    this.__smartDateKey = smartDateKey;
    this.__smartDateState = smartDateState;
  }

  getSmartDateKey(): string {
    return this.getLatest().__smartDateKey;
  }

  getSmartDateState(): SmartDateNodeState {
    return this.getLatest().__smartDateState;
  }

  setSmartDateState(state: SmartDateNodeState): this {
    const writable = this.getWritable();
    writable.__smartDateState = state;
    return writable;
  }

  createDOM(config: EditorConfig, editor?: LexicalEditor): HTMLElement {
    const dom = super.createDOM(config, editor);
    const state = this.getSmartDateState();
    dom.dataset.ledgerSmartDate = 'true';
    dom.dataset.ledgerSmartDateKey = this.getSmartDateKey();
    dom.dataset.ledgerSmartDateState = state;
    dom.classList.add(
      'ledger-smart-date',
      'cursor-pointer',
      'select-auto',
      'focus-visible:outline-none'
    );
    dom.classList.add(...STATE_CLASS_NAMES[state].split(' '));
    dom.setAttribute('role', 'button');
    dom.setAttribute('tabindex', '0');
    dom.setAttribute(
      'aria-label',
      `${STATE_ARIA_PREFIX[state]}: ${this.getTextContent().trim() || 'date phrase'}`
    );
    return dom;
  }

  updateDOM(prevNode: SmartDateNode, dom: HTMLElement, config: EditorConfig): boolean {
    const updated = super.updateDOM(prevNode as unknown as this, dom, config);
    if (prevNode.__smartDateState !== this.__smartDateState) {
      dom.dataset.ledgerSmartDateState = this.__smartDateState;
      dom.classList.remove(...Object.values(STATE_CLASS_NAMES).flatMap((value) => value.split(' ')));
      dom.classList.add(...STATE_CLASS_NAMES[this.__smartDateState].split(' '));
      dom.setAttribute(
        'aria-label',
        `${STATE_ARIA_PREFIX[this.__smartDateState]}: ${this.getTextContent().trim() || 'date phrase'}`
      );
    }
    if (prevNode.__smartDateKey !== this.__smartDateKey) {
      dom.dataset.ledgerSmartDateKey = this.__smartDateKey;
    }
    return updated;
  }

  exportJSON(): SerializedSmartDateNode {
    return {
      ...super.exportJSON(),
      type: 'ledger-smart-date',
      version: 1,
      smartDateKey: this.__smartDateKey,
      smartDateState: this.__smartDateState,
    };
  }

  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const { element } = super.exportDOM(editor);
    if (element instanceof HTMLElement) {
      const state = this.getSmartDateState();
      element.dataset.ledgerSmartDate = 'true';
      element.dataset.ledgerSmartDateKey = this.getSmartDateKey();
      element.dataset.ledgerSmartDateState = state;
      element.classList.add(
        'ledger-smart-date',
        'cursor-pointer',
        'select-auto'
      );
      element.classList.add(...STATE_CLASS_NAMES[state].split(' '));
      element.setAttribute(
        'aria-label',
        `${STATE_ARIA_PREFIX[state]}: ${this.getTextContent().trim() || 'date phrase'}`
      );
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
    }
    return { element };
  }

  isTextEntity(): true {
    return true;
  }

  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }
}

export const $createSmartDateNode = (
  text: string,
  smartDateKey: string,
  smartDateState: SmartDateNodeState = 'detected'
) => $applyNodeReplacement(new SmartDateNode(text, smartDateKey, smartDateState));

export const $isSmartDateNode = (node: SmartDateNode | null | undefined): node is SmartDateNode =>
  node instanceof SmartDateNode;
