# Deep dives: how they run

[COACHING.md](COACHING.md) section 5 says when a deep dive is required. This file is how one runs, step
by step, so it lasts hours and doesn't stop after the first answer. Every step that has to happen later
is scheduled when the work starts, so it happens whether or not anyone remembers.

## Roles

- **Worker thread**: does the work and writes the answer.
- **Critic thread**: reads the worker's answer cold, from the sources, and lists what is wrong, missing or
  unchecked. It has not seen the worker's reasoning, only its answer and the player's words.
- **Coordinator**: starts both, passes results between them by link (never a summary), and challenges each
  round. It does not answer the question itself.

## Steps

1. **Coordinator: start both.** Route with `Depth: deep dive` (COACHING.md section 6). Ask for a critic
   thread at the same time, with the same attachments plus a line naming the worker thread.
2. **Worker, first turn: schedule the check-ins before doing any work.** Three `send_later` reminders to
   itself, at about 30, 90 and 180 minutes. Each one says: "Deep-dive check-in N: read the critic's
   newest findings, answer every one (fixed, or why not, with the source), sweep once more for what
   neither of us looked at, and post the new version." Then save the reminder ids in the thread's first
   checklist line, so anyone can see they exist.
3. **Worker: first full answer.** Exhaustive by default (COACHING.md section 1): every source, every
   candidate, every spec. Each number from the app or the game data with its label. Post it with the
   checklist showing round 1, then message the critic thread with the link.
4. **Critic: review.** Against the sources, not the worker's wording: re-run its queries, look for the
   candidates it skipped, check every number against its `src`, check the rules (COACHING.md 1 to 4).
   Each finding names what is wrong and where the right answer is. "Nothing new" is a finding too,
   and it ends the dive only if the critic really looked (it says what it checked).
5. **Coordinator: challenge.** At each round, ask one question the answer doesn't settle yet (a source
   not read, a spec not scored, a cheaper or safer option) and send it to the worker by message.
6. **Worker, each check-in:** answer every critic finding and the coordinator's question, post the new
   version, message the critic again. If a check-in finds the critic hasn't answered yet, it does its
   own fresh sweep instead and schedules one more check-in 60 minutes later.
7. **End.** The dive ends when a full critic round finds nothing new. Not when the first answer lands,
   and not because the scheduled check-ins ran out (schedule another round instead). The worker then
   posts the final answer on a card if he acts on it (COACHING.md section 3), with a line marked
   `For the project chat:`, and tells the coordinator.

## What he should see

Checking back hours later, he should see the threads still going: rounds numbered on the worker's
checklist, the critic's findings, and the answers to them. A deep dive that ended after one round with no
critic round is a `SHALLOW` correction in the weekly audit.
