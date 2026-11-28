# HRMS Pro runbook

How to run, operate and recover the system. For what it does, see the README.

## Services

| Service  | Role                                                              | Port (dev) |
| -------- | ----------------------------------------------------------------- | ---------- |
| app      | SvelteKit server (`node build`)                                   | 3000       |
| worker   | BullMQ worker: mail, meal bills, file text, webhooks, hourly job  | none       |
| migrate  | One-shot: database migrations, bucket, system-role sync           | none       |
| postgres | Postgres 17, row-level security per tenant                        | 55432      |
| redis    | Queues, rate limits, session cache, sign-in challenges (AOF on)   | 56379      |
| minio    | S3-compatible file store (documents, receipts, payslips, resumes) | 59000      |
| mailpit  | Local SMTP sink with a web inbox (dev only)                       | 58025      |

The app and worker both need Postgres and Redis. Only the worker sends mail.

## Run locally

```bash
cp .env.example .env            # fill every <...> value
npm ci
npm run infra:up                # postgres, redis, minio, mailpit
npm run db:migrate              # schema, roles, bucket, system roles
SEED_PASSWORD=secret npm run db:seed   # demo tenant at /t/demo
npm run dev                     # app on :5173
npm run worker                  # in a second terminal
```

Seeded users: `admin@hrms.local` (platform admin), `owner@demo.local`, `hr@demo.local`, `staff@demo.local`.

## Run with Docker

```bash
docker compose --profile app up -d --build
```

`migrate` runs first; `app` and `worker` start only after it succeeds. Set real secrets in the environment before this;
the compose defaults are for development.

## Configuration

Every variable is validated at startup (`src/lib/server/config.ts`); a bad value stops the process with the name of the
variable.

| Variable                                     | Notes                                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`                               | `hrms_app` role, no BYPASSRLS. All tenant traffic.                                       |
| `AUTH_DATABASE_URL`                          | `hrms_auth` role. Users, sessions, tenant lookup.                                        |
| `OWNER_DATABASE_URL`                         | Table owner. Used only by `migrate`.                                                     |
| `HRMS_APP_DB_PASSWORD` `HRMS_AUTH_DB_PASSWORD` | `migrate` creates or updates the two roles with these.                                 |
| `APP_ENC_KEYS`                               | `kid:base64(32 bytes)`, comma separated. The first key encrypts; all keys decrypt.       |
| `METRICS_TOKEN`                              | Bearer token for `/metrics`.                                                             |
| `TEST_MODE`                                  | Enables e2e fixture endpoints. Refused when `NODE_ENV=production`.                       |
| `RL_*`, `TOTP_FAILS_PER_15MIN`               | Rate limits (login, reset, invite, mutations, downloads, 2FA). Defaults in `config.ts`.  |
| `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET`    | Optional Google sign-in.                                                                 |
| `AI_PLATFORM_GEMINI` `GEMINI_API_KEY`        | Platform Gemini key for tenants without their own. Off by default; turn on only with a paid key (free-tier traffic may be used for training). |
| `AI_PLATFORM_MONTHLY_TOKENS` `AI_PLATFORM_DAILY_TOKENS` | Per-tenant monthly and all-tenant daily token ceilings on the platform key.     |
| `AI_DEADLINE_MS` `AI_CALL_TIMEOUT_MS` `RL_AI_*` | Whole-request deadline, per-model call timeout and AI rate limits.                   |
| `RL_AI_OCR_PER_USER_MIN`                     | File reads (receipt, CV, document) per person per minute. Default 10.            |
| `AI_FAKE`                                    | Deterministic fake provider for tests. Needs `TEST_MODE`; refused in production.         |

Business settings (leave, attendance, payroll, tax, meals, letters) live per tenant in the app under Settings, not in
the environment.

## Tenants and users

```bash
printf %s "$PW" | npm run cli -- create-platform-admin ops@example.com "Ops"
npm run cli -- create-tenant acme "Acme Ltd" owner@acme.com   # prints the owner's invitation link
```

The owner role cannot be edited or removed from the last owner. Every other built-in role is editable per tenant;
`migrate` brings built-in roles in line with the code without undoing an admin's own changes.

## Company sign-in (SSO)

An organisation's owner sets this up under Settings → Company sign-in. What they need from you and from their IT:

- The redirect address shown on that page, `${APP_URL}/sso/callback`. Register it in the Google Cloud OAuth client
  (Web application) or the Entra app registration (Web platform, ID tokens not needed; a client secret is). `APP_URL`
  must be the address people really use, over https.
- A DNS TXT record on each email domain, on the domain itself (`example.com`, not a subdomain), with the value shown
  on the page (`hrms-sso-verify=...`). "Check" looks it up from the app server, so the server needs outbound DNS.
- Redis: in-progress sign-ins live there for 10 minutes. With Redis down, company sign-in says it is unavailable and
  password sign-in keeps working.
- Outbound https to `accounts.google.com`/`oauth2.googleapis.com` or `login.microsoftonline.com`.

When company sign-in is required, the owner is never forced through it; turning "Require" on needs the owner's own
2FA, so the way back in is password plus 2FA. If the provider breaks, the owner signs in
with their password and turns "Require" off. Someone who joined through company sign-in has no password; they can
set one with "Forgot your password?". Unlinking under Account → Security, removing their membership or disabling the
user stops their company sign-in.

Provisioning (SCIM) uses the token from the same page and the base URL `${APP_URL}/api/scim/v2`; in Entra use
"Bearer token" as the secret token, in Okta "HTTP Header". A token is limited to 600 requests a minute, and an
address that sends 30 bad tokens in an hour is turned away for that hour. If the identity provider deactivates
someone by mistake, reactivating them there turns them back on; if HR disabled them, HR turns them back on under
Members. A leaked token: Replace or Revoke it on the page; the old one stops at once. Turning company sign-in off
does not stop provisioning; revoke the token for that.

## 1:1s and feedback

Turn on "1:1s and feedback" in Settings, Modules. A 1:1 can only be scheduled between an employee and their current
manager. People with `performance.manage` see 1:1s and their agenda and actions for the people in their scope; private
notes are only ever returned to their author and are excluded from the audit log. Feedback marked "manager and HR only"
is shown to people with `performance.review` or `performance.manage` over the subject, never to the subject. When an
ex-employee's access expires, their private notes, feedback requests and the feedback about them are deleted, and
feedback they gave shows as "Former employee". A 1:1 belongs to the employee: when their manager changes, the new
manager takes over their past 1:1s and open actions, and the old manager loses access. Feedback, feedback requests and
1:1 items are audited by row only, so their text never reaches the audit log.

## Skills and internal jobs

Turn on "Skills and internal jobs" in Settings, Modules. HR admins hold `skill.manage` for the catalogue; line managers
and department heads hold `skill.validate` for their team or department, and nobody can validate their own skill.
Removing a skill from the catalogue removes it from every employee and opening. On an opening, "Show on the internal
job board" lists it on Internal jobs while it is open; the description accepts a safe Markdown subset (bold, italic,
headings, lists and http(s) links; any HTML is shown as text). An internal applicant is a candidate with source
"internal" linked to their employee record; hiring them moves them to Hired without creating a second employee, so
update their department, designation and manager on their profile afterwards. Hiring a referred candidate from an
opening with a referral bonus creates a pending reward due on the join date plus "Referral bonus qualifying period"
(Settings, People). The nightly lifecycle job moves a pending reward to due once that date passes while the hire is
working, and voids it if the hire has left. Rewards are salary data: only the referrer and people with salary access
see them, and only `salary.update` can mark one paid or void it; nothing is added to payroll, so pay it in the next run
yourself.

## Learning

Turn on "Learning" in Settings, Modules. `course.manage` (HR admin) builds, publishes and assigns courses;
`course.report` (HR admin everywhere, department heads for their department, line managers for their team) sees the
training report at Learning, Training report, and can check a certificate code there. A course publishes only with at
least one lesson, questions on every quiz and a file on every file lesson; removing a lesson or question that a
published course needs is refused, and quiz or file lessons can be added only while the course is a draft. Removing a
lesson marks anyone who has now done every remaining lesson as passed. Quiz options are typed one per line with `*`
before each correct one; a question with more than one correct option needs all of them picked, and scores round down.
Course managers see the answer key on the course page, so a manager taking their own course sees it too. When someone
runs out of attempts (also when HR lowers the limit below what they used) the course shows them as "Out of attempts"
and HR can allow another try, which resets the unpassed quizzes only. A person is on a course once per cycle: the first
assignment that reaches them sets the due date, a later one only adds people not yet on it, and an assignment taking
over a passed self-enrolment sets its renewal date without a new notification. The days to finish must be shorter than
the renewal period. The daily lifecycle step `learning` (counter `learning_day`, once per tenant day) enrols people who
now match an assignment, opens a renewal cycle `due_in_days` before a passed course expires (the last certificate stays
downloadable meanwhile), and sends the 7 and 1 day reminders; a missed day does not resend them. Removing an assignment
deletes enrolments nobody started and keeps the rest as optional, without further renewals. Certificate codes are
derived from the server key ring (`keyedMac`), so they cannot be forged without it; a code is checked only inside its
own tenant and shows as expired after its renewal date. Archiving a course stops new progress but keeps passed
certificates downloadable.

## E-signature

Turn on "E-signature" in Settings, Modules. `signature.manage` (HR admin) creates requests at Signatures: a title, a PDF
up to 10 MB (checked by its header) and 1 to 90 days to sign, counted from when it is sent. Signers are added while the request
is a draft, up to 10, each email once; staff must have an active login. People sign strictly in the order added, and
only the current signer is invited: staff by notification and email, outside people by an email link to
`/sign/<token>`. Staff sign on the request page after confirming their password (10 minute window, the same one API keys
use). Outside signers ask for a 6 digit code by email; a code lasts 10 minutes, each signer gets at most 3 codes and 5
tries in total, a new code never resets the tries, and after 5 wrong tries the link is locked, so cancel and send a new
request. Wrong links count against the address (20 an hour), and each link allows 60 requests an hour. A link stops
working when the request is cancelled, declined, completed or expired, the module is off or the organisation is
suspended. Expiry is checked when someone opens or acts on the request; nothing runs on a schedule and no reminders go
out. "Resend invite" sends the current signer a fresh link (the old one stops working). A decline (with an optional
reason) ends the request and tells its creator. When the last signer signs, the certificate of completion is built
with each signer's details and the consent text they agreed to, stored as `<original key>-certificate`, its SHA-256 is
saved, and the creator is told. Cancelling closes every link, including the document link of someone who already
signed. Every step is in the audit log with actor kind `signature` (sent, invite_resent, code_sent, code_failed,
signed, declined, completed, cancelled); names, emails, IP addresses, browser details and typed names are kept out of
the audit log. For an offer letter (needs `recruitment.manage` to create and to send) pick the pending offer: the
candidate, who must have an email, is added first and cannot be removed, sending refuses an expired offer, and the
offer is marked accepted as soon as the candidate signs, through the normal offer rules, even if a later signer
declines. When HR accepts, declines or withdraws the offer on the offer page, its open signature request is
cancelled. Purging a candidate also deletes their offer's signature request and both files. The legal level is a
simple electronic signature with an audit trail, not a qualified one.

## Pay reviews

Finance, Pay reviews. `comp.manage` (restricted; payroll officer by default, never HR admin, who cannot read salaries)
starts a review with a name, the date the new salaries start and an optional guideline raise (0.01 to 100%), sets each
department's monthly budget, applies and closes it. Budgets and amounts are shown only to a `comp.manage` holder who can
also read every salary; a budget's use is the sum of proposed gross minus current gross, without changes finance
rejected, red when over (going over is allowed), and people without a department show as "No department".
`comp.propose` (line manager for their team, department head for their department) saves a raise of 0.01 to 100% with
a reason for anyone in scope who has a salary, except themselves. Anyone without `salary.read` for that person sees only
the percentage, never the amounts. The list shows 500 people; search by name for the rest. The proposed salary scales
BASIC and fixed earning lines by the raise, keeps `pct_basic` lines (they follow BASIC), leaves fixed deductions alone,
and solves BASIC so the gross lands on the target; the stored gross is the one the lines add up to.

"Apply proposals" needs `salary.update` as well and runs in one transaction: each proposal becomes a pending salary
change from the review's start date, made by the person applying, with the reason `<review>: <reason>`; finance
approves it in the usual place with the usual self-approval rule. A proposal is skipped and listed when it is the
applier's own raise, the person has left, already has a change waiting, joined after the start date, has a salary that
changed since the proposal (save it again), or has a salary starting on or after the review date. Skipped proposals
stay proposed, so apply again after fixing them. Applied proposals cannot be edited until finance rejects the change;
then the proposal can be saved again and re-applied. A closed review cannot be changed. Budgets and proposals are
readable in the database only with the salary flag, which `comp.propose` and `comp.manage` set, so an employee never
reads their own proposal. Increment letters are not generated; issue them from Letters after approval.

## Travel and per diem

Off by default; turn on "Travel and per diem" in Settings, Modules. My work, Travel. `travel.request` (every employee)
asks for a trip: purpose (1 to 200), country and optional city (1 to 60), leave and return dates (2000 to 2099, not
in the past, return on or after leave), estimated cost and an optional advance no larger than the cost. The request
goes to the same approver chain as leave: the manager, else the department head, else anyone with `travel.approve` or
`travel.manage` for all; `travel.approve` is seeded to line managers (team) and department heads (department), and
nobody decides their own trip unless single-admin approval is on. Only a waiting trip can be cancelled.

Approving a trip with an advance creates a salary advance (one instalment, from the month of the return date or the
current month if later, reason `Travel advance: <purpose>`) waiting in Loans for `loan.approve`; the trip is approved
only if that works, so a person with a loan or advance already waiting cannot have an advance trip approved until
finance decides it. `travel.manage` (HR admin) adds and removes per diem rates: one per country, or per country and
city, case and spaces ignored, at most 500, amounts entered in the company currency (convert foreign rates yourself).
Per diem guidance is the city rate, else the country rate, times the days including both travel days. A claim can be
linked to the claimant's own approved trip while the module is on; settlement is the sum of linked claims that are not
rejected or cancelled minus the advance, unless finance rejected or cancelled it. `travel.read` (HR admin, finance)
lists everyone's decided trips in scope with the same figures. Per diem is guidance only; nothing is paid
automatically.

## Forms, checklists and tasks

Off by default; turn on "Forms and checklists" in Settings, Modules. My work, Forms. `form.manage` (HR admin) creates a
form (title 1 to 120, description up to 1000) and adds up to 30 questions while it is a draft: text (up to 2000
characters), number (up to 10 digits and 4 decimals), date, one choice or several choices (2 to 20 choices of up to 100
characters), yes or no, photo (PNG, JPEG or WEBP), file (PDF or image) or read and confirm; at most 5 photo or file
questions. A draft with at least one question can be published, after which its questions are fixed; only a draft can
be deleted, and a published form can be archived, which hides it from everyone who has to fill it.

A published form is assigned to everyone, a department and its sub-departments, a branch, or one person who has not
left, once, every day or every week on a chosen weekday, from a start date that is not in the past to an optional end
date, at most 50 live (not yet ended) assignments per form. A once assignment is filled once; a daily one once per day;
a weekly one once per week, counted from the chosen weekday, with the start date opening the first part week. Each
person sends a form once per period, even when several assignments reach them. A yes or no question is answered with
Yes or No; when required, one of them must be picked. Ending an assignment nobody has sent yet that starts today or later
deletes it; otherwise it ends yesterday (or on its start day), so it stops being due at once and the answers stay. Files
share the 10 MB and 5 file limit of other attachments. The location is only sent when the person taps "Add my location".

The hourly lifecycle job sends the reminder in the company time zone at the chosen hour to everyone who has not sent the
current period, once per person and form: daily forms every day, once forms on each of their first 7 days, and weekly
forms on the weekday and on the start date (category `forms`). Answers
are read on the form page by `form.manage` and `form.read` within scope (department heads: department, line managers:
team, HR admin: all); attached files open for the person who sent them and for those readers.

Tasks: anyone can give a task (title up to 200, details up to 2000, optional due date not in the past) to themselves or
to someone in their `employee.read` scope who has not left; the assignee is notified (category `tasks`). The assignee or
the creator marks it done or reopens it, only the creator deletes it, and done tasks drop off after 30 days.

## Me page

Workspace, Me, for every member. Details shows the linked employee record (name, code, work email, phone, department,
designation, branch, manager, join date, status) and, for members with `employee.read`, links to the full profile, where edits and change requests follow
the existing rules; a member with no employee record sees a note instead. Payslips repeats the paid payslip list.
My requests lists the latest 20 of each of the person's own leave requests, attendance requests, expense claims, loans
and advances, and help desk tickets, plus trips and form submissions while those modules are on, newest first, each
linking to its module page; a group only shows when the member holds a permission that opens that page. Activity lists the person's own `audit_log` rows, 50 a page, newest first (an unknown or stale page link starts
again from the newest): the time in the company time zone, a
label for the table and the operation or event. Values are never read. Only user-facing tables are listed: leave,
attendance and expense requests, loans, trips, tickets and replies, form submissions, tasks, change requests, kudos,
announcement comments, files, policies and acknowledgements, letters, documents, signatures and employee records.
Survey, suggestion, salary and payroll tables never appear. The `audit_log_actor_idx` index (tenant, actor, time, id)
serves the page; nothing on it writes.

## Careers page

Turn on "Careers page" in Settings, Modules, then set "Who can see it" on an opening to "Public careers page" (or "Job
board and careers page" with the talent module on). The link is `/careers/<tenant slug>/<careers link>`; a blank link is
made from the title (with `-2`, `-3` added when it is taken, and `job` for a title with no Latin letters), a link typed
by hand must be free, and an opening that leaves the careers page drops its link. Only open openings are listed; put an
opening on hold or close it to take it down at once. The page is anonymous: limits are five applications per IP per
opening an hour, 200 per opening and 1000 per tenant a day (Redis keys `rl:careers_ip`, `rl:careers_opening`,
`rl:careers_tenant`; delete a key to lift a limit early). Bot submissions (honeypot filled, form sent in under 3 seconds
or with a missing, forged or day-old token) and repeat emails get the normal thank-you page and store nothing. CVs are
checked for a PDF header only; they are not scanned for malware, so open them with care. Only their text layer is read
for search: a scanned CV is never sent to OCR, so visitors cannot spend the AI budget. The IP limit needs the real
client address, so set `ADDRESS_HEADER` behind a proxy or every visitor shares one bucket. Nothing is emailed to the
address an applicant types. Applicants are kept under the candidate retention setting (People) and purged with other
candidates; the page names the legal name and address from Settings as the contact for deletion requests, so delete the
candidate by hand when one arrives.

## Kudos and comments

HR admins hold `kudos.moderate` and `announcement.manage`, which let them hide kudos and comments; hidden items stay
visible to moderators, marked hidden, and can be shown again. Company values for kudos are edited on the Kudos page.
Comments and reactions are allowed only while the announcement is live and only for its audience; a comment that
mentions someone outside the audience is refused. When an ex-employee's access expires, the same run that removes
survey data anonymises their kudos and comments and deletes their reactions, mentions and received kudos.

## Surveys

Anonymous answers cannot be traced back to a person, even with database access: there is no person, time or
response id on `survey_answers`, and `survey_participation` and `survey_answers` are excluded from the audit log.
After each anonymous answer the participation rows of that survey are rewritten in random order, so row versions
do not pair a person with an answer; the old row versions stay on disk until autovacuum removes them. Errors while
saving answers are logged without the answer values. Do not add a join, a trigger or a log line that links the
two. A survey cannot be edited once saved; delete it and
create it again. Results of an anonymous survey stay hidden until it closes and has at least its group size of
answers. Suggestions show to HR only once five are waiting. When an ex-employee's access expires, their
participation rows and named answers are deleted; anonymous answers stay. Deleting a department or branch deletes
the surveys sent to it.

## Health and monitoring

- `GET /healthz`: process is up.
- `GET /readyz`: Postgres, Redis and MinIO reachable (503 otherwise). Use this for load balancer checks.
- `GET /metrics`: Prometheus metrics, `Authorization: Bearer $METRICS_TOKEN`.
- Logs are JSON (pino) on stdout. Postgres logs statements slower than 500 ms.

## Scheduled work

The worker registers one hourly job (minute 5). For each active tenant it, in order: completes exits whose last day
has passed and ends expired ex-employee access, accrues leave, recomputes attendance days, prepares and locks meal
days, retries stuck meal bill emails, purges candidate data past retention, queues webhook deliveries stuck for
more than 10 minutes again and deletes deliveries older than 30 days. Each step picks up whatever is due, so
a missed hour is caught up by the next one.

## Deploy

1. Build the image.
2. Run `migrate` to completion (migrations are forward only; take a backup first).
3. Roll `app` and `worker`. Both stop cleanly on SIGTERM.

Behind a reverse proxy, set `ADDRESS_HEADER=X-Forwarded-For` and `XFF_DEPTH` to the number of proxies in front of the
app. Without them every request appears to come from the proxy, so all clients share one login and reset rate-limit
bucket. Never set them when the app is reachable directly, or clients can choose their own address.

If Redis is down, sign-in, password reset and 2FA refuse requests rather than run without limits. Saves and downloads
keep working with limits counted in each app process's memory and log `redis rate limit unavailable; counting in memory`,
so with several app processes a user can briefly get that many times the normal allowance.
The attendance kiosk also refuses PINs while Redis is down, because its lockouts live there. Staff can still punch
from their phones. Kiosk PINs are keyed with `APP_ENC_KEYS`; keep retired keys in the ring after a rotation or every
kiosk PIN made with them stops matching and has to be set again.

API keys (`/api/v1`) are limited to 600 requests a minute each, and an address that sends 30 bad keys in an hour is
refused for an hour; with Redis down both limits are counted in each app process's memory. That per-address limit is
another reason to set `ADDRESS_HEADER` behind a proxy. To cut off an integration at once, revoke its key under
Settings → API keys; changing the creator's password or disabling them also stops every key they made.

Attendance devices post to `/api/v1/punches` with their own key, limited to 60 requests a minute each, and bad keys
count toward the same 30-an-hour address limit as API keys; a working device key keeps working from a blocked
address, so one reader with an old key does not stop the others behind the same router. To cut off a lost or stolen reader, switch it off under
Settings → Attendance devices; to replace its key, make a new key there and enter it on the reader. Punches older
than 31 days are refused, so a reader that was offline longer needs its punches imported by CSV. Check "Punches to
check" on that page after each payroll approval.

Webhooks go out from the worker's `webhooks` queue. The worker must be able to reach the internet on port 443; it
refuses private and loopback addresses on purpose, so an endpoint on your own network will not work. A delivery that
fails is tried again after 1 minute, 5 and 30 minutes, then 2, 6, 12 and 24 hours. An endpoint that fails 50 times in
a row turns itself off and notifies everyone with `api.manage`; fix the receiver, then turn it back on under
Settings → Webhooks. The signing secret is encrypted with `APP_ENC_KEYS`, so keep retired keys in the ring after a
rotation.

## Backup and restore

```bash
docker compose exec -T postgres pg_dump -U hrms_owner -Fc hrms > hrms-$(date +%F).dump
docker compose exec -T postgres pg_restore -U hrms_owner -d hrms --clean --if-exists < hrms-YYYY-MM-DD.dump
mc mirror local/hrms ./hrms-files      # MinIO bucket (configure `mc alias set local ...` first)
```

Back up Postgres and the MinIO bucket together; files are referenced by key from the database. Redis holds only queues, counters, a
session cache and in-progress sign-ins: losing it drops unsent mail jobs and half-finished logins, never records.

## Rotating secrets

- Encryption key: prepend a new `kid:key` to `APP_ENC_KEYS` and restart. Keep the old key in the list until nothing
  encrypted with it remains.
- Database passwords: change `HRMS_APP_DB_PASSWORD` / `HRMS_AUTH_DB_PASSWORD`, run `migrate`, restart app and worker.

## Tests

```bash
npm test                 # unit
npm run test:int         # integration, against the local Postgres/Redis/MinIO
npm run test:e2e         # Playwright; builds the app and starts a worker
```

## Troubleshooting

| Symptom                              | Check                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------ |
| Startup fails "Invalid environment"  | The message names the variable.                                          |
| `/readyz` 503                        | The JSON body says which dependency is down.                             |
| No emails                            | Worker running? Mailpit (dev) or SMTP reachable? Failed jobs in Redis.   |
| User sees "permission" errors        | Their roles under Users; role grants under Roles.                        |
| 429 responses                        | Rate limit hit; limits are the `RL_*` variables.                         |
