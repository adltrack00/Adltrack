# Adltrack: the plan

**Adltrack helps a family follow the hospital's care plan at home: the right medication at the right time, a refill before it runs out, and nothing missed between family members.**

Promise: **"From discharge papers to daily care in minutes."**

Adltrack is Returnly with the same design, the same pages in the same places and the same navigation. The name, the words and what's on the cards change. The journey stays four steps, like Returnly's Scan → Item → Return → Get paid:

**Scan → Confirm → Take → Refill**

---

## How to use this plan

Every section below is written so it can be run on its own. To run one, start a session and say:

> Read `docs/adltrack-plan.md`. Do **section N** only. Follow "Rules for every section". Stop when its "Done when" list is true, run `npm test`, and show me screenshots on desktop and phone.

Each section has:
- **Status**: Done, Partly done, or To do, with the commit that did it.
- **Reuses**: the Returnly screen it changes. Layout and design stay; only words and card contents change.
- **Build**: what to make.
- **Done when**: how to check it's finished.

Sections can be run in any order unless a section says **Needs** another one first.

---

## Rules for every section

**Safety (never broken):**
1. Adltrack only shows what the discharge papers or the pharmacy label say. It never adds a medication, dose, time or instruction of its own, never works out a dose and never rewords instructions.
2. A blank is better than a guess. Anything unclear is left blank and named, for the family to fill in from the bottle.
3. Nothing is reminded until the family has confirmed it.
4. When the papers and the bottle disagree, the app never picks one. It flags it and says to call the pharmacy or doctor before giving the medication.
5. A skipped dose is only recorded. It is never moved or doubled, and an unchecked dose never means "take an extra one".
6. Anything medical points to the doctor, the pharmacist or 911, with their number.

**Design:** keep Returnly's layout, type, colours, spacing and components. Don't restyle.

**Words:** no user-facing "return", "refund", "price", "store", "receipt", "purchase" or "Get paid" anywhere a section touches. Internal names (`returnly-*` storage keys, the service worker cache name, `ReturnlyNudge`, the `render.yaml` service and database names, the `purchases` data model) stay, so saved data, sign-ins and the Render deploy keep working.

**Privacy:** the patient's name and address, record, insurance, card, Rx, DEA and NDC numbers, and barcodes are never asked for and are scrubbed from anything the AI reads.

**Every section ends with** `npm test` passing and before/after screenshots in `docs/screenshots/`.

---

## Setup (once per computer)

The AI reader (sections 2 and 3) needs `ANTHROPIC_API_KEY`. The server reads it from the environment; there is no `.env` file.

- **This PC:** in PowerShell, `setx ANTHROPIC_API_KEY "sk-ant-…"`. Then open a **new** PowerShell window, `cd` to the `Adltrack` folder and run `npm start`. Keep that window open. After pulling new code, press Ctrl+C there and run `npm start` again, then Ctrl+Shift+R in the browser.
- **Render:** the web service's Environment, add `ANTHROPIC_API_KEY`. `render.yaml` already lists it.
- Without a key the app still works; Scan just opens an empty card to fill in by hand.

---

## 1. Name and menu

**Status:** Done (9e0c32c).
**Reuses:** every page, the side menu, top nav and footer.
**Build:** Returnly → Adltrack everywhere users see it. Menu: Your purchases → **Your medications**, Your returns → **Your schedule**, Your results → **Your refills**; Reminders, History, Settings, Support unchanged. "Add purchase +" → **Add discharge papers +**.
**Done when:** no user-facing "Returnly"; the menu reads as above.

---

## 2. Scan: two ways in

**Status:** Done (a6a57a0, 1858ab4).
**Reuses:** "Scan your receipt" camera screen.
**Build:**
- Scan asks what the family has: **discharge papers** (photos or PDF, up to 8 pages) or **just the medication bottles** ("No discharge papers? Start with the bottles").
- From the papers it reads, as printed: each medication (name, strength, dose, how it's taken, how often, clock times only when printed, the instruction line word for word, how long, new/changed/continue/stop only when stated), the prescribing doctor and phone, the pharmacy, follow-up appointments, and warning signs.
- Medications marked stop get no card and are listed: "Stop taking: …".
- One card per medication comes out, shown one at a time like Returnly's items.
**Done when:** the example papers ("Try an example") produce one card per medication with blanks left blank, and stopped medications listed.

---

## 3. Confirm: match the bottle

**Status:** Done (d259112, 1858ab4, 64e5f9e).
**Needs:** section 2.
**Reuses:** the Item card (photo grid, collapsed Edit row).
**Build:**
- **Three bottle photos** per card, because the label wraps round the bottle. Each slot shows a drawn example with a made-up label until its photo is taken:
  1. **Front**: name, strength and directions.
  2. **Turn it**: pharmacy, prescriber, quantity, refills, dates, and what the pill looks like.
  3. **Turn again**: warnings.
  "Add another photo" for extra stickers. The first photo becomes the card's photo everywhere.
- The three photos are read as **one label**.
- **Papers vs bottle check**, a row each for medication, strength and directions: ✓ match, amber "These don't match. Call the pharmacy or doctor before giving this medication" with Call buttons, or "Check this yourself". A card can't be confirmed while a row differs until the family records which one the pharmacy or doctor said to follow.
- **Bottles only:** one column, "What the label says", checked against the bottle in hand.
- **"No bottle yet"** saves a "Pick up from the pharmacy" task with the pharmacy's Call button.
- Doctor and pharmacy sit in one collapsed Edit row. "Add one manually" and "Try an example" stay.
- A checkbox, **"I checked this against the papers and the bottle"**, before Confirm.
**Done when:** a card can't be confirmed without the photo, the checkbox and no unresolved amber row.

---

## 4. Dose times and reminders

**Status:** Done (0648527).
**Needs:** section 3.
**Build:**
- On each Confirm card the family picks **when** from Morning, Midday, Evening and Bedtime. The directions set **how many** ("twice a day" = 2) and no more can be picked. Times printed on the papers are used as they are. "As needed" gets no timed reminder, just a "Log a dose" button.
- A push reminder at each dose time, listing the medications due then in the instructions' own words, sent once, and not if already marked.
**Done when:** a twice-a-day medication can't be given three times, and a reminder arrives at each picked time.

---

## 5. Home: Your medications

**Status:** Done (this section's PR). Today is a list of cards like a lock list: the bottle photo, what to do with a short line from the papers, and one black **Done** button, with Skipped and Need help under each line. Totals sit in the menu, where refunds and store credit were.
**Needs:** section 4.
**Reuses:** Your purchases dashboard.
**Build:**
- **Today** at the top, the family's daily checklist: "Today, Wednesday October 14 · 2 of 5 done", every dose, appointment and refill step due today in time order, each with **Done**, **Skipped** or **Need help**.
- Medication cards: bottle photo, name and strength as printed, how to take it, next dose time, and a label: **Due now**, **Taken**, **Skipped**, **Needs refill** or **Pick up**.
- Totals across the top (where refunds and store credit sit): **Doses taken today**, **Doses left today**, **Refills to get**.
- **Your care radar** (was the return radar): the next things to do, most urgent first, e.g. "Evening medication at 8:00 PM", "Lisinopril: 2 refills left, call CVS by Oct 20", "Follow-up visit Thursday 2:00 PM".
- Shortcuts: Your schedule, Daily reminders, Back up my medications, Personalize my space. Import a spreadsheet is removed.
- Filters: Due today, Needs refill, Finished. Example medications on day one, labelled as examples.
**Done when:** the home page shows no Returnly totals, store or price, and Today lists every dose due today.

---

## 6. Take: the medication's card

**Status:** Partly done (d259112, 1858ab4, 0648527).
**Needs:** section 4.
**Reuses:** the Return card.
**Build (check, then fill gaps):**
- Top: bottle photo, name and dose, **Next dose: 8:00 PM** (where "Return by" sat), and **what the pill looks like** ("Green oval tablet, B on the front, 887 2 on the back") so the right pill is picked.
- **How to take it**, word for word. **Warnings** from the label.
- **Prescribed by** with Call; **Your pharmacy** with hours, Call and Directions (reuses "Nearest drop-off", so it can show the three nearest pharmacies when none is named).
- **The papers:** a link to the page this medication came from.
- Today's doses, each with **Taken / Skipped / Need help**, plus who marked it and when. Skipped says "Check the label or call your pharmacist about a missed dose." Need help shows the doctor, the pharmacist and 911.
- **Finished** (course done: moves to History, reminders stop) and **Needs refill** (opens section 7).
**Done when:** every item above shows on a confirmed medication, with no return wording.

---

## 7. Refill

**Status:** Partly done. Steps exist (d259112); the label's refills are read (1858ab4).
**Needs:** section 3.
**Reuses:** Get paid.
**Build (what's left):**
- **Runs out around …**: estimated from the label's quantity and the confirmed doses per day. A week before, the medication shows **Needs refill** and the steps start by themselves.
- The steps:
  1. **Call the pharmacy for a refill** (refills left), or **call Dr. … for a new prescription** (none left, or past the refill-by date).
  2. **Ready at the pharmacy?**
  3. **Picked up**: the card says "Refilled October 20", the run-out date resets and the refill count goes down by one.
- Reminded once a day at the reminder time until each step is done.
- **Discard after** date from the label: a gentle "This bottle expires on …" a week before.
**Done when:** a 60-tablet, once-a-day medication with 2 refills shows the right run-out date, and picking up counts the refills down.

---

## 8. Follow-up appointments

**Status:** To do. The papers already read appointments (a6a57a0); nothing shows them yet.
**Needs:** section 2.
**Reuses:** a Confirm card (to check them) and the Return card layout (to show one).
**Build:**
- Appointments from the papers appear as their own cards to confirm: who, where, date and time as printed, phone. If the papers say "see Dr. X in 1 week" with no date, the card asks the family to **book it** with a Call button and a date picker.
- "Add an appointment" by hand.
- Steps on each: **Booked**, **Ride arranged**, **Papers ready** (bring the medication list from section 11), **Went**.
- Reminders the day before and 2 hours before. They show on Today, the care radar and Your schedule.
**Done when:** the example papers' follow-up visit becomes a card, appears on Today on its day, and reminds the day before.

---

## 9. When to call for help

**Status:** To do. The papers already read warning signs (a6a57a0).
**Needs:** section 2.
**Build:**
- **When to call** on the home page, the Need help sheet and Support: the warning signs printed on the papers, word for word, grouped as the papers group them ("Call your doctor if…", "Call 911 if…"), with the numbers.
- Nothing is added or interpreted. With no papers, show only "Call your doctor or pharmacist with any concern. In an emergency, call 911."
**Done when:** the example papers' warning signs show word for word in all three places.

---

## 10. Your schedule

**Status:** To do (menu label only).
**Reuses:** Your returns calendar.
**Build:** the same monthly calendar. Each day shows its doses, appointments and refill steps. Tap a day to see only that day; Taken and Skipped doses show their label. **Export reminders ↓** stays for Google, Apple and Outlook.
**Done when:** no return deadlines show; a day with doses lists each dose time.

---

## 11. Your refills and the medication list

**Status:** To do (menu label only).
**Reuses:** Your results.
**Build:**
- Three groups: **Needs refill**, **Waiting at the pharmacy**, **Picked up this month**.
- **Medication list ↓** (was Export your records): one printable page with every medication, how it's taken, the doctor and the pharmacy, to bring to a follow-up visit or show a pharmacist. In bottles-only mode it says "Ask your pharmacist or doctor to review this list."
**Done when:** no money totals show, and the medication list prints on one page for 5 medications.

---

## 12. Reminders page

**Status:** Partly done (dose reminders in 0648527).
**Reuses:** the Reminders page and its settings rows.
**Build:** same rows (reminder time for refill and appointment steps, daily on/off, notifications, test, email, quiet hours, Gentle). The **preview** reads "8:00 PM: Lisinopril 10 mg, 1 tablet" with the bottle photo. Buttons on the notification: **Taken**, **Snooze 15 minutes**, **Skipped**, working without opening the app.
**Done when:** the test notification shows a dose with those three buttons and they mark the dose.

---

## 13. History

**Status:** To do.
**Reuses:** History.
**Build:** finished medications and every dose marked Taken or Skipped, newest first, with the date, time and who marked it.
**Done when:** marking a dose Taken shows it at the top of History.

---

## 14. Settings

**Status:** To do.
**Build:**
- **My profile:** same.
- **My doctors and pharmacies** (where "Add purchases from email" sat): every doctor and pharmacy from the papers and labels. Fix a number once and every medication uses it.
- **Security and privacy:** wording for health information. **Delete my account** also removes the papers and bottle photos.
- **Terms of service:** rewritten for Adltrack, with "Adltrack doesn't give medical advice".
- Remove **Policy review** (admins) and email import.
**Done when:** no store, policy or email-import rows remain.

---

## 15. Support

**Status:** To do.
**Build:**
- **How Adltrack works:** Scan → Confirm → Take → Refill in four short lines.
- **Medications 101** (was Returns 101): reading a pharmacy label, what to do about a missed dose (call the pharmacist), how refills work.
- **Common questions:** Does Adltrack give medical advice? (No. It only shows what's on the papers and the label.) What if the papers and the bottle don't match? (Call the pharmacy before giving it.) I don't have the discharge papers. (Start with the bottles.)
- **When to call for help:** from section 9.
**Done when:** no return wording remains on Support.

---

## 16. Landing page and sign up

**Status:** To do (name only).
**Reuses:** `index.html`, sign up, sign in, forgot password, install as an app.
**Build:** same campaign layout. Headline **"Bring them home. Keep them on track."** Under it: "Scan the discharge papers or the bottles. Adltrack turns them into a daily checklist with reminders and refills, shared with your family." Three steps under the fold: **Scan**, **Confirm**, **Follow**.
**Done when:** the landing page has no Returnly copy or images about shopping.

---

## 17. Leftover wording sweep

**Status:** To do. Run this last, or whenever a screen still says return, price or store.
**Build:** search every user-facing string (HTML, JS, emails, notifications, server error messages, the manifest, README) for return, refund, price, store, receipt, purchase, shop, retailer, Get paid, and replace each with the Adltrack wording from the sections above. Also rename the package to `adltrack` in `package.json`. Leave the internal names listed in "Rules for every section".
**Done when:** the search finds no user-facing hits, and `npm test` passes.

---

## 18. Family sharing

**Status:** To do (later). Today one login on several phones covers a family.
**Build:**
- **Invite a family member** by email to the same patient's plan. Everyone sees the same Today list.
- Every Done, Skipped and Need help shows **who** and **when**, so nobody gives a dose twice.
- **Assign** a medication, appointment or refill step to a person; their reminders go to them.
- A **Family** tab on the home page: who's doing what today, and what's still open.
**Done when:** two accounts on one plan see each other's Taken marks within a few seconds.

---

## Not in the first version

- Medical advice of any kind: interpreting symptoms, changing doses, or suggesting what to do about a missed dose.
- Several patients under one account (one plan per account for now).
- Insurance, prices and pharmacy ordering.
- iPhone and Android apps (same plan as Returnly's Session 12).
