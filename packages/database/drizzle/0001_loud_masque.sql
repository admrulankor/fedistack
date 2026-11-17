CREATE TYPE "public"."article_status" AS ENUM('draft', 'published', 'unpublished');--> statement-breakpoint
CREATE TYPE "public"."article_visibility" AS ENUM('public', 'members_only');--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"excerpt" text,
	"body" jsonb NOT NULL,
	"status" "article_status" DEFAULT 'draft' NOT NULL,
	"visibility" "article_visibility" DEFAULT 'public' NOT NULL,
	"published_at" timestamp with time zone,
	"unpublished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "articles_publication_slug_unique_idx" ON "articles" USING btree ("publication_id","slug");--> statement-breakpoint
CREATE INDEX "articles_publication_status_published_idx" ON "articles" USING btree ("publication_id","status","published_at");--> statement-breakpoint
CREATE INDEX "articles_author_user_id_idx" ON "articles" USING btree ("author_user_id");