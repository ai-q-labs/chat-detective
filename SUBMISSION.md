# Devpost submission draft

**Title:** Chat Detective

**Tagline (≤ 200 chars):** A live mystery for any Twitch stream: the whole chat plays one detective, votes where to search and whom to question, and catches a suspect's lie by pointing at the evidence.

**Video:** (to add) · **Code:** https://github.com/ai-q-labs/chat-detective

---

## Inspiration

We write murder-mystery party games. At a table, the best moment is always the same one: somebody says "wait, that's not what the receipt says" and the whole room turns. Twitch chat is a room of hundreds of people who love to call things out, but most chat games give them a vote and nothing to argue about. We wanted chat to do actual detective work, together, on top of whatever the streamer is already playing.

## What it does

The streamer opens a case from a small control page; an overlay sits on top of their stream. Then chat runs the investigation:

- **Search.** `!search 1-3` votes on where to look. The evidence card flips open on the case board.
- **Question.** `!ask A-D` votes on whom to question. The suspect's testimony appears on stream.
- **Catch the lie.** While the testimony is up, anyone can type `!contradict E3` to point at the evidence that breaks it. If they are right, the card cracks, the suspect's real story comes out, a red string stays on the board from that evidence to that suspect, and the first viewer who saw it gets a "Sharp Eye" credit.
- **Accuse.** After three rounds chat votes on who did it. The reveal shows the vote split, how many got it right, and the lies caught.

The bot posts each step in chat (at most one message per second), votes are one per viewer per ballot, and the host can move on at any time with `!next`. A case is one JSON file, so a streamer can write their own.

The first case, *The Trophy at Table Nine*, is an original, family-friendly theft at a board-game café (no murder, so it fits any stream).

## How we built it

- **Built with OpenAI Codex in one thread.** We wrote a spec (SPEC.md: rules, the case, the overlay, the Twitch requirements) and Codex built the project from it, then refined it over 13 passes in the same thread (`codex exec`, then `codex exec resume`). Each pass came from running the real thing: watching the overlay, playing the case, the first live session on a real channel, and the recorded takes of the demo. `docs/build-log.json` lists every pass (what was asked and what came back; the video shows the log as it was after pass 8), and the session ID is in the submission.
- **Twitch:** EventSub over WebSocket (`channel.chat.message`) to read chat, the Send Chat Message API to post, device-code authorization (public client, no client secret), token validation at start-up, refresh on 401, reconnect with backoff, a keepalive watchdog, and echo filtering by message ID.
- **Node.js with zero dependencies:** a pure game engine, an HTTP server with Server-Sent Events, an OBS browser-source overlay (a fixed 1920×1080 stage scaled to any window) and a host control page.
- **Simulation and demo modes** play the whole case with no Twitch account, so anyone can try it with `npm run sim` or watch `npm run demo`.
- **35 tests** with `node --test` (no network), plus `npm run check-twitch` for a live connection check.
- **A narrated showcase page** (`/showcase`) made the demo video: the live step opens the real Twitch popout chat in its own window and shows the lines EventSub received; the simulated step runs on a second server.

## Challenges we ran into

- **The first live run read nothing.** Sending worked, but a viewer's `!search 1` never arrived and the socket kept reconnecting. Codex added logging for the subscription response and close codes plus `npm run check-twitch`; the subscription itself was fine (HTTP 202, enabled), and the fix was the keepalive watchdog and the event stream to the control page. On the next live run a viewer's `!search 2` opened location 2.
- **Ballots leaking between rounds**, the testimony card covering the accusation vote, and a one-option search vote: all found by watching full runs of the overlay, not by tests, and then pinned down with tests.
- **The embedded Twitch chat would not take input** on a localhost page, even with third-party cookies allowed for twitch.tv. The showcase now opens the real popout chat in its own window and shows, next to the game, the lines EventSub actually received.
- **Making a lie visible.** "Correct!" in chat is not fun to watch; a cracked card, a red string that stays, and a name on the board are.

## Accomplishments that we're proud of

- Chat does real deduction together, and the board remembers what chat proved.
- It runs on top of any stream as an overlay, with nothing for viewers to install.
- One JSON file is a new case.

## What we learned

- Live platforms fail in ways tests don't: logging the exact subscription response and close code turned a guess into a fix.
- A spec plus short, concrete passes in one Codex thread worked better than one big request.

## What's next

- A case editor page for streamers, and a few more original cases.
- Channel Points to buy a hint, and moderator tools for large chats.
- A Twitch Extension version of the board.

## Built with

`node.js` · `javascript` · `twitch-api` · `eventsub` · `websockets` · `server-sent-events` · `obs` · `openai-codex`

**AI disclosure:** the code was written by OpenAI Codex. The spec, the case, the review of each pass and this text were written with the help of Claude (Anthropic). The case and its characters are original and fictional.
