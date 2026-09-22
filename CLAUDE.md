# Working notes for this repo

Ryan has no local machine for Claude Code sessions — everything runs in the
cloud sandbox. Do not tell him to run terminal commands (`npm install`,
`netlify dev`, `netlify deploy`, `git ...`). Run all of that yourself in
this session (npm install, local test/build verification, `netlify` CLI or
the Netlify MCP tools for deploy) and push finished results.

What Ryan does do himself, because it's a web UI action rather than a local
machine one:
- Registering API credentials on a provider's own web console (e.g.
  BrickLink's consumer registration page) — only his account can do this.
- Pasting secrets directly into the Netlify dashboard's environment
  variables screen, rather than into chat — keeps secrets out of session
  logs even though Claude also has MCP write access to set them directly.
- One-off clicks in the Netlify UI (e.g. "Import from Git") if a step
  can't be done via the MCP tools/CLI.

Netlify: Ryan's account (ryanstraits@gmail.com, team id
5d786728f31b7564c277ac88) already has a similar app deployed as
`straitsbudget` (site id 33025e83-0751-4029-9329-eeeb9b951461) — Claude
set that one up and deploys to it directly; use the same pattern here
instead of asking Ryan to run CLI commands.

## Fork point: pre-API-expansion

Branch `fork-point-pre-api-expansion` (commit `6105b7c`) marks the app
right before adding Drive Thru sending, order messages, and buyer
feedback — a simple, fully-working state (pick list, item photos,
BrickLink status write-back, durable Netlify Blobs pick state). Ryan
asked for this checkpoint in case the new features make the app feel
unwieldy and he wants to back out.

To undo everything after this point and go back to that simpler app:
```
git checkout -B claude/bricklink-pick-list-backend-13b32l fork-point-pre-api-expansion
git push --force-with-lease origin claude/bricklink-pick-list-backend-13b32l
```
(Confirm with Ryan before force-pushing — this discards the newer commits
from the branch history, though they remain reachable via the fork-point
branch and the commit hash above either way.)

Note: pushing an actual git *tag* to this repo from a session returns a
403 (branch refs work fine, so a branch was used for the marker instead)
— worth knowing if this comes up again.
