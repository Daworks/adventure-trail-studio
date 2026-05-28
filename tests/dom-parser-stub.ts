export function installDomParserStub(): void {
  class TestNode {
    children: TestNode[] = [];
    documentElement?: TestNode;
    parent?: TestNode;
    textContent = "";

    constructor(
      public tagName: string,
      private attributes: Record<string, string> = {},
    ) {}

    get localName(): string {
      return this.tagName.split(":").at(-1) || this.tagName;
    }

    getAttribute(name: string): string | null {
      return this.attributes[name] ?? null;
    }

    querySelector(selector: string): TestNode | null {
      return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector: string): TestNode[] {
      const parts = selector.trim().split(/\s+/);
      return selectDescendants([this], parts);
    }
  }

  class TestDomParser {
    parseFromString(xml: string): TestNode {
      return parseXml(xml);
    }
  }

  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    value: TestDomParser,
  });

  function parseXml(xml: string): TestNode {
    const root = new TestNode("document");
    const stack = [root];
    const tokenPattern = /<([^>]+)>|([^<]+)/g;
    let match: RegExpExecArray | null;
    while ((match = tokenPattern.exec(xml))) {
      const [, rawTag, rawText] = match;
      if (rawText) {
        stack.at(-1)!.textContent += decodeXml(rawText);
        continue;
      }
      const tag = rawTag.trim();
      if (!tag || tag.startsWith("?") || tag.startsWith("!")) continue;
      if (tag.startsWith("/")) {
        stack.pop();
        continue;
      }
      const selfClosing = tag.endsWith("/");
      const source = selfClosing ? tag.slice(0, -1).trim() : tag;
      const [name = "", ...rest] = source.split(/\s+/);
      const node = new TestNode(name, attributesFrom(rest.join(" ")));
      const parent = stack.at(-1)!;
      node.parent = parent;
      parent.children.push(node);
      if (!selfClosing) stack.push(node);
    }
    root.documentElement = root.children[0];
    return root;
  }

  function attributesFrom(source: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (const match of source.matchAll(/([^\s=]+)="([^"]*)"/g)) {
      attributes[match[1]] = decodeXml(match[2]);
    }
    return attributes;
  }

  function selectDescendants(nodes: TestNode[], parts: string[]): TestNode[] {
    let current = nodes;
    for (const part of parts) {
      current = current.flatMap((node) => descendants(node).filter((child) => child.tagName === part));
    }
    return current;
  }

  function descendants(node: TestNode): TestNode[] {
    return node.children.flatMap((child) => [child, ...descendants(child)]);
  }

  function decodeXml(value: string): string {
    return value
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&apos;", "'");
  }
}
