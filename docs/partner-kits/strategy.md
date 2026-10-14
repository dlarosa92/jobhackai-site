# Partner distribution kits

Owner-approved build: October 14, 2026. These are two separate acquisition experiments. A researched prospect is not a partner; a prepared email is not sent. Public launch copy and new outreach remain subject to the owner's existing batch-review process.

## The bet

Put a useful resource into an email that somebody already needs to send. A recruiter confirms an interview. A property manager explains move-out. One person adopting a reusable insert can create repeated referrals without Sebastian producing daily content or paying for impressions. This is a hypothesis, not a traffic or revenue forecast.

| | Interview prep | Local move-out |
|---|---|---|
| Public destination | https://jobhackai.io/interview-prep-kit | https://jobhackai.io/directory/move-out-kit |
| First distributor | Staffing recruiter or interview coordinator who already sends candidate confirmations | Greater Cincinnati / Northern Kentucky property manager who sends move-out instructions |
| Recipient need | Explain their own contribution when an interviewer probes a team project | Compare removal quotes before the move-out deadline |
| Immediate value | Three prompts, private browser worksheet, printable notes | Five questions, two-provider worksheet, municipal-pickup guidance link |
| Partner's small action | Paste an optional preparation block beneath existing interview details | Paste an optional comparison resource beneath existing building requirements |
| Next step | One free lifetime voice interview per account; signup required; limited feedback preview | Existing junk-removal directory, then contact a provider directly |
| Commercial path | Verified practice activation, then a paid subscription if more practice/full feedback is useful | Demonstrated attributable provider contact intent, then a future explicit paid-distribution offer |

Do not promise interview success, tenant compliance, reduced support volume, bookings, or provider quality. Do not imply that a directory listing is an endorsement. No charge to a provider or new paid placement is created by this experiment.

## Distribution and ownership

1. **Stan researches continuously.** Look for public evidence of interview preparation or move-out coordination plus a real published business contact. Expand through relevant professional directories and official company sites. Quality and the approval queue determine throughput; there is no artificial five-per-day research or draft limit.
2. **Stan produces reviewable batches.** Each row needs the company, contact source, exact relevance, suppression/duplicate checks, intro, one follow-up, and the three validated links from the generator. Never infer an email address. Record held prospects and the reason. Check ongoing conversations before following up.
3. **Penny owns kit and email copy.** Start from the approved product facts and current directory sources. These pages contain her prepared concepts and wording, edited for exact offer boundaries. Refresh for substantive changes, not date churn.
4. **Sonny distributes public previews.** One text post for the core company's LinkedIn, one for the JobHackAI Local Facebook page, with platform-specific campaign tags. Prepare derivatives for other connected, correctly identified channels only after the first pair is reviewed. Keep existing Nextdoor and other schedules intact.
5. **Sebastian reviews the batch, not individual research steps.** Show exact recipients and messages together. Sending happens only after approval. A positive reply receives a ready-to-paste block containing that partner's recipient-handoff URL. No integration, candidate uploads, or tenant list is needed.
6. **Codex verifies and reports.** Verify publication/sending from native evidence, retain a private link registry, deduplicate, and reconcile useful outcomes with GA4. Existing hourly partner-outreach coordination carries the work; do not create competing automations.

## Initial qualification lanes

Recruiters: independent staffing teams with visible interview coaching, screening or placement support. Property managers: local teams with resident communication and move-in/move-out coordination. The contact can approve an email-template insert or route it to the person who can; that decision-making role is an inference until confirmed.

Start with the four prospects in the private campaign registry. Research more in parallel with draft review, without sending unapproved batches. Skip form-only contacts until a suitable permitted contact route is verified. Hold ambiguous company identities, placeholder domains, bounces, opt-outs and duplicate threads. Never treat the first four as the full addressable market.

## Messages and objections

Lead with the resource and a specific reason it fits the recipient's existing workflow. Ask whether it belongs in their confirmation or move-out email. No sales call or software setup is needed for adoption. Include one clear link and the factual offer boundary. Avoid fabricated familiarity, fake testimonials, scarcity, or “happy to hear a no.”

- Already send preparation advice: offer this as an optional worksheet underneath their existing advice.
- Already have a removal vendor: the kit is optional quote preparation, with no requirement to replace a vendor.
- Concerned about privacy: no candidate or tenant list is uploaded; worksheet entries are not submitted.
- Concerned about sales pressure: explain the free-account limit for voice practice and direct provider booking for Local.

One follow-up after at least five business days if no reply, bounce, opt-out, active thread or other suppression applies. No automated follow-up should continue after a human response.

## Launch sequence and decision rules

- **Build and verify now:** useful pages, mobile/print checks, truthful CTAs, accessible worksheets, tagged handoff inserts, crawlable HTML/Markdown and sitemap entries.
- **Prepare while building:** Stan qualifies prospects and prepares exact batches; Sonny prepares the two public previews. Do not say a page is published until the deployed URL is verified.
- **After approval:** send the approved partner batch and publish the approved channel copy. Record actual times and native evidence. Continue research and drafting while waiting; no daily research cap.
- **After first real replies:** resolve objections and help willing partners paste the insert. Count explicit confirmation of insertion separately from interest.
- **At seven days after first approved send:** compare adoption, recipient sessions and qualified actions by lane. If prospects reply but do not adopt, simplify the insert or proposition. If no replies across 20 verified delivered-to-server initial messages in a lane, inspect relevance, sending and copy before increasing sends. Server acceptance does not prove inbox placement.
- **At fourteen days:** select the lane with actual recipient use, rather than the most sends. Working targets are three confirmed template adoptions per lane and at least one meaningful downstream action per adopted partner; these are experiment goals, not forecasts. Small samples remain directional.

## Attribution contract

Generate partner links with:

```sh
node marketing/scripts/partner-kit-links.mjs interview recruiter_001
node marketing/scripts/partner-kit-links.mjs moveout property_001
```

Keep company-to-ID mappings outside Git and out of analytics. `introduction` and `followup` use `email / outreach`. `recipient_handoff` uses `email / partner_referral`. Campaigns are `voice_recruiter_handoff_2026_10` and `local_moveout_partners_2026_10`; content IDs distinguish each partner and phase. The public page's copied block uses a shared `public_*_handoff_01` ID, which cannot identify a specific distributor. Use each partner's dedicated handoff URL in their delivered block.

Do not add UTMs to internal navigation. Existing consent-gated shared attribution carries permitted acquisition information into app signup and checkout. Browser restrictions, denied consent, copied/stripped links and cross-device visits can leave attribution unknown; do not promise complete person-level coverage.

| Stage | Evidence | Interpretation |
|---|---|---|
| Outreach | Native sent item, bounce/reply evidence | Sent does not prove inbox delivery |
| Adoption | Partner explicitly confirms inserting the block | A copy event alone is not adoption |
| Recipient arrival | GA4 sessions with exact campaign + `email / partner_referral` + handoff content ID | Keep staff QA and partner outreach visits separate |
| Kit use | `partner_kit_action`: `email_block_copied` or `print_opened` | Opening print does not prove printing; no worksheet content is collected |
| Core intent | `cta_click` with `kit_interview_practice*` | A click does not establish signup or practice completion |
| Core activation/revenue | Existing verified signup, practice and collected purchase records, with available attribution | No inferred purchases or duplicate production checkout tests |
| Local intent | Distinct sessions containing `directory_contact_click`, filtered to campaign/content where supported | A contact click is not a booking or paid customer |

Use production GA4 property 523348532. Existing source, medium, campaign and manual ad-content dimensions identify these campaigns; custom kit actions are supporting diagnostics. Report unknown attribution honestly. Review existing purchase/activation event availability before using them as joined funnel results. Do not blend raw event counts with session counts or use raw outreach volume as proof of demand.

## Persona journeys

**Maya, operations analyst with an interview Friday.** Her recruiter includes the optional kit in the confirmation. Maya opens it on her phone, writes the team's result and the data work she actually owned, prints her notes, then signs up for her free lifetime voice interview. She hears where she rambles, sees the limited feedback preview, and decides whether more practice/full feedback is worth paying for. The recruiter only had to add one block to a template.

`Recruiter confirmation → three prompts → own example → voice practice → feedback preview → optional paid plan`

**Jordan, renter moving out in Northern Kentucky.** The manager's move-out email links the kit. Jordan checks building and municipal pickup rules, lists the couch and other bulky items, and compares two providers' written quotes using the worksheet. Jordan opens the directory, confirms service area and scope, then contacts a provider directly. JobHackAI Local can measure an attributable contact-intent session when consent and tags permit; it cannot claim a booking from that click. The manager only had to add the optional resource.

`Move-out email → pickup eligibility → quote worksheet → provider comparison → direct provider contact`
