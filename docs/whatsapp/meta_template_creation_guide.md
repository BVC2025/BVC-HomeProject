# Meta WhatsApp Message Template Creation Guide

**Purpose of this document:** This guide walks any administrator — with no
technical/coding background required — through creating a WhatsApp Message
Template inside Meta Business Manager, and explains exactly how the values
you enter there map to the fields on the **WhatsApp Module Settings** page
(System → WhatsApp Module Settings) in this ERP. Keep this open side-by-side
with that page while configuring a new module's WhatsApp automation.

---

## 1. What a WhatsApp Message Template Is, and Why Meta Requires One

WhatsApp does not let a business message a customer out of the blue with
any free text it likes — that would be spam. Meta enforces a simple rule,
sometimes called the **24-hour customer service window**:

- If a customer messaged your business within the last 24 hours, you can
  reply with **any plain text** you want — no template needed.
- If you are messaging someone for the **very first time**, or it has been
  **more than 24 hours** since they last messaged you, you **must** use a
  **pre-approved template** — a message format Meta has reviewed and
  approved in advance.

This is exactly why every module's very first message (the "welcome"
message, sent the moment a new record like a Lead is created) always uses a
template — a brand-new contact has never messaged you, so there's no open
24-hour window yet. It's also why a **re-engagement template** exists as a
fallback: if the AI conversation goes quiet for more than 24 hours, the next
message must go back to using a template until the customer replies again.

---

## 2. Step-by-Step: Creating a Template in Meta Business Manager

1. **Log in to Meta Business Manager** at [business.facebook.com](https://business.facebook.com) using an account that has access to your WhatsApp Business Account (WABA).
2. **Open WhatsApp Manager** from the Business Manager menu (or directly at business.facebook.com/wa/manage).
3. **Select the correct WhatsApp Business Account.** If you manage more than one, make sure you pick the same WABA that's configured on this ERP's **System → WhatsApp Configuration** page (the `WABA_ID` field there must match).
4. **Navigate to Message Templates** in the left-hand menu of WhatsApp Manager.
5. Click **Create Template** (or **Create Message Template**).
6. **Choose the appropriate category:**
   - **Utility** — recommended for transactional messages like a welcome message or an order/lead confirmation. Utility templates are reviewed faster and rejected less often than Marketing.
   - **Marketing** — for promotional content. Avoid this category for the welcome/re-engagement templates configured in this ERP, since promotional wording increases the chance of rejection for what is really a transactional message.
   - **Authentication** — only for one-time-password / login codes. Not relevant to this feature.
7. **Select the language** — pick the exact language/locale you intend to use (e.g. English (US), Tamil). Note the exact code Meta assigns it (e.g. `en_US`, `ta`) — you will need this precise code later.
8. **Enter the Template Name** — lowercase, no spaces (Meta will enforce this), e.g. `lead_welcome` or `order_confirmation`. Choose something clear and memorable, since you'll type this exact name into the ERP.
9. **Design the message body** — write the actual text customers will see. Keep it natural and professional.
10. **Add placeholders** where you want dynamic content — Meta uses `{{1}}`, `{{2}}`, `{{3}}`, and so on, numbered in the order they appear in the body. For example:
    > Hi {{1}}, thanks for your interest in {{2}}. Our team will be in touch shortly!

    Here `{{1}}` might be the customer's name and `{{2}}` their company name.
11. **Add buttons if required** — e.g. Quick Reply buttons for a language choice ("English" / "தமிழ்"), or a Call-to-Action button. Button label text is fixed at approval time — the wording you choose here is exactly what customers will tap.
12. **Submit the template for review.**
13. **Wait for Meta's approval** — this typically takes anywhere from a few minutes to a day. You can check the status (Pending / Approved / Rejected) in WhatsApp Manager's Message Templates list at any time. A rejected template can be edited and resubmitted.

---

## 3. Field-by-Field: What Each Term Means, and Where It Goes in the ERP

| Meta Business Manager term | What it means | Where it goes in this ERP |
|---|---|---|
| **Template Name** | The exact, case-sensitive name you gave the template in step 8 | `Welcome Template Name` / `Re-engagement Template Name` on the WhatsApp Module Settings page — **must match Meta's approved name exactly**, or the send will fail |
| **Language Code** | The precise locale Meta assigned in step 7 (e.g. `en_US`, not just `en`) | `Welcome Template Language Code` / `Re-engagement Template Language Code` — must match exactly, including the region suffix if Meta uses one |
| **Template Parameters** | The `{{1}}`, `{{2}}`, … placeholders you wrote into the body in step 10 | `Welcome Template Parameters` field — a **comma-separated list of field names from this ERP's data** (for the Lead Management module, these are Lead record columns like `CONTACT_NAME`, `COMPANY_NAME`), listed **in the same order** as the placeholders appear in your template body |

### How `{{1}}`, `{{2}}` map to ERP fields — a worked example

If your approved template body is:
> Hi {{1}}, thanks for your interest in {{2}}. Our team will be in touch shortly!

then in the ERP's **Welcome Template Parameters** field you would enter:
```
CONTACT_NAME,COMPANY_NAME
```
The ERP takes the record that triggered the message (e.g. a newly created
Lead), reads its `CONTACT_NAME` value and puts it into `{{1}}`, reads its
`COMPANY_NAME` value and puts it into `{{2}}`, in that exact order. If you
leave this field blank, the system falls back to a single parameter — the
contact's name — filling `{{1}}` only, which only works correctly if your
template body has exactly one placeholder.

---

## 4. How This ERP Actually Sends the Template

You don't need to understand this to configure a template, but it helps to
know what happens after you save your settings:

1. A new record is created (e.g. a Lead, via the Lead Management module).
2. If that module's WhatsApp setting has **Enabled** and **Auto-trigger**
   both turned on, and the record has a mobile number, the system queues a
   welcome message.
3. A background process picks up queued messages on a short interval,
   respecting the vendor's configured sending limits (max messages per
   second, daily sending cap) so Meta never sees a sudden flood of
   messages.
4. The message is sent to Meta's WhatsApp Cloud API using your approved
   template name, language code, and parameter values.
5. If the customer replies, the conversation continues as normal free-form
   text (AI-powered, if AI Reply is enabled) — no more templates needed
   until 24 hours pass without a reply from the customer, at which point
   the next outbound message automatically falls back to the
   Re-engagement Template.

---

## 5. When a Template Is Required vs. When Free-Form AI Text Is Used

| Situation | What gets sent |
|---|---|
| First-ever message to a new contact | **Template required** (Welcome Template) |
| Customer replied within the last 24 hours | **Free-form text** — the AI can say anything, no template |
| Customer has been silent for over 24 hours and the module needs to reach out again | **Template required** (Re-engagement Template) |
| Customer replies to the re-engagement message | **Free-form text again** — the window reopens |

---

## 6. Troubleshooting Common Rejection Reasons

- **Marketing-style wording in a Utility-category template** — Meta expects Utility templates to sound transactional/informational, not promotional. Avoid phrases like "Special offer!" or "Limited time" in a Utility template.
- **Placeholders not in sequential order** — `{{1}}`, `{{2}}`, `{{3}}` must appear in that numeric order in the body; skipping a number or using `{{2}}` before `{{1}}` will be rejected.
- **Generic or vague sample content** — when submitting for review, Meta may ask for example values for each placeholder; provide realistic-looking examples (e.g. a real-sounding name), not placeholder text like "test" or "xxx".
- **Requesting a language/locale variant that doesn't exist** — double-check the exact language code Meta offers before selecting it; a template approved under `en_US` will not match if the ERP's Language Code field is set to plain `en`.

---

### Maintenance note

If your company's welcome or re-engagement wording ever needs to change,
you do **not** need any code changes here — edit or resubmit the template
in Meta Business Manager, then update the corresponding fields (Template
Name / Language Code / Parameters) on the WhatsApp Module Settings page to
match. The **Sample WhatsApp Message Preview** on that page's Details view
gives you a quick illustrative reference of how the configured template
will look to a customer, though the exact approved wording always lives in
Meta Business Manager, not in this ERP's database.
