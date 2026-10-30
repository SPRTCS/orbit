export type Inline =
  | { type: "text"; text: string; bold?: boolean; italic?: boolean; strike?: boolean }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] };

export type ListItem = { children: Block[]; checked?: boolean | null };

export type Block =
  | { type: "heading"; level: number; inline: Inline[] }
  | { type: "paragraph"; inline: Inline[] }
  | { type: "code"; lang: string; text: string; open: boolean }
  | { type: "quote"; children: Block[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] }
  | { type: "rule" };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const indentOf = (s: string) => s.replace(/\t/g, "    ").length;

export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replace(/\r\n?/g, "\n").split("\n"));
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && s[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (c === "`") {
      code = !code;
      cell += c;
    } else if (c === "|" && !code) {
      cells.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "paragraph", inline: parseInline(para.join("\n").trim()) });
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1]!;
      const body: string[] = [];
      i++;
      let open = true;
      while (i < lines.length) {
        const l = lines[i]!;
        if (l.trim().startsWith(marker[0]!.repeat(marker.length)) && l.trim().replace(new RegExp(`^\\${marker[0]}+`), "").trim() === "") {
          open = false;
          i++;
          break;
        }
        body.push(l);
        i++;
      }
      blocks.push({ type: "code", lang: fence[2] ?? "", text: body.join("\n"), open });
      continue;
    }
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1]!.length, inline: parseInline(heading[2]!) });
      i++;
      continue;
    }
    if (RULE.test(line) && !(para.length && /^ {0,3}-+\s*$/.test(line))) {
      flush();
      blocks.push({ type: "rule" });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const inner: string[] = [];
      while (i < lines.length && lines[i]!.trim() && QUOTE.test(lines[i]!)) {
        inner.push(QUOTE.exec(lines[i]!)![1]!);
        i++;
      }
      blocks.push({ type: "quote", children: parseBlocks(inner) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!) && lines[i + 1]!.includes("-")) {
      flush();
      const header = splitRow(line).map((cell) => parseInline(cell));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|")) {
        rows.push(splitRow(lines[i]!).map((cell) => parseInline(cell)));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const item = ITEM.exec(line);
    if (item && (!para.length || indentOf(item[1]!) === 0)) {
      flush();
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return blocks;
}

function parseList(lines: string[], from: number): [Block & { type: "list" }, number] {
  const first = ITEM.exec(lines[from]!)!;
  const baseIndent = indentOf(first[1]!);
  const ordered = /\d/.test(first[2]!);
  const start = ordered ? parseInt(first[2]!, 10) : 1;
  const items: ListItem[] = [];
  let i = from;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]!);
    if (!m || indentOf(m[1]!) !== baseIndent || /\d/.test(m[2]!) !== ordered) break;
    const contentIndent = indentOf(m[1]!) + m[2]!.length + 1;
    let text = m[3]!;
    let checked: boolean | null = null;
    const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
    if (task) {
      checked = task[1] !== " ";
      text = task[2]!;
    }
    const body: string[] = [text];
    i++;
    let blank = false;
    while (i < lines.length) {
      const l = lines[i]!;
      if (!l.trim()) {
        blank = true;
        body.push("");
        i++;
        continue;
      }
      const indent = indentOf(/^\s*/.exec(l)![0]);
      const sibling = ITEM.exec(l);
      if (sibling && indentOf(sibling[1]!) <= baseIndent) break;
      if (indent < baseIndent + 2) {
        if (blank || FENCE.test(l) || HEADING.test(l) || QUOTE.test(l)) break;
        body.push(l.trim());
        i++;
        continue;
      }
      body.push(l.replace(/\t/g, "    ").slice(Math.min(indent, contentIndent)));
      blank = false;
      i++;
    }
    while (body.length && !body[body.length - 1]!.trim()) body.pop();
    items.push({ children: parseBlocks(body), checked });
    if (blank && i < lines.length) {
      const next = ITEM.exec(lines[i]!);
      if (!next || indentOf(next[1]!) !== baseIndent) break;
    }
  }
  return [{ type: "list", ordered, start, items }, i];
}

type Style = { bold?: boolean; italic?: boolean; strike?: boolean };

const URL_RE = /^(https?:\/\/[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)*)/;

export function safeHref(href: string): string | null {
  const h = href.trim().replace(/^<|>$/g, "");
  return /^(https?:|mailto:)/i.test(h) ? h : null;
}

export function parseInline(text: string, style: Style = {}): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const push = (node: Inline) => {
    if (buf) out.push({ type: "text", text: buf, ...style });
    buf = "";
    out.push(node);
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const rest = text.slice(i);
    if (c === "\\" && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!|~<>]/.test(text[i + 1]!)) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      const ticks = /^`+/.exec(rest)![0];
      const end = text.indexOf(ticks, i + ticks.length);
      if (end > 0) {
        push({ type: "code", text: text.slice(i + ticks.length, end).replace(/^ (.*) $/, "$1") });
        i = end + ticks.length;
        continue;
      }
    }
    if (c === "[") {
      const link = /^\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*(<[^>]*>|(?:[^\s()]+|\([^\s()]*\))+)(?:\s+"[^"]*")?\s*\)/.exec(rest);
      if (link) {
        const href = safeHref(link[2]!);
        const children = parseInline(link[1]!, style);
        if (href) push({ type: "link", href, children });
        else {
          if (buf) out.push({ type: "text", text: buf, ...style });
          buf = "";
          out.push(...children);
        }
        i += link[0].length;
        continue;
      }
    }
    if (c === "<") {
      const auto = /^<(https?:\/\/[^>\s]+)>/.exec(rest);
      if (auto) {
        push({ type: "link", href: auto[1]!, children: [{ type: "text", text: auto[1]!, ...style }] });
        i += auto[0].length;
        continue;
      }
    }
    if ((c === "h" || c === "H") && (i === 0 || /[\s(]/.test(text[i - 1]!))) {
      const url = URL_RE.exec(rest);
      if (url) {
        const href = url[1]!.replace(/[.,;:!?'"]+$/, "");
        push({ type: "link", href, children: [{ type: "text", text: href, ...style }] });
        i += href.length;
        continue;
      }
    }
    if (c === "~" && rest.startsWith("~~")) {
      const end = text.indexOf("~~", i + 2);
      if (end > i + 2) {
        if (buf) out.push({ type: "text", text: buf, ...style });
        buf = "";
        out.push(...parseInline(text.slice(i + 2, end), { ...style, strike: true }));
        i = end + 2;
        continue;
      }
    }
    if (c === "*" || c === "_") {
      const run = /^(\*{1,3}|_{1,3})/.exec(rest)![1]!;
      const intraword = c === "_" && i > 0 && /\w/.test(text[i - 1]!);
      const next = text[i + run.length];
      if (!intraword && next && !/\s/.test(next)) {
        const close = findClose(text, i + run.length, run);
        if (close > 0) {
          if (buf) out.push({ type: "text", text: buf, ...style });
          buf = "";
          const inner = text.slice(i + run.length, close);
          const n = run.length;
          out.push(...parseInline(inner, { ...style, ...(n !== 1 ? { bold: true } : {}), ...(n !== 2 ? { italic: true } : {}) }));
          i = close + n;
          continue;
        }
      }
    }
    buf += c;
    i++;
  }
  if (buf) out.push({ type: "text", text: buf, ...style });
  return merge(out);
}

function findClose(text: string, from: number, run: string): number {
  let i = from;
  while (i < text.length) {
    const at = text.indexOf(run, i);
    if (at < 0) return -1;
    const before = text[at - 1];
    const after = text[at + run.length];
    if (before && !/\s/.test(before) && after !== run[0] && !(run[0] === "_" && after && /\w/.test(after))) return at;
    i = at + 1;
  }
  return -1;
}

function merge(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === "text" && last?.type === "text" && !!last.bold === !!n.bold && !!last.italic === !!n.italic && !!last.strike === !!n.strike) {
      out[out.length - 1] = { ...last, text: last.text + n.text };
    } else out.push(n);
  }
  return out;
}

export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.type === "link" ? inlineText(n.children) : n.text)).join("");
}
