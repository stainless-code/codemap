# PR comment fact-check — workflow

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

**Done when:** all unresolved threads fetched; count logged.

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

**Done when:** every distinct claim has file:line (or tool) evidence and a verdict.

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

The exception applies to `❌ hallucinated` and `⚠️ partial — needs a call` rows. The other rows already resolve by default.

**Done when:** triage table covers every unresolved thread; ✅/⚠️ rows applied or replied; resolve policy from table + merge-gate exception applied.

### Commands

```bash
# Reply to a thread — write body to a temp file first (heredocs mangle backticks in markdown)
printf '%s' '<reply text>' > /tmp/pr-<number>-reply.md
gh api "repos/{owner}/{repo}/pulls/<number>/comments" \
  --field body=@/tmp/pr-<number>-reply.md \
  -F in_reply_to=<comment_id>

# Resolve a thread (GraphQL only — REST endpoints don't support resolve)
gh api graphql -f query='mutation($id: ID!) {
  resolveReviewThread(input:{threadId:$id}) { thread { isResolved } }
}' -F id=<thread_node_id>
```

The thread node ID (`PRRT_…`) comes from the GraphQL `reviewThreads` query in step 1 — the REST `comments` endpoint only returns the comment ID (`databaseId`), which is what `in_reply_to` takes.

### After applying

Run [`verify-after-each-step`](../../rules/verify-after-each-step.md) checks on touched files. Optional: [`harden-pr`](../harden-pr/SKILL.md) full on the branch once triage is complete.
