# Adltrack: the plan

**Adltrack helps a family follow the discharge papers at home: the right medication at the right time, and a refill before it runs out.**

Adltrack is Returnly with the same design, the same pages in the same places, and the same navigation. The name changes, the words change, and what's on the cards changes. Every section below names the Returnly screen it reuses.

The journey stays four steps, like Returnly's **Scan → Item → Return → Get paid**:

**Scan → Confirm → Take → Refill**

---

## 1. Getting started (same as Returnly)

### Home page (`index.html`)
Same campaign-style layout, same Sign in and Sign up buttons, same photo and type.
- Headline: **"Bring them home. Keep them on track."**
- Line under it: "Scan the discharge papers. Adltrack turns them into a daily medication list with reminders and refills."

### Sign up / Sign in, Forgot password, Install as an app
No change apart from the name and logo text: Returnly → Adltrack everywhere.

---

## 2. The side menu (same order, same look)

| Returnly | Adltrack |
|---|---|
| Your purchases (home) | **Your medications** (home) |
| Your returns (deadline calendar) | **Your schedule** (calendar) |
| Your results (money and store credit) | **Your refills** |
| Reminders | Reminders |
| History | History |
| Settings | Settings |
| Support | Support |
| **Add purchase +** | **Add discharge papers +** |

---

## 3. Your medications (home)

Same dashboard layout as Your purchases.

- **Medication cards**, one per medication, in the same card style. Each card shows:
  - **the photo of the actual pill bottle or box** you took when confirming it (this stays on the card so everyone recognizes the exact medication),
  - the name and dose **as printed on the discharge papers**,
  - when it's taken ("8:00 AM and 8:00 PM"),
  - the next dose time, and a label: **Taken**, **Due now**, **Skipped** or **Needs refill**.
- **Totals across the top** (where items returned, refunds and store credit sit today): **Doses taken today**, **Doses left today**, **Refills to get**.
- **Your care radar** (was the return radar): the next things to do, most urgent first. For example "Evening medication at 8:00 PM", "Lisinopril needs a refill: call Dr. Patel", "Follow-up visit Thursday 2:00 PM".
- **Shortcuts**: Your schedule, Daily reminders, **Back up my medications**, Personalize my space. (Import a spreadsheet is removed.)
- **Search and filters**: Due today, Needs refill, Finished.

Tapping a card opens that medication's journey (section 5). Example medications are there on day one, labelled as examples, just like the example purchases.

---

## 4. Adding discharge papers

### a) Scan (step 1, the main way)
Same camera screen as "Scan your receipt."
- Title: **"Scan the discharge papers."** Take photos or upload a PDF. Discharge papers are long, so it takes more pages than a receipt (Returnly allows 4).
- While it works: "Reading the discharge papers…".
- It reads, from the papers only:
  - each **medication**: name, dose, how and when to take it, how long, and whether it's new, changed or stopped (only when the papers say so),
  - the **doctor who prescribed it**, with their phone number,
  - the **pharmacy**, with its address and phone, when printed,
  - **follow-up appointments**.
- Anything it can't read clearly is left blank and named underneath, exactly like Returnly does now. A blurry or dark page is refused with the reason.

### b) Confirm (step 2, was the Item card)
Same photo-grid layout as the Item card.
- One card per medication found on the papers.
- On each one you tap **Add a photo of this medication** and take a picture of the bottle or box. This photo is what then shows on the card everywhere.
- You check the name, dose and times against the bottle and the papers, then tap **Confirm**. Nothing is reminded until it's confirmed.
- The **doctor** and **pharmacy** sit in one collapsed **Edit** row (like store, date and "online / in store" do today), so you can fix the phone number or pick a different pharmacy.
- **Add one manually** stays, for a medication that isn't on the papers but the doctor told you about. **Try an example** stays.

---

## 5. Taking a medication (step 3, was the Return card)

Same layout as the Return card.

- **Top of the card**: the bottle photo, the name and dose, and **"Next dose: 8:00 PM"** (where "Return by" and "days left" sit today).
- **How to take it**: the instructions word for word from the discharge papers ("Take 1 tablet by mouth with food"). Nothing is added or reworded.
- **Prescribed by**: the doctor's name with a **Call** button.
- **Your pharmacy**: name, address, today's hours, **Call** and **Directions**. This reuses Returnly's "Nearest drop-off" section, so it can also show the three nearest pharmacies if the papers don't name one.
- **The papers**: a link to the page of the discharge papers this medication came from (where "Open retailer's return portal" sits).
- **Buttons for today's dose**: **Taken**, **Skipped**, **Need help**.
  - Skipped never moves or doubles a dose. The card says "Check the instructions or call your pharmacist about a missed dose."
  - Need help shows the doctor's and pharmacy's numbers.
- **Progress buttons** (where "I sent it back" sits today):
  - **Finished**: the course is done. The medication moves to History and stops reminding.
  - **Needs refill**: starts the refill steps in section 6.

---

## 6. Refill (step 4, was Get paid)

Same screen as Get paid, with the refill steps in place of the money lines.

1. **Call Dr. Patel for a refill** with a Call button. The doctor comes from the discharge papers this medication came from.
2. **Refill ready at the pharmacy?** Mark it when the pharmacy says it's ready.
3. **Picked up.** The medication goes back to normal, and the card says "Refilled October 20".

Adltrack reminds you every day at your reminder time until each step is done ("Call Dr. Patel for a Lisinopril refill"), the same way Returnly reminds you until the money is back.

---

## 7. Your schedule (was Your returns, the calendar)

The same monthly calendar.
- Each day shows its doses, follow-up appointments and refill steps.
- Tap a day to see only that day. Doses marked Taken or Skipped show their label.
- **Export reminders ↓** stays, for Google, Apple or Outlook calendars.

---

## 8. Your refills (was Your results)

Same layout as Your results, with refills in place of money.
- **Needs refill**: medications waiting on a call to the doctor.
- **Waiting at the pharmacy**: the doctor has been called, the refill isn't ready yet.
- **Picked up**: refills done this month.
- **Export your records ↓** stays: a list of medications, doctors and pharmacies to bring to a follow-up visit.

---

## 9. Reminders

Same page and same settings rows (reminder time, daily on/off, notifications, test, email, quiet hours, Gentle).
- What changes: a reminder goes out at **each dose's time**, not only once a day. Refill steps are reminded once a day.
- **Preview**: "8:00 PM: Lisinopril 10 mg, 1 tablet", with the bottle photo.
- **Buttons on the notification**: **Taken**, **Snooze 15 minutes**, **Skipped** (Returnly has Show QR code, Snooze, I sent it back, I'm keeping it). They work without opening the app, as now.

---

## 10. History

Same list. Finished medications and every dose marked Taken or Skipped, newest first, with the date and time.

---

## 11. Settings

- **My profile**: same.
- **My doctors and pharmacies**: every doctor and pharmacy taken from the papers, so a number can be fixed once for all medications. This sits where "Add purchases from email" sits today.
- **Security and privacy**: same, with wording for health information. **Delete my account** stays and removes the papers and photos too.
- **Terms of service**: same place, rewritten for Adltrack.
- **Policy review** (admins): removed.
- **Sign out**: same.

---

## 12. Support

Same page.
- **How Adltrack works** and **Medications 101** (was Returns 101): reading a label, what to do about a missed dose (call the pharmacist), how refills work.
- **Common questions**: Does Adltrack give medical advice? (No. It only shows what's on the discharge papers.) What if the papers and the bottle don't match? (Call the pharmacy before taking it.)
- **When to call for help**: the warning signs printed on the discharge papers, word for word, with the numbers to call.

---

## 13. Behind the scenes (kept from Returnly)

Sync across devices, private photo storage, background jobs, push and email reminders, the AI reading pipeline, and install as an app all stay as they are. The store policy engine, store lookup, email import and spreadsheet import are taken out because Adltrack doesn't use them.

---

## Safety rules Adltrack always follows

- It only shows what the discharge papers say. It never adds a medication, dose or instruction of its own.
- A blank is better than a guess: anything unclear is left for you to fill in from the bottle.
- Nothing is reminded until you've confirmed it with a photo.
- A skipped dose is never moved or doubled.
- Anything medical points to the doctor or pharmacist with their number.

---

## Not in the first version

- **Sharing with family** (more than one person on the same account, and seeing who marked a dose Taken). Today one account can be signed in on several phones, which covers a family sharing one login.
- Reading the number of pills or refills left from the bottle photo.
- iPhone and Android apps (same plan as Returnly's Session 12).
