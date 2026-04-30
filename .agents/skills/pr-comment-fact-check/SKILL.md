---
name: pr-comment-fact-check
description: Triage and fact-check PR review comments against the actual codebase, project rules, and skills. Use when the user asks to address PR comments, respond to reviewer feedback, check if a comment is correct, fact-check a reviewer's claim, decide which comments to push back on, or sort hallucinated suggestions from real ones. Triggers on phrases like "check PR comments", "are these comments right", "review the PR feedback", "address comments on #N", "is the reviewer correct", "fact check this PR", "Bugbot/CodeRabbit/Copilot said X".
---

# PR comment fact-check

When a PR has reviewer comments (human or bot), don't apply suggestions reflexively. Each comment is a **claim about the code** that may be:

| Verdict                      | What it means                                                                                                                                    | Default action                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| ✅ Correct                   | The code does/says what the reviewer claims; their suggestion improves it.                                                                       | Apply or ack.                                                                          |
| ⚠️ Partially correct         | Premise right, conclusion wrong (or vice versa).                                                                                                 | Reply with the nuance; apply the salvageable part.                                     |
| ❌ Incorrect (hallucination) | The code doesn't do what the reviewer claims, OR the reviewer cites a "best practice" that contradicts our actual rules / TS + library versions. | Push back with evidence. Don't silently change correct code to match a wrong critique. |
| 🕒 Outdated                  | The code already changed since the comment was posted.                                                                                           | Resolve with a one-line note pointing at the fix commit.                               |
| 💭 Style preference          | Not enforced by any lint rule or skill; subjective.                                                                                              | Apply if cheap, otherwise defer to author.                                             |

**The agent's job is to verify before acting.** Auto-applying suggestions from LLM reviewers (Bugbot, Copilot, Cursor's own bot, CodeRabbit) is the most common silent regression source — they confidently propose changes that contradict project conventions because they don't have the project context the human team has codified in skills/rules.

## Process

### 1. Pull the comments

```bash
# Top-level review comments + line comments
gh pr view <number> --json reviews,comments --jq '.reviews[].body, .comments[].body' | head -100

# Line-level inline comments (with file + line + position)
gh api "repos/{owner}/{repo}/pulls/<number>/comments" \
  --jq '.[] | { id, path, line, body: .body[0:200], user: .user.login, in_reply_to_id }'

# Outstanding review threads only (unresolved)
gh api graphql -f query='
  query($owner:String!, $repo:String!, $pr:Int!) {
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$pr) {
        reviewThreads(first:100) {
          nodes {
            isResolved
            comments(first:10) {
              nodes { id, path, originalLine, body, author { login } }
            }
          }
        }
      }
    }
  }' -F owner=<owner> -F repo=<repo> -F pr=<number> \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)'
```

The GraphQL form is the only way to get the **resolved/unresolved** state. The REST endpoints don't expose it. Filter out resolved threads — they don't need re-triaging.

### 2. Group comments

For each comment, capture:

- file path + line number (the **anchor**)
- comment body (the **claim**)
- author (human reviewer? Bugbot? Copilot? Cursor bot? CodeRabbit?)
- thread context (is this a reply to an earlier comment? what was said?)

Group comments touching the same file/line/concern into one thread for triage — usually a reviewer makes the same point in 3 places and you only need to verify it once.

### 3. Fact-check each claim

For every distinct claim, **verify against the actual code and the project's authoritative sources**:

| Claim shape                                    | How to verify                                                                                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "This function does X"                         | `Read` the cited file and lines. Does it actually do X? Use [`codemap`](../codemap/SKILL.md) to confirm callers / signature.                                                                                 |
| "This is a memory leak / race / resource leak" | Trace the dependency graph. Use `codemap` to find related state subscriptions / open handles. Run the actual code mentally or write a quick test if borderline.                                              |
| "We should use library/pattern Y here"         | Check `.agents/rules/` and `.agents/skills/` — is Y endorsed? Contradicted? Silent? Library version match?                                                                                                   |
| "This breaks convention Z"                     | Find Z in the rules/skills + `docs/`. If it doesn't exist in our docs, it's not "our" convention — it's the reviewer's preference. Mark style.                                                               |
| "This isn't tested"                            | `Glob` for `*.test.ts` neighbours. Check the test file's coverage, not just its existence. Many behaviours have golden-query coverage in `fixtures/golden/` instead of unit tests — verify before accepting. |
| "This duplicates X elsewhere"                  | Use `codemap` (`SELECT FROM symbols WHERE name LIKE …`) or `Grep` for the symbol/pattern. Is it actually duplicated, or just structurally similar?                                                           |
| "This violates type-safety"                    | Run `bun run typecheck`. If it passes, the claim is wrong unless the reviewer can show a runtime case.                                                                                                       |
| "Performance issue"                            | Quantify if possible. Many "performance" comments are speculative — ask for a measurement before accepting. Run `bun run benchmark:query` if the claim is about query stdout cost.                           |

### 4. Categorize and report

Output a triage table grouped by verdict, not by file. Make it easy for the user to scan "what to fix vs what to push back on":

```markdown
## ✅ Correct (N) — apply

| #   | File:line | Claim (1 line) | Action                |
| --- | --------- | -------------- | --------------------- |
| 1   | x.ts:42   | …              | Apply suggested diff. |

## ❌ Incorrect / hallucinated (N) — push back

| #   | File:line | Claim                             | Why wrong                                                                                                         |
| --- | --------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 2   | parser.ts | "use a regex here instead of oxc" | Codemap is AST-backed by design; `docs/architecture.md` § Parsers documents the rejection of regex-based parsing. |

## ⚠️ Partially correct (N)

…

## 🕒 Outdated (N)

…

## 💭 Style preference (N)

…
```

Then propose **the actual reply** for each comment you'd push back on — don't just say "wrong", give the reviewer the receipts (file:line link, rule reference, codemap query result, doc anchor).

### 5. Apply / reply / resolve

Default behaviour per category — **resolve threads you have authority over; leave the ones that need reviewer concession**:

| Verdict                     | Apply?                    | Reply?                                                                          | Resolve thread?                                                                                                                             |
| --------------------------- | ------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ Correct                  | Yes                       | Optional ack ("applied in &lt;sha&gt;")                                         | **Yes** — the bot was right, the fix is in, the thread has served its purpose. Leaving it open creates noise.                               |
| ⚠️ Partially correct        | The salvageable part      | Yes — explain the nuance                                                        | **Resolve only if the reviewer agrees** (or is a bot that won't push back). Otherwise leave open.                                           |
| ❌ Incorrect / hallucinated | No                        | Yes — push back with evidence (file:line, rule reference, codemap query result) | **Leave unresolved** — the reviewer (human or bot) needs to see the receipts and concede. Auto-resolving a thread you reject is dismissive. |
| 🕒 Outdated                 | N/A                       | Optional — point at the fix commit                                              | **Yes**                                                                                                                                     |
| 💭 Style preference         | If cheap; otherwise defer | Brief reply if you applied                                                      | **Yes if applied**, otherwise leave open for the author to weigh in                                                                         |

The "leave unresolved when the reviewer needs to concede" rule applies even to bot reviewers — bots can iterate and update their stance on the next review pass when they see the rebuttal.

#### If branch protection requires conversation resolution to merge

Codemap's `main` branch protection currently does **not** require conversation resolution (verified via `gh api repos/stainless-code/codemap/branches/main/protection` — `required_conversation_resolution.enabled: false`), so the default flow above is the live flow.

If that ever changes (or for downstream forks where it's enabled), the "leave unresolved on hallucinated comments" guidance flips:

1. Push back with the receipts (file:line, rule reference, codemap query result) — same as the default flow.
2. Push the rebuttal-with-evidence + wait one review-cycle for the reviewer to escalate or concede.
3. **Resolve the thread regardless** — the rebuttal lives in the thread body for the next reviewer pass; the merge gate cannot be held hostage to a bot's silence.

When this exception applies, drop a one-line summary of contested rebuttals into the **PR description** so the next reviewer sees them without scrolling through resolved threads.

### Commands

```bash
# Reply to a thread
gh api "repos/{owner}/{repo}/pulls/<number>/comments" \
  -f body="$(cat <<'EOF'
<reply text>
EOF
)" -F in_reply_to=<comment_id>

# Resolve a thread (GraphQL only — REST endpoints don't support resolve)
gh api graphql -f query='mutation($id: ID!) {
  resolveReviewThread(input:{threadId:$id}) { thread { isResolved } }
}' -F id=<thread_node_id>
```

The thread node ID (`PRRT_…`) comes from the GraphQL `reviewThreads` query in step 1 — the REST `comments` endpoint only returns the comment ID (`databaseId`), which is what `in_reply_to` takes.

## Common hallucination patterns to watch for

These come up repeatedly with LLM reviewers and warrant extra scrutiny. The codemap-shape ones (1–4) come from the codemap thesis — what Codemap deliberately is and isn't (per [`docs/why-codemap.md` § What Codemap is not](../../../docs/why-codemap.md#what-codemap-is-not) and [`docs/roadmap.md` § Non-goals](../../../docs/roadmap.md#non-goals-v1)). The shape-5+ ones are universal across TS projects:

1. **"Just regex this"** when the file is in `src/parsers/` or `src/adapters/` — codemap is AST-backed by design (oxc for TS, lightningcss for CSS). Suggesting a regex replacement undoes the architectural choice. Verify against [`docs/architecture.md` § Parsers / Adapters](../../../docs/architecture.md) before accepting.
2. **"Add full-text search"** — explicitly a non-goal per [`docs/roadmap.md` § Non-goals (v1)](../../../docs/roadmap.md#non-goals-v1). Push back with that anchor.
3. **"Add a daemon for performance"** — same; one-shot CLI is intentional, sub-100ms cold start makes a daemon unnecessary. Same non-goal anchor.
4. **"Index this column"** in `src/db.ts` — Codemap's SQLite schema is intentionally lean. Indexes are added when a query benchmark proves them necessary, not pre-emptively. Push back: ask for the query that's slow.
5. **Generic "best practice" claims** unsupported by our rules — "always destructure props at the top", "never use enums", "prefer interfaces over types" — these are stylistic and we either have a rule or we don't. Grep `.agents/rules/` and `.agents/skills/` first.
6. **"This isn't tested" without checking sibling test files OR golden fixtures** — codemap has unit tests under `src/**/*.test.ts` AND query-shape coverage under `fixtures/golden/`. A query change might be tested via golden-snapshot, not a `.test.ts`. Verify before accepting.
7. **Memory-leak / resource-leak claims with no concrete trigger** — "this could leak the SQLite handle" without a scenario is speculation; ask for the path. Codemap closes DB handles via the `using` pattern in most call sites — verify before accepting.
8. **Type-safety alarms** — if `tsgo --noEmit` (`bun run typecheck`) passes, the claim is almost always wrong (or about runtime behaviour the type system can't see, in which case the reviewer should justify with the runtime case).
9. **Convention citations that don't exist** — "This breaks our API conventions" — grep `.agents/` and `docs/` for the convention. If it's not codified, it's preference, not rule.
10. **Schema-bump / changeset alarms** — "this needs a minor changeset" — check [`.agents/lessons.md`](../../lessons.md) ("changesets bump policy"): pre-v1, default is patch unless the schema actually breaks the `.codemap.db` (new tables/columns/SCHEMA_VERSION bump). Don't accept "minor for new CLI commands or public types".

## Anti-patterns

- **Don't apply every suggestion to clear the queue.** Each silently-applied wrong fix is a regression.
- **Don't reply with `"Good catch, fixed!"` without verifying.** That's how subtle bugs get introduced.
- **Don't dismiss without evidence.** Push-back is fine; evidence-free push-back wastes everyone's time and erodes trust.
- **Don't rebuild the same fact-check from scratch on every review round.** Save the verified state in a comment thread or in the PR description so subsequent rounds skip what's already settled.

## Reference

- Codemap (structural verification): [`codemap`](../codemap/SKILL.md).
- `gh` CLI for PR comments: <https://cli.github.com/manual/gh_pr_view>, <https://cli.github.com/manual/gh_api>.
- GitHub GraphQL for resolved/unresolved state: <https://docs.github.com/en/graphql/reference/objects#pullrequestreviewthread>.
- [`docs/why-codemap.md`](../../../docs/why-codemap.md) and [`docs/roadmap.md` § Non-goals](../../../docs/roadmap.md#non-goals-v1) — the canonical anchors for "this is a non-goal" push-backs (hallucination patterns 2–3 above).
- [`pr-comment-fact-check` rule](../../rules/pr-comment-fact-check.md) — Tier 1 priming layer that fires this skill on intent.
