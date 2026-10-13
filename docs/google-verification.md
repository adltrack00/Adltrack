# Gmail connect: Google verification

"Connect Gmail" (Settings → Add purchases from email) asks for `https://www.googleapis.com/auth/gmail.readonly`. Google classes it as a **restricted scope**. A public app that asks for it needs Google's app verification, plus a **third-party security assessment (CASA)** because Returnly reads mail on its server. The assessment is repeated **every year**.

Until verification is done, Gmail connect runs in **testing mode** and **forwarding is the default** way to add purchases from email. Forwarding and Outlook connect don't need any of this. "Continue with Google" sign-in uses only `openid email profile`, which are not sensitive scopes, so it is unaffected.

Checked October 12, 2026. Google changes this process and assessors change their prices, so check the sources below before you start.

## Testing mode (what runs today)

- In Google Cloud Console → Google Auth Platform → Audience, keep the publishing status at **Testing** and add each person under **Test users**. Up to **100 test users**.
- Test users see Google's "unverified app" warning and have to click through it.
- **Refresh tokens expire after 7 days** in testing mode. Returnly marks the inbox "access expired" and the sub-page shows "Reconnect Gmail". The sub-page says this to everyone while `GMAIL_VERIFIED` isn't `true`.
- Anyone not on the test-user list gets an error from Google. Returnly shows "We couldn't connect your inbox" and forwarding still works.

## Steps to verification

1. **Get the basics in place.** Verified domain for the app's home page and the redirect URIs (`https://<APP_URL>/api/inbox/gmail/callback`, `https://<APP_URL>/api/auth/google/callback`). A public privacy policy that describes the Gmail data use; Google's [User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) includes the "Limited Use" rules. The Terms of service draft also needs review first. Add an app logo and a support email.
2. **Confirm the scope is needed.** Google asks why a narrower scope won't do. Our answer: `gmail.metadata` has no message bodies, so order details can't be read, and nothing narrower than `gmail.readonly` gives read access to bodies. Returnly never sends, changes or deletes mail.
3. **Submit for verification** (Google Auth Platform → Verification Center). Include:
   - a written justification for each scope;
   - a demo video showing the consent screen with the scope, the "Connect Gmail" privacy text, an order email appearing as a "From email" card, and "Disconnect and delete";
   - the privacy policy link.
4. **Brand and policy review by Google.** Expect back-and-forth by email. Google may ask for changes to the privacy policy, the video or the in-app wording.
5. **CASA security assessment.** Google assigns the tier, usually Tier 2 for an app like this. You pick an authorised assessor from the [App Defense Alliance CASA list](https://appdefensealliance.dev/casa). The assessor scans the app (and for Tier 2, reviews a self-assessment questionnaire). You fix what they find and they send the letter of validation to Google.
6. **Approval.** Then set the publishing status to **In production** and set `GMAIL_VERIFIED=true` on Render. The sub-page stops showing the testing note, and refresh tokens no longer expire after 7 days.
7. **Every year:** Google asks for the assessment again. Put a reminder in the calendar about 2 months before the anniversary.

## What the assessor will look at (already in place)

- Narrowest scope; only known shopping senders and subjects are opened (`server/mail.js`); first import limited to 90 days.
- No email bodies stored: only extracted fields and the message id (`inbox_messages`). Forwarded mail waits in the job queue encrypted and is wiped once read.
- Tokens encrypted at rest with AES-256-GCM (`INBOX_TOKEN_KEY`).
- "Disconnect and delete" revokes the Google grant and deletes everything read from the inbox. "Delete my account" revokes every grant first.
- HTTPS only, HttpOnly session cookies, strict CSP, rate limits.
- Still to do before the assessment: a written incident-response plan, dependency scanning in CI, and a key-rotation procedure for `INBOX_TOKEN_KEY`.

## Costs

Google doesn't charge for verification itself. The security assessment is paid to the assessor, and **Google publishes no official price**. Prices quoted publicly in 2026 for a Tier 2 assessment:

- From about **$540 per app per year** for a basic Tier 2 assessment at the lowest-cost authorised labs, up to about $1,800 for premium options ([Switch Labs comparison](https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option), [Unipile](https://www.unipile.com/integrating-google-oauth-2-0-user-authentication-into-your-app/)).
- Much higher figures, $15,000–$75,000, appear mostly from vendors selling a pre-verified integration ([Truto](https://truto.one/google/)). Treat them as an upper bound, not a quote.

Get current quotes from two or three authorised assessors before budgeting. Plan for the cost again every year.

## Timing

- Google's brand and policy review: usually a few weeks, longer if the video or privacy policy needs changes.
- The assessment: about 1–3 weeks for Tier 2 at the faster labs (same sources as above), plus the time to fix findings.
- Plan for **6–12 weeks** from submission to production, and start well before Gmail connect needs to be open to everyone.

## Sources

- Google: [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), [OAuth app audience and testing](https://support.google.com/cloud/answer/15549945)
- Google's setup docs on [testing-mode refresh tokens expiring after 7 days](https://developers.google.com/health/setup)
- [App Defense Alliance: CASA](https://appdefensealliance.dev/casa)
- Third-party price and timing reports: [Switch Labs](https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option), [Unipile](https://www.unipile.com/integrating-google-oauth-2-0-user-authentication-into-your-app/), [Nylas](https://developer.nylas.com/docs/cookbook/use-cases/build/fix-google-access-denied/)
