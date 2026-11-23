# Deep dives: how they run

[COACHING.md](COACHING.md) section 5 says when a deep dive is required. This file is how one runs, step
by step, so it lasts hours and doesn't stop after the first answer. Every step that has to happen later
is scheduled when the work starts, so it happens whether or not anyone remembers.

## Roles

- **Worker thread**: does the work and posts each version of the answer in its own thread.
- **Critic thread**: reads only the worker's posted answers (not the rest of its thread) and the player's
  words, checks them against the sources, and posts what is wrong, missing or unchecked.
- **Coordinator**: starts both threads, and when a round is posted challenges it. It never answers the
  question itself and never puts sources, numbers or summaries in a message (COACHING.md section 6).

## Steps

1. **Coordinator: start the worker**, routed with `Depth: deep dive` (the 4-line template, COACHING.md
   section 6). **Then start the critic** with the same template: the same attachments, `Depth: deep dive`,
   and the worker's thread link on the `Earlier work` line. Then `message_thread` the worker with the
   critic's thread link.
2. **Worker, first turn: schedule the check-ins before doing any work.** Three `send_later` reminders to
   itself, at about 30, 90 and 180 minutes, each saying "Deep-dive check-in". Put the reminder times on
   the first line of its checklist, so anyone can see they exist.
3. **Worker: round 1.** Exhaustive by default (COACHING.md section 1): every source, every candidate,
   every spec. Each number from the app or the game data with its label, and the draft passes
   `tools/check-answer.py`. Post it with the checklist showing "Round 1", then `message_thread` the
   critic with a link to that post, and `message_coordinator` with the same link (the coordinator's cue
   to challenge).
4. **Critic: each round.** Re-run the worker's queries, look for candidates it skipped, check every
   number against its `src` and the rules (COACHING.md 1 to 4). Post the findings in the critic thread,
   each saying what is wrong and where the right answer is, and `message_thread` the worker the link. If
   it finds nothing new, it says what it checked to know that.
5. **Coordinator: challenge each round.** One question the round doesn't settle yet, sent to the worker
   by `message_thread`. It names only a kind of gap (a source, a spec, a cheaper or safer option, a step
   of the chain) with the thread link, never a source's content or a number.
6. **Worker, each check-in.** First read its own checklist: if the dive has ended, stop
   (`no_reply_needed`); if round 1 isn't posted yet, schedule the check-in again for 30 minutes later and
   keep working. Otherwise answer every critic finding and the coordinator's question (fixed, or why not,
   with the source), sweep once more for what neither looked at, post the next round as in step 3, and
   schedule the next check-in for 60 minutes later.
7. **No reply from the critic.** If two check-ins in a row find no new critic post, the worker asks the
   coordinator (`message_coordinator`) to start a fresh critic thread, and does its own fresh sweep
   meanwhile.
8. **End.** The dive ends when a full critic round finds nothing new. A finding that changes no candidate,
   number or verdict counts as nothing new. It also ends at a hard cap of 6 rounds or 8 hours; then the
   final answer lists the findings still open, each marked unresolved. Not when the first answer lands,
   and not because the scheduled check-ins ran out. The worker posts the final answer, on a card if he
   acts on it (COACHING.md section 3), ending with a line marked `For the project chat:`, which the
   coordinator pastes exactly.

## What he should see

Checking back hours later, he should see the threads still going: rounds numbered on the worker's
checklist, the critic's findings, and the answers to them. A deep dive that ended after one round with no
critic round is a `SHALLOW` correction in the weekly audit.
