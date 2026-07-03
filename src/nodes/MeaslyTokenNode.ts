import { TextNode, NodeKey, EditorConfig, SerializedTextNode } from 'lexical';

type TokenData = Record<string, string>;

type SerializedMeaslyTokenNode = SerializedTextNode & {
  tokenType: string;
  tokenClasses?: string[];
  tokenData?: TokenData;
};

const sanitizeDataKey = (key: string) => key.replace(/[^a-zA-Z0-9_\-]/g, '');

const resolveTokenClassList = (tokenType: string, tokenClasses: string[]) => {
  if (tokenClasses.length > 0) {
    return tokenClasses;
  }
  return [`measly-token-${tokenType}`];
};

export class MeaslyTokenNode extends TextNode {
  __tokenType: string;
  __tokenClasses: string[];
  __tokenData: TokenData;

  constructor(
    text: string,
    tokenType: string,
    tokenClasses: string[] = [],
    tokenData: TokenData = {},
    key?: NodeKey,
  ) {
    super(text, key);
    this.__tokenType = tokenType;
    this.__tokenClasses = tokenClasses;
    this.__tokenData = tokenData;
  }

  static getType(): string {
    return 'measly-token';
  }

  static clone(node: MeaslyTokenNode): MeaslyTokenNode {
    return new MeaslyTokenNode(
      node.__text,
      node.__tokenType,
      [...node.__tokenClasses],
      { ...node.__tokenData },
      node.__key,
    );
  }

  // Keep this custom node editable like normal text.
  isSimpleText(): boolean {
    return true;
  }

  isTextEntity(): boolean {
    return false;
  }

  canInsertTextBefore(): boolean {
    return true;
  }

  canInsertTextAfter(): boolean {
    return true;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    const classList = resolveTokenClassList(this.__tokenType, this.__tokenClasses);
    for (const cls of classList) {
      dom.classList.add(cls);
    }
    dom.setAttribute('data-token-type', this.__tokenType);
    for (const [key, value] of Object.entries(this.__tokenData)) {
      const safeKey = sanitizeDataKey(key);
      if (safeKey.length === 0) continue;
      dom.setAttribute(`data-${safeKey}`, String(value));
    }
    return dom;
  }

  updateDOM(
    prevNode: this,
    dom: HTMLElement,
    config: EditorConfig,
  ): boolean {
    const isUpdated = super.updateDOM(prevNode, dom, config);
    if (
      prevNode.__tokenType !== this.__tokenType
      || prevNode.__tokenClasses.join(' ') !== this.__tokenClasses.join(' ')
      || JSON.stringify(prevNode.__tokenData) !== JSON.stringify(this.__tokenData)
    ) {
      const previousClassList = resolveTokenClassList(prevNode.__tokenType, prevNode.__tokenClasses);
      for (const cls of previousClassList) {
        dom.classList.remove(cls);
      }

      const nextClassList = resolveTokenClassList(this.__tokenType, this.__tokenClasses);
      for (const cls of nextClassList) {
        dom.classList.add(cls);
      }

      dom.setAttribute('data-token-type', this.__tokenType);
      Array.from(dom.attributes)
        .map((attribute) => attribute.name)
        .filter((name) => name.startsWith('data-') && name !== 'data-token-type')
        .forEach((name) => dom.removeAttribute(name));
      for (const [key, value] of Object.entries(this.__tokenData)) {
        const safeKey = sanitizeDataKey(key);
        if (safeKey.length === 0) continue;
        dom.setAttribute(`data-${safeKey}`, String(value));
      }
      return true;
    }
    return isUpdated;
  }

  setTokenPresentation(tokenType: string, tokenClasses: string[] = [], tokenData: TokenData = {}): void {
    const writable = this.getWritable();
    writable.__tokenType = tokenType;
    writable.__tokenClasses = tokenClasses;
    writable.__tokenData = tokenData;
  }

  static importJSON(serializedNode: SerializedMeaslyTokenNode): MeaslyTokenNode {
    const node = $createMeaslyTokenNode(
      serializedNode.text,
      serializedNode.tokenType,
      serializedNode.tokenClasses,
      serializedNode.tokenData,
    );
    node.setFormat(serializedNode.format);
    node.setDetail(serializedNode.detail);
    node.setMode(serializedNode.mode);
    node.setStyle(serializedNode.style);
    return node;
  }

  exportJSON(): SerializedMeaslyTokenNode {
    return {
      ...super.exportJSON(),
      type: 'measly-token',
      tokenType: this.__tokenType,
      tokenClasses: [...this.__tokenClasses],
      tokenData: { ...this.__tokenData },
      version: 1,
    };
  }
}

export function $createMeaslyTokenNode(
  text: string,
  tokenType: string,
  tokenClasses: string[] = [],
  tokenData: TokenData = {},
): MeaslyTokenNode {
  return new MeaslyTokenNode(text, tokenType, tokenClasses, tokenData);
}

export function $isMeaslyTokenNode(node: unknown): node is MeaslyTokenNode {
  return node instanceof MeaslyTokenNode;
}
