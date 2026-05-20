import { TextNode, NodeKey, EditorConfig, SerializedTextNode } from 'lexical';

export class MeaslyTokenNode extends TextNode {
  __tokenType: string;

  constructor(text: string, tokenType: string, key?: NodeKey) {
    super(text, key);
    this.__tokenType = tokenType;
  }

  static getType(): string {
    return 'measly-token';
  }

  static clone(node: MeaslyTokenNode): MeaslyTokenNode {
    return new MeaslyTokenNode(node.__text, node.__tokenType, node.__key);
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    // Add our custom class based on the token type (e.g. 'token-heading', 'token-keyword')
    dom.className = `measly-token-${this.__tokenType}`;
    return dom;
  }

  updateDOM(
    prevNode: this,
    dom: HTMLElement,
    config: EditorConfig,
  ): boolean {
    const isUpdated = super.updateDOM(prevNode, dom, config);
    if (prevNode.__tokenType !== this.__tokenType) {
      dom.className = `measly-token-${this.__tokenType}`;
      return true;
    }
    return isUpdated;
  }

  static importJSON(serializedNode: SerializedTextNode & { tokenType: string }): MeaslyTokenNode {
    const node = $createMeaslyTokenNode(serializedNode.text, serializedNode.tokenType);
    node.setFormat(serializedNode.format);
    node.setDetail(serializedNode.detail);
    node.setMode(serializedNode.mode);
    node.setStyle(serializedNode.style);
    return node;
  }

  exportJSON(): SerializedTextNode & { tokenType: string } {
    return {
      ...super.exportJSON(),
      type: 'measly-token',
      tokenType: this.__tokenType,
      version: 1,
    };
  }
}

export function $createMeaslyTokenNode(text: string, tokenType: string): MeaslyTokenNode {
  return new MeaslyTokenNode(text, tokenType);
}

export function $isMeaslyTokenNode(node: any): node is MeaslyTokenNode {
  return node instanceof MeaslyTokenNode;
}
