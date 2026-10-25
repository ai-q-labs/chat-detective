# Chat Detective

A live mystery for Twitch streams: viewers search locations, question suspects, call out contradictions, and vote on the culprit. The app uses a JSON case and has no runtime dependencies or AI service. Requires Node.js 22+.

## Run

- `npm start` connects to Twitch. Set `TWITCH_CLIENT_ID` and `TWITCH_CHANNEL`; create a **Public** Twitch app with an OAuth redirect such as `http://localhost`. On first run, authorize at the printed URL with the displayed device code. Tokens are saved in `.twitch-token.json` and refreshed automatically.
- `npm run sim` starts the browser-only simulation. Open `http://localhost:3000/control`; the OBS browser source is `http://localhost:3000/overlay` (1920×1080).
- `npm run demo` runs a twelve-viewer crowd through a simulated case. `DEMO_SPEED=8` speeds up the vote intervals; `PORT` changes the default port 3000.
- `npm run check-twitch` validates the saved token, checks the configured channel and EventSub subscription, then waits up to 60 seconds for one chat message. It prints diagnostics but never prints the token.
- `npm test` runs the game, command, OAuth, and Twitch refresh tests.

Twitch chat uses EventSub `channel.chat.message` and the Helix Send Chat Message API with `user:read:chat` and `user:write:chat`. The broadcaster or a moderator can use `!next`, `!reveal`, and `!reset`.

## Run it on your channel

Register a Twitch **Public** app with redirect URL `http://localhost`, then run `TWITCH_CLIENT_ID=… TWITCH_CHANNEL=… npm start` (set those variables in your shell). Approve the device code at [twitch.tv/activate](https://www.twitch.tv/activate). Add `http://localhost:3000/overlay` as an OBS browser source at 1920×1080, open `/control`, and press **Next** when ready to begin. Use `npm run check-twitch` to troubleshoot the token, channel lookup, and EventSub connection.

## Commands and cases

Viewer commands: `!search <location id>`, `!ask <suspect>`, `!contradict <evidence id>` (or `!c <evidence id>`), and `!accuse <suspect>`. Votes can be changed until a ballot closes.

Copy `cases/trophy-at-table-nine.json` to create a case. It defines `title`, `intro`, `suspects`, `locations` with evidence, `testimonies` with optional `contradictedBy` and `truth`, `solution`, and `endings`. Load the new file in `src/server.js`.

## How it was built

Built with OpenAI Codex from a written spec (`SPEC.md`).
