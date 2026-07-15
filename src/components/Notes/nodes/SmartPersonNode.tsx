import type {
  DOMConversionOutput,
  DOMConversionMap,
  DOMExportOutput,
  EditorConfig,
  LexicalEditor,
  NodeKey,
  SerializedTextNode,
} from 'lexical';
import { $applyNodeReplacement, TextNode } from 'lexical';

export type SmartPersonNodeState = 'detected' | 'linked' | 'dismissed';

export type SerializedSmartPersonNode = SerializedTextNode & {
  type: 'ledger-smart-person';
  version: 1;
  personUserId: string;
  sourceKey: string;
  smartPersonState: SmartPersonNodeState;
};

const STATE_CLASS_NAMES: Record<SmartPersonNodeState, string> = {
  detected:
    'underline decoration-solid decoration-1 decoration-[color:var(--ledger-text-muted)] underline-offset-[0.2em]',
  linked:
    'underline decoration-solid decoration-2 decoration-[color:var(--ledger-accent)] underline-offset-[0.2em]',
  dismissed: 'no-underline',
};

const STATE_ARIA_PREFIX: Record<SmartPersonNodeState, string> = {
  detected: 'Person detected',
  linked: 'Linked person',
  dismissed: 'Dismissed person reference',
};

type SmartPersonElement = HTMLElement & {
  dataset: DOMStringMap & {
    ledgerSmartPerson?: string;
    ledgerSmartPersonUserId?: string;
    ledgerSmartPersonKey?: string;
    ledgerSmartPersonState?: string;
  };
};

const convertSmartPersonElement = (domNode: Node): DOMConversionOutput | null => {
  if (!(domNode instanceof HTMLElement)) return null;
  const element = domNode as SmartPersonElement;
  if (element.dataset.ledgerSmartPerson !== 'true') return null;
  return {
    node: $createSmartPersonNode(
      element.textContent ?? '',
      element.dataset.ledgerSmartPersonUserId ?? '',
      element.dataset.ledgerSmartPersonKey ?? '',
      (element.dataset.ledgerSmartPersonState as SmartPersonNodeState) ?? 'detected'
    ),
  };
};

export class SmartPersonNode extends TextNode {
  __personUserId: string;
  __sourceKey: string;
  __smartPersonState: SmartPersonNodeState;

  static getType(): string {
    return 'ledger-smart-person';
  }

  static clone(node: SmartPersonNode): SmartPersonNode {
    return new SmartPersonNode(
      node.__text,
      node.__personUserId,
      node.__sourceKey,
      node.__smartPersonState,
      node.__key
    );
  }

  static importJSON(serializedNode: SerializedSmartPersonNode): SmartPersonNode {
    return $createSmartPersonNode(
      serializedNode.text,
      serializedNode.personUserId,
      serializedNode.sourceKey,
      serializedNode.smartPersonState
    );
  }

  static importDOM(): DOMConversionMap {
    return {
      span: () => ({ conversion: convertSmartPersonElement, priority: 4 }),
    };
  }

  constructor(
    text: string,
    personUserId: string,
    sourceKey: string,
    state: SmartPersonNodeState = 'detected',
    key?: NodeKey
  ) {
    super(text, key);
    this.__personUserId = personUserId;
    this.__sourceKey = sourceKey;
    this.__smartPersonState = state;
  }

  getPersonUserId(): string {
    return this.getLatest().__personUserId;
  }

  setPersonUserId(personUserId: string): this {
    const writable = this.getWritable();
    writable.__personUserId = personUserId;
    return writable;
  }

  getSourceKey(): string {
    return this.getLatest().__sourceKey;
  }

  getSmartPersonState(): SmartPersonNodeState {
    return this.getLatest().__smartPersonState;
  }

  setSmartPersonState(state: SmartPersonNodeState): this {
    const writable = this.getWritable();
    writable.__smartPersonState = state;
    return writable;
  }

  private applyDOMState(dom: HTMLElement): void {
    const state = this.getSmartPersonState();
    dom.dataset.ledgerSmartPerson = 'true';
    dom.dataset.ledgerSmartPersonUserId = this.getPersonUserId();
    dom.dataset.ledgerSmartPersonKey = this.getSourceKey();
    dom.dataset.ledgerSmartPersonState = state;
    dom.classList.add(...STATE_CLASS_NAMES[state].split(' '));
    dom.setAttribute('aria-label', `${STATE_ARIA_PREFIX[state]}: ${this.getTextContent().trim()}`);
  }

  createDOM(config: EditorConfig, editor?: LexicalEditor): HTMLElement {
    const dom = super.createDOM(config, editor);
    dom.classList.add('ledger-smart-person', 'cursor-pointer', 'select-auto', 'focus-visible:outline-none');
    dom.setAttribute('role', 'button');
    dom.setAttribute('tabindex', '0');
    this.applyDOMState(dom);
    return dom;
  }

  updateDOM(prevNode: SmartPersonNode, dom: HTMLElement, config: EditorConfig): boolean {
    const updated = super.updateDOM(prevNode as unknown as this, dom, config);
    if (prevNode.__smartPersonState !== this.__smartPersonState) {
      dom.classList.remove(...Object.values(STATE_CLASS_NAMES).flatMap((value) => value.split(' ')));
      this.applyDOMState(dom);
    }
    return updated;
  }

  exportJSON(): SerializedSmartPersonNode {
    return {
      ...super.exportJSON(),
      type: 'ledger-smart-person',
      version: 1,
      personUserId: this.__personUserId,
      sourceKey: this.__sourceKey,
      smartPersonState: this.__smartPersonState,
    };
  }

  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const { element } = super.exportDOM(editor);
    if (element instanceof HTMLElement) {
      element.classList.add('ledger-smart-person', 'cursor-pointer', 'select-auto');
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
      this.applyDOMState(element);
      element.removeAttribute('data-ledger-smart-person-user-id');
    }
    return { element };
  }
}

export const $createSmartPersonNode = (
  text: string,
  personUserId: string,
  sourceKey: string,
  state: SmartPersonNodeState = 'detected'
) => $applyNodeReplacement(new SmartPersonNode(text, personUserId, sourceKey, state));

export const $isSmartPersonNode = (
  node: unknown
): node is SmartPersonNode => node instanceof SmartPersonNode;
