# Adltrack: the care team plan

**One patient, one family's care team. The family's admin adds family and paid caregivers, and a caregiver who goes to different homes can be on several families' teams. The people given My Tasks do the care, everyone else follows along, and nobody misses anything. Total transparency.**

This plan comes after [adltrack-plan.md](adltrack-plan.md) (Scan → Confirm → Take → Refill, sections 1–18). It replaces that plan's section 18, Family sharing. Decided with George on 2026-10-22.

---

## How to use this plan

There are **11 steps**. Run each one in its own session, one PR each, so it can be checked and corrected on its own. To run one, start a session and say:

> Read `docs/care-team-plan.md`. Do **step N** only. Follow "Rules for every step". Stop when its "Done when" list is true, run `npm test`, and show me screenshots on desktop and phone.

Each step has:
- **Status**: Done, In review (PR open) or To do.
- **Needs**: the steps that must be merged first.
- **Build**: what to make.
- **Done when**: how to check it's finished.

When a step is merged, update its **Status** here in the same PR.

---

## Rules for every step

1. Keep Adltrack's design: the same pages, positions, menu, type, colours and components. New screens reuse existing ones (Settings rows, sub-pages, the Item and Take cards, the My Tasks sheet). Don't restyle.
2. The safety rules in [adltrack-plan.md](adltrack-plan.md) still apply: the app only shows what the papers and labels say, never gives medical advice, and points to the doctor, pharmacist or 911.
3. **Who can do what** (decided by George):

| | Admin (one or more) | Caregiver (paid or family) | Family viewer |
| --- | --- | --- | --- |
| Add people in Settings → People by name, email and mobile | Yes | No | No |
| Pick each person's role and ticks while adding them | Yes | No | No |
| Daily care report, photos, every menu page | Yes | Yes | Yes |
| See doctors, pharmacy and the papers | Yes | Yes | Yes |
| My Tasks: do tasks with Done or Skip | If ticked | Always | No |
| + button: add a new task | Always | If ticked | No |
| + button: report an incident | Yes | Yes | No |
| Scan papers, add or change medications | Always | If ticked | No |
| Alerts: incidents, missed doses, end-of-day report | Yes | Yes | Yes |

4. **Total transparency:** every entry shows who did it and when. Incidents alert everyone straight away.
5. **Caregivers on several families:** a caregiver who goes to different homes is signed up by each family's admin and picks a patient first, then sees that patient's own Home and My Tasks. A family viewer only ever sees their own relative. An agency dashboard (one admin, many patients) comes in a later step.
6. Permissions are checked on the server, never only by hiding buttons.
7. Every step ends with `npm test` passing and before/after screenshots in `docs/screenshots/<step>/`.

---

## 1. Care teams and People in Settings

**Status:** Done (PR #26).
**Build:** Settings → People. Admins add a person by name, email and mobile number as Family viewer, Caregiver or Admin, and tick what they can also do. The invite goes by email (Resend) and text (Twilio, `TWILIO_*`), with a link to copy. `join.html` shows who added you, then create an account or sign in and join. Everyone on a team shares the owner's care plan. Entries carry the signed-in person's own name. Code: `server/team.js`, `server/sms.js`, `team.js`, the `team_members` table.
Admins can change anyone's role at any time (Settings → People → tap their name), for example moving a family viewer up to Caregiver or Admin, or back down. Only admins can do this, and the server uses the new role straight away.
**Done when:** an admin adds a caregiver, the caregiver joins from the link, and a dose the caregiver marks shows on the admin's phone with the caregiver's name.

---

## 2. Permissions enforced

**Status:** Done (PR #27). Code: `server/permissions.js` (checked on every write in `server/app.js`), `can.js` (hides what a person can't do), `Account.can` in `account.js`.
**Needs:** step 1.
**Build:**
- The server refuses changes a person isn't allowed: viewers can't change items, settings or photos; marking doses and tasks needs My Tasks; adding or changing medications and scanning papers needs that tick.
- The app hides what a person can't do: no My Tasks sheet for viewers; no Add discharge papers +, Confirm or Edit for people without the medications tick.
- **Role changes switch over by themselves.** When an admin moves someone up (Family viewer → Caregiver or Admin) or down, that person's app changes to match without signing out: the next time it opens, and within a minute while it's open. For example, My Tasks appears for a viewer who becomes a caregiver. A short note tells them: "George changed your access to Caregiver."
**Done when:** a viewer can see everything but change nothing, even by calling the API directly; a caregiver without the medications tick can do tasks but can't edit a medication; and when an admin moves a viewer up to Caregiver, My Tasks appears on that person's open app within a minute.

---

## 3. A caregiver on several families

**Status:** Done (PR #29). Decided with George on 2026-10-22: a caregiver goes to different homes and is signed up by each family's own admin, not one admin with several patients (that's the agency dashboard, a later step). Code: one account on many care teams (`membershipsOf` in `server/store.js`), `access` in `server/team.js` picks the family from the app's `X-Patient` header, and `patients.js` (the picker and the switch on Home).
**Needs:** step 2.
**Build:**
- Each family's admin adds the caregiver in their own Settings → People, with that family's own role and ticks. One account can be on any number of families' care teams.
- A caregiver on more than one family picks who they're caring for first ("Who are you caring for?", the patients' photos and names), then sees that patient's own Home and My Tasks. A switch under the photo on Home changes patient.
- They only ever see the families that signed them up, and each family's People shows only that family's team.
- The Home profile shows the patient, not the signed-in person.
**Done when:** a caregiver signed up by 3 families sees each one's own report and tasks, switches between them without signing out, can't reach a family that didn't sign them up, and a family viewer only sees their own relative.

---

## 4. Family viewer dashboard

**Status:** Done (PR #31). Decided with George on 2026-10-22: My Tasks stays the same on every dashboard. Code: `can.js`.
**Needs:** steps 2 and 3.
**Build:** Home for viewers is the same Home: the daily care report (Previous day, Today, Photos) in the same place, and the same My Tasks sheet with its done count (1/3) and line showing how far the day has gone and what's left. A viewer can open My Tasks and see every task, but tapping a task or a vital sign does nothing, so they can't mark or change anything. All menu pages stay, read only. A viewer signed up by more than one family (a grandchild following two grandparents, say) keeps step 3's picker and the switch under the photo, and each family's Home shows only that family's patient.
**Done when:** a viewer's Home shows the report, photos and My Tasks exactly as a caregiver's does, with no way to mark a task anywhere; a viewer on two families switches between them and each shows its own My Tasks.

---

## 5. The + button: new tasks and incidents

**Status:** Done (PR #32). Code: `plus.js` (the + and its forms, tasks in My Tasks and the report), `server/permissions.js` (a new task needs "Can add new tasks", an incident anyone who does the care or manages the plan).
**Needs:** steps 2 and 3.
**Build:**
- Everything here belongs to the family on screen: a caregiver on several families adds a task or reports an incident for the patient they're looking at, and it shows only in that family's My Tasks and report.
- A round + at the top right of My Tasks, with the "My Tasks" title staying top left, only for people allowed to add tasks or report incidents (moved from the far left at George's request on 2026-10-22).
- **New task:** what to do, an optional note and photo, the date and exact time, once or repeating (daily, chosen days, weekly), from today up to one year ahead. It shows in My Tasks at its time and is done with the existing Done or Skip buttons, with notes and photos as now.
- **Report an incident:** what happened (fall, refused medication, injury, behaviour, other), when, a note, photos, witnesses (their names, separated by commas), and who was told. Call 911 sits on the form.
- Both show in the daily care report, numbered and time-stamped. Like the other entries, they don't say who added them (George, 2026-10-22).
**Done when:** an admin schedules a task for next Monday at 3:00 PM and it appears in the caregiver's My Tasks then; an incident shows in the report straight away; a caregiver on two families sees each family's tasks only under that family.

---

## 6. Live updates and alerts for everyone

**Status:** Done (PR #33). Code: `server/reminders.js` (everything sent per family to that family's team: `teamOf`, `dispatchPlan`, missed doses, end-of-day reports, incidents, each person's `alert_prefs`), `server/items.js` (`mergeMarks` and `mergeVitals`, so two people marking at once keep both marks), `/api/changes` and `/api/alerts/prefs` in `server/app.js`, `account.js` (the open app checks every 2.5 seconds and takes changes in place), `remind.js` (each person's choices on Reminders), `push.js` and `sw.js` (a notification opens its family).
Decided while building it: an unmarked dose reminds the people with My Tasks again at 60 minutes and alerts everyone at 75 minutes; quiet hours hold back everything except incidents; the person who reports an incident isn't sent their own alert; the end-of-day report comes at each person's own time (8:00 PM unless they change it).
**Needs:** steps 2, 3 and 5.
**Build:**
- Reminders and alerts are sent per family, to everyone on that family's team. Today reminders are sent per account (`server/reminders.js`), so this step makes them loop over every family a person is on: a caregiver on three families gets each family's reminders, and every notification names the patient ("Rose · Lisinopril 10 mg"). Tapping it opens that family's Home.
- Changes show on other phones within a few seconds without reloading, and two people marking at once never undo each other's marks.
- Push reminders and alerts go to every person on the team, by role: dose and task reminders to people with My Tasks; incidents straight away, missed doses and the end-of-day report to everyone.
- **Missed dose:** not marked 60 minutes after its time → remind the caregivers again, then alert everyone.
- **End-of-day report:** at a set time, a summary of the day with a link to the report.
- Each person picks quiet hours and which alerts they get on Reminders, except incidents, which always arrive.
**Done when:** a caregiver marks a dose and a viewer's open app shows it within 5 seconds; an incident reaches every device; an unmarked dose alerts everyone after an hour; a caregiver on two families gets both families' reminders, each naming its patient and opening that family.

---

## 7. Subscriptions and payments

**Status:** Done (PR #34). Code: `server/billing.js` (plans, trial, Stripe Checkout, webhook, texts counted per family), the `family_plans` table, `plan.js` (Settings → Plan, admins only), the People page's note when a plan is full or ended.
Prices decided by George on 2026-10-22, counting everyone on the team, the admin too: **Solo $9 a month** (one person looking after their own or a loved one's health), **Family $19** (2 to 5 people) and **Care team $29** (6 to 10). Adding someone past the plan's size asks an admin to upgrade first. A 14-day free trial (up to 10 people) starts from Settings → Plan or when the admin first adds someone. Above 10 people: to decide with George.
**Needs:** step 3.
**Build:** a plan per family, paid by that family's admin (for example per month), a free trial, payment by card (Stripe), and the admin's plan and receipts in Settings. Caregivers and viewers never pay: a caregiver on several families is covered by each family's plan. Text invites and text alerts count towards the plan of the family that sends them. Agency plans come with step 11.
**Done when:** an admin starts a trial, pays by card and sees the plan in Settings; when a plan lapses that family's team can still see everything but can't add people, and the caregiver's other families aren't affected.

---

## 8. Clean up Settings, Support and the landing page

**Status:** Done (PR #37). Covers sections 14–17 of [adltrack-plan.md](adltrack-plan.md). Code: `menu.js` (Settings without email import or Policy review; My doctors and pharmacies; Support, Medications 101, Security and privacy and the terms rewritten), the guide in `app.html`, the landing page (`index.html`, `landing.html`), the sign-in pages' picture (`assets/care-editorial.jpg`), the hero (`campaign.png`, `assets/campaign-phone.jpg`) and the A icons. `tests/cleanup.test.cjs` checks the wording. The old purchase screens no one can reach any more still have Returnly words in their code; nothing shows them.
**Needs:** nothing.
**Build:** no return, refund, store, receipt or purchase words anywhere. Settings: remove Add purchases from email and Policy review, add My doctors and pharmacies. Support and the terms rewritten for Adltrack ("Adltrack doesn't give medical advice"). Landing page and sign up: "Bring them home. Keep them on track." with the care team in the story. Replace the clothing photos on the sign-in, sign-up and email pages.
**Done when:** a search of every user-facing string finds no Returnly wording, and `npm test` passes.

---

## 9. Go live properly

**Status:** In review. Code: `render.yaml` (Starter web service, paid Postgres), `server/health.js` (`/api/health` answers 503 and emails `ALERT_EMAIL` when reminders stop), `server/security.js` (strong passwords, shared phone sign-out, device names), the `sign_ins` table and Security and privacy in `menu.js`, `legal.js` and `legal.html` (privacy policy and terms), the consent box on `join.html` (`team_members.consented_at`). George's steps and the HIPAA list: [go-live.md](go-live.md). Still George's: switching the live site to the paid plans, `ALERT_EMAIL`, and approving the privacy policy and terms.
**Needs:** steps 1–6 merged.
**Build:**
- Render Starter web service (so reminders never sleep) and a paid Postgres with daily backups. Photos stay in Cloudflare R2.
- A health check that alerts if reminders stop sending.
- Security: strong passwords, sign out after inactivity on shared phones, a sign-in history in Security and privacy.
- Privacy and terms written for health information, and consent when joining a team. Delete account removes the papers and photos.
- **HIPAA readiness for agencies (step 11):** a Business Associate Agreement with each agency, and providers that sign one with us (hosting, database, file storage, the AI reader, email and texts). Families using it for their own relative don't need this. Have a lawyer review before selling to agencies.
**Done when:** the live site runs on paid plans with backups, reminders keep arriving overnight, and the privacy page and terms are approved.

---

## 10. Phone apps

**Status:** To do.
**Needs:** step 9.
**Build:** iPhone and Android apps from the same code (Capacitor), with native notifications and the camera, published to the App Store and Google Play.
**Done when:** the app installs from both stores, signs in, and gets a dose reminder with the app closed.

---

## 11. Agency dashboard

**Status:** To do. Details to decide with George.
**Needs:** steps 3 and 7.
**Build:** for a home care agency or small care home: one agency admin runs many patients. The agency adds its patients (name and photo), signs up its caregivers once and chooses which patients each one visits, and invites each patient's family as viewers of that patient only. The agency admin's dashboard lists every patient with today's progress. Caregivers use the same picker and switch from step 3, alongside any families who signed them up themselves. An agency plan in Subscriptions (per patient per month). A first version of adding patients under one admin was built and then set aside in step 3 (commit `257ccc8`), and can be reused.
**Done when:** an agency with 3 patients assigns a caregiver to two of them, the caregiver switches between them, each family sees only their own relative, and the agency admin sees all three on one page.
