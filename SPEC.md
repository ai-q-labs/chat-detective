# Chat Detective — build spec

A live mystery for Twitch streams where the whole chat plays one detective. The streamer hosts; chat votes on where to search and whom to question, catches a suspect's lie by pointing at the evidence that contradicts it, and finally votes on who did it. A browser-source overlay shows the case board live.

Built for the Codex x TwitchCon Hackathon (build window Oct 23 – Nov 2, 2026). License: MIT, copyright "Ai-Q Labs".

## Hard requirements

- Node.js 22 or later, **zero npm dependencies** (use the global `fetch` and `WebSocket`, `node:http`, `node:test`).
- Connects to Twitch through **EventSub over WebSocket** (`channel.chat.message`) and the **Send Chat Message** API (`POST https://api.twitch.tv/helix/chat/messages`).
- Auth with the **Device Code Grant Flow** (public client, no client secret): `POST https://id.twitch.tv/oauth2/device` with `client_id` and `scopes`, show the user the `verification_uri` and code, poll `POST https://id.twitch.tv/oauth2/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`. Scopes: `user:read:chat user:write:chat`. Store tokens in `.twitch-token.json` (git-ignored), refresh with the refresh token (one-time use, store the new one). Never log tokens.
- Config from environment: `TWITCH_CLIENT_ID`, `TWITCH_CHANNEL` (login name of the broadcaster; the bot uses the same account by default), `PORT` (default 3000), `VOTE_SECONDS` (default 30).
- **Simulation mode** (`npm run sim`): no Twitch at all. The control page gets a fake chat box (username + message) so judges can play the whole case in a browser. `npm run demo` plays a scripted crowd of 12 fake viewers through the whole case at speed (for testing and for anyone without a Twitch app). Everything simulated is labelled "SIMULATED CHAT" on the overlay.
- Runtime uses **no AI service** and no paid service. The case is a JSON file.
- `node --test` covers the game engine (pure functions, no network).

## Pieces

- `src/game.js` — pure state machine. `createGame(caseData, opts)` returns an object with `handle(event)` and `state()`. Events: `{type:'chat', user, text, isHost}`, `{type:'tick', now}`, `{type:'host', action}`. Returns a list of effects (`{say: text}` for chat messages to post, `{broadcast: state}`).
- `src/commands.js` — parse chat: `!search 1-3`, `!ask A-D`, `!contradict E1-E3` (also `!c E2`), `!accuse A-D`, host only: `!next`, `!reveal`, `!reset`. Case-insensitive, extra words ignored.
- `src/twitch.js` — device-code auth, token refresh, EventSub WebSocket client (handle `session_welcome` → create the subscription with `transport: {method:'websocket', session_id}`, `session_keepalive`, `session_reconnect` → connect to the new URL, `notification` → chat event, `revocation`), `sendChat(text)`. Look up the broadcaster's user id with `GET /helix/users?login=`. The host is the broadcaster (badge `broadcaster`) or a moderator (badge `moderator`).
- `src/server.js` — `node:http`. Routes: `/overlay` (1920×1080, transparent background, for OBS browser source), `/control` (host panel: big Next / Reveal / Reset buttons, current phase, vote counts, and in sim mode the fake chat), `/events` (Server-Sent Events with the full state on every change), `/case` (current case JSON without the solution until the reveal).
- `cases/trophy-at-table-nine.json` — the first case (content below). The schema must let a streamer write a new case in one file: title, intro, suspects, locations→evidence, testimonies with optional `contradictedBy` and `truth`, solution, endings.
- `scripts/demo.js` — the scripted crowd.
- `README.md` — what it is, a 5-minute setup (create a Twitch application in the developer console: client type **Public**, any OAuth redirect such as `http://localhost`, copy the Client ID; `npm start`; open the code URL; add `http://localhost:3000/overlay` as a browser source), sim/demo mode, how to write a case, commands, and "Built with OpenAI Codex".

## Game flow (one case ≈ 10–15 minutes)

1. **Intro** — overlay shows the title, the scene and the four suspects. Bot posts the scene in two short messages.
2. **Round 1–3**, each round:
   - **Search vote** (`!search N`, VOTE_SECONDS). Only unsearched locations are on the ballot. Highest count wins; ties go to the lowest number. The evidence card flips open on the overlay; the bot posts it in one line.
   - **Question vote** (`!ask X`). The chosen suspect's testimony appears as a speech card.
   - **Objection window** (VOTE_SECONDS). Anyone may `!contradict E#` while the testimony is up. If that evidence is the one that contradicts this testimony **and** the evidence has been found, the card cracks, the suspect's hidden truth appears, and the first user who called it gets the "Sharp Eye" credit on the board. Wrong calls just count as a miss (show a small tally, never shame a name). Each user gets one call per testimony.
   - The host can `!next` to skip waiting at any point.
3. **Accusation vote** (`!accuse X`, double length). Then `!reveal` (or the timer) shows the solution, the vote split, the percentage of voters who got it right, and the Sharp Eye credits.
- One vote per user per ballot; a later vote replaces the earlier one. Votes are shown live as bars with counts (no usernames on the bars).
- Bot messages: short, at most one per phase change, never more than 1 message per second.

## Overlay look

A detective's case board: dark charcoal background panel occupying the lower third and right column so the streamer's gameplay stays visible; paper-white evidence cards with a typewriter-style heading (system monospace font), suspect cards with initials in a coloured circle (no images, no external fonts or assets), red string lines drawn between a testimony and the evidence that broke it. Smooth CSS transitions for card flips and vote bars. Large readable text (min 28px on 1080p). A small "!search 1–3" style hint always visible for the current ballot.

## The first case: "The Trophy at Table Nine" (all names fictional)

Scene: A board-game café's Friday tournament. At 21:40 the lights went out for ninety seconds. When they came back, the champion's trophy was gone from the shelf behind the counter. Four people were close enough to reach it.

Suspects:
- A — Mara Quill, the café owner. Insured the trophy last month.
- B — Theo Brandt, last year's champion. Lost in the semi-final tonight.
- C — Ivy Sato, the tournament judge. Was holding the fuse-box key.
- D — Ruben Ash, the delivery rider. Arrived at 21:35 with pizzas and is still here.

Locations and evidence:
1. The fuse box (back hallway) → E1: The main switch was flipped by hand, not blown. A smear of red ink from a pizza box is on the lever.
2. The counter shelf → E2: A dust outline where the trophy stood, and a cardboard pizza-box insert left in its place, cut to the trophy's height so it looked like the trophy in the dark.
3. The delivery bag → E3: Empty except for the receipt: four pizzas, delivered 21:35, signed "I. Sato".

Testimonies:
- A: "I was at the till the whole blackout. The drawer beeps if it opens, and nobody heard it." (true; no contradiction)
- B: "I'd already gone outside to cool off. I came back in when the lights came on." (true; no contradiction)
- C: "I never touched the pizzas. I was at Table Nine with the finalists." → contradicted by E3. Truth: "Fine. I signed for the pizzas at the counter at 21:35, right next to the shelf."
- D: "I never went past the counter. I left the boxes on the first table and waited by the door." → contradicted by E1. Truth: "Okay, I flipped the switch. Ivy gave me ten bucks and the key and said it was a prank for the finalists."

Solution: C, Ivy Sato. She held the fuse-box key and gave it to Ruben to flip the switch (E1 and Ruben's truth), signed for the pizzas at the counter so she had a reason to stand by the shelf (E3), and left the cut cardboard as a stand-in (E2). The trophy was already listed for sale online under a fake name.
Endings: if chat picks C — "Case closed. Chat, you'd make a fine detective." If D — "Ruben flipped the switch, but he never touched the trophy. The judge walks out with it." If A or B — the true account of that suspect, then the solution.
