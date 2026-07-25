# Dictation Lab handoff

Dictation Lab is a no-build, mobile-first IELTS Listening trainer. The browser needs only the files in this folder. Typing, diffing, scoring, tagging, summaries, streaks, and progress work offline; generating new speech audio requires the configured TTS endpoint.

## Files

- `index.html` contains the four application views and accessible controls.
- `styles.css` contains the Nothing.tech-inspired black, white, and flare-orange design.
- `packs.js` exposes `DICTATION_PACKS`: four packs with 20 original sentences each.
- `app.js` contains `CONFIG`, storage, TTS, diffing, tagging, session, and progress logic.

There is no package manager, build command, framework, or runtime dependency.

## CONFIG

`CONFIG` is the single frozen object at the top of `app.js`.

| Key | Purpose | Current value |
| --- | --- | --- |
| `TTS_BASE_URL` | Same-origin or absolute Edge TTS endpoint. The client sends `POST` JSON and buffers the complete response before playback. | `/api/tts` |
| `TTS_VOICE` | Voice sent in the TTS request body. | `en-US-JennyNeural` |
| `SUPABASE_URL` | Supabase project URL used for REST persistence when `fs_user` is present. May be injected during deployment; do not commit a private service-role credential. | empty |
| `SUPABASE_ANON_KEY` | Public browser-safe Supabase anon/publishable key. Authenticated access uses the token found in `fs_user` when available. | empty |
| `SUPABASE_SESSIONS_TABLE` | Table for completed sessions. | `dictation_sessions` |
| `SUPABASE_PREFERENCES_TABLE` | Table for per-user speed. | `dictation_preferences` |
| `SESSION_LENGTH` | Sentences sampled from a selected 20-sentence pack. | `10` |

The TTS request body is:

```json
{
  "text": "Sentence to speak.",
  "voice": "en-US-JennyNeural"
}
```

The client accepts either a raw audio response or JSON containing `audioContent`, `audio_content`, `base64`, `audioUrl`, `audio_url`, or `url`. Remote audio is always downloaded into an `ArrayBuffer`/`Blob` before `HTMLAudioElement.play()`. The Start, Replay, and Next gestures unlock the audio element for iOS Safari.

## Storage module contract

All persistence lives in the `Storage` IIFE inside `app.js`; application code does not call `localStorage` or Supabase directly.

- `init(): Promise<void>` loads `fs_user`, local cache, remote preferences, and remote session history.
- `getMode(): "guest" | "account"` reports whether a valid `fs_user` object exists.
- `getUser(): object | null` returns the parsed unified user object.
- `getUserId(): string` accepts common unified-user shapes: `id`, `user_id`, `uid`, or nested `user.id`/`user.uid`.
- `getSpeed(): 0.75 | 1 | 1.25` returns the saved playback speed.
- `setSpeed(speed): Promise<{remote: boolean}>` writes the local cache immediately and upserts Supabase when configured.
- `getSessions(): Session[]` returns a defensive copy of saved sessions, newest first.
- `saveSession(session): Promise<{remote: boolean, queued: boolean}>` writes locally immediately and upserts Supabase when configured.
- `getSyncState(): "local" | "queued" | "synced"` exposes current persistence state.

Guest keys use this namespace:

```text
dictation_lab:v1:guest:preferences
dictation_lab:v1:guest:sessions
```

Signed-in local caches replace `guest` with the URL-encoded unified user ID. If the network or Supabase configuration is unavailable, signed-in writes remain in that user-specific local cache and the UI reports that account sync is queued. The user is never blocked.

### Expected Supabase rows

`dictation_preferences` needs a unique `user_id` plus `speed` and `updated_at`.

`dictation_sessions` needs a unique composite key on `(user_id, session_id)` plus:

```text
pack_id, pack_title, accuracy, avg_replays,
correct_words, total_words, error_tags (jsonb),
sentence_results (jsonb), completed_at
```

Row-level security should restrict both tables to the authenticated user's ID. The browser must receive only the anon/publishable key; never expose the service-role key.

## Word diff and score

Input and reference text are tokenized case-insensitively. Sentence punctuation and capital letters do not affect scoring; apostrophes, hyphens, decimal points, and time colons inside a token remain meaningful. A dynamic-programming edit distance aligns reference and answer tokens.

- Exact token: white.
- Substitution: entered token in orange with the expected token beneath.
- Deletion: orange underline placeholder with the expected token beneath.
- Insertion: dim, struck-through token.

Sentence and session accuracy are `exact reference words / total reference words`. Extra words appear in the diff but do not increase the denominator.

## Error-tag rules

Only substitutions and missing reference words are tagged. Extra entered words are shown in the diff but do not receive a tag.

Rules run in this order:

1. `article`: expected token is `a`, `an`, or `the`.
2. `number`: expected token contains a digit, a number/ordinal word, a month/day, or a common quantity label.
3. `preposition`: expected token appears in the built-in preposition set.
4. Missing-token fallback: plural-looking expected tokens become `plural`; other deletions become `missed_word`.
5. `verb_form`: expected and entered forms share a regular verb stem or belong to the same built-in irregular-verb group.
6. `plural`: expected and entered tokens reduce to the same simple singular form.
7. `spelling`: every other substitution.

Counts are aggregated in each saved session. The session summary shows the most frequent current-session tag, while Progress ranks the top three tags across all saved sessions.

## Operational follow-up

1. Confirm that the production Edge endpoint at `/api/tts` uses the documented POST/response contract and permits requests from `flarestamina.com`.
2. Inject the deployment's public Supabase URL and anon/publishable key into `CONFIG`, then create the two tables and their RLS policies. The current repository does not contain these shared values.
3. If the unified `fs_user` schema is narrowed later, simplify `getUserId()` and `userToken()` to the canonical fields.

No other application code needs to change for a backend swap; replace the internals of `Storage` while keeping its public contract.
