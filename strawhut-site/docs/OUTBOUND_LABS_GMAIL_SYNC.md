# Auto-capture Outbound Labs / Appointlet bookings into GoHighLevel

Every time Outbound Labs books a discovery call, two emails land in Ryan's
Gmail — an **Appointlet "Scheduled"** email (carries the questionnaire: spend,
goals, status) and an **Outbound Labs "New Result"** email (the AI-SDR
summary). This makes those bookings flow into GoHighLevel automatically, with
qualification tags, so no lead lives only in the inbox.

## How it works

```
Ryan's Gmail ──(Apps Script, runs in Ryan's account)──▶ POST /hooks/leads ──▶ GoHighLevel
```

- A small **Google Apps Script** runs in Ryan's own Google account on a timer.
  It finds the booking emails and POSTs each one's raw `{from, subject, body}`
  to the website server. **The server never logs into Gmail** — inbox access
  stays entirely on Ryan's side, and the script only ever touches emails from
  `notifications@appointlet.com` and `admin@outboundlabs.com`.
- The server (`src/leadHook.js`) parses the email and upserts a GoHighLevel
  contact. It **dedupes by email**, so re-sending the same booking updates the
  same contact instead of duplicating. Tags applied:
  `appointlet`, `outbound-labs`, and one of
  `unqualified-under-1k` (marketing spend < $1k/mo) /
  `needs-qualification` (spend not found) / *(none)* when it clears the bar.
  The questionnaire + AI summary are attached as a note for call prep.

## One-time setup

### 1. Set the shared secret on Railway (STRAW HUT SITE service)

Add an environment variable:

```
LEAD_HOOK_TOKEN = 85ce5d6fd41ed546e79f2171f548c9981f0169dfb3e20dac
```

(That's a freshly generated random token. Until it's set, the endpoint is
disabled and returns 503 — nothing can reach it.)

### 2. Add the Apps Script (in Ryan's Google account)

1. Go to <https://script.google.com> → **New project**.
2. Delete the sample code and paste the script below.
3. Replace `TOKEN_HERE` with the same token as above.
4. **Save**, then **Run ▸ `syncLeadsToGHL`** once — Google will ask you to
   **authorize** (it needs "read/modify Gmail"). Approve it.
5. Click the ⏰ **Triggers** (left sidebar) → **Add Trigger**:
   - Function: `syncLeadsToGHL`
   - Event source: **Time-driven** → **Minutes timer** → **Every 15 minutes**.
   - Save.

That's it. Every 15 minutes it sweeps new bookings into GoHighLevel and labels
the emails `ghl-synced` so they're never processed twice.

```javascript
// Straw Hut — sync Outbound Labs / Appointlet bookings into GoHighLevel.
// Paste into script.google.com, set TOKEN, authorize, add a 15-min trigger.
var HOOK_URL = 'https://www.strawhutmedia.com/hooks/leads?token=TOKEN_HERE';
var SYNCED_LABEL = 'ghl-synced';

function syncLeadsToGHL() {
  var label = GmailApp.getUserLabelByName(SYNCED_LABEL) || GmailApp.createLabel(SYNCED_LABEL);
  var query = '(from:notifications@appointlet.com OR from:admin@outboundlabs.com) newer_than:3d -label:' + SYNCED_LABEL;
  var threads = GmailApp.search(query, 0, 30);
  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var msgs = thread.getMessages();
    var allOk = true;
    for (var j = 0; j < msgs.length; j++) {
      var m = msgs[j];
      var payload = { from: m.getFrom(), subject: m.getSubject(), body: m.getPlainBody() };
      try {
        var resp = UrlFetchApp.fetch(HOOK_URL, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });
        if (resp.getResponseCode() >= 300) allOk = false;
      } catch (e) {
        allOk = false;
      }
    }
    if (allOk) thread.addLabel(label); // only mark done if every message posted
  }
}
```

## Verifying it works

- After the first run, check GoHighLevel for the recent bookings, tagged as
  above, each with a prep note.
- The server logs a line per upsert. `/healthz` continues to report GHL health.
- To re-import a booking you already synced: remove the `ghl-synced` label from
  that email in Gmail; the next run re-sends it (the upsert just updates the
  existing contact — safe).

## Notes / limits

- Cancellations are ignored; reschedules update the same contact.
- If Outbound Labs changes its email format, the parser
  (`parseOutboundLabs` / `parseAppointlet` in `src/leadHook.js`) may need a
  tweak — the raw email still reaches the server, so nothing is lost, it just
  may not extract a field until updated.
- This is deliberately a pull from Gmail rather than server-side inbox access,
  so the website server never holds Gmail credentials.
