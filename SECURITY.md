# Security

This is a starter and demonstration application. Review authentication, usage
limits and provider configuration before exposing an adapted application publicly.

## Reporting a vulnerability

Do not put credentials or exploit details into a public issue. Use the repository's
GitHub **Security → Report a vulnerability** option if private reporting is enabled.
If it is unavailable, contact the maintainers through an established private
channel before disclosing details. This repository does not promise a response SLA.

## Current boundaries

- Provider credentials stay server-side. `.env` is excluded from Git and Docker.
- Without `BOOTH_PASSCODE`, Node binds to loopback. With it, both browser sockets
  require the shared passcode. Static pages remain public.
- The shared browser passcode is stored in local storage and carried in socket
  query strings. Use HTTPS and avoid query-string logging at proxies.
- The Python service is loopback-only and requires a separate `PIPECAT_TOKEN`.
- Audio and transcripts are processed in memory, without application recording.
  Consoles receive transcripts; the latest conversation remains in server memory
  until the next call or process exit. Providers have their own retention policies.
- There is no per-user authorization, rate limiting or spending quota. A shared
  passcode is not a substitute for these controls in a public product.

If a credential is exposed, revoke it at the provider and replace it in your secret
store. Removing a file or changing a Git commit does not revoke a leaked key.
