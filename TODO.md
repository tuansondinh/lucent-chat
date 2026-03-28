# TODO

## Security Review (2026-03-28)

### CRITICAL

- [x] **WebBridgeServer ignores `remoteAccessEnabled`** — Server always starts on port 8788/0.0.0.0 even when disabled. Any local process gets unauthenticated access.
  - Fixed: gated startup on `settings.remoteAccessEnabled` in `index.ts`

- [ ] **`fs-write-file` not blocked for remote clients** — `web-bridge-server.ts` BLOCKED_CMDS omits `fs-write-file`, so PWA clients can write arbitrary files in the project root. Add to blocklist or create an explicit write-allow opt-in.

- [ ] **Remote clients can escalate via `set-settings`** — A remote client can change `permissionMode` to `danger-full-access`, set `remoteAccessToken` to `""`, or modify `autoModeRules`. Block security-sensitive fields from remote `set-settings` calls.

- [ ] **`remoteAccessToken` not sanitized from renderer responses** — `sanitizeSettingsForRenderer` strips `tavilyApiKey` but passes `remoteAccessToken` through. Add it to the `Omit` in `settings-contract.ts`.

### HIGH

- [ ] **Localhost auth bypass on 0.0.0.0 binding** — Server binds all interfaces; localhost requests bypass token auth. Any local process (malicious npm script, compromised extension) gets full unauthenticated API access. Bind to `127.0.0.1` by default; only bind `0.0.0.0` when Tailscale serve is enabled.

- [ ] **Token comparison not constant-time** — `web-bridge-server.ts:203` uses `!==` for bearer token check. Use `crypto.timingSafeEqual` instead.

- [x] **Classifier rules trivially bypassed** — Deny rules like `rm *` only match full command text. Chained commands (`&& rm`), absolute paths (`/bin/rm`), subshells (`$(rm)`), and interpreter wrappers (`bash -c "rm"`) all bypass.
  - Fixed: `extractBashSubcommands` now decomposes commands into subcommands, strips paths/env vars, extracts subshells and interpreter wrappers. Deny rules match all candidates; allow rules only match full command.

- [ ] **`readFileFull` has no size limit** — `file-service.ts` reads entire file into memory. Add a cap (e.g. 50MB) to prevent OOM from large files or `/dev/zero` symlinks.

- [ ] **Token logged to stdout** — `server.ts:233` prints the bearer token. Remove or redact.

### MEDIUM

- [ ] **Default permission mode is `danger-full-access`** — New installs have zero guardrails. Consider defaulting to `accept-on-edit`.

- [ ] **TOCTOU in `writeFile` path validation** — Parent directory could be replaced with symlink between check and write. Validate resolved path of parent directory before write.

- [ ] **PWA token persisted in localStorage** — Accessible to any JS on same origin. Any XSS would compromise the token.

- [ ] **No request body size limit on HTTP API** — `web-bridge-server.ts` `handleCommand` concatenates body chunks without limit. Add a cap (e.g. 10MB).

- [ ] **`remoteAccessToken` validation accepts empty string** — `validateSettingsPatch` only checks `typeof === 'string'`. Add minimum length check (≥16 chars).

## Classifier / Auto Mode

- [ ] Replace `CLAUDE.md` with `LUCENT.md` as the project instructions file read by the classifier.
  - Currently reads: `join(pane.projectRoot, 'CLAUDE.md')` in `apps/studio/src/main/ipc-handlers.ts`
  - Change to: `LUCENT.md` (Lucent Chat's own config file, not Claude Code's)
