import { describe, expect, it } from "vitest";
import {
  type ArticleDocument,
  createEmptyArticleDocument,
  escapeHtml,
  isSafeLinkHref,
  PublishingError,
  renderArticleDocumentToHtml,
  slugifyText,
  slugSchema,
  stripRestrictedNodesForUnentitledReader,
  validateArticleDocument
} from "./index.js";

describe("packages/publishing unit suite", () => {
  describe("slug validation and normalization", () => {
    it("accepts valid lowercase hyphenated slugs and normalizes case/whitespace", () => {
      expect(slugSchema.parse("independent-press")).toBe("independent-press");
      expect(slugSchema.parse("  Morning-Dispatch-2026 ")).toBe(
        "morning-dispatch-2026"
      );
    });

    it("rejects reserved slugs, too-short slugs, and invalid characters", () => {
      for (const reserved of ["admin", "api", "login", "dashboard", "p"]) {
        expect(() => slugSchema.parse(reserved)).toThrow();
      }
      expect(() => slugSchema.parse("a")).toThrow();
      expect(() => slugSchema.parse("bad--slug")).toThrow();
      expect(() => slugSchema.parse("-leading")).toThrow();
      expect(() => slugSchema.parse("bad_slug!")).toThrow();
    });

    it("slugifies diacritics, punctuation, and reserved words safely", () => {
      expect(slugifyText("Café & Journalism 2026!")).toBe(
        "cafe-journalism-2026"
      );
      expect(slugifyText("admin")).toBe("admin-post");
      expect(slugifyText("...")).toBe("post");
      expect(slugSchema.parse(slugifyText("admin"))).toBe("admin-post");
    });
  });

  describe("structured TipTap/ProseMirror document validation", () => {
    it("accepts valid documents with all supported block types and inline marks", () => {
      const empty = createEmptyArticleDocument();
      expect(validateArticleDocument(empty)).toEqual(empty);

      const doc: ArticleDocument = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Headline" }]
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Bold", marks: [{ type: "bold" }] },
              { type: "text", text: " " },
              { type: "text", text: "Italic", marks: [{ type: "italic" }] },
              { type: "text", text: " " },
              { type: "text", text: "Strike", marks: [{ type: "strike" }] },
              { type: "text", text: " " },
              { type: "text", text: "Code", marks: [{ type: "code" }] },
              { type: "hardBreak" },
              {
                type: "text",
                text: "Read more",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "https://fedistack.org/docs",
                      target: "_blank",
                      rel: "noopener noreferrer"
                    }
                  }
                ]
              }
            ]
          },
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Quoted sentence." }]
              }
            ]
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Bullet one" }]
                  }
                ]
              }
            ]
          },
          {
            type: "orderedList",
            attrs: { start: 3 },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Step three" }]
                  }
                ]
              }
            ]
          },
          {
            type: "codeBlock",
            attrs: { language: "typescript" },
            content: [{ type: "text", text: "const x = 1;" }]
          },
          { type: "horizontalRule" },
          { type: "paywallBoundary" }
        ]
      };

      expect(validateArticleDocument(doc)).toEqual(doc);
    });

    it("rejects dangerous link href schemes and protocol-relative URLs", () => {
      expect(isSafeLinkHref("https://fedistack.org/about")).toBe(true);
      expect(isSafeLinkHref("http://localhost:3000/p/pub")).toBe(true);
      expect(isSafeLinkHref("mailto:editor@fedistack.org")).toBe(true);
      expect(isSafeLinkHref("/p/my-pub")).toBe(true);
      expect(isSafeLinkHref("#section-1")).toBe(true);

      const dangerousUrls = [
        "javascript:alert(1)",
        "JAVASCRIPT:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "vbscript:evil()",
        "file:///etc/passwd",
        "//evil.example.com/phish",
        "https://example.com\n"
      ];

      for (const href of dangerousUrls) {
        expect(isSafeLinkHref(href)).toBe(false);
        expect(() =>
          validateArticleDocument({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Click",
                    marks: [{ type: "link", attrs: { href } }]
                  }
                ]
              }
            ]
          })
        ).toThrowError(PublishingError);

        try {
          validateArticleDocument({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Click",
                    marks: [{ type: "link", attrs: { href } }]
                  }
                ]
              }
            ]
          });
        } catch (err) {
          expect(err).toBeInstanceOf(PublishingError);
          expect((err as PublishingError).code).toBe("VALIDATION_ERROR");
          expect((err as PublishingError).statusCode).toBe(400);
        }
      }
    });
  });

  describe("deterministic HTML rendering and XSS escaping", () => {
    it("renders semantic HTML tags for all blocks and marks", () => {
      const doc: ArticleDocument = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Section Title" }]
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello " },
              { type: "text", text: "world", marks: [{ type: "bold" }] },
              { type: "hardBreak" },
              {
                type: "text",
                text: "Visit",
                marks: [
                  {
                    type: "link",
                    attrs: { href: "https://fedistack.org", target: "_blank" }
                  }
                ]
              }
            ]
          },
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Independent press." }]
              }
            ]
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "First" }]
                  }
                ]
              }
            ]
          },
          {
            type: "orderedList",
            attrs: { start: 2 },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Second" }]
                  }
                ]
              }
            ]
          },
          {
            type: "codeBlock",
            attrs: { language: "ts" },
            content: [{ type: "text", text: "const ok = true;" }]
          },
          { type: "horizontalRule" }
        ]
      };

      const html = renderArticleDocumentToHtml(doc);
      expect(html).toContain("<h2>Section Title</h2>");
      expect(html).toContain(
        '<p>Hello <strong>world</strong><br /><a href="https://fedistack.org" target="_blank" rel="noopener noreferrer">Visit</a></p>'
      );
      expect(html).toContain("<blockquote><p>Independent press.</p></blockquote>");
      expect(html).toContain("<ul><li><p>First</p></li></ul>");
      expect(html).toContain('<ol start="2"><li><p>Second</p></li></ol>');
      expect(html).toContain(
        '<pre><code class="language-ts">const ok = true;</code></pre>'
      );
      expect(html).toContain("<hr />");
    });

    it("escapes raw HTML tags in text nodes, headings, and code blocks to prevent XSS", () => {
      const payload = '<script>alert("xss")</script>';
      expect(escapeHtml(payload)).toBe(
        "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
      );

      const html = renderArticleDocumentToHtml({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: payload }]
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: `<img src=x onerror=alert(1)>` }]
          },
          {
            type: "codeBlock",
            attrs: { language: "html" },
            content: [{ type: "text", text: payload }]
          }
        ]
      });

      expect(html).not.toContain("<script>");
      expect(html).not.toContain("<img ");
      expect(html).toContain(
        "<h1>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</h1>"
      );
      expect(html).toContain(
        "<p>&lt;img src=x onerror=alert(1)&gt;</p>"
      );
      expect(html).toContain(
        '<pre><code class="language-html">&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</code></pre>'
      );
    });
  });

  describe("server-side paywall node stripping", () => {
    const sampleDocWithBoundary: ArticleDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Public teaser paragraph." }]
        },
        { type: "paywallBoundary" },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Secret subscriber content." }]
        }
      ]
    };

    const sampleDocWithoutBoundary: ArticleDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Full members-only body." }]
        }
      ]
    };

    it("returns full content without paywallBoundary markers for public articles", () => {
      const result = stripRestrictedNodesForUnentitledReader(
        sampleDocWithBoundary,
        "public",
        false
      );
      expect(result.isPaywalled).toBe(false);
      expect(result.restrictedNodesStripped).toBe(false);
      expect(result.document.content).toHaveLength(2);
      expect(
        result.document.content.some((n) => n.type === "paywallBoundary")
      ).toBe(false);
    });

    it("returns full content without paywallBoundary markers for entitled members", () => {
      const result = stripRestrictedNodesForUnentitledReader(
        sampleDocWithBoundary,
        "members_only",
        true
      );
      expect(result.isPaywalled).toBe(false);
      expect(result.restrictedNodesStripped).toBe(false);
      expect(result.document.content).toHaveLength(2);
      const html = renderArticleDocumentToHtml(result.document);
      expect(html).toContain("Public teaser paragraph.");
      expect(html).toContain("Secret subscriber content.");
    });

    it("keeps only teaser nodes before paywallBoundary for unentitled readers", () => {
      const result = stripRestrictedNodesForUnentitledReader(
        sampleDocWithBoundary,
        "members_only",
        false
      );
      expect(result.isPaywalled).toBe(true);
      expect(result.restrictedNodesStripped).toBe(true);
      expect(result.document.content).toHaveLength(1);
      const html = renderArticleDocumentToHtml(result.document);
      expect(html).toContain("Public teaser paragraph.");
      expect(html).not.toContain("Secret subscriber content.");
    });

    it("strips all body nodes for unentitled readers when no paywallBoundary is present", () => {
      const result = stripRestrictedNodesForUnentitledReader(
        sampleDocWithoutBoundary,
        "members_only",
        false
      );
      expect(result.isPaywalled).toBe(true);
      expect(result.restrictedNodesStripped).toBe(true);
      expect(result.document.content).toEqual([]);
      expect(renderArticleDocumentToHtml(result.document)).toBe("");
    });
  });
});
