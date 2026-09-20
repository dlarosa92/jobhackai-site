// Content banks used to generate transcript fixtures.
// Each role has 3 scenarios, one per interview question. Every scenario
// provides labeled fragments (situation, background, action, process,
// outcome, metric, vague, short, irrelevant, conflict, leadership) that
// archetype "plans" compose into candidate answers.

export const QUESTIONS = [
  'Tell me about a time you had to deliver under a tight deadline.',
  'Describe a situation where you disagreed with a teammate or stakeholder. How did you handle it?',
  "Tell me about a project you're proud of. What was your role and what was the result?"
];

export const ROLES = [
  'Software Engineer',
  'Product Manager',
  'Data Analyst',
  'Account Executive',
  'Customer Support Manager'
];

export const ROLE_SCENARIOS = {
  'Software Engineer': [
    {
      situation: 'Two weeks before our holiday sale, load testing showed our checkout service timing out at peak traffic.',
      background: [
        'A bit of context first: our platform is a mid-sized e-commerce site built on a microservices stack that we migrated from a monolith about two years ago.',
        'The checkout service itself had been through three ownership changes, most of the original team had left, and the documentation was thin, so nobody really knew its edge cases anymore.'
      ],
      action: 'I profiled the service, found an N+1 query in the cart lookup, added a covering index, and put a Redis cache in front of the pricing calls.',
      process: [
        'First I set up a local reproduction with production-like data, then I wired up tracing so I could see span-level timings across every downstream call.',
        'After that I wrote a benchmark harness, tested three caching strategies against each other, and reviewed the rollout plan with the on-call team before deploying behind a feature flag.'
      ],
      outcome: 'We shipped the fix before the sale and checkout stayed healthy through peak traffic.',
      metric: 'P95 latency dropped from 2.1 seconds to 180 milliseconds and we processed three times normal order volume with zero checkout incidents.',
      technical: 'The root cause was an N+1 query pattern where each cart item triggered a separate pricing lookup; I batched those into a single query, added a composite index on cart_id and sku, and fronted the pricing service with a Redis cache using a 60-second TTL and stampede protection via request coalescing.',
      leadership: 'I set the technical direction, split the work between two engineers, kept stakeholders updated daily, and made the final call on the rollout plan.',
      vague: 'We had some performance problems before a big sale, so I worked on making things faster and it went fine in the end.',
      short: 'I fixed a slow checkout service right before a deadline.',
      irrelevant: "Honestly, what I'd love to talk about is my home lab setup — I recently rebuilt my Kubernetes cluster on three mini PCs, and I've been experimenting with self-hosting my own media server, which taught me a lot about networking.",
      conflict: 'Although, to be fair, we actually ended up missing the sale deadline and the fix only went out the following month.'
    },
    {
      situation: 'Last year our tech lead wanted to rewrite our reporting module in a new framework right before a major release.',
      background: [
        'For context, the reporting module was about five years old, written by a contractor team, and every team had a slightly different opinion about what should happen to it.',
        'There was also a company-wide push at the time to standardize our frontend stack, which added a lot of politics to what should have been a technical discussion.'
      ],
      action: 'I put together a one-page risk comparison, proposed we defer the rewrite and instead fix the two worst pain points, and walked the lead through the data in a one-on-one.',
      process: [
        'I started by listing every open bug against the module, categorized them by root cause, and estimated the fix cost for each one individually.',
        'Then I scheduled separate conversations with QA, the product owner, and the lead to gather each perspective before writing anything down.'
      ],
      outcome: 'The lead agreed to defer the rewrite, the release shipped on time, and we scheduled the rewrite for the next quarter with proper planning.',
      metric: 'The release shipped on schedule, the two targeted fixes cut reporting-related support tickets by 40 percent, and the rewrite later landed a quarter early because of the prep work.',
      technical: "My main concern was that the new framework's server-side rendering model didn't fit our report-generation pipeline, which streams large CSV exports through a worker queue, so a rewrite would have forced us to redesign the entire export path under deadline pressure.",
      leadership: "I framed the tradeoff for the team, aligned the product owner and the tech lead on shared decision criteria, and took ownership of the deferred-rewrite plan so the disagreement didn't linger.",
      vague: 'Me and a coworker disagreed about a technical thing, we talked about it, and eventually we figured something out that worked for both of us.',
      short: 'I disagreed with my tech lead about a rewrite and we talked it out.',
      irrelevant: "Disagreements are interesting — my favorite debate lately is tabs versus spaces, and I also have strong opinions about which text editor is best, which I'm happy to get into if you want.",
      conflict: "That said, I mostly just went along with the rewrite anyway because I don't like pushing back on senior people."
    },
    {
      situation: 'Our support team was spending hours manually triaging bug reports, so I pitched and built an internal triage tool.',
      background: [
        'To give the full picture, our support volume had roughly doubled after a big partnership launch, and the support team had grown from four people to nine in six months.',
        "We'd also just switched ticketing systems, so everyone was already dealing with new workflows and nobody had bandwidth to spare for process fixes."
      ],
      action: 'I designed the tool, built the classification pipeline, integrated it with our ticketing system, and ran weekly feedback sessions with the support team to tune it.',
      process: [
        'I began with two weeks of shadowing support agents to map their exact triage steps, wrote up the workflow, and got sign-off on it before writing any code.',
        'Then I built the integration incrementally — first read-only suggestions, then auto-labeling, then routing — validating each stage against a golden set of historical tickets.'
      ],
      outcome: "The tool became part of the support team's daily workflow and freed them up to focus on complex tickets.",
      metric: 'Average triage time dropped from 25 minutes to under 4, about 60 percent of tickets were auto-routed correctly, and the support lead estimated it saved roughly 15 hours a week.',
      technical: 'The classifier was a two-stage setup — a rules layer for known error signatures, then an embedding-based similarity match against resolved tickets — and I kept the whole thing observable with a review queue so agents could correct bad routes, which fed corrections back into the rules layer.',
      leadership: 'I drove the project end to end — got buy-in from the support director, negotiated engineering time with my manager, and mentored a junior engineer who built the dashboard.',
      vague: 'I built an internal tool that people liked and it made some processes better around the team.',
      short: 'I built a ticket triage tool for our support team.',
      irrelevant: "The project I'm most proud of is actually my sourdough starter — keeping it alive for three years takes real dedication, and I've gotten my weekend baking routine down to a science.",
      conflict: 'In the end the tool never really got adopted and support went back to manual triage, but I still consider it a success.'
    }
  ],

  'Product Manager': [
    {
      situation: 'Six weeks before a contractual launch date with our biggest client, engineering flagged that the integration scope was about 30 percent bigger than estimated.',
      background: [
        'Some context: this client represented our expansion into the enterprise segment, and the contract had been negotiated over nine months with a lot of executive attention on it.',
        'Our team had also just reorganized, so half the engineers were new to the codebase and the person who made the original estimate had moved to another team.'
      ],
      action: 'I re-scoped the launch with engineering, cut two nice-to-have features into a fast-follow, renegotiated the acceptance criteria with the client, and set up a daily 15-minute risk check.',
      process: [
        'I started by building a feature-by-feature spreadsheet of effort, risk, and contractual necessity, and reviewed it line by line with the tech lead.',
        'Then I drafted three descope options, socialized them with sales and legal before the client call, and documented every agreement in a shared decision log.'
      ],
      outcome: 'We hit the launch date, the client accepted the phased plan, and the fast-follow shipped three weeks later.',
      metric: 'We launched on the contractual date, the client signed off with zero penalty clauses triggered, and the fast-follow shipped in week three with a 92 percent feature-adoption rate in its first month.',
      leadership: 'I owned the client relationship through the crunch, aligned engineering, sales, and legal on one plan, and took the heat in the exec review so the team could focus.',
      vague: 'We were behind on a big launch, so I helped reprioritize some things and we ended up getting it out okay.',
      short: 'I descoped a launch to hit a contractual deadline.',
      irrelevant: 'Deadlines remind me of my marathon training, actually — I follow a pretty strict 16-week plan, and the discipline of hitting weekly mileage targets has taught me a lot about myself as a person.',
      conflict: 'Though honestly the launch slipped by two months in the end and the client was pretty unhappy about it.'
    },
    {
      situation: "Our head of sales wanted to promise a custom analytics dashboard to close a deal, and I didn't think we should build it.",
      background: [
        "For background, we'd been burned before by one-off customer commitments — we had at least four bespoke features on the roadmap that only one customer each actually used.",
        'At the same time, the sales team was under real pressure that quarter and this deal was material to their number, so tensions were already high before I got involved.'
      ],
      action: 'I pulled usage data on past custom builds, quantified the maintenance cost, and proposed an alternative — a configurable reporting API that served this client and three other open deals.',
      process: [
        "I interviewed the client's analysts myself to understand what they actually needed versus what was written in the deal memo.",
        'Then I ran the proposal past engineering for a feasibility check, priced both options with finance, and brought a one-pager to the sales leadership meeting rather than debating it over email.'
      ],
      outcome: 'Sales agreed to the API approach, the deal closed anyway, and we avoided another unmaintainable one-off build.',
      metric: 'The deal closed at full value, the API we built instead was adopted by five enterprise accounts within two quarters, and we retired two of the old custom dashboards it replaced.',
      leadership: 'I made the disagreement about the data instead of the people, gave sales a path to win the deal, and set a precedent the exec team later formalized into our custom-work policy.',
      vague: 'Sales wanted a feature I disagreed with, we discussed it a bunch, and we landed somewhere reasonable in the end.',
      short: 'I pushed back on a custom feature request from sales.',
      irrelevant: "Speaking of disagreements, my book club had a heated debate about whether the ending of our last novel was earned — I ended up writing a two-page defense of the author, which everyone found a bit much.",
      conflict: "Ultimately I just built the custom dashboard they asked for since it wasn't worth the argument."
    },
    {
      situation: 'Our onboarding flow was losing almost half of new signups before activation, and I led the project to redesign it.',
      background: [
        'To set the stage, activation had been flat for a year while marketing spend kept climbing, so acquisition costs were quietly eating our growth story.',
        'Three previous attempts to fix onboarding had stalled because they tried to redesign everything at once and never shipped anything.'
      ],
      action: 'I mapped the funnel step by step, identified the three biggest drop-off points, ran a research sprint with eight customer interviews, and drove a series of five A/B-tested changes.',
      process: [
        'I set up weekly funnel reviews with design and engineering, wrote crisp one-page briefs for each experiment, and kept a public scoreboard of results.',
        'Each experiment had a pre-registered success metric and a kill criterion, so we never argued after the fact about whether something had worked.'
      ],
      outcome: 'Activation improved meaningfully and the new flow became the template for how we run growth experiments.',
      metric: 'Activation rate went from 52 to 71 percent in one quarter, trial-to-paid conversion rose 18 percent, and the experiment framework we built is still used by three other teams.',
      leadership: 'I got exec sponsorship, protected the team from scope creep, and coached two junior PMs who were running experiments end to end by the final month.',
      vague: 'I worked on improving our onboarding and the numbers got better after we made some changes.',
      short: 'I led an onboarding redesign that improved activation.',
      irrelevant: "What I'm genuinely proudest of is my vegetable garden — this year I finally beat the squirrels with a netting system of my own design, and the tomato yield was honestly spectacular.",
      conflict: "That said, activation didn't actually move and the redesign was quietly rolled back the next quarter."
    }
  ],

  'Data Analyst': [
    {
      situation: 'The CFO requested a board-ready revenue analysis two days before the board meeting, after the original owner went out sick.',
      background: [
        'For context, our revenue data lives across three systems — billing, the CRM, and a legacy spreadsheet process from before my time — and they never fully agree with each other.',
        'This was also my first quarter at the company, so I was still learning where the bodies were buried in the data warehouse.'
      ],
      action: "I scoped the questions with the CFO's chief of staff first, rebuilt the revenue reconciliation query, validated the totals against billing exports, and built a six-slide summary with clear caveats.",
      process: [
        'I started by writing down the five questions the board actually needed answered before touching any data.',
        'Then I built the query incrementally with checkpoint validations at each join, and had a peer review both the SQL and the final numbers before anything went out.'
      ],
      outcome: 'The analysis went to the board on time and the CFO used it as the anchor for the revenue discussion.',
      metric: 'I delivered in 36 hours, the numbers reconciled to within 0.3 percent of billing, and two of my slides went into the board deck verbatim.',
      leadership: "I coordinated the handoff from the sick analyst's notes, negotiated scope directly with the CFO's office, and briefed my manager daily so nobody was surprised.",
      vague: 'I had to do a big analysis on short notice and it worked out — leadership seemed happy with what I gave them.',
      short: 'I turned around a board-level revenue analysis in two days.',
      irrelevant: 'Tight deadlines make me think of speedrunning, which is a hobby of mine — I hold a personal best in an old platformer that took me four hundred attempts, and the optimization mindset carries over, I think.',
      conflict: "Although in the end the deck wasn't used because the numbers didn't hold up under review."
    },
    {
      situation: 'Our marketing director wanted to report campaign ROI using a model I believed double-counted conversions.',
      background: [
        'Some background: attribution had been a running argument for two quarters, and each team had its own dashboard that told a flattering story.',
        'The director had also just presented the old numbers to the CMO, so changing the model meant walking back a story leadership already liked.'
      ],
      action: 'I built a side-by-side comparison of the two attribution models on the same campaign data, quantified the double-counting, and proposed a compromise model with a documented methodology.',
      process: [
        'I recreated their model from scratch first so I could critique it accurately, and annotated exactly where conversions were being counted twice.',
        'Then I previewed my findings with the director privately before any group meeting, so it never became a public ambush.'
      ],
      outcome: 'We adopted the corrected model, and the director appreciated getting ahead of it before the next exec review.',
      metric: 'The corrected model showed ROI had been overstated by about 35 percent; after the fix, forecast accuracy for the next two campaigns landed within 8 percent of actuals.',
      leadership: 'I treated it as a methodology problem rather than a turf war, wrote the documentation standard we now use for all attribution models, and presented the change jointly with the director.',
      vague: 'I disagreed with how another team was measuring something, we went back and forth for a while, and eventually we sorted out a better way.',
      short: 'I flagged a flawed attribution model and got it fixed.',
      irrelevant: "On the topic of disagreements, I volunteer as a referee for a youth soccer league on weekends, and de-escalating arguments with parents on the sideline is honestly a skill of its own.",
      conflict: "In the end I let the original numbers stand since it wasn't really my call to make."
    },
    {
      situation: 'I noticed our churn reports only looked at cancellations after they happened, so I built an early-warning churn model.',
      background: [
        'For the full picture, customer success had twelve account managers covering nine hundred accounts, so they could only be proactive with a small fraction of the book.',
        'The data for this lived in five different tools, and nobody had ever joined product usage to support history before.'
      ],
      action: 'I assembled a training dataset joining usage, billing, and support signals, built a scoring model, and worked with customer success to design an intervention playbook around it.',
      process: [
        'I validated the model against two years of historical churn before showing anyone a single score.',
        'Then I ran a four-week pilot with three account managers, gathered their feedback on false positives, and tuned the threshold before the full rollout.'
      ],
      outcome: 'Customer success adopted the scores into their weekly planning and started reaching at-risk accounts before they cancelled.',
      metric: 'The model flagged 68 percent of churners at least six weeks early, and accounts that received proactive outreach churned 22 percent less than the control group.',
      leadership: 'I pitched the project to the VP of customer success myself, ran the cross-functional pilot, and trained the whole CS team on interpreting the scores.',
      vague: 'I did a project around churn data that helped the customer team be more proactive about things.',
      short: 'I built a churn early-warning model for customer success.',
      irrelevant: "The thing I'm proudest of lately is restoring a 1970s road bike I found at a flea market — sourcing period-correct parts took months and taught me a surprising amount about patience.",
      conflict: "Ultimately the model was never used because the CS team didn't trust the scores."
    }
  ],

  'Account Executive': [
    {
      situation: 'My largest prospect moved their procurement deadline up by three weeks, right in the middle of our security review.',
      background: [
        'For context, this was a two-hundred-seat deal that had been in the pipeline for five months, with six stakeholders on their side and a competitive bake-off against two rivals.',
        'Our security questionnaire process normally takes a month because it routes through legal, IT, and a third-party auditor.'
      ],
      action: 'I got our sales engineer and security lead in a room the same day, built a compressed timeline working backward from their date, and personally chased every open item across both companies daily.',
      process: [
        "I created a shared tracker with the buyer's procurement team so both sides saw the same status in real time.",
        'I also pre-drafted answers to the forty most common security questions from past deals so our responses could go back the same day.'
      ],
      outcome: 'We completed the review in time and signed before their deadline.',
      metric: 'We closed the 200-seat deal nine days early at full list price, and the compressed security-review playbook I built cut our average enterprise review time by two weeks.',
      leadership: "I quarterbacked five people across three departments who didn't report to me, kept the buyer's exec sponsor engaged with twice-weekly updates, and escalated exactly once, at the right moment.",
      vague: 'A big deal got moved up unexpectedly, so I hustled to keep everything on track and we got it done.',
      short: 'I closed a big deal on a compressed timeline.',
      irrelevant: "Pressure situations remind me of my poker hobby — I play in a weekly tournament and final-tabled a regional event last year, which is really more about patience than bluffing, despite what people think.",
      conflict: 'Even so, the deal ended up pushing to the next quarter and we eventually lost it to a competitor.'
    },
    {
      situation: 'My sales manager wanted me to push a prospect toward our premium tier, but their use case honestly fit the standard plan.',
      background: [
        'Some background: it was the last month of the quarter and the team was behind on the premium-mix target that leadership watches closely.',
        "I'd also spent three months building trust with this buyer, who had been burned by overselling from a previous vendor."
      ],
      action: 'I laid out the risk of overselling to my manager with two examples of churned oversold accounts, and proposed selling the standard plan with a structured expansion path tied to their growth milestones.',
      process: [
        'I pulled the retention numbers on oversold deals from the last two years so it became a data conversation instead of a judgment call.',
        'Then I wrote the expansion plan into the account notes with specific trigger points, so the upsell path was concrete rather than a vague promise.'
      ],
      outcome: 'My manager backed the approach, the client signed the standard plan, and the relationship stayed strong.',
      metric: 'The client signed standard, expanded to premium seven months later exactly on schedule, and the account grew to 2.4 times its original contract value within eighteen months.',
      leadership: 'I disagreed in private, committed publicly, and turned the disagreement into a repeatable expansion-path framework the whole team now uses.',
      vague: 'My manager and I saw a deal differently, we talked it through, and it came out fine for everyone involved.',
      short: 'I pushed back on overselling a client and was right.',
      irrelevant: 'Disagreements, sure — my brother and I have a running argument about the best barbecue style, and our annual cook-off has gotten competitive enough that we bought matching smokers.',
      conflict: 'In the end I sold them the premium tier like my manager wanted, and they churned within the year.'
    },
    {
      situation: 'Our team had no real process for re-engaging closed-lost deals, so I built one and proved it out on my own book.',
      background: [
        'For the record, closed-lost accounts were basically a graveyard in the CRM — nobody had touched most of them since the loss date, some for two years.',
        'This started as a side project during a slow month, not something anyone asked me to do.'
      ],
      action: 'I audited 18 months of closed-lost deals, categorized the loss reasons, built a re-engagement cadence for each category, and ran it systematically for a full quarter.',
      process: [
        'I tagged every closed-lost account by loss reason, competitor, and timing, then wrote category-specific outreach sequences rather than one generic follow-up.',
        'I tracked reply and meeting rates per sequence weekly and killed the two sequences that were underperforming by week four.'
      ],
      outcome: 'The playbook revived a meaningful set of dead opportunities and was adopted by the rest of the team.',
      metric: 'I reopened conversations with 31 accounts, closed four of them for 380 thousand dollars in new revenue, and the playbook added roughly 12 percent to team pipeline the following quarter.',
      leadership: 'I built it solo, proved it with my own quota, then packaged the playbook and personally trained the six other reps on the cadence.',
      vague: "I worked on a way to revisit old deals that didn't close, and it brought some business back in.",
      short: 'I built a closed-lost re-engagement playbook.',
      irrelevant: "What I'm really proud of is my fantasy football league title — twelve years of playing and I finally won the whole thing with a draft strategy I'd been refining for seasons.",
      conflict: 'Truthfully none of the revived deals ever closed, but the effort felt worthwhile anyway.'
    }
  ],

  'Customer Support Manager': [
    {
      situation: "A botched release broke password resets on a Friday afternoon, and we had 48 hours before Monday's peak to get support ready while engineering worked on the fix.",
      background: [
        'Context-wise, our support team runs lean on weekends — normally just two agents covering all channels — and Monday mornings are our highest-volume window of the week.',
        'This also happened during a holiday weekend when half the team had approved time off, which made staffing especially tricky.'
      ],
      action: 'I stood up an incident channel, wrote customer-facing macros and a workaround guide within two hours, rearranged weekend coverage with volunteers, and synced with engineering every four hours.',
      process: [
        'I triaged the likely contact drivers first, drafted responses for each, and had engineering fact-check the workaround before anything went out to customers.',
        'I also set up a live tracking sheet of ticket volume by hour so I could shift agents between channels as the pattern emerged.'
      ],
      outcome: 'We absorbed the Monday spike without a meltdown and customers got accurate answers throughout the incident.',
      metric: 'First-response time stayed under 30 minutes through a 4x ticket spike, CSAT on incident tickets held at 4.2 out of 5, and the workaround guide deflected an estimated 300 tickets.',
      leadership: 'I ran the incident end to end — coverage, communications, and the engineering liaison role — and afterward ran the postmortem that produced our now-standard incident playbook.',
      vague: 'We had a big incident before a busy period and I helped get the team through it without too much damage.',
      short: 'I managed support through a weekend incident.',
      irrelevant: 'Weekend crises aside, my real passion project is my community garden plot — the zucchini situation this summer got completely out of hand and I ended up delivering produce to half my street.',
      conflict: 'Come Monday the queue collapsed anyway and most customers waited over a day for answers.'
    },
    {
      situation: 'Our VP wanted to cut phone support entirely to reduce costs, and I thought it would hurt our highest-value customers.',
      background: [
        'By way of background, phone was only 9 percent of ticket volume, which made it look like an easy cut on a spreadsheet.',
        'But our enterprise segment had grown 40 percent that year, and those buyers had phone support written into their expectations if not their contracts.'
      ],
      action: 'I segmented phone usage by customer tier, showed that enterprise accounts made up two-thirds of call volume, and proposed cutting general phone access while keeping a dedicated line for the top tier.',
      process: [
        'I listened to a sample of thirty calls myself and tagged what would have happened to each issue in an email-only world.',
        'Then I modeled three cost scenarios with finance so the conversation was about options rather than a yes-or-no fight.'
      ],
      outcome: 'We kept the enterprise line, cut the general queue, and hit the cost target without touching our biggest accounts.',
      metric: 'The hybrid model delivered 85 percent of the planned savings, enterprise CSAT actually rose 0.3 points, and we had zero support-related escalations from top-tier accounts that year.',
      leadership: 'I brought the VP an option that met the budget goal instead of just objecting, and I owned the transition plan including the two staffing changes it required.',
      vague: 'Leadership wanted to change how we do support, I had concerns, and we found a middle ground that mostly worked.',
      short: 'I saved phone support for our enterprise customers.',
      irrelevant: "Speaking of phone calls, I've been teaching my parents to video call properly for years — I finally wrote them an illustrated guide, laminated it, and stuck it to their fridge, which I consider a major diplomatic achievement.",
      conflict: "The phone line got cut completely anyway and I didn't really fight it."
    },
    {
      situation: 'Our knowledge base was so outdated that agents kept private notes instead, so I led a full rebuild of it.',
      background: [
        'To paint the picture, the knowledge base had 900 articles, a third of which referenced features that no longer existed, and search was so bad agents used Ctrl-F on a giant shared doc instead.',
        "New-hire ramp time had crept up to twelve weeks, partly because so much tribal knowledge lived only in people's heads."
      ],
      action: 'I ran a content audit, archived 400 dead articles, established an ownership model where every article has a named owner and review date, and rebuilt the taxonomy around how customers actually phrase their problems.',
      process: [
        'I mined six months of search queries and failed-search terms to design the new taxonomy from real customer language.',
        'Then I ran writing workshops for the team and set up a lightweight review rota so maintenance became part of the weekly rhythm rather than a special project.'
      ],
      outcome: 'Agents went back to trusting the knowledge base and customer self-service improved noticeably.',
      metric: 'Article-attach rate on tickets went from 22 to 61 percent, self-service deflection rose 17 percent, and new-hire ramp time dropped from twelve weeks to seven.',
      leadership: 'I secured a quarter of dedicated time from leadership, delegated section ownership across eight senior agents, and kept the program on schedule through a support-volume surge.',
      vague: 'I helped clean up our internal documentation, which made day-to-day work smoother for the team.',
      short: 'I rebuilt our support knowledge base.',
      irrelevant: "Documentation is one thing, but the archive I'm proudest of is my grandmother's recipe collection — I spent a winter scanning and annotating 200 handwritten cards, and relatives now request copies every holiday.",
      conflict: 'Most agents ignored the new knowledge base though, and the old shared doc is still what everyone actually uses.'
    }
  ]
};

// Role-independent banks, indexed by question (0..2).

export const GENERIC = [
  "I work well under pressure. I'm the kind of person who always gets things done no matter what, because I'm very hardworking and dedicated to whatever I take on.",
  "I'm a real team player, so I don't really run into conflicts much. When people disagree with me I just stay positive and keep communication open, because communication is key.",
  "I take pride in everything I do. Every project is important to me and I always give one hundred and ten percent, so it's genuinely hard to pick just one."
];

export const HYPOTHETICAL = [
  "If I ever faced a really tight deadline, I would first assess the scope, then I'd prioritize ruthlessly and communicate early with stakeholders. I would probably also try to negotiate the timeline if it looked unrealistic.",
  "If a disagreement came up, I would listen to the other person's perspective first, then I'd try to find common ground. I think I would only escalate as a very last resort.",
  'If I were to pick a future project, I would want to lead something with real impact. I would set clear goals, build the right team, and I would measure success carefully along the way.'
];

export const BLAME = [
  "The deadline was only tight because management kept changing the requirements every week. I did my part on time; it was the other teams that dropped the ball, honestly, and QA made everything slower than it needed to be.",
  "There was this coworker who was impossible to work with — he never listened and management refused to do anything about him. It wasn't really my fault things got tense; anyone would have snapped eventually.",
  "I'd have more projects to be proud of if leadership actually funded my ideas. The stuff I worked on was fine, but my managers never gave me the interesting assignments — those always went to the favorites."
];

export const BUZZWORD = [
  'When timelines compress, I leverage synergies across cross-functional stakeholders to drive alignment and operationalize a best-in-class delivery cadence, moving the needle while keeping all the ducks in a row at scale.',
  'In conflict scenarios I circle back to first principles, socialize the strategic narrative, and double-click on root causes to unlock win-win value creation and drive stakeholder buy-in across the matrix.',
  'My proudest initiative was an end-to-end paradigm shift where we harmonized our north-star KPIs, right-sized the operating model, and future-proofed our roadmap to deliver holistic, game-changing impact.'
];

export const MINIMAL = [
  "I can't think of a specific deadline story right now. I just try to manage my time well.",
  "I don't really have disagreements at work.",
  'Nothing really stands out. I just do my job.'
];

export const ULTRA_SHORT = [
  'Not really, deadlines are fine for me.',
  'No conflicts come to mind.',
  'Nothing specific, honestly.'
];

export const TANGENTS = [
  "Actually, that reminds me of a completely different story from my previous job, which I'll try to keep short but it's related, I promise.",
  '— and by the way, this was around the time we moved offices, which was its own whole saga that I could talk about forever —',
  'I could go on about this part for hours, honestly, there was just so much going on that year with the reorg and everything.'
];

export const BUZZ_EXTRA = "Net-net, it's about moving the needle and boiling the ocean only when it's strategically appropriate to do so.";

export const NEG_EXTRA = 'Honestly, most of my jobs have been like that — good work undone by bad management.';
