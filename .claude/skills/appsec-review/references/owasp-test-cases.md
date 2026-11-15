# Finding OWASP risks in code

For each OWASP Top 10:2025 category: what to search for, what the vulnerable and safe shapes look
like, and the test that proves a fix. Search patterns are starting points: they find candidates,
and you confirm each by reading the code path.

## Contents
- How to use this file
- A01 Broken Access Control
- A02 Security Misconfiguration
- A03 Software Supply Chain Failures
- A04 Cryptographic Failures
- A05 Injection
- A06 Insecure Design
- A07 Authentication Failures
- A08 Software or Data Integrity Failures
- A09 Security Logging and Alerting Failures
- A10 Mishandling of Exceptional Conditions

## How to use this file

1. List the entry points in scope (routes, handlers, message consumers, CLI commands).
2. Run the searches for the categories that apply (`grep -rnE` or `rg`).
3. For each hit, read the surrounding function and trace where the data came from.
4. Write a finding only when you can name the input or state that triggers it.

Safe local tests use hostile *strings* as data in unit tests. They never run against real systems.

## A01 Broken Access Control

**Search:** route definitions without an auth decorator or middleware; handlers that take an id
(`:id`, `{id}`, `params.id`, `request.args["id"]`) and load by it; `role ==` / `is_admin` checks
scattered in handlers; `Access-Control-Allow-Origin: *`; `path.join(base, userInput)`.

**Vulnerable:** `Order.objects.get(id=request.GET["id"])`
**Safe:** `Order.objects.get(id=oid, customer=request.user)`; a central policy check.

**Also check:** is every object-level read, update and delete scoped? Are list endpoints filtered
by owner or tenant? Can a normal user reach an admin route by URL?

**Test:** user B requests user A's resource (expect 403 or 404); anonymous request (401); regular
role calls admin route (403); update with another user's id (no change).

## A02 Security Misconfiguration

**Search:** `DEBUG = True`, `debug: true`, `app.run(debug=True)`; default credentials; `cors({ origin: '*' })`
with `credentials: true`; missing `helmet`/security headers; `verify=False`; permissive Dockerfile
(`USER root`), public buckets, `0.0.0.0/0` rules in IaC; stack traces in error responses.

**Test:** response-header assertions (CSP, HSTS, nosniff); an error response contains no stack
trace; IaC scan clean.

## A03 Software Supply Chain Failures

**Search:** manifest changes without a lockfile change; `curl ... | sh` in scripts and Dockerfiles;
unpinned `uses: owner/action@main` or tags; `FROM image:latest`; `postinstall` scripts in new
dependencies; dependency names one letter off a popular package.

**Test:** `osv-scanner`, `npm audit`, `pip-audit`, `cargo deny` fail on known high issues; CI uses
frozen lockfile installs.

## A04 Cryptographic Failures

**Search:** `md5`, `sha1`, `DES`, `ECB`, `Math.random()`, `random.random()` near tokens or keys;
hard-coded `key`, `iv`, `salt`, `secret`; `verify=False`, `rejectUnauthorized: false`,
`InsecureSkipVerify`, `danger_accept_invalid_certs`; passwords hashed with a fast hash; HTTP URLs
for sensitive calls; sensitive fields stored in plaintext.

**Safe:** Argon2id for passwords; AES-GCM with a unique nonce; a CSPRNG (`secrets`, `crypto.randomBytes`).

**Test:** stored password values are Argon2id/bcrypt hashes; tokens come from a CSPRNG; TLS
verification is on in the client config.

## A05 Injection

**Search (SQL):** `execute(f"`, `query(\`...${`, `"SELECT ... " + var`, `format!("SELECT`; raw ORM calls
(`.raw(`, `$queryRawUnsafe`, `text(`) with interpolation.
**Search (OS command):** `shell=True`, `os.system`, `child_process.exec(`, `Command::new("sh")` with input.
**Search (output):** `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, `|safe`, `Markup(`, `eval(`, `new Function(`.
**Search (other):** template rendering of user strings, `yaml.load(`, `pickle.loads(`, Mongo queries built
from request JSON, `RegExp(userInput)`.

**Safe:** bound parameters; argument arrays; the framework's auto-escaping.

**Test:** unit tests feeding `' OR 1=1 --`, `"; ls`, `<script>x</script>`, `{{7*7}}` assert the value is
stored or echoed as inert data.

## A06 Insecure Design

**Look for:** flows with no abuse case: reset/verify flows that reveal whether an account exists;
no rate or quota on expensive operations; trusting client-supplied prices, roles or ids; sequential
guessable identifiers as the only control; business rules enforced only in the UI; check-then-act
races (balance, stock, coupons).

**Test:** replay a request; reorder steps; negative and huge quantities; two concurrent requests
against one balance.

## A07 Authentication Failures

**Search:** password comparison with `==`; `bcrypt` cost under 10 or fast hashes; JWT decode with
`verify=False`, `algorithms=["none"]`, or no `aud`/`iss`/`exp` checks; session id in URL; no session
regeneration at login; no throttle on `/login`, `/reset`; long-lived tokens in `localStorage`; reset
tokens that are guessable or reusable.

**Test:** wrong password throttle; expired, tampered, unsigned and wrong-audience tokens rejected; session
id changes at login; logout invalidates the session server-side.

## A08 Software or Data Integrity Failures

**Search:** `pickle.loads`, `yaml.load` (not safe_load), `ObjectInputStream`, `unserialize`, `eval` on
data; auto-update or plugin loading without signature checks; webhook handlers without signature
verification; CI that runs fork PR code with secrets (`pull_request_target` + checkout of PR head);
`${{ github.event.* }}` interpolated into `run:`.

**Test:** webhook with a bad signature or stale timestamp is rejected; payload from a hostile
source is parsed only through a schema.

## A09 Security Logging and Alerting Failures

**Look for:** no log line on login failure, access denied or privilege change; logs missing user or
request ids; secrets, tokens, full card numbers or personal data in log statements (`log(.*password`,
`log(.*token`, request bodies logged whole); no alert on repeated auth failures; log injection
(unsanitized newlines).

**Test:** a denied-access request emits an audit event; log redaction test for known sensitive fields.

## A10 Mishandling of Exceptional Conditions

**Search:** empty `catch {}` / `except: pass`; `except Exception: return True/None`; `catch` that
continues as if authorized; unchecked `unwrap()` / `expect()` on external input; `.catch(() => {})`;
error responses that include `e.stack`/`str(e)`; resources opened without `finally`/`with`.

**Look for fail-open:** an authorization or validation service call whose failure path allows the action.

**Test:** make the auth/permission dependency raise and assert the request is denied; force a
database error mid-write and assert no partial state; assert error bodies are generic.

## API and agent-specific additions

See `.claude/security/api-security.md` for BOLA, mass assignment, SSRF, rate limiting and webhooks, and
`.claude/security/input-output.md` for upload, path and deserialization checks. For LLM features, treat
model output as untrusted input before it reaches SQL, a shell, HTML or a tool call.
