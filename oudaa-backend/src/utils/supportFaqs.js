// -----------------------------------------------------------------------
// Hand-authored FAQ content for the in-app Help & Support panel.
// Deliberately static (not DB-backed) — this is product documentation,
// not user data, so it belongs in source control and ships with the app
// like everything else. Add/edit entries here directly; no migration or
// admin UI needed.
//
// `role`: 'ALL' | 'ADMIN' | 'RESIDENT' — ADMIN means committee member.
// -----------------------------------------------------------------------

const FAQS = [
  // ---------------------------------------------------------------------
  // Getting started / account
  // ---------------------------------------------------------------------
  {
    id: 'login-methods',
    role: 'ALL',
    category: 'Account',
    question: 'How do I log in?',
    answer:
      'You can log in with either your email address or your phone number, plus your password. If your community hasn’t added your account yet, ask a committee member to create your resident profile first — you can’t self-register.',
  },
  {
    id: 'forgot-password',
    role: 'ALL',
    category: 'Account',
    question: 'I forgot my password. What do I do?',
    answer:
      'On the login screen, tap "Forgot password?" and enter the email on your account. You’ll get a reset link by email (valid for a limited time and usable only once). If you never receive it, check spam, confirm the email on file with your committee, and try again.',
  },
  {
    id: 'update-profile',
    role: 'ALL',
    category: 'Account',
    question: 'How do I update my name, photo, or contact details?',
    answer:
      'Go to Profile from the sidebar. You can change your profile photo, and update contact info. Some fields (like your unit number) can only be changed by a committee member since they affect billing.',
  },
  {
    id: 'change-password',
    role: 'ALL',
    category: 'Account',
    question: 'How do I change my password?',
    answer:
      'Go to Profile → Security, enter your current password and your new one. You’ll stay logged in on this device; other devices will need the new password next time they refresh their session.',
  },
  {
    id: 'session-expired',
    role: 'ALL',
    category: 'Account',
    question: 'Why do I keep getting logged out?',
    answer:
      'Your login session normally lasts several days and refreshes automatically in the background while you use the app. If you’re seeing "Your session expired" often, it usually means the refresh cookie was blocked or cleared (private/incognito windows, or browser settings that block cookies) — try a normal browser window.',
  },

  // ---------------------------------------------------------------------
  // Payments (both roles)
  // ---------------------------------------------------------------------
  {
    id: 'how-to-pay-resident',
    role: 'RESIDENT',
    category: 'Payments',
    question: 'How do I make a payment?',
    answer:
      'Go to My Payments → Make a payment. Choose what you’re paying for (a fee, a project, or a fund), pick one of the community’s listed payment methods (e.g. CBE or Telebirr), send the money through your bank/mobile app, then come back and submit the transaction details so it can be verified.',
  },
  {
    id: 'self-verify-explained',
    role: 'RESIDENT',
    category: 'Payments',
    question: 'What does "self-verify" mean, and why did my payment go to Pending Review instead of Verified?',
    answer:
      'When you submit a bank transfer yourself, Oudaa automatically checks it against the bank’s records. If everything matches cleanly (amount, payer name, receiving account) it’s marked Verified instantly. If something looks slightly off — a name mismatch, an unusually large amount, or the bank response didn’t have enough detail to be fully sure — it’s set to Pending Review so a committee member can double-check it manually. This is a safeguard, not an accusation.',
  },
  {
    id: 'upload-receipt-screenshot',
    role: 'RESIDENT',
    category: 'Payments',
    question: 'Can I just upload a screenshot of my transfer instead of typing everything in?',
    answer:
      'Yes — when submitting a payment, use "Upload receipt" and attach the screenshot. Oudaa reads it automatically (amount, sender name, transaction ID, bank, date) and fills the form for you; double-check the fields before submitting since automatic reading can occasionally misread a receipt.',
  },
  {
    id: 'payment-rejected',
    role: 'RESIDENT',
    category: 'Payments',
    question: 'My payment was rejected. What now?',
    answer:
      'A rejected payment means the committee could not verify it against the community’s bank records (wrong account, amount mismatch, duplicate submission, etc.). Check the reason shown on the payment, and if you believe it’s a mistake, contact a committee member directly with your transaction reference so they can look into it — you can also resubmit a corrected payment.',
  },
  {
    id: 'payment-methods-admin',
    role: 'ADMIN',
    category: 'Payments',
    question: 'How do I add or change our community’s payment accounts?',
    answer:
      'Go to Settings → Payment Methods. You can add a CBE bank account or a Telebirr number, give it a label residents will see (e.g. "CBE — Main Account"), and mark it active/inactive. Changes to core payment details go through committee approval (see Pending Changes) before they take effect, so one member can’t silently redirect where resident money goes.',
  },
  {
    id: 'record-cash-payment',
    role: 'ADMIN',
    category: 'Payments',
    question: 'A resident paid me in cash. How do I record that?',
    answer:
      'Go to Payments → Record payment, choose the resident, what it’s for, the amount, and set the method to Cash (attach a photo of the receipt if you have one). Manually recorded payments can be edited or deleted later if you made a mistake — unlike a resident’s own bank self-verified payment, which stays append-only since the bank is the source of truth for that one.',
  },
  {
    id: 'verify-pending-payment',
    role: 'ADMIN',
    category: 'Payments',
    question: 'How do I review a payment that’s Pending or Pending Review?',
    answer:
      'Open Payments, filter by status, and click into the payment to see the resident’s submitted details alongside the bank verification response (if any). From there you can Verify or Reject it. Verifying counts it toward the resident’s balance and the community’s totals; rejecting does not.',
  },
  {
    id: 'unpaid-residents',
    role: 'ADMIN',
    category: 'Payments',
    question: 'How do I see who hasn’t paid a fee yet?',
    answer:
      'The Fees page and Reports → Collections both show payment status by resident and by month. You can also just ask the "Ask Oudaa AI" assistant in this panel — e.g. "who hasn’t paid the August dues yet?" — and it will pull the current list for you.',
  },

  // ---------------------------------------------------------------------
  // Residents (admin)
  // ---------------------------------------------------------------------
  {
    id: 'add-resident',
    role: 'ADMIN',
    category: 'Residents',
    question: 'How do I add a new resident?',
    answer:
      'Go to Residents → Add resident. Enter their name, email, unit number, and phone (used for phone-based login and reminders). They’ll be created with a temporary password flow — they can use "Forgot password" with their email to set their own.',
  },
  {
    id: 'deactivate-resident',
    role: 'ADMIN',
    category: 'Residents',
    question: 'A resident moved out. What do I do with their account?',
    answer:
      'Open their profile and choose Deactivate rather than deleting — this preserves their full payment history for your records while marking them Inactive/Moved out (you’ll pick a reason). You can reactivate them later if needed, e.g. if they move back in.',
  },
  {
    id: 'resident-owner-renter',
    role: 'ADMIN',
    category: 'Residents',
    question: 'What’s the difference between Owner and Renter on a resident profile?',
    answer:
      'It’s just a label for your own records (ownerType) — Oudaa doesn’t treat owners and renters differently for billing or permissions. Use it however your community finds useful, e.g. filtering reports.',
  },

  // ---------------------------------------------------------------------
  // Fees, Funds, Projects, Expenses
  // ---------------------------------------------------------------------
  {
    id: 'fees-vs-funds-vs-projects',
    role: 'ALL',
    category: 'Fees, Funds & Projects',
    question: 'What’s the difference between a Fee, a Fund, and a Project?',
    answer:
      'A Fee is a recurring or one-time charge every resident owes (e.g. monthly dues). A Fund is a pool of money set aside for a purpose (e.g. "Security Fund", "Emergency Fund") that residents can also contribute to directly. A Project is a specific initiative with its own budget (e.g. "Repave the parking lot") that draws money from one or more Funds.',
  },
  {
    id: 'create-fee',
    role: 'ADMIN',
    category: 'Fees, Funds & Projects',
    question: 'How do I set up a new fee?',
    answer:
      'Go to Fees → Add fee. Set the name, amount, and frequency (one-time, monthly, quarterly, yearly), plus an optional due day. It will then show up for residents in their Make a Payment flow.',
  },
  {
    id: 'create-project',
    role: 'ADMIN',
    category: 'Fees, Funds & Projects',
    question: 'How do I create a project and fund it?',
    answer:
      'Go to Projects → Add project, set its budget and which fund(s) it draws from — a project can be split across more than one fund, as long as the amounts add up to the total budget. Residents can then see and optionally contribute to it directly.',
  },
  {
    id: 'fund-goal',
    role: 'ADMIN',
    category: 'Fees, Funds & Projects',
    question: 'Can I set a fundraising goal for a fund?',
    answer:
      'Yes — open the fund and set a Goal amount. Residents will see progress toward that goal on the fund’s page.',
  },
  {
    id: 'cancel-project',
    role: 'ADMIN',
    category: 'Fees, Funds & Projects',
    question: 'How do I cancel a project?',
    answer:
      'Open the project and choose Cancel — you’ll be asked for a reason, which is shown alongside the project afterward so residents understand why it stopped.',
  },

  // ---------------------------------------------------------------------
  // Expenses & receipts (admin)
  // ---------------------------------------------------------------------
  {
    id: 'record-expense',
    role: 'ADMIN',
    category: 'Expenses',
    question: 'How do I record a community expense?',
    answer:
      'Go to Expenses → Add expense. Attach it to a project, a fund directly, or leave it general; pick a category, amount, vendor, and attach a receipt photo if you have one. Every committee member can view all expenses.',
  },
  {
    id: 'fix-expense-mistake',
    role: 'ADMIN',
    category: 'Expenses',
    question: 'I recorded an expense wrong. How do I fix it?',
    answer:
      'Expenses can’t be edited directly once recorded — instead, open the expense and choose Reverse, which creates an offsetting entry and marks the original as voided. This keeps a clean, honest trail of what actually happened rather than silently rewriting history. Then record a new, corrected expense if needed.',
  },
  {
    id: 'receipt-verify',
    role: 'ADMIN',
    category: 'Expenses',
    question: 'What does "verify" mean on a receipt?',
    answer:
      'It’s a committee member confirming the uploaded receipt image genuinely matches the expense it’s attached to — a lightweight second pair of eyes, visible to the whole committee, not an accounting audit.',
  },

  // ---------------------------------------------------------------------
  // Committee governance
  // ---------------------------------------------------------------------
  {
    id: 'pending-changes-explained',
    role: 'ADMIN',
    category: 'Committee & Approvals',
    question: 'Why do some changes need approval before they apply?',
    answer:
      'Sensitive actions — like changing the community’s payment account — require every other committee member to approve before they take effect. This shows up under Pending Changes (you’ll get a notification). One rejection cancels the request; unresolved requests auto-expire after 24 hours.',
  },
  {
    id: 'auto-approval',
    role: 'ADMIN',
    category: 'Committee & Approvals',
    question: 'What is "auto-approval" and should I turn it on?',
    answer:
      'It lets you pre-authorize your own approval for future low-stakes requests of a specific type (e.g. payment method edits), for a period you choose, instead of manually clicking approve every time. It’s entirely optional and always has an expiry — use it only for change types you’re comfortable rubber-stamping, since a request auto-approved this way still lists you as having approved it.',
  },
  {
    id: 'committee-transfer',
    role: 'ADMIN',
    category: 'Committee & Approvals',
    question: 'How do I hand my committee seat to someone else?',
    answer:
      'Go to Settings → Transfer seat, pick the resident you want to hand it to. Every other committee member must approve first, then the resident themselves must accept — either step can decline and cancel it. Once fully accepted, you become a regular resident and they become a committee member.',
  },
  {
    id: 'audit-log',
    role: 'ADMIN',
    category: 'Committee & Approvals',
    question: 'What is the Audit Log for?',
    answer:
      'It’s a permanent, read-only record of every meaningful action taken in your community’s account (who created/verified/rejected what, and when). Every committee member can view it; nothing in it can ever be edited or deleted, by design — it’s there so the committee can always account for its own actions.',
  },

  // ---------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------
  {
    id: 'reports-overview',
    role: 'ALL',
    category: 'Reports',
    question: 'What can I see in Reports?',
    answer:
      'A financial summary (total collected, total spent, net balance), collections by fee/month, and expenses by category, with a monthly trend. Residents see their own community’s totals; committee members get the same view with full drill-down and export options.',
  },
  {
    id: 'export-report',
    role: 'ADMIN',
    category: 'Reports',
    question: 'Can I export data for my own records?',
    answer:
      'Yes — most list pages (Residents, Payments, Expenses, Reports) have an Export option that downloads the data as a spreadsheet you can open in Excel or Google Sheets.',
  },
];

function getFaqsForRole(role) {
  return FAQS.filter((f) => f.role === 'ALL' || f.role === role);
}

module.exports = { FAQS, getFaqsForRole };
