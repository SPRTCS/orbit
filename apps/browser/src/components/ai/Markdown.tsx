import { copyText } from "@ardia/shell";
import { memo, useMemo, type ReactNode } from "react";
import { Text, View, type TextStyle } from "react-native";
import { parseMarkdown, type Block, type Inline } from "../../lib/ai/markdown";
import { useTheme } from "../../lib/theme";
import { IconButton } from "../primitives";

const MONO = "Menlo";
const BODY = 13.5;
const LINE = 20;

type Ctx = { onLink: (href: string) => void; color: string; muted: string; link: string; codeBg: string; border: string };

function inlineNodes(nodes: Inline[], ctx: Ctx, key = ""): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    if (n.type === "code") {
      return (
        <Text key={k} style={{ fontFamily: MONO, fontSize: BODY - 1.5, backgroundColor: ctx.codeBg }}>
          {` ${n.text} `}
        </Text>
      );
    }
    if (n.type === "link") {
      return (
        <Text key={k} style={{ color: ctx.link }} onPress={() => ctx.onLink(n.href)}>
          {inlineNodes(n.children, ctx, `${k}.`)}
        </Text>
      );
    }
    const style: TextStyle = {};
    if (n.bold) style.fontWeight = "600";
    if (n.italic) style.fontStyle = "italic";
    if (n.strike) style.textDecorationLine = "line-through";
    return n.bold || n.italic || n.strike ? (
      <Text key={k} style={style}>
        {n.text}
      </Text>
    ) : (
      n.text
    );
  });
}

function CodeBlock({ block, ctx }: { block: Extract<Block, { type: "code" }>; ctx: Ctx }) {
  return (
    <View style={{ borderRadius: 8, backgroundColor: ctx.codeBg, borderWidth: 0.5, borderColor: ctx.border, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", height: 26, paddingLeft: 10, paddingRight: 2 }}>
        <Text style={{ flex: 1, fontSize: 11, color: ctx.muted }}>{block.lang || "code"}</Text>
        <IconButton icon="doc.on.doc" size={11} box={22} radius={5} tooltip="Copy Code" onPress={() => copyText(block.text)} />
      </View>
      <Text selectable style={{ fontFamily: MONO, fontSize: 12, lineHeight: 17, color: ctx.color, paddingHorizontal: 10, paddingBottom: 9 }}>
        {block.text}
      </Text>
    </View>
  );
}

function Blocks({ blocks, ctx, depth = 0 }: { blocks: Block[]; ctx: Ctx; depth?: number }) {
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} ctx={ctx} depth={depth} />
      ))}
    </View>
  );
}

const HEADING_SIZE = [0, 18, 16, 14.5, 13.5, 13.5, 13.5];

function BlockView({ block, ctx, depth }: { block: Block; ctx: Ctx; depth: number }) {
  switch (block.type) {
    case "heading":
      return (
        <Text selectable style={{ fontSize: HEADING_SIZE[block.level], lineHeight: HEADING_SIZE[block.level]! + 6, fontWeight: "600", color: ctx.color, marginTop: depth ? 0 : 4 }}>
          {inlineNodes(block.inline, ctx)}
        </Text>
      );
    case "paragraph":
      return (
        <Text selectable style={{ fontSize: BODY, lineHeight: LINE, color: ctx.color }}>
          {inlineNodes(block.inline, ctx)}
        </Text>
      );
    case "code":
      return <CodeBlock block={block} ctx={ctx} />;
    case "quote":
      return (
        <View style={{ flexDirection: "row" }}>
          <View style={{ width: 3, borderRadius: 1.5, backgroundColor: ctx.border, marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <Blocks blocks={block.children} ctx={{ ...ctx, color: ctx.muted }} depth={depth + 1} />
          </View>
        </View>
      );
    case "rule":
      return <View style={{ height: 1, backgroundColor: ctx.border, marginVertical: 4 }} />;
    case "list":
      return (
        <View style={{ gap: 4 }}>
          {block.items.map((item, i) => (
            <View key={i} style={{ flexDirection: "row" }}>
              <Text style={{ width: block.ordered ? 22 : 16, fontSize: BODY, lineHeight: LINE, color: ctx.muted, textAlign: block.ordered ? "right" : "center", marginRight: 6 }}>
                {item.checked != null ? (item.checked ? "☑" : "☐") : block.ordered ? `${block.start + i}.` : depth % 2 ? "◦" : "•"}
              </Text>
              <View style={{ flex: 1 }}>
                <Blocks blocks={item.children} ctx={ctx} depth={depth + 1} />
              </View>
            </View>
          ))}
        </View>
      );
    case "table":
      return (
        <View style={{ borderRadius: 6, borderWidth: 0.5, borderColor: ctx.border, overflow: "hidden" }}>
          {[block.header, ...block.rows].map((row, r) => (
            <View key={r} style={{ flexDirection: "row", backgroundColor: r === 0 ? ctx.codeBg : undefined, borderTopWidth: r ? 0.5 : 0, borderTopColor: ctx.border }}>
              {block.header.map((_, c) => (
                <Text key={c} selectable style={{ flex: 1, fontSize: 12.5, lineHeight: 17, padding: 6, color: ctx.color, fontWeight: r === 0 ? "600" : "400" }}>
                  {inlineNodes(row[c] ?? [], ctx)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
  }
}

export const Markdown = memo(function Markdown({ text, onLink }: { text: string; onLink: (href: string) => void }) {
  const theme = useTheme();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const ctx: Ctx = {
    onLink,
    color: theme.textPrimary,
    muted: theme.textSecondary,
    link: theme.dark ? "#8AB4FF" : "#1F5FD1",
    codeBg: theme.dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.045)",
    border: theme.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)",
  };
  return <Blocks blocks={blocks} ctx={ctx} />;
});

