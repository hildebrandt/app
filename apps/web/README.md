# web

The home page is an Agent workspace. Select an example to start an editable
draft, or enter a prompt in **Ask anything**. Press **Enter** or select
**Submit prompt** to send it. Press **Shift+Enter** to insert a new line.
The workspace follows the system color scheme until you use the light or dark
mode button in the footer.

While the agent responds, **Thinking…** appears below the last message and the
send arrow changes to a stop icon. Select **Stop response** to cancel. The
workspace keeps the text already received and any draft you entered while
waiting. For an interrupted text response, **Retry** replaces that answer
without submitting a second user message or changing the draft.

Select **Copy message** below a message to copy its text to the clipboard.

If an embedded draft action was requested, the workspace does not retry the turn.
Check the draft before sending another prompt. Stopping a response does not
reverse an edit that already landed. Use `undo_draft` while its permission and
draft still match.

## Run

From the repository root, set `LLM_API_KEY` in the backend terminal's environment
and start the backend:

```sh
pnpm --filter backend dev
```

In a separate terminal, start the web app:

```sh
pnpm --filter web dev
```

From this directory:

```sh
pnpm dev
```

Open <http://localhost:3000>. The browser sends chat requests to the web app's
`/api/chat` endpoint. The web server forwards them to the separate backend on
`127.0.0.1:3001`. The backend calls `http://192.168.10.2:30129/v1` with model
`default`. Its runtime needs network access to that address.

| Variable | Process | Purpose |
| --- | --- | --- |
| `LLM_API_KEY` | Backend | Required provider key. Do not set it in the web app or commit it. |
| `BACKEND_PORT` | Backend | Optional port. Defaults to `3001`. |
| `CHAT_BACKEND_URL` | Web server | Optional backend origin. Defaults to `http://127.0.0.1:3001`. Set it if you change the backend port. |
| `CHAT_OWNER_SECRET` | Web server and backend | Optional shared secret of at least 32 characters. Keep it server-side. Without the same value in both processes, embedded draft actions are unavailable. |

The chat endpoint has no user authentication. The production launcher binds to
`127.0.0.1`. Do not expose it through a reverse proxy without access controls.

Embedded draft edits require a loopback browser origin, a backend URL with a
loopback IP address such as `127.0.0.1`, and the shared owner secret.
Enable **Allow agents to edit the draft** in the current tab. When the model
requests an edit, review the current and proposed text and
select **Approve**, **Deny**, or **Stop**. Approval changes the draft but does not
send it. Revoking the edit grant cancels a pending approval. The external bridge
and WebMCP still use the standing grant without this per-edit confirmation.

## Build

From the repository root:

```sh
pnpm --filter web build
```

### Verify chat without a provider

After the build, start the disposable pair from the repository root:

```sh
node packages/e2e-web/e2e/fixtures/chat-pair.mjs
```

Use the printed `webUrl` as `PLAYWRIGHT_BASE_URL` and `controlUrl` as
`CHAT_PAIR_CONTROL_URL`. Then run:

```sh
pnpm --filter @repo/e2e-web e2e agent-chat.test.ts agent-draft-chat.test.ts agent-connections.test.ts --workers=1
```

The protected draft tests start their own disposable pair with a scripted
TanStack adapter. Neither pair needs provider credentials. Stop the first pair
when the tests finish.

## Agent connections

Both connections use the same browser-side tool handlers on the **Ask Agent**
textarea. The external bridge pairs one local Node process with one browser tab
over a loopback WebSocket. WebMCP registers the same two tools directly with the
browser. Neither connection requires an agent account or provider key, and
neither can submit prompts.

### Least privilege

| Tool | Arguments | Required permission | Change event | Undo behavior |
| --- | --- | --- | --- | --- |
| `set_draft` | `{ "value": "string" }` | **Allow agents to edit the draft** in this tab | `draft.changed` for an applied change | Saves the previous value for one undo. An equivalent value does not replace it. |
| `undo_draft` | `{}` | The same permission, checked again | `draft.changed` when the previous value is restored | Restores the last agent edit. A manual or example edit clears the undo slot. Undo does not redo or send anything. |

The argument objects reject extra properties. The edit grant starts off and
applies to both connections. You can revoke it at any time. Listing tools does
not require the grant and returns only names, descriptions, and schemas.
Neither connection exposes a tool to read the draft, invoke other controls, or
submit prompts. A client with the edit grant can infer that a proposed value
matches the current draft up to newline normalization when `set_draft` returns
`change: null`.

`set_draft` accepts at most 4,000 Unicode code points in `value`. With the
grant enabled, both connections answer a tool call that carries an over-limit
value with the tool-level result `{"ok":false,"error":"invalid_arguments"}`
and leave the draft unchanged. WebMCP sets `isError` on this result. The
external bridge applies a separate size cap to each request line and answers
a larger line with `{"error":"invalid_request","type":"error"}` before any
tool call. A message over that cap fails before `set_draft` runs. It produces
no tool result and leaves the draft unchanged.

After it validates the argument, `set_draft` normalizes newlines in `value`:
CRLF (`\r\n`) and bare CR (`\r`) become LF (`\n`), the line ending the
textarea uses. The 4,000 code point limit counts `value` as sent, before this
normalization, so each CRLF counts as two code points. A value that equals the
current draft after normalization is a no-op: it returns `ok: true` with
`change: null` and does not replace the undo slot.

An applied change returns `ok: true` with `change` set to
`{"type":"draft.changed","key":"value","label":"Ask Agent","source":"agent"}`.
A no-op returns `ok: true` with `change: null`. A valid ungranted call returns
`{"ok":false,"error":"permission_denied"}` and makes no change. WebMCP also
sets `isError` on the native tool result. Draft text is not included in results.

If the bridge disconnects after dispatching a draft edit or Undo but before it
receives the result, it returns `draft_outcome_unknown`. Inspect the draft before
retrying. A disconnect does not reverse a change.

### Five-step trial

Use Node.js 24 or newer and pnpm 11.25.0. No account or permission fixture is
required. Run these steps from the repository root.

1. Run `pnpm install --frozen-lockfile`,
   `pnpm --filter @repo/e2e-web e2e:install`, then `pnpm --filter web build`.
   The browser install provides the pinned Chromium. On a Linux host without
   the Playwright system libraries, run
   `pnpm --filter @repo/e2e-web exec playwright install --with-deps chromium`.
2. Run `pnpm --filter @repo/e2e-web e2e agent-connections.test.ts`.
   Playwright starts the built app on `127.0.0.1:3000`, launches Chromium with
   `--enable-features=WebMCP`, and invokes the registered tools through the
   native Chrome DevTools Protocol `WebMCP` domain. It starts the external
   bridge as a separate Node process. Keep port 3000 free for this run.
3. For a manual external call, start `pnpm --filter web dev` in one terminal
   and `node apps/web/scripts/agent-bridge.mjs http://127.0.0.1:3000` in another.
   Open <http://127.0.0.1:3000>, select the **Max Mustermann** profile at the
   bottom of the sidebar to open **Agent connections**, and paste the
   `url` from the `ready` message into **Bridge URL**. Select **Connect bridge**.
   Treat the URL as a pairing secret. Send one JSON request per line to the
   bridge process. `{"id":1,"method":"tools/list"}` lists the tools.
4. Enter a value in the **Ask Agent** textbox. Select the **Max Mustermann**
   profile again, check **Allow agents to edit the draft**, and send
   `{"id":2,"method":"tools/call","name":"set_draft","arguments":{"value":"Plan a launch"}}`.
   Check the event and the visible value. Send
   `{"id":3,"method":"tools/call","name":"undo_draft","arguments":{}}`
   and check that the initial value returns. In a WebMCP-enabled Chromium
   client, invoke the same tool names and argument objects. The scenario in
   step 2 shows how to discover and invoke them through native CDP.
5. Select the **Max Mustermann** profile, uncheck the grant, and send the exact
   `set_draft` call again with a new
   request ID. Check for `permission_denied` and an unchanged textarea. Try
   the same tool and arguments through WebMCP. Disconnect the bridge when
   finished. The grant and undo slot are not stored across page loads.

If the app is already running, set
`PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000` for the command in step 2. The URL
must match the application origin used by the bridge process.

### SDK compatibility

The app uses the browser `createAgent` and `subscribe` APIs in the installed
React SDK. Start with `node_modules/@ui-sdk/react/docs/llms.txt` from this
directory for documentation that matches the installed version. The online
[WebMCP guide](https://ui-sdk.dev/docs/agents/connect-an-agent/webmcp) and the
installed guide describe `registerTools`, which publishes the SDK's generic
`snapshot`, `act`, and `query` tools. This app registers only its two draft
tools through `document.modelContext.registerTool` to avoid exposing page
reads and unconstrained actions. A browser without that API can still use the
external bridge.
