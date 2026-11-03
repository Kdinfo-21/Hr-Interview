# Review Queue Update

The recruiter `Needs Review` queue now follows this rule:

1. The candidate's interview Q&A performance must be weak (base Q&A score below 55/100).
2. The candidate must have submitted the final challenge.
3. The latest final-challenge submission must be auto-evaluated as passed.
4. Only then is the interview marked `needs_review: true` and shown by the dashboard Review filter.

A solved final challenge contributes a 30% challenge weight plus an 8-point hireability boost before the existing 2% calibration adjustment. This increases the candidate's hiring score modestly, but a weak Q&A performance with a solved challenge is still routed to a human recruiter rather than being automatically rejected.

A low interview score by itself does **not** enter the Review queue.

A failed final challenge does **not** enter the Review queue.

An unattempted or unscored final challenge does **not** enter the Review queue.
