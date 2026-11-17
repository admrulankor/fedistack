"use client";

import { Badge, Button } from "@fedistack/ui";
import * as React from "react";
import {
  type ArticleBlockNode,
  type ArticleDocument,
  type ArticleInlineNode,
  type ArticleMark,
  createParagraphNode,
  extractInlineText,
  textToInlineNodes
} from "@/lib/article-document";

export interface ArticleEditorProps {
  value: ArticleDocument;
  onChange: (next: ArticleDocument) => void;
  disabled?: boolean;
}

type InlineMarkType = "bold" | "italic" | "strike" | "code" | "link";

function getUniformMarks(nodes: ArticleInlineNode[] | undefined): ArticleMark[] {
  if (!nodes) return [];
  const textNodes = nodes.filter(
    (node): node is Extract<ArticleInlineNode, { type: "text" }> =>
      node.type === "text"
  );
  if (textNodes.length === 0) return [];
  return textNodes[0]?.marks ?? [];
}

function hasMultipleInlineSegments(
  nodes: ArticleInlineNode[] | undefined
): boolean {
  if (!nodes) return false;
  const textNodes = nodes.filter((node) => node.type === "text");
  return textNodes.length > 1;
}

function toggleMarkInList(
  marks: ArticleMark[],
  markType: InlineMarkType,
  linkHref?: string
): ArticleMark[] {
  const exists = marks.some((m) => m.type === markType);
  if (exists && markType !== "link") {
    return marks.filter((m) => m.type !== markType);
  }
  if (markType === "link") {
    const filtered = marks.filter((m) => m.type !== "link");
    if (linkHref && linkHref.trim().length > 0) {
      return [
        ...filtered,
        {
          type: "link",
          attrs: {
            href: linkHref.trim(),
            target: "_blank",
            rel: "noopener noreferrer"
          }
        }
      ];
    }
    return exists ? filtered : [...filtered, { type: "link", attrs: { href: "https://", target: "_blank", rel: "noopener noreferrer" } }];
  }
  return [...marks, { type: markType }];
}

function renderPreviewInlineNodes(
  nodes: ArticleInlineNode[] | undefined,
  keyPrefix: string
): React.ReactNode {
  if (!nodes || nodes.length === 0) {
    return null;
  }

  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === "hardBreak") {
      return <br key={key} />;
    }

    let content: React.ReactNode = node.text;
    if (node.marks) {
      for (const mark of node.marks) {
        switch (mark.type) {
          case "bold":
            content = <strong>{content}</strong>;
            break;
          case "italic":
            content = <em>{content}</em>;
            break;
          case "strike":
            content = <s>{content}</s>;
            break;
          case "code":
            content = (
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-900">
                {content}
              </code>
            );
            break;
          case "link":
            content = (
              <a
                href={mark.attrs.href}
                target={mark.attrs.target ?? undefined}
                rel="noopener noreferrer"
                className="text-indigo-700 underline hover:text-indigo-900"
              >
                {content}
              </a>
            );
            break;
        }
      }
    }

    return <React.Fragment key={key}>{content}</React.Fragment>;
  });
}

function DocumentPreview({ document }: { document: ArticleDocument }) {
  if (document.content.length === 0) {
    return (
      <p className="text-sm italic text-slate-500">
        No content blocks yet. Add a paragraph or heading to preview your post.
      </p>
    );
  }

  return (
    <div className="space-y-4 text-slate-800">
      {document.content.map((block, index) => {
        const key = `preview-block-${index}`;
        switch (block.type) {
          case "paragraph":
            return (
              <p key={key} className="leading-7">
                {renderPreviewInlineNodes(block.content, key)}
              </p>
            );
          case "heading": {
            const inner = renderPreviewInlineNodes(block.content, key);
            if (block.attrs.level === 1) {
              return (
                <h1 key={key} className="text-3xl font-bold text-slate-900">
                  {inner}
                </h1>
              );
            }
            if (block.attrs.level === 2) {
              return (
                <h2 key={key} className="text-2xl font-bold text-slate-900">
                  {inner}
                </h2>
              );
            }
            if (block.attrs.level === 3) {
              return (
                <h3 key={key} className="text-xl font-semibold text-slate-900">
                  {inner}
                </h3>
              );
            }
            return (
              <h4 key={key} className="text-lg font-semibold text-slate-900">
                {inner}
              </h4>
            );
          }
          case "blockquote":
            return (
              <blockquote
                key={key}
                className="space-y-2 border-l-4 border-slate-300 pl-4 italic text-slate-700"
              >
                {block.content.map((p, pIdx) => (
                  <p key={`${key}-p-${pIdx}`}>
                    {renderPreviewInlineNodes(p.content, `${key}-p-${pIdx}`)}
                  </p>
                ))}
              </blockquote>
            );
          case "bulletList":
            return (
              <ul key={key} className="list-disc space-y-1 pl-6">
                {block.content.map((item, iIdx) => (
                  <li key={`${key}-li-${iIdx}`}>
                    {item.content.map((p, pIdx) => (
                      <React.Fragment key={`${key}-li-${iIdx}-p-${pIdx}`}>
                        {renderPreviewInlineNodes(
                          p.content,
                          `${key}-li-${iIdx}-p-${pIdx}`
                        )}
                      </React.Fragment>
                    ))}
                  </li>
                ))}
              </ul>
            );
          case "orderedList":
            return (
              <ol
                key={key}
                start={block.attrs?.start ?? 1}
                className="list-decimal space-y-1 pl-6"
              >
                {block.content.map((item, iIdx) => (
                  <li key={`${key}-li-${iIdx}`}>
                    {item.content.map((p, pIdx) => (
                      <React.Fragment key={`${key}-li-${iIdx}-p-${pIdx}`}>
                        {renderPreviewInlineNodes(
                          p.content,
                          `${key}-li-${iIdx}-p-${pIdx}`
                        )}
                      </React.Fragment>
                    ))}
                  </li>
                ))}
              </ol>
            );
          case "codeBlock": {
            const codeText = (block.content ?? []).map((n) => n.text).join("");
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs text-slate-100"
              >
                <code>{codeText}</code>
              </pre>
            );
          }
          case "horizontalRule":
            return <hr key={key} className="border-slate-200" />;
          case "paywallBoundary":
            return (
              <div
                key={key}
                className="my-4 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-amber-900"
              >
                Paywall Boundary — Content below is stripped for unentitled
                readers on members-only posts
              </div>
            );
        }
      })}
    </div>
  );
}

interface InlineRunEditorProps {
  nodes: ArticleInlineNode[] | undefined;
  onChange: (nextNodes: ArticleInlineNode[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

function InlineRunEditor({
  nodes,
  onChange,
  disabled = false,
  placeholder = "Write content..."
}: InlineRunEditorProps) {
  const [multiSegmentMode, setMultiSegmentMode] = React.useState(() =>
    hasMultipleInlineSegments(nodes)
  );

  const textRuns = React.useMemo(() => {
    if (!nodes || nodes.length === 0) {
      return [{ type: "text" as const, text: "" }];
    }
    const filtered = nodes.filter(
      (n): n is Extract<ArticleInlineNode, { type: "text" }> =>
        n.type === "text"
    );
    return filtered.length > 0 ? filtered : [{ type: "text" as const, text: "" }];
  }, [nodes]);

  if (!multiSegmentMode && !hasMultipleInlineSegments(nodes)) {
    const currentText = extractInlineText(nodes);
    const activeMarks = getUniformMarks(nodes);
    const linkMark = activeMarks.find((m) => m.type === "link");

    const toggleMark = (markType: InlineMarkType) => {
      const nextMarks = toggleMarkInList(activeMarks, markType);
      onChange(textToInlineNodes(currentText, nextMarks));
    };

    const updateLinkHref = (href: string) => {
      const nextMarks = toggleMarkInList(activeMarks, "link", href);
      onChange(textToInlineNodes(currentText, nextMarks));
    };

    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["bold", "italic", "strike", "code"] as const).map((markType) => {
            const active = activeMarks.some((m) => m.type === markType);
            return (
              <button
                key={markType}
                type="button"
                disabled={disabled}
                onClick={() => toggleMark(markType)}
                className={`rounded border px-2 py-0.5 text-xs font-medium capitalize transition-colors ${
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                } disabled:opacity-50`}
              >
                {markType}
              </button>
            );
          })}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (linkMark) {
                const withoutLink = activeMarks.filter(
                  (m) => m.type !== "link"
                );
                onChange(textToInlineNodes(currentText, withoutLink));
              } else {
                const nextMarks = toggleMarkInList(
                  activeMarks,
                  "link",
                  "https://example.com"
                );
                onChange(textToInlineNodes(currentText, nextMarks));
              }
            }}
            className={`rounded border px-2 py-0.5 text-xs font-medium transition-colors ${
              linkMark
                ? "border-indigo-700 bg-indigo-700 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            } disabled:opacity-50`}
          >
            Link
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMultiSegmentMode(true)}
            className="ml-auto text-xs text-slate-500 underline hover:text-slate-800 disabled:opacity-50"
          >
            Split into inline segments
          </button>
        </div>

        {linkMark ? (
          <input
            type="url"
            disabled={disabled}
            value={linkMark.attrs.href}
            onChange={(e) => updateLinkHref(e.target.value)}
            placeholder="https://example.com"
            aria-label="Link URL"
            className="block w-full rounded-md border border-indigo-300 bg-indigo-50/40 px-2.5 py-1 text-xs text-slate-900 focus:border-indigo-700 focus:outline-none"
          />
        ) : null}

        <textarea
          rows={3}
          disabled={disabled}
          value={currentText}
          placeholder={placeholder}
          onChange={(e) =>
            onChange(textToInlineNodes(e.target.value, activeMarks))
          }
          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:bg-slate-50"
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-600">
          Inline segments ({textRuns.length})
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              onChange([
                ...textRuns,
                { type: "text", text: " new segment" }
              ])
            }
            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            + Add segment
          </button>
          {textRuns.length <= 1 ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setMultiSegmentMode(false)}
              className="text-xs text-slate-500 underline hover:text-slate-800"
            >
              Simple editor
            </button>
          ) : null}
        </div>
      </div>

      {textRuns.map((run, idx) => {
        const marks = run.marks ?? [];
        const linkMark = marks.find((m) => m.type === "link");

        const updateRun = (nextRun: Extract<ArticleInlineNode, { type: "text" }>) => {
          const updated = textRuns.map((item, i) => (i === idx ? nextRun : item));
          onChange(updated);
        };

        return (
          <div
            key={`seg-${idx}`}
            className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-2"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {(["bold", "italic", "strike", "code"] as const).map(
                (markType) => {
                  const active = marks.some((m) => m.type === markType);
                  return (
                    <button
                      key={markType}
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        updateRun({
                          ...run,
                          marks: toggleMarkInList(marks, markType)
                        })
                      }
                      className={`rounded border px-2 py-0.5 text-xs capitalize ${
                        active
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-300 bg-white text-slate-700"
                      }`}
                    >
                      {markType}
                    </button>
                  );
                }
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (linkMark) {
                    updateRun({
                      ...run,
                      marks: marks.filter((m) => m.type !== "link")
                    });
                  } else {
                    updateRun({
                      ...run,
                      marks: toggleMarkInList(
                        marks,
                        "link",
                        "https://example.com"
                      )
                    });
                  }
                }}
                className={`rounded border px-2 py-0.5 text-xs ${
                  linkMark
                    ? "border-indigo-700 bg-indigo-700 text-white"
                    : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                Link
              </button>
              {textRuns.length > 1 ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onChange(textRuns.filter((_, i) => i !== idx))
                  }
                  className="ml-auto text-xs text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              ) : null}
            </div>

            {linkMark ? (
              <input
                type="url"
                disabled={disabled}
                value={linkMark.attrs.href}
                onChange={(e) =>
                  updateRun({
                    ...run,
                    marks: toggleMarkInList(marks, "link", e.target.value)
                  })
                }
                placeholder="https://example.com"
                className="block w-full rounded border border-indigo-300 bg-white px-2 py-1 text-xs"
              />
            ) : null}

            <input
              type="text"
              disabled={disabled}
              value={run.text}
              placeholder="Segment text..."
              onChange={(e) => updateRun({ ...run, text: e.target.value })}
              className="block w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
            />
          </div>
        );
      })}
    </div>
  );
}

export function ArticleEditor({
  value,
  onChange,
  disabled = false
}: ArticleEditorProps) {
  const [activeTab, setActiveTab] = React.useState<"write" | "preview">(
    "write"
  );

  const blocks = value.content;

  function updateBlocks(nextBlocks: ArticleBlockNode[]) {
    onChange({
      type: "doc",
      content: nextBlocks
    });
  }

  function updateBlockAt(index: number, nextBlock: ArticleBlockNode) {
    updateBlocks(blocks.map((b, i) => (i === index ? nextBlock : b)));
  }

  function moveBlock(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const copy = [...blocks];
    const [item] = copy.splice(index, 1);
    if (!item) return;
    copy.splice(target, 0, item);
    updateBlocks(copy);
  }

  function removeBlock(index: number) {
    updateBlocks(blocks.filter((_, i) => i !== index));
  }

  function appendBlock(block: ArticleBlockNode) {
    updateBlocks([...blocks, block]);
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("write")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === "write"
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            Structured Editor ({blocks.length} blocks)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("preview")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === "preview"
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            Live Preview
          </button>
        </div>

        {activeTab === "write" ? (
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="secondary"
              disabled={disabled}
              className="px-2.5 py-1 text-xs"
              onClick={() => appendBlock(createParagraphNode(""))}
            >
              + Paragraph
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              className="px-2.5 py-1 text-xs"
              onClick={() =>
                appendBlock({
                  type: "heading",
                  attrs: { level: 2 },
                  content: []
                })
              }
            >
              + Heading
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              className="px-2.5 py-1 text-xs"
              onClick={() =>
                appendBlock({
                  type: "blockquote",
                  content: [createParagraphNode("")]
                })
              }
            >
              + Quote
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              className="px-2.5 py-1 text-xs"
              onClick={() =>
                appendBlock({
                  type: "bulletList",
                  content: [
                    { type: "listItem", content: [createParagraphNode("")] }
                  ]
                })
              }
            >
              + Bullet List
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              className="px-2.5 py-1 text-xs"
              onClick={() =>
                appendBlock({
                  type: "orderedList",
                  attrs: { start: 1 },
                  content: [
                    { type: "listItem", content: [createParagraphNode("")] }
                  ]
                })
              }
            >
              + Ordered List
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              className="px-2.5 py-1 text-xs"
              onClick={() =>
                appendBlock({
                  type: "codeBlock",
                  attrs: { language: "ts" },
                  content: [{ type: "text", text: "" }]
                })
              }
            >
              + Code
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              className="px-2.5 py-1 text-xs"
              onClick={() => appendBlock({ type: "horizontalRule" })}
            >
              + Divider
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              className="border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-900 hover:bg-amber-100"
              onClick={() => appendBlock({ type: "paywallBoundary" })}
            >
              + Paywall Boundary
            </Button>
          </div>
        ) : null}
      </div>

      {activeTab === "preview" ? (
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-6">
          <DocumentPreview document={value} />
        </div>
      ) : blocks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          This article has no blocks yet. Use the toolbar above to add your
          first paragraph or heading.
        </div>
      ) : (
        <div className="space-y-3">
          {blocks.map((block, index) => (
            <div
              key={`block-${index}`}
              className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      block.type === "paywallBoundary" ? "warning" : "default"
                    }
                  >
                    {block.type === "heading"
                      ? `Heading H${block.attrs.level}`
                      : block.type === "paywallBoundary"
                        ? "Paywall Boundary"
                        : block.type}
                  </Badge>
                  <span className="text-xs text-slate-400">
                    Block #{index + 1}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={disabled || index === 0}
                    onClick={() => moveBlock(index, -1)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    disabled={disabled || index === blocks.length - 1}
                    onClick={() => moveBlock(index, 1)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => removeBlock(index)}
                    className="rounded border border-red-200 bg-white px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {block.type === "paragraph" ? (
                <InlineRunEditor
                  disabled={disabled}
                  nodes={block.content}
                  placeholder="Write paragraph text..."
                  onChange={(nextContent) =>
                    updateBlockAt(index, {
                      type: "paragraph",
                      content: nextContent
                    })
                  }
                />
              ) : null}

              {block.type === "heading" ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor={`heading-level-${index}`}
                      className="text-xs font-medium text-slate-700"
                    >
                      Level
                    </label>
                    <select
                      id={`heading-level-${index}`}
                      disabled={disabled}
                      value={block.attrs.level}
                      onChange={(e) => {
                        const lvl = Number(e.target.value) as 1 | 2 | 3 | 4;
                        updateBlockAt(index, {
                          ...block,
                          attrs: { level: lvl }
                        });
                      }}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      <option value={1}>H1</option>
                      <option value={2}>H2</option>
                      <option value={3}>H3</option>
                      <option value={4}>H4</option>
                    </select>
                  </div>
                  <InlineRunEditor
                    disabled={disabled}
                    nodes={block.content}
                    placeholder="Section heading..."
                    onChange={(nextContent) =>
                      updateBlockAt(index, {
                        ...block,
                        content: nextContent
                      })
                    }
                  />
                </div>
              ) : null}

              {block.type === "blockquote" ? (
                <textarea
                  rows={3}
                  disabled={disabled}
                  value={block.content
                    .map((p) => extractInlineText(p.content))
                    .join("\n\n")}
                  placeholder="Quoted text (separate paragraphs with a blank line)..."
                  onChange={(e) => {
                    const paragraphs = e.target.value
                      .split(/\n{2,}/)
                      .map((part) => createParagraphNode(part));
                    updateBlockAt(index, {
                      type: "blockquote",
                      content:
                        paragraphs.length > 0
                          ? paragraphs
                          : [createParagraphNode("")]
                    });
                  }}
                  className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              ) : null}

              {block.type === "bulletList" || block.type === "orderedList" ? (
                <div className="space-y-2">
                  {block.type === "orderedList" ? (
                    <div className="flex items-center gap-2">
                      <label
                        htmlFor={`ol-start-${index}`}
                        className="text-xs font-medium text-slate-700"
                      >
                        Start at
                      </label>
                      <input
                        id={`ol-start-${index}`}
                        type="number"
                        min={1}
                        disabled={disabled}
                        value={block.attrs?.start ?? 1}
                        onChange={(e) =>
                          updateBlockAt(index, {
                            ...block,
                            attrs: {
                              start: Math.max(
                                1,
                                Number.parseInt(e.target.value, 10) || 1
                              )
                            }
                          })
                        }
                        className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      />
                    </div>
                  ) : null}
                  <textarea
                    rows={3}
                    disabled={disabled}
                    value={block.content
                      .map((item) =>
                        item.content
                          .map((p) => extractInlineText(p.content))
                          .join(" ")
                      )
                      .join("\n")}
                    placeholder="One list item per line..."
                    onChange={(e) => {
                      const lines = e.target.value.split("\n");
                      const items = (lines.length > 0 ? lines : [""]).map(
                        (line) => ({
                          type: "listItem" as const,
                          content: [createParagraphNode(line)]
                        })
                      );
                      if (block.type === "bulletList") {
                        updateBlockAt(index, {
                          type: "bulletList",
                          content: items
                        });
                      } else {
                        updateBlockAt(index, {
                          type: "orderedList",
                          attrs: block.attrs,
                          content: items
                        });
                      }
                    }}
                    className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              ) : null}

              {block.type === "codeBlock" ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    disabled={disabled}
                    value={block.attrs?.language ?? ""}
                    placeholder="Language (e.g. ts, bash, sql)"
                    aria-label="Code language"
                    onChange={(e) =>
                      updateBlockAt(index, {
                        ...block,
                        attrs: {
                          language: e.target.value
                            .replace(/[^a-zA-Z0-9_-]/g, "")
                            .slice(0, 40)
                        }
                      })
                    }
                    className="w-48 rounded border border-slate-300 bg-white px-2.5 py-1 font-mono text-xs"
                  />
                  <textarea
                    rows={4}
                    disabled={disabled}
                    value={(block.content ?? []).map((t) => t.text).join("")}
                    placeholder="Code snippet..."
                    onChange={(e) =>
                      updateBlockAt(index, {
                        ...block,
                        content: [{ type: "text", text: e.target.value }]
                      })
                    }
                    className="block w-full rounded-md border border-slate-300 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              ) : null}

              {block.type === "horizontalRule" ? (
                <hr className="my-2 border-slate-300" />
              ) : null}

              {block.type === "paywallBoundary" ? (
                <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Preview stops here for unentitled readers when article
                  visibility is set to <strong>Members only</strong>.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
