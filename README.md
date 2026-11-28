# HRMS Pro

Multi-tenant HR system for running a software company: people, directory and org chart, team calendar and
events, leave, attendance,
timesheets, payroll with Bangladesh tax, loans, expenses, meal billing, recruitment, performance, helpdesk, letters,
policies, shareable reports and one search box for pages and records.

SvelteKit (Svelte 5) · TypeScript · Postgres 17 with row-level security · drizzle-orm · Redis + BullMQ · MinIO ·
Vitest · Playwright · Docker.

[![HRMS Pro walkthrough on YouTube: six roles, every module, live file attachments (6:51)](screenshots/walkthrough-video.png)](https://youtu.be/BGxO0nnjlsM)

<p align="center"><a href="https://youtu.be/BGxO0nnjlsM" target="_blank" rel="noopener">▶ Watch the 7-minute walkthrough on YouTube</a></p>

<p align="center"><a href="https://srabon444.github.io/hrms-pro/"><b>System design</b></a>: architecture, data model, business requirements and functional spec</p>

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="screenshots/home.png" alt="Owner dashboard"><br><sub>Dashboard scoped to the signed-in role</sub></td>
    <td width="50%"><img src="screenshots/employees.png" alt="Employee directory"><br><sub>Employee directory with filters and CSV import and export</sub></td>
  </tr>
  <tr>
    <td><img src="screenshots/payroll.png" alt="Payroll run"><br><sub>Payroll run with tax, provident fund and bank sheets</sub></td>
    <td><img src="screenshots/recruitment.png" alt="Recruitment pipeline"><br><sub>Recruitment pipeline from applied to hired</sub></td>
  </tr>
  <tr>
    <td><img src="screenshots/leave-approval.png" alt="Leave approval with a prescription"><br><sub>Leave approval with the attached prescription</sub></td>
    <td><img src="screenshots/roles.png" alt="Roles and permissions"><br><sub>Roles with permissions at own, team, department or company scope</sub></td>
  </tr>
</table>

## How it is built

- **Tenant isolation in the database.** Every tenant table has Postgres row-level security, so a missed filter in code
  still cannot leak another company's data.
- **Scoped permissions.** Each permission is granted at own, team, department or company scope, and every check runs
  on the server.
- **Files with access rules.** Attachments on 15+ record types (leave, resignations, candidates, offers, salary changes,
  projects, assets and more) live in MinIO and open only for people who may see the record.
- **One search box.** `Ctrl K` (or `/`) finds menu pages and records across 12 modules: people, documents, letters,
  policies, tickets, expenses, assets, projects, candidates, payroll runs and more. Each module answers through its own
  access rule, so search never shows a row its page would hide; confidential tickets match only by number.
- **Ask HR.** With AI on, Home and the Ask HR page answer questions about the asker's own leave balances and
  requests, attendance, company holidays, who is out (for people who may see the team calendar), payslips (only when
  the company shares payroll with AI) and company policies, including the text inside policy files. The model only
  picks from seven read-only lookups, each run with the asker's own access in its own short transaction, for at
  most four rounds and 45 seconds; it never writes anything. Answers link only to pages the lookups returned, never
  to links in model text, and say "I don't know" when nothing fits. The last six turns (8,000 characters at most)
  are kept in the browser only, and every round counts against the AI limits and budget as "ask".
- **Search inside policy files and CVs.** After a policy PDF or a resume is uploaded, a background job reads its
  text and search matches words inside the file, showing the matching line under the hit. Text-layer PDFs and Word
  resumes are read locally at no AI cost; scanned PDFs (or ones whose only text is a watermark) and resume images
  (PNG, JPEG, WebP) are transcribed by the company's AI when AI and file reading are on, charged to its budget as
  "index". PDFs are parsed in a separate thread with a memory cap and a 20 s limit, and Word files are unpacked with
  a size cap, so a crafted file cannot take the worker down. Inactive policies stay hidden from staff and candidates
  from anyone without recruitment access; a replaced file's old text is dropped at once and the new file is read
  straight away. Failed reads retry with backoff up to three times; files waiting for AI, or failed because of a bad
  key or quota, are picked up again when the AI settings are saved.
- **AI with the company's own key.** Settings → AI lets an owner turn AI on (with an explicit consent that data is
  sent to the provider), pick Google Gemini, OpenAI or Anthropic Claude, paste the company's API key, pick a model and
  set a monthly token budget. A key is tested with one small call before it is saved, stored encrypted and bound to
  the organisation, and never shown, logged or audited; only its last four characters are. Calls go through a model
  chain that skips models the key cannot see and falls through on rate limits, outages and timeouts. Every call is
  rate limited per person and per organisation, reserved against the budget before it runs, recorded in a usage
  table kept for 13 months, and never made while a database transaction is open. Without a key, a platform Gemini
  key can be used if the operator sets `AI_PLATFORM_GEMINI=1` (only with a paid key) and has not switched AI off for
  that organisation on the platform page.
- **AI reads files and drafts text, as suggestions only.** With AI on, "Read receipt" fills an expense row
  (merchant, date, amount, category), "Read CV" fills the add-candidate form and "Read document" fills a
  certificate's title and expiry. "Draft with AI" writes an announcement body or a job description, and "Suggest a
  reply" drafts a helpdesk answer. Nothing is saved until the person checks the form and submits it, and the normal
  form rules run again. Uploads read this way are never stored. Identity and contract documents are never sent, nor
  confidential tickets or internal notes; a receipt in another currency leaves the amount blank. Each button needs
  both the page's own permission and the AI feature switch, and file reading has its own per-person limit
  (`RL_AI_OCR_PER_USER_MIN`, default 10 a minute).
- **Money in integer poisha.** Payroll, tax, loans and meal bills never touch floating point.
- **Background work.** Email, meal bills and an hourly job for leave accrual, attendance and exits run on BullMQ
  workers backed by Redis. Each hourly step runs on its own, so one failure does not stop the others.
- **Directory and org chart.** Everyone can find colleagues, browse the reporting lines or departments and jump to
  their own place in the chart; work anniversaries and opt-in birthdays (day and month only) show on the home page.
  Optional parts like these are modules each organisation turns on or off.
- **Team calendar and events.** A month view (an agenda list on phones) of who is out, holidays and events, plus a
  private subscription link for Google Calendar, Outlook or Apple Calendar. The link is stored only as a hash, shows
  other people's leave just as "Out", stops working when the member, user or organisation is switched off or the
  password changes, and is rate limited per link and per address. Events go to everyone, a department or a branch;
  people answer going, maybe or not going and get a reminder the day before.
- **1:1s and continuous feedback** (module, off by default). An employee and their manager schedule 1:1s with a
  shared agenda and actions; open actions carry to their next 1:1. Each of the two can keep a private note that
  only they can read; HR sees the meetings and shared items but never the notes, and the notes are not written to
  the audit log. Anyone can give a colleague feedback, shared with them or kept for their manager and HR, and ask
  colleagues for feedback; feedback from a review period shows on that review. Feedback is limited to 30 a day and
  requests to 20.
- **Skills, internal job board and referrals** (module, off by default). HR keeps a skills catalogue; employees list
  their skills with a level from 1 to 5 and a manager in scope validates them (any change sends the skill back for
  validation); skills show on the employee profile. Openings marked for the internal job board list the skills they
  want, a safe Markdown description and an optional referral bonus; employees see their skill match, apply in one
  click (their manager is told only if they choose) and refer friends. Referrers and internal applicants see the stage
  of their own applications and referrals only. Hiring a referred candidate starts a referral bonus that falls due
  after the qualifying period (90 days by default) while the hire is still employed; payroll marks it paid. Ten
  applications and ten referrals a day per person.
- **Public careers page** (module, off by default). Openings set to "Public careers page" (or both) are listed at
  `/careers/<organisation>` with a link HR can set; anyone can apply with name, email, optional phone and a PDF CV up
  to 5 MB, agreeing to the retention window shown. Applicants become "Website" candidates in the first stage. Spam
  controls: a hidden honeypot field, a signed form token that must be at least 3 seconds and at most a day old, five
  applications per address per opening an hour, 200 per opening and 1000 per organisation a day. The CV is checked to
  be a real PDF (not a malware scan) and always downloads as an attachment. No email is ever sent to the applicant,
  and a repeat email shows the same thank-you page. A suspended organisation or the module being off answers 404.
- **Learning** (module, off by default). HR builds courses from text, link (videos are plain links, nothing is
  embedded), file and quiz lessons, with a pass mark and up to 10 attempts per quiz. Quizzes are graded on the server and
  the correct answers never reach the learner's browser. Courses are assigned to everyone, a department (with its
  sub-departments), a branch or one person, with a due date, required or optional, and an optional renewal every N
  months; new joiners are enrolled on the daily run, and a passed course opens its next cycle ahead of expiry. Passing
  gives a PDF certificate with a verification code HR can check. Employees also keep external certifications with an
  expiry and a file. Reminders go out 7 days and 1 day before a course is due or a certification expires. The training
  report (completion, overdue, certifications expiring in 60 days) follows the `course.report` scope.
- **E-signature** (module, off by default). HR uploads a PDF (up to 10 MB), adds up to 10 signers, staff or outside
  people, and sends it; they sign one after another in that order. Staff sign in the app after confirming their
  password (and authenticator code when 2FA is on); outside signers get an email link and confirm with a 6 digit email
  code (10 minutes, at most 3 codes and 5 tries per signer, tries never reset). Each signer sees the consent text and
  the document's SHA-256 and types their name. When everyone has signed, a separate certificate of completion PDF
  (signers, emails, UTC times, IP addresses, browsers, the original SHA-256) is stored with its own hash next to the
  untouched original. An offer letter request adds the candidate as the first signer and marks the offer accepted as
  soon as the candidate signs; an HR decision on the offer cancels the open request. The signing window counts from
  sending, a cancel closes every link, and signer personal data stays out of the audit log. This is a simple electronic signature with an audit trail, not a qualified electronic signature.
- **Pay reviews.** Payroll starts a review (name, start date of the new salaries, an optional guideline raise) and sets a
  monthly budget per department. Managers propose a raise in percent for each person in their team or department, never
  for themselves, and see salaries only where they may already read them. The new salary scales basic and fixed
  earnings, keeps percentage lines on basic, and stores the gross it really comes to. Applying the review sends each
  proposal to finance as a pending salary change; nothing changes until finance approves it, and people who cannot be
  applied (a change already waiting, a salary changed since the proposal, a start date not after the current salary)
  are listed with the reason.
- **Travel and per diem.** An optional module (off by default). Employees ask for a trip with its purpose, place,
  dates, estimated cost and an optional advance; their manager (or department head, or a travel approver) decides it
  from the inbox. An approved advance becomes a salary advance for finance to approve, repaid from the salary of the
  month the trip ends. HR keeps daily per diem rates per country or city (a city rate wins), entered in the company
  currency. Expense claims can be linked to the claimant's own approved trip, and the trip shows the per diem guidance
  and the settlement: what was claimed minus the advance.
- **Forms, checklists and tasks.** An optional module (off by default). HR builds a form from up to 30 questions
  (text, number, date, one or several choices, yes or no, photo, file, or read and confirm), publishes it and assigns it
  to everyone, a department (with its sub-departments), a branch or one person, once, every day or on one weekday,
  with an hourly reminder to those who have not sent it. Employees fill it from the phone, with a camera photo and an
  optional location; HR, department heads and line managers read the answers for the people in their scope. Anyone can
  also give an ad-hoc task with an optional due date to themselves or to someone they can see; the assignee is notified.
- **Kudos and announcement discussion.** Colleagues thank up to 10 people at once (20 kudos a day each), tagged
  with one of the company values HR lists; kudos show on a wall, on the home page and in a monthly count by value,
  and recipients are notified. Announcements get six reactions (counts only, no list of who reacted) and
  comments. Only people in an announcement's audience can read or write them, and they can mention only people in
  that audience, who are notified. Comments are limited to 10 a minute; authors delete their own, and people who
  manage announcements or moderate kudos can hide and show them again, with an audit trail. When an
  ex-employee's access ends, their kudos and comments show as "Former employee" and their reactions and mentions
  are removed.
- **Surveys, eNPS and suggestion box.** HR builds short surveys (1 to 5 ratings, eNPS, one choice from a list,
  written answers) for everyone, a department or a branch, opens them, sends up to two reminders to people who have
  not answered and closes them. Anonymous surveys keep no link between a person and their answers: who answered and
  what they answered sit in separate tables with no person, time or shared key, the list of who answered is
  rewritten in random order after every answer, and neither is written to the audit log. Results show only after
  the survey closes and with at least the chosen group size (5 or more); a department or branch with fewer people
  than that is never recorded on an answer, and hidden groups always add up to at least the group size. Named
  surveys show results while open and names on written answers. The suggestion box takes anonymous suggestions (5 a day per person) and shows them
  to HR only in batches of five, in random order. When an ex-employee's access ends, their participation and named
  answers are removed; anonymous answers stay.
- **Leave balance cards.** The Leave page shows one card per leave type: days left, the balance today, after
  approved leave still to come and after pending requests, the accrual rule in plain words, and a history of every
  credit, leave, adjustment and lapse with the balance after it and links to attached files. The numbers come
  straight from the leave ledger.
- **Locked payslip PDFs by email.** An organisation can attach the payslip PDF to the payslip email. Each person
  sets their own payslip password (12 to 64 characters, not their sign-in password) and the attached PDF is locked
  with AES-256; without a password they get the link only. Downloads inside the app stay unlocked.
- **Work weeks.** Settings → Work weeks defines other weekends, such as Saturday–Sunday next to a Friday–Saturday
  company weekend, and a profile assigns one from a date onwards. Attendance, leave day counts, payroll working days
  and meal defaults follow each person's own weekend. A change can only start today or later, never inside a month
  whose payroll is approved, and it refuses to turn rest days inside booked leave into working days; leave days that
  become rest days are dropped and refunded.
- **Work sites and breaks.** Settings → Work sites lists office locations (a point and a radius) and office
  networks, for every branch or one. The punch rule is off, flag or block: a web punch counts as on site when it
  comes from an office network or from a phone inside a site's radius (its reported accuracy adds up to 200 m).
  Flagged punches show as away from site on the team view; blocked ones are refused. A browser's location can be
  faked, so networks are the stronger check, and location is only stored while the rule is on. Staff start and end
  breaks from the attendance page. A shift can mark its break unpaid: punched breaks come off worked time, or the
  shift's break minutes on days longer than a half day when no break was punched.
- **Attendance kiosk (module, off by default).** Settings → Kiosks adds a shared tablet at a work site and makes a
  one-time pairing link that works for 15 minutes; opening it on the tablet turns that browser into the kiosk with a
  long-lived cookie, and HR can switch a kiosk off or bind it to office networks. Staff set their own 6 to 8 digit
  kiosk PIN on the attendance page (runs, repeats, their code and birth-date forms are refused; only a keyed hash is
  stored, never the PIN) and punch with their employee code and PIN. Kiosk punches count as on site. A wrong PIN and
  an unknown code get the same answer in the same time; five wrong PINs lock that code on that kiosk for 15 minutes,
  doubling each time, and HR is notified at the second lock. HR can reset a forgotten PIN. If Redis is down the kiosk
  refuses PINs rather than run without limits.
- **Read-only REST API with scoped keys.** Settings → API keys (owner-only by default) makes a key after the
  person re-enters their password (and their authenticator code when 2FA is on) within the last 10 minutes. A key
  reads employees, leave requests, attendance days, the published roster or events at a scope no wider than its
  creator's, works for 30 days to a year, and is shown once; only its hash is stored. Every request is narrowed to
  what the creator can read that day, so a demoted creator's keys shrink and a disabled creator's keys stop. The API
  lives at `/api/v1` with `Authorization: Bearer`, JSON only, cursor pages of up to 200 rows, 600 requests a minute per
  key and a short field list per endpoint (never national ID, bank, tax or pay fields); `/api/v1/openapi.json`
  describes it. Making, revoking and the first use each day are audited, and changing or resetting a password or
  turning off 2FA revokes that person's keys.
- **Webhooks.** Settings → Webhooks (same permission and password check) adds up to 10 https endpoints that hear
  when an employee is added or changed and when leave is requested, decided or cancelled. Each POST carries only the
  event name, ids and a time, signed in `X-HRMS-Signature` (`t=<seconds>,v1=<HMAC-SHA256 of "t.body">`) with a
  secret shown once. The event is written in the same transaction as the change, so a rolled-back change sends
  nothing. A failed delivery is tried 8 times over about two days; after 50 failures in a row the endpoint turns off and
  people who manage API access are told. Outbound calls go only to public addresses on port 443: every resolved
  address is checked (private, loopback, link-local, cloud metadata, CGNAT, multicast, documentation, IPv4-mapped and
  NAT64 ranges are refused), with no redirects, a 5 second limit and a 64 KB reply cap. Deliveries are kept 30 days.
- **Fingerprint and card readers.** Settings → Attendance devices (people who manage everyone's attendance, after
  the same password check) adds a reader with its own `hrd_` key, shown once and stored as a hash. The reader posts
  up to 500 punches at a time to `POST /api/v1/punches`, matched by the device user ID set on that page or by employee
  code. Each punch comes back accepted, repeated or refused with a reason (unknown person, older than 31 days, ahead
  of the clock, outside employment), so a reader can resend a batch safely. API keys cannot post punches and device
  keys cannot read anything. A punch in a month whose payroll is already approved is kept and listed under "Punches
  to check" so HR can run arrears; web and kiosk punches in a closed month are listed too. 60 requests a minute per
  device, 256 KB per request.
- **Company sign-in.** Settings → Company sign-in (owner only, after a password check) connects one Google Workspace
  or Microsoft Entra app per organisation. Only email domains proven with a DNS TXT record can sign in, and a domain
  belongs to one organisation. People link their company account once under Account → Security after a password
  check, or accept an invitation with it; accounts are matched by the provider's subject (Entra directory and object
  ID), never by email, so a company account only opens the organisation that linked it. A company sign-in opens that
  organisation only: no platform admin, no other organisations, no password or 2FA changes. The owner can require
  it for everyone but the owner, who keeps password and 2FA sign-in as the way back in (2FA must be on first). The flow uses PKCE, a nonce, a state
  kept 10 minutes in Redis and a cookie that ties it to the browser.
- **Provisioning (SCIM 2.0).** On the same page the owner creates a provisioning token (`hrs_...`, shown once,
  replaceable and revocable) and gives the identity provider the base URL `${APP_URL}/api/scim/v2`. Entra or Okta
  can then list, add and deactivate people (`/Users` with `userName eq` filters, PATCH, PUT, DELETE). It only adds
  people in the organisation's verified domains, adds an existing account as a member without changing it, never
  returns names, and never changes owners. Only `active` is honoured. Deactivation ends that person's company
  sign-in sessions; reactivation only undoes its own deactivation, so someone HR disabled or who left through an
  exit stays off.
- **Schedule.** The Schedule page is a weekly roster: a manager puts people on a shift or gives them a day off
  for each day, copies last week as drafts, and publishes the week, which tells each person. Staff only see
  published days. A published shift makes a weekend a working day for attendance and meals, a published day off
  makes a working day a rest day, and a work week marked "Rostered" rests people on every day without a shift.
  Leave days and payroll still follow the work week. People mark the times they are unavailable, and the grid flags
  a shift during them or over leave. Publishing refuses a shift over leave or inside a month whose payroll is
  approved, and warns about anyone with no rest day that week. Line managers schedule only their team.
- **Open shifts and shift swaps.** A manager can post an open shift; staff ask for it, and their approver gives
  it to one of them, which turns the other requests down. Staff can offer one of their published shifts to a
  colleague in their team or department, either as a swap for one of the colleague's shifts or as a give-away. The
  colleague accepts, then each person's approver approves; one approver over both people approves once. The swap
  is checked again at approval (employment, leave, another entry that day, approved payroll), the giver gets a
  published day off for the day they gave away, and attendance is recounted. Swaps nobody finished expire on the
  day. Requests show in the Approvals inbox, and each person's published shifts appear on their calendar and in
  their calendar feed.
- **International by default.** A new company starts on UTC, USD, a January fiscal year and a Saturday–Sunday
  weekend, or on the time zone, currency, fiscal month and weekend days its creator picks. Payslips, letters and
  reports print names in Latin, Cyrillic, Greek, Vietnamese, Devanagari and Bengali script.
- **Audit trail.** Database triggers record every change, with sensitive fields masked.
- **Tested.** 1,000+ unit, integration and end-to-end tests run against real Postgres, Redis and MinIO; a shared leak
  helper checks that reads stay inside each viewer's scope and tenant.

## Run it locally

```bash
cp .env.example .env && npm ci && npm run infra:up && npm run db:migrate
SEED_PASSWORD=secret npm run db:seed && npm run dev   # and `npm run worker`
```

The seed creates the demo company at `/t/demo` with `owner@demo.local`, `hr@demo.local`, `manager@demo.local`,
`staff@demo.local`, `payroll@demo.local` and `finance@demo.local`, all using `SEED_PASSWORD`.

Running, configuring and operating it: [RUNBOOK.md](RUNBOOK.md).
