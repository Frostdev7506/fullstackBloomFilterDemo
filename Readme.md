```
BLOOM FILTER SIGN-UP DEMO — FULL-STACK (EXPRESS + REACT)
=========================================================

This project demonstrates a production-style pattern for speeding up “is this email already registered?” checks in a user sign-up flow using a Bloom filter.

The stack:
- Backend: Node.js + Express + SQLite + the “bloomfilter” library
- Frontend: React + Vite (a simple UI that live-checks emails as you type)

The key idea:
- A Bloom filter can tell you “definitely NOT present” or “maybe present” for set membership.
- We use it to pre-check user emails:
  • If the filter says NOT present, we skip a database read and attempt to insert directly.
  • If the filter says MAYBE present, we do a database lookup to confirm.
- This reduces database reads without sacrificing correctness (the DB remains the source of truth).


WHAT THIS PROJECT SHOWS
-----------------------
1) How to size a Bloom filter (bits m, hashes k) for a target false positive rate (FPP).
2) How to build and maintain the filter from your database state.
3) How to design a safe registration path that:
   - Avoids unnecessary reads (fast path on Bloom “miss”),
   - Verifies duplicates (slow path on Bloom “hit”),
   - Handles race conditions with a unique constraint.
4) A small React UI that debounces user input and displays “Not in set” vs “Maybe in set” in real time.


REPOSITORY LAYOUT
-----------------
fullstack-bloom-demo/
  server/
    index.js          (Express API, Bloom filter logic)
    db.js             (SQLite schema + helpers)
    package.json
    .gitignore
  client/
    vite.config.js    (Proxy for /api to backend)
    package.json
    src/
      main.jsx
      App.jsx         (UI with debounce + status pill + form)
      api.js          (fetch wrappers for API)
      index.css


BACKEND OVERVIEW (server/)
--------------------------
1) db.js (SQLite helpers)

   Schema:
     users(
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       email TEXT UNIQUE NOT NULL,
       name TEXT NOT NULL,
       created_at TEXT NOT NULL
     )

   Key functions:
   - normalizeEmail(email): trims and lowercases an email string.
   - countUsers(): returns total user count.
   - getAllEmails(): returns an array of all email strings, used to populate the Bloom filter at startup.
   - findUserByEmail(email): returns a user row if present.
   - createUser({ email, name }): creates a new user; unique(email) enforces no duplicates.
   - seedIfEmpty(): inserts a few known emails on first run (e.g., ada@example.com, linus@example.com, etc.).

2) index.js (Express app + Bloom filter)

   The Bloom filter is created and loaded at startup by reading every email from the DB. The project targets ~1% false positives with headroom for growth.

   Computing parameters (m, k):
   - Inputs:
       n = expected capacity (how many items we plan to hold)
       p = target false positive probability (e.g., 0.01 = 1%)
   - Formulas (standard Bloom filter math):
       m = ceil( - (n * ln p) / (ln 2)^2 )
       k = round( (m / n) * ln 2 )
     The code also rounds m up to a multiple of 32 because the “bloomfilter” library stores bits in 32-bit chunks.

   Why choose n and p this way:
   - We size for expected = max(2 × currentUsers, 1000). This gives headroom so the filter maintains the target FPP as the dataset grows.
   - p = 0.01 (1%) is a realistic tradeoff between speed and occasional “maybe” checks.

   Rebuild procedure:
   - countUsers() -> pick expected capacity
   - computeBloomParams(expected, p) -> get m (bits) and k (hashes)
   - new BloomFilter(m, k)
   - For each email in getAllEmails(), bloom.add(normalizeEmail(email))
   - Cache a bloomConfig object for health and debug logs

   What bloom.test(email) does:
   - Hashes the email k times; each hash maps to a bit index (0..m-1).
   - If any corresponding bit is 0, the item is DEFINITELY NOT present (returns false).
   - If all bits are 1, the item is MAYBE present (returns true). This could be a true positive (actually added before) or a false positive (collision).

   API endpoints (payloads shown for clarity):
   - GET /api/health
       Returns JSON with ok, service name, and bloomConfig (capacity, hashes, bits, current item count).
     Example response:
       {
         "ok": true,
         "service": "fullstack-bloom-demo",
         "bloom": {
           "expectedCapacity": 1000,
           "targetFPP": 0.01,
           "bits": 9600,
           "hashes": 7,
           "currentItems": 5
         }
       }

   - POST /api/auth/check-email
       Request JSON: { "email": "user@example.com" }
       Response JSON:
         {
           "email": "user@example.com",
           "maybePresent": true|false,
           "meaning": "human-readable explanation"
         }
       Notes:
         maybePresent = false  -> definitely not in set (fast path likely)
         maybePresent = true   -> maybe in set, backend will verify on submit

   - POST /api/auth/register
       Request JSON: { "name": "User Name", "email": "user@example.com" }
       Response on success (two cases):
         {
           "user": { "id": 7, "email": "user@example.com", "name": "User Name", "created_at": "..." },
           "created": true,
           "via": "fast-path"
         }
         OR
         {
           "user": { ... },
           "created": true,
           "via": "false-positive-path"
         }
       Response on duplicate:
         { "error": "Email already registered" } with HTTP 409
       Internal logic:
         • If bloom.test(email) === false (miss):
             - Attempt insert directly (skip read).
             - On success: add email to Bloom, return fast-path.
             - If the DB rejects with UNIQUE constraint (rare race), return 409.
         • If bloom.test(email) === true (hit):
             - Query DB:
                 - If found: return 409 (duplicate).
                 - If not found: it was a false positive; insert; add to Bloom; return false-positive-path.

   - GET /api/_stats
       Returns bloomConfig (useful for debugging and metrics dashboards).


FRONTEND OVERVIEW (client/)
---------------------------
1) App.jsx (main UI)
   - Local state includes:
       name, email, status (“idle”, “checking”, “miss”, “maybe”), hint message,
       result (success payload), error (string or null).

   - onEmailChange handler:
       • Updates state with each keystroke.
       • Simple input guard: if empty or not email-shaped, set status to “idle” and skip network work.
       • Debounces 350ms to avoid hammering the API while the user is typing.
       • Calls checkEmail(email) (POST /api/auth/check-email).
       • Interprets response:
            maybePresent = false -> setStatus("miss") and show hint “definitely not registered”
            maybePresent = true  -> setStatus("maybe") and show hint “may be registered; will verify”

     Why debounce?
       To reduce unnecessary requests and keep the UI responsive during typing bursts.

   - onSubmit handler:
       • Prevents default form submission.
       • Calls register(name, email) (POST /api/auth/register).
       • On success: displays a success notice containing the created user email and the path (“fast-path” or “false-positive-path”).
       • On 409 or any server error: displays an “Oops” notice with the error message.

   - StatusPill component:
       Displays the current membership result: Idle / Checking… / Not in set / Maybe in set.

2) api.js (network wrappers)
   - checkEmail(email): POSTs to /api/auth/check-email with JSON body.
   - register(name, email): POSTs to /api/auth/register with JSON body.
   - Both helpers convert non-OK responses into thrown errors for the UI to handle.

3) index.css (styling)
   - Provides minimal styling:
       • Card layout for the form
       • Input focus styles
       • A small “pill” for the membership status
       • Notice banners for success and error


END-TO-END LIFECYCLE (WHAT HAPPENS AS YOU TYPE)
-----------------------------------------------
1) User types in the email input.
2) Frontend validates basic shape; if invalid or empty, UI resets to Idle (no API calls).
3) After 350ms of no typing, the frontend calls /api/auth/check-email with the current input.
4) Backend normalizes the email (lowercase+trim), and runs bloom.test(email).
   - If the test returns false:
       The response says “definitely not registered”, and the UI shows “Not in set”.
   - If the test returns true:
       The response says “may be registered”, and the UI shows “Maybe in set”.
5) When the user clicks “Create account”, the frontend calls /api/auth/register.
6) Backend repeats bloom.test(email) to select fast path or slow path:
   - Fast path (miss): try DB insert immediately; on success, add email to Bloom; UI shows success via “fast-path”.
   - Slow path (hit): check DB; if found -> 409 conflict; else -> insert, add to Bloom; UI shows success via “false-positive-path”.
7) The DB’s UNIQUE(email) constraint guarantees no duplicates even if two clients race.


BLOOM FILTER THEORY (WHY AND HOW)
---------------------------------
Guarantees and tradeoff:
- NO false negatives: If the test says “not present”, the element was never added.
- POSSIBLE false positives: The test can sometimes say “maybe present” even if not added, due to hash collisions. That is why we confirm with the DB when the filter says “maybe”.

Sizing math:
- Let n be expected capacity (how many items you plan to insert).
- Let p be the desired false positive probability (e.g., 0.01).
- Then:
    m = ceil( - (n * ln p) / (ln 2)^2 )  bits in the filter
    k = round( (m / n) * ln 2 )          hash functions
- Choosing n larger than current count (headroom) keeps p roughly constant as the set grows.

Interpreting the logs:
- On startup the backend logs something like:
    [Bloom] rebuilt { expectedCapacity: 1000, targetFPP: 0.01, bits: 9600, hashes: 7, currentItems: 5 }
  This means:
    • The filter is sized for ~1000 items at ~1% FPP.
    • It uses 9600 bits (~1.2 KB) and 7 hash functions.
    • It currently contains 5 items (loaded from the DB).


RACES AND CONSISTENCY
---------------------
- Even with a Bloom “miss” (fast insert), two clients could try the same new email nearly simultaneously.
- The UNIQUE(email) constraint in SQLite is the safety net:
   • If both attempt inserts, one will succeed and the other will get a constraint error.
   • The server converts that into a 409 “Email already registered”.
- After a successful insert, the backend calls bloom.add(email) so subsequent checks see it as “maybe present”.


SCALING, PERSISTENCE, AND DISTRIBUTION
--------------------------------------
- Capacity: Memory grows roughly linearly with the number of items. For 1,000 items at 1% FPP, the filter is ~1.2 KB; for 1,000,000 items at 1% FPP, expect ~1.2 MB.
- Rebuilds: As currentItems approaches expectedCapacity, the actual FPP will increase. Rebuild the filter periodically (e.g., cron or on startup) with a larger expected capacity.
- Persistence: For very large sets, you can serialize and persist the bit array to avoid cold-start costs, or reconstruct from the DB on boot.
- Horizontal scaling: Either:
   • Rebuild the filter on each node from the DB, or
   • Centralize with a networked structure (e.g., RedisBloom) and call BF.ADD / BF.EXISTS.
- Observability: Expose bloomConfig via metrics and watch FPP trends (indirectly visible as “false-positive-path” frequency).


SECURITY CONSIDERATIONS
-----------------------
- A Bloom filter is a performance optimization, not an authorization mechanism.
- Never treat “maybe present” as “definitely present.” Always confirm duplicates at the DB level.
- Do not ship the raw filter to the client; it can leak information through membership probes.


TESTING STRATEGY (WHAT TO TEST)
-------------------------------
- Component-level (mock API):
   • Typing an existing email leads to “Maybe in set”.
   • Typing a brand-new email leads to “Not in set”.
   • Submitting a brand-new email produces a success message.
- End-to-end (real backend):
   • The seeded emails cause Bloom hits and DB-confirmed duplicates.
   • Newly created emails go through the fast path or the false-positive path deterministically.
   • Race behavior: submitting the same new email from two tabs leads to one success, one 409.
- Backend units:
   • computeBloomParams(n, p) returns sensible m and k (e.g., m multiple of 32).
   • Rebuild loads all current emails.
   • Register endpoint behavior across the three paths (fast-path, slow-path duplicate, slow-path false-positive).


TROUBLESHOOTING NOTES
---------------------
- Too many “maybe present” results:
   • Expected capacity may be too small. Rebuild with a larger n (e.g., 3–5× current count).
- Seeing duplicates:
   • Ensure the DB has a UNIQUE(email) constraint and error handling returns 409 on conflict.
- UI spamming requests:
   • Increase debounce duration or add stricter local validation before calling the API.
- Inconsistent behavior after restart:
   • Confirm rebuild logic runs early and loads all DB emails before serving traffic.


FAQ
---
Q: Why not always query the database?
A: For low traffic, you can. At scale, Bloom filters shed most reads and keep latency low, especially when most inputs are new.

Q: Can we delete emails from a Bloom filter?
A: Standard Bloom filters are append-only. For deletions, use a Counting Bloom filter or a Cuckoo filter, or rebuild periodically.

Q: What happens if the Bloom filter says “maybe present” for a never-seen email?
A: That’s a false positive. The backend checks the DB; if not found, it proceeds with insert and then adds to the Bloom filter.

Q: Do we risk missing a duplicate if the filter says “not present”?
A: No. Bloom filters have no false negatives. A “miss” means the element is definitely not in the filter. True duplicates are prevented by the DB’s UNIQUE constraint during insertion.

Q: How often should we rebuild the filter?
A: When currentItems nears expectedCapacity, or on a schedule (daily/weekly), or on deployments. The key is to keep FPP near your target.


LICENSE
-------
MIT. Free to use and modify.
```
