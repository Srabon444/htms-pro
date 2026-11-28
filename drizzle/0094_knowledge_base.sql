CREATE TABLE "kb_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"folder_id" uuid,
	"title" text NOT NULL,
	"body_md" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	CONSTRAINT "kb_articles_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "kb_articles_title_ck" CHECK (length(trim("kb_articles"."title")) between 1 and 160),
	CONSTRAINT "kb_articles_body_ck" CHECK (length("kb_articles"."body_md") <= 50000),
	CONSTRAINT "kb_articles_status_ck" CHECK ("kb_articles"."status" in ('draft', 'published'))
);
--> statement-breakpoint
CREATE TABLE "kb_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parent_id" uuid,
	"name" "citext" NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"department_id" uuid,
	"branch_id" uuid,
	"created_by_user_id" uuid,
	CONSTRAINT "kb_folders_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "kb_folders_name_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","parent_id","name"),
	CONSTRAINT "kb_folders_name_ck" CHECK (length(trim("kb_folders"."name")) between 1 and 80),
	CONSTRAINT "kb_folders_parent_ck" CHECK ("kb_folders"."parent_id" <> "kb_folders"."id"),
	CONSTRAINT "kb_folders_audience_ck" CHECK (("kb_folders"."audience" = 'all' and "kb_folders"."department_id" is null and "kb_folders"."branch_id" is null) or ("kb_folders"."audience" = 'department' and "kb_folders"."department_id" is not null and "kb_folders"."branch_id" is null) or ("kb_folders"."audience" = 'branch' and "kb_folders"."branch_id" is not null and "kb_folders"."department_id" is null))
);
--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_folder_fk" FOREIGN KEY ("tenant_id","folder_id") REFERENCES "public"."kb_folders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_folders" ADD CONSTRAINT "kb_folders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_folders" ADD CONSTRAINT "kb_folders_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."kb_folders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_folders" ADD CONSTRAINT "kb_folders_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_folders" ADD CONSTRAINT "kb_folders_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_articles_folder_idx" ON "kb_articles" USING btree ("tenant_id","folder_id","title");--> statement-breakpoint
CREATE INDEX "kb_articles_search_idx" ON "kb_articles" USING gin ("tenant_id",("title"::text) gin_trgm_ops,("body_md"::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "kb_folders_parent_idx" ON "kb_folders" USING btree ("tenant_id","parent_id");