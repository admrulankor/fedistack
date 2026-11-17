import { z } from "zod";
import { PublishingError } from "./errors.js";

const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;

export function isSafeLinkHref(rawHref: string): boolean {
  if (CONTROL_CHAR_PATTERN.test(rawHref)) {
    return false;
  }
  const trimmed = rawHref.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) {
    return false;
  }

  if (trimmed.startsWith("#")) {
    return trimmed.length > 1;
  }

  if (trimmed.startsWith("/")) {
    return !trimmed.startsWith("//");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol === "https:" || protocol === "http:") {
    return Boolean(parsed.hostname);
  }
  if (protocol === "mailto:") {
    return parsed.pathname.includes("@");
  }

  return false;
}

export const safeLinkHrefSchema = z
  .string()
  .refine((val) => !CONTROL_CHAR_PATTERN.test(val), {
    message: "Link URL contains invalid control characters."
  })
  .transform((val) => val.trim())
  .pipe(
    z
      .string()
      .min(1, "Link URL is required.")
      .max(2048, "Link URL is too long.")
      .refine(isSafeLinkHref, {
        message:
          "Link URL must use http(s), mailto, a hash anchor, or a relative path starting with /."
      })
  );

export const boldMarkSchema = z.object({
  type: z.literal("bold")
});

export const italicMarkSchema = z.object({
  type: z.literal("italic")
});

export const strikeMarkSchema = z.object({
  type: z.literal("strike")
});

export const codeMarkSchema = z.object({
  type: z.literal("code")
});

export const linkMarkSchema = z.object({
  type: z.literal("link"),
  attrs: z.object({
    href: safeLinkHrefSchema,
    target: z.enum(["_blank", "_self"]).nullable().optional(),
    rel: z.string().max(120).nullable().optional()
  })
});

export const articleMarkSchema = z.discriminatedUnion("type", [
  boldMarkSchema,
  italicMarkSchema,
  strikeMarkSchema,
  codeMarkSchema,
  linkMarkSchema
]);

export const textInlineNodeSchema = z.object({
  type: z.literal("text"),
  text: z.string().max(50000),
  marks: z.array(articleMarkSchema).max(16).optional()
});

export const hardBreakInlineNodeSchema = z.object({
  type: z.literal("hardBreak")
});

export const articleInlineNodeSchema = z.discriminatedUnion("type", [
  textInlineNodeSchema,
  hardBreakInlineNodeSchema
]);

export const paragraphBlockNodeSchema = z.object({
  type: z.literal("paragraph"),
  content: z.array(articleInlineNodeSchema).max(2000).optional()
});

export const headingBlockNodeSchema = z.object({
  type: z.literal("heading"),
  attrs: z.object({
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
  }),
  content: z.array(articleInlineNodeSchema).max(1000).optional()
});

export const blockquoteBlockNodeSchema = z.object({
  type: z.literal("blockquote"),
  content: z
    .array(paragraphBlockNodeSchema)
    .min(1, "Blockquote must contain at least one paragraph.")
    .max(200)
});

export const listItemNodeSchema = z.object({
  type: z.literal("listItem"),
  content: z
    .array(paragraphBlockNodeSchema)
    .min(1, "List item must contain at least one paragraph.")
    .max(100)
});

export const bulletListBlockNodeSchema = z.object({
  type: z.literal("bulletList"),
  content: z
    .array(listItemNodeSchema)
    .min(1, "Bullet list must contain at least one item.")
    .max(500)
});

export const orderedListBlockNodeSchema = z.object({
  type: z.literal("orderedList"),
  attrs: z
    .object({
      start: z.number().int().min(1).max(10000).optional()
    })
    .optional(),
  content: z
    .array(listItemNodeSchema)
    .min(1, "Ordered list must contain at least one item.")
    .max(500)
});

export const codeBlockNodeSchema = z.object({
  type: z.literal("codeBlock"),
  attrs: z
    .object({
      language: z
        .string()
        .trim()
        .max(40)
        .regex(/^[a-zA-Z0-9_-]*$/, "Invalid code language identifier.")
        .nullable()
        .optional()
    })
    .optional(),
  content: z
    .array(
      z.object({
        type: z.literal("text"),
        text: z.string().max(100000)
      })
    )
    .max(500)
    .optional()
});

export const horizontalRuleBlockNodeSchema = z.object({
  type: z.literal("horizontalRule")
});

export const paywallBoundaryBlockNodeSchema = z.object({
  type: z.literal("paywallBoundary")
});

export const articleBlockNodeSchema = z.discriminatedUnion("type", [
  paragraphBlockNodeSchema,
  headingBlockNodeSchema,
  blockquoteBlockNodeSchema,
  bulletListBlockNodeSchema,
  orderedListBlockNodeSchema,
  codeBlockNodeSchema,
  horizontalRuleBlockNodeSchema,
  paywallBoundaryBlockNodeSchema
]);

export const articleDocumentSchema = z.object({
  type: z.literal("doc"),
  content: z.array(articleBlockNodeSchema).max(2000).default([])
});

export type ArticleMark = z.infer<typeof articleMarkSchema>;
export type ArticleInlineNode = z.infer<typeof articleInlineNodeSchema>;
export type ParagraphBlockNode = z.infer<typeof paragraphBlockNodeSchema>;
export type ArticleBlockNode = z.infer<typeof articleBlockNodeSchema>;
export type ArticleDocument = z.infer<typeof articleDocumentSchema>;
export type ArticleVisibility = "public" | "members_only";

export function createEmptyArticleDocument(): ArticleDocument {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [] }]
  };
}

export function validateArticleDocument(raw: unknown): ArticleDocument {
  const parsed = articleDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const location = issue?.path?.length ? ` at ${issue.path.join(".")}` : "";
    throw new PublishingError(
      "VALIDATION_ERROR",
      `Invalid article document${location}: ${issue?.message ?? "Malformed document structure."}`,
      400
    );
  }
  return parsed.data;
}

export interface StrippedArticleDocumentResult {
  document: ArticleDocument;
  isPaywalled: boolean;
  restrictedNodesStripped: boolean;
}

/**
 * Strips restricted document nodes on the server before serialization when an
 * unauthenticated or unentitled reader accesses a `members_only` article.
 */
export function stripRestrictedNodesForUnentitledReader(
  doc: ArticleDocument,
  visibility: ArticleVisibility,
  isEntitled: boolean
): StrippedArticleDocumentResult {
  if (visibility === "public" || isEntitled) {
    return {
      document: {
        type: "doc",
        content: doc.content.filter((node) => node.type !== "paywallBoundary")
      },
      isPaywalled: false,
      restrictedNodesStripped: false
    };
  }

  const boundaryIndex = doc.content.findIndex(
    (node) => node.type === "paywallBoundary"
  );

  const keptNodes =
    boundaryIndex >= 0 ? doc.content.slice(0, boundaryIndex) : [];

  return {
    document: {
      type: "doc",
      content: keptNodes
    },
    isPaywalled: true,
    restrictedNodesStripped: true
  };
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

function renderInlineNodes(nodes: ArticleInlineNode[] | undefined): string {
  if (!nodes || nodes.length === 0) {
    return "";
  }

  return nodes
    .map((node) => {
      if (node.type === "hardBreak") {
        return "<br />";
      }

      let rendered = escapeHtml(node.text);
      if (!node.marks || node.marks.length === 0) {
        return rendered;
      }

      for (const mark of node.marks) {
        switch (mark.type) {
          case "bold":
            rendered = `<strong>${rendered}</strong>`;
            break;
          case "italic":
            rendered = `<em>${rendered}</em>`;
            break;
          case "strike":
            rendered = `<s>${rendered}</s>`;
            break;
          case "code":
            rendered = `<code>${rendered}</code>`;
            break;
          case "link": {
            const href = escapeHtml(mark.attrs.href);
            const targetAttr =
              mark.attrs.target === "_blank"
                ? ' target="_blank"'
                : mark.attrs.target === "_self"
                  ? ' target="_self"'
                  : "";
            rendered = `<a href="${href}"${targetAttr} rel="noopener noreferrer">${rendered}</a>`;
            break;
          }
        }
      }

      return rendered;
    })
    .join("");
}

function renderParagraph(node: ParagraphBlockNode): string {
  return `<p>${renderInlineNodes(node.content)}</p>`;
}

/**
 * Deterministically renders a validated TipTap/ProseMirror structured document
 * to sanitized HTML without trusting or passing through raw HTML strings.
 */
export function renderArticleDocumentToHtml(doc: ArticleDocument): string {
  return doc.content
    .map((node) => {
      switch (node.type) {
        case "paragraph":
          return renderParagraph(node);
        case "heading": {
          const level = node.attrs.level;
          return `<h${level}>${renderInlineNodes(node.content)}</h${level}>`;
        }
        case "blockquote":
          return `<blockquote>${node.content.map(renderParagraph).join("")}</blockquote>`;
        case "bulletList": {
          const items = node.content
            .map(
              (item) => `<li>${item.content.map(renderParagraph).join("")}</li>`
            )
            .join("");
          return `<ul>${items}</ul>`;
        }
        case "orderedList": {
          const start = node.attrs?.start;
          const startAttr =
            start !== undefined && start !== 1 ? ` start="${start}"` : "";
          const items = node.content
            .map(
              (item) => `<li>${item.content.map(renderParagraph).join("")}</li>`
            )
            .join("");
          return `<ol${startAttr}>${items}</ol>`;
        }
        case "codeBlock": {
          const lang = node.attrs?.language?.trim();
          const classAttr = lang
            ? ` class="language-${escapeHtml(lang)}"`
            : "";
          const codeText = (node.content ?? [])
            .map((textNode) => textNode.text)
            .join("");
          return `<pre><code${classAttr}>${escapeHtml(codeText)}</code></pre>`;
        }
        case "horizontalRule":
          return "<hr />";
        case "paywallBoundary":
          return "";
      }
    })
    .filter((fragment) => fragment.length > 0)
    .join("\n");
}
