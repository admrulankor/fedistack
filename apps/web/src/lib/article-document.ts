import { z } from "zod";

export const articleMarkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("strike") }),
  z.object({ type: z.literal("code") }),
  z.object({
    type: z.literal("link"),
    attrs: z.object({
      href: z.string(),
      target: z.enum(["_blank", "_self"]).nullable().optional(),
      rel: z.string().nullable().optional()
    })
  })
]);

export const articleInlineNodeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
    marks: z.array(articleMarkSchema).optional()
  }),
  z.object({
    type: z.literal("hardBreak")
  })
]);

export const paragraphBlockNodeSchema = z.object({
  type: z.literal("paragraph"),
  content: z.array(articleInlineNodeSchema).optional()
});

export const headingBlockNodeSchema = z.object({
  type: z.literal("heading"),
  attrs: z.object({
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
  }),
  content: z.array(articleInlineNodeSchema).optional()
});

export const blockquoteBlockNodeSchema = z.object({
  type: z.literal("blockquote"),
  content: z.array(paragraphBlockNodeSchema)
});

export const listItemNodeSchema = z.object({
  type: z.literal("listItem"),
  content: z.array(paragraphBlockNodeSchema)
});

export const bulletListBlockNodeSchema = z.object({
  type: z.literal("bulletList"),
  content: z.array(listItemNodeSchema)
});

export const orderedListBlockNodeSchema = z.object({
  type: z.literal("orderedList"),
  attrs: z
    .object({
      start: z.number().int().min(1).optional()
    })
    .optional(),
  content: z.array(listItemNodeSchema)
});

export const codeBlockNodeSchema = z.object({
  type: z.literal("codeBlock"),
  attrs: z
    .object({
      language: z.string().nullable().optional()
    })
    .optional(),
  content: z
    .array(
      z.object({
        type: z.literal("text"),
        text: z.string()
      })
    )
    .optional()
});

export const articleBlockNodeSchema = z.discriminatedUnion("type", [
  paragraphBlockNodeSchema,
  headingBlockNodeSchema,
  blockquoteBlockNodeSchema,
  bulletListBlockNodeSchema,
  orderedListBlockNodeSchema,
  codeBlockNodeSchema,
  z.object({ type: z.literal("horizontalRule") }),
  z.object({ type: z.literal("paywallBoundary") })
]);

export const articleDocumentSchema = z.object({
  type: z.literal("doc"),
  content: z.array(articleBlockNodeSchema)
});

export type ArticleMark = z.infer<typeof articleMarkSchema>;
export type ArticleInlineNode = z.infer<typeof articleInlineNodeSchema>;
export type ParagraphBlockNode = z.infer<typeof paragraphBlockNodeSchema>;
export type ArticleBlockNode = z.infer<typeof articleBlockNodeSchema>;
export type ArticleDocument = z.infer<typeof articleDocumentSchema>;

export function extractInlineText(
  nodes: ArticleInlineNode[] | undefined
): string {
  if (!nodes || nodes.length === 0) {
    return "";
  }
  return nodes
    .map((node) => (node.type === "hardBreak" ? "\n" : node.text))
    .join("");
}

export function textToInlineNodes(
  text: string,
  marks?: ArticleMark[]
): ArticleInlineNode[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.split("\n");
  const nodes: ArticleInlineNode[] = [];
  lines.forEach((line, index) => {
    if (line.length > 0) {
      nodes.push({
        type: "text",
        text: line,
        ...(marks && marks.length > 0 ? { marks } : {})
      });
    }
    if (index < lines.length - 1) {
      nodes.push({ type: "hardBreak" });
    }
  });
  return nodes;
}

export function createParagraphNode(
  text = "",
  marks?: ArticleMark[]
): ParagraphBlockNode {
  return {
    type: "paragraph",
    content: textToInlineNodes(text, marks)
  };
}
