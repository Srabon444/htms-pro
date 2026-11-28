CREATE TABLE "form_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"form_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"department_id" uuid,
	"branch_id" uuid,
	"employee_id" uuid,
	"schedule" text NOT NULL,
	"weekday" smallint,
	"remind_hour" smallint NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"created_by_user_id" uuid NOT NULL,
	CONSTRAINT "form_assignments_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "form_assignments_audience_ck" CHECK ("form_assignments"."audience" in ('all','department','branch','employee')),
	CONSTRAINT "form_assignments_target_ck" CHECK (("form_assignments"."department_id" is not null) = ("form_assignments"."audience" = 'department') and ("form_assignments"."branch_id" is not null) = ("form_assignments"."audience" = 'branch') and ("form_assignments"."employee_id" is not null) = ("form_assignments"."audience" = 'employee')),
	CONSTRAINT "form_assignments_schedule_ck" CHECK ("form_assignments"."schedule" in ('once','daily','weekly')),
	CONSTRAINT "form_assignments_weekday_ck" CHECK (("form_assignments"."weekday" is not null) = ("form_assignments"."schedule" = 'weekly') and ("form_assignments"."weekday" is null or "form_assignments"."weekday" between 0 and 6)),
	CONSTRAINT "form_assignments_hour_ck" CHECK ("form_assignments"."remind_hour" between 0 and 23),
	CONSTRAINT "form_assignments_dates_ck" CHECK ("form_assignments"."ends_on" is null or "form_assignments"."ends_on" >= "form_assignments"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"form_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"period" date NOT NULL,
	"answers" jsonb NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"submitted_by_user_id" uuid NOT NULL,
	CONSTRAINT "form_submissions_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "form_submissions_period_uq" UNIQUE("tenant_id","assignment_id","employee_id","period"),
	CONSTRAINT "form_submissions_answers_ck" CHECK (jsonb_typeof("form_submissions"."answers") = 'object'),
	CONSTRAINT "form_submissions_location_ck" CHECK (("form_submissions"."lat" is null) = ("form_submissions"."lng" is null) and ("form_submissions"."lat" is null or ("form_submissions"."lat" between -90 and 90 and "form_submissions"."lng" between -180 and 180)))
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	CONSTRAINT "forms_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "forms_title_ck" CHECK (length(trim("forms"."title")) between 1 and 120),
	CONSTRAINT "forms_description_ck" CHECK ("forms"."description" is null or length("forms"."description") <= 1000),
	CONSTRAINT "forms_fields_ck" CHECK (jsonb_typeof("forms"."fields") = 'array' and jsonb_array_length("forms"."fields") <= 30),
	CONSTRAINT "forms_status_ck" CHECK ("forms"."status" in ('draft','published','archived'))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assignee_employee_id" uuid NOT NULL,
	"due_on" date,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "tasks_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "tasks_title_ck" CHECK (length(trim("tasks"."title")) between 1 and 200),
	CONSTRAINT "tasks_description_ck" CHECK ("tasks"."description" is null or length("tasks"."description") <= 2000),
	CONSTRAINT "tasks_status_ck" CHECK ("tasks"."status" in ('open','done')),
	CONSTRAINT "tasks_done_ck" CHECK (("tasks"."status" = 'done') = ("tasks"."done_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_owner_type_ck";--> statement-breakpoint
ALTER TABLE "form_assignments" ADD CONSTRAINT "form_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_assignments" ADD CONSTRAINT "form_assignments_form_fk" FOREIGN KEY ("tenant_id","form_id") REFERENCES "public"."forms"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_assignments" ADD CONSTRAINT "form_assignments_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_assignments" ADD CONSTRAINT "form_assignments_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_assignments" ADD CONSTRAINT "form_assignments_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_fk" FOREIGN KEY ("tenant_id","form_id") REFERENCES "public"."forms"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_assignment_fk" FOREIGN KEY ("tenant_id","assignment_id") REFERENCES "public"."form_assignments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_fk" FOREIGN KEY ("tenant_id","assignee_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_assignments_form_idx" ON "form_assignments" USING btree ("tenant_id","form_id");--> statement-breakpoint
CREATE INDEX "form_submissions_form_idx" ON "form_submissions" USING btree ("tenant_id","form_id","created_at");--> statement-breakpoint
CREATE INDEX "form_submissions_employee_idx" ON "form_submissions" USING btree ("tenant_id","employee_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("tenant_id","assignee_employee_id","status");--> statement-breakpoint
CREATE INDEX "tasks_creator_idx" ON "tasks" USING btree ("tenant_id","created_by_user_id","status");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_type_ck" CHECK ("files"."owner_type" in ('leave_request','ticket','resignation','asset','candidate','offer','interview_feedback','checklist_item','change_request','attendance_request','loan','ticket_comment','announcement','salary_change','review','goal','project','meal_bill','education','experience','course_lesson','certification','form_submission'));