# Salesforce fact verification — M1 content gate

Verified 2026-09-09 before any question pool was authored.

`developer.salesforce.com` returns **HTTP 403** to programmatic fetching, so
primary pages could not be read directly. Verification below is from official
Salesforce search results (developer.salesforce.com / help.salesforce.com only).
Anything not confirmed to primary-source confidence is listed as UNVERIFIED and
is **barred from being a grading signal**.

## Rule this produced

> **No exact numeric value, and no GA/beta status, may be a grading signal.**

This is not just caution — it is required by the product philosophy
(evaluate engineering reasoning, not trivia). The two constraints converge, so
the pool is designed to never depend on a release-dependent fact.

## VERIFIED — safe to encode as structural signals

| Fact | Note |
|---|---|
| Sync SOQL query limit is 100 per transaction | Confirmed. Encoded only as "a SOQL query limit exists and applies per transaction" — never the integer. |
| Sync DML statement limit is 150 per transaction | Same treatment. |
| Sync CPU time limit is 10,000 ms | Same treatment. |
| Async transactions get higher ceilings than sync | Direction confirmed; magnitudes deliberately not encoded. |
| Up to 50 jobs can be enqueued via `System.enqueueJob` in one transaction | Confirmed, but still not encoded as a number. |
| `WITH USER_MODE` and `WITH SYSTEM_MODE` clauses exist | Confirmed. |
| `Security.stripInaccessible()` enforces field- and object-level protection and strips inaccessible fields | Confirmed. Recommended where permission errors must be handled gracefully rather than thrown. |
| `WITH USER_MODE` and `stripInaccessible()` are both current recommended approaches over Schema-method boilerplate | Confirmed. |
| `WITH USER_MODE` performs better than `WITH SECURITY_ENFORCED` | Confirmed — so requiring `WITH SECURITY_ENFORCED` would be requiring a worse practice. |
| User-mode database operations reached GA (release 242) | Confirmed. |

## CONTRADICTED MY PRIOR — signal rewritten

**"Apex runs in system mode by default."** Salesforce documentation states that
**in API version 67.0 and later, Apex database operations run in user mode by
default**, applying sharing rules, FLS, and object permissions of the running
user.

The M1 spec's Q4 signal `s1` asserted the opposite. As written it would have
scored the *more* current and correct answer as wrong, and penalised a candidate
who said "it depends on the API version."

Rewritten to be version-agnostic:

> `s1` — recognises that whether sharing and FLS are enforced is determined by
> the execution mode of the class or operation, and is not something to assume.
> A candidate who says it depends on API version or on how the class is
> declared **fully satisfies** this signal.

## UNVERIFIED — barred from grading signals

| Item | Why |
|---|---|
| Async heap size | Sources conflict: 12 MB in older material, reported as increased to 25 MB in more recent releases. Could not resolve to primary source. |
| Async SOQL query and CPU ceilings | Reported as 200 queries / 60,000 ms, not confirmed against a primary page. Only the *direction* (higher than sync) is encoded. |
| Queueable chaining depth | **Not a single number.** Edition-dependent (max stack depth 5 in Developer/Trial orgs) and configurable via `AsyncOptions`. Encoded only as "chaining is possible and is bounded". |
| Trigger chunk size (200) | Widely held and probably correct, but not confirmed from a primary page in this pass. Encoded as "a large load fires the trigger repeatedly in chunks, so limits apply per chunk" — no integer. |
| GA vs beta status of any recent Apex/LWC feature | Moves every release. Chained-Queueable stack depth configuration was Beta in release 244 and GA by 246 — a clean example of why this must never be a signal. |
| Current canonical spelling of some taxonomy labels | e.g. "Batch Apex" vs `Database.Batchable`. Cosmetic; labels use the widely recognised form. |

## Re-verification

Re-run this gate whenever the pool is regenerated, and at minimum every three
Salesforce releases. If `developer.salesforce.com` becomes fetchable, replace
the search-derived rows with primary reads.

Sources consulted:
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_enforce_usermode.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_with_security_stripInaccessible.htm
- https://developer.salesforce.com/docs/platform/lwc/guide/apex-security.html
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_queueing_jobs.htm
- https://help.salesforce.com/s/articleView?id=release-notes.rn_apex_User_Mode_GA.htm
- https://help.salesforce.com/s/articleView?id=release-notes.rn_apex_queueable_enhancements_ga.htm
