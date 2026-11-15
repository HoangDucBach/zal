# Input validation and output encoding

> **Precedence:** a project security policy that is *stricter* than this file wins. A weaker one
> needs a documented risk acceptance (an ADR or ticket with an owner).

Every value from outside the process is attacker-controlled until proven otherwise: request
bodies, headers, query strings, cookies, file contents, uploaded file names, third-party API
responses, queue messages, environment variables in multi-tenant setups, and LLM output.
Validate on the way in, and encode for the destination on the way out.

## Validate at the boundary

- **Parse into typed values with a schema** at the edge (zod/valibot in TS, Pydantic in Python,
  serde with `deny_unknown_fields` plus validator in Rust). The rest of the code works with
  validated types only.
- **Allow-lists over block-lists:** expected type, length, range, format and enum values.
  Reject what doesn't match; don't try to "clean" malicious input.
- Canonicalize before validating (unicode normalization, URL decoding once) so encoded payloads
  can't slip past.
- Client-side validation is for UX only. The server always re-validates.

## Injection, by destination

| Destination | Do | Never |
|---|---|---|
| SQL | Parameterized queries or the ORM's bound parameters; allow-list identifiers (column names for sorting) | String concatenation or f-strings into SQL; raw ORM queries built from input |
| OS command | Avoid the shell: argument arrays (`subprocess.run([...])`, `execFile`, `Command::new().arg()`); allow-list arguments | `shell=True`, `exec(string)`, `system()` with input |
| HTML | The framework's auto-escaping (React, Angular, Jinja autoescape); sanitize rich text with DOMPurify or nh3/ammonia | `innerHTML`, `dangerouslySetInnerHTML`, `v-html` or `|safe` with untrusted data |
| JavaScript / URL contexts | Encode for the context; validate URL schemes (`https:` only) before using them in `href` | `javascript:` URLs; building scripts from input |
| Templates (server-side) | Pass data as variables | Rendering user input *as* a template (SSTI) |
| NoSQL / LDAP / XPath | Typed query builders; escape per the spec | Passing JSON from the request straight into a Mongo query (`$where`, operator injection) |
| HTTP headers / logs | Strip CR/LF; structured logging | Echoing raw input into headers (response splitting) or log lines (log forging) |
| Regex | Bounded patterns, RE2/linear-time engines, input length limits | Nested quantifiers on untrusted input (ReDoS) |

## SSRF (server-side request forgery)

When the server fetches a URL that the user influences (webhooks, image import, link previews):

1. Allow-list schemes (`https`) and, where possible, the destination hosts.
2. Resolve DNS, then **reject private, loopback, link-local and metadata addresses**
   (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16` including `169.254.169.254`,
   `::1`, `fc00::/7`, `fe80::/10`), and connect to the IP you checked, which prevents DNS rebinding.
3. Disable redirects, or re-check every redirect hop.
4. Set timeouts and response size limits. Route through an egress proxy if you have one.

## File uploads

- Enforce size limits at the proxy and in the app. Allow-list extensions *and* check the content
  type by magic bytes.
- Generate a random storage name. Never use the user's file name in a path. Store outside the
  web root or in object storage, with `Content-Disposition: attachment` when serving.
- Process images through a re-encoder (strips payloads and metadata). Scan with antivirus where
  required.
- Unpacking archives: check every entry path stays inside the target directory (zip slip), and
  limit the total uncompressed size (zip bombs).

## Paths

Resolve the final path (`realpath`/`Path.resolve()`/`canonicalize`) and check it is inside the
allowed base directory before opening it. Reject `..`, absolute paths and NUL bytes in input.

## Deserialization and parsing

- Don't deserialize untrusted data with formats that can instantiate types: Python `pickle`,
  `yaml.load` (use `yaml.safe_load`), Java native serialization, .NET `BinaryFormatter`, PHP
  `unserialize`, or Jackson default typing.
- Use JSON (or protobuf) plus schema validation. Limit payload size and nesting depth.
- XML: disable DTDs and external entities (XXE). In Python use `defusedxml`.
- JS: guard against prototype pollution when merging objects (`Object.create(null)`, reject
  `__proto__`/`constructor` keys, or use `structuredClone`).

## Redirects

Only redirect to relative paths or allow-listed hosts. An open redirect is a phishing tool.

## LLM and agent inputs

Treat model output as untrusted input: validate it before using it in SQL, shell commands, HTML
or tool calls, and never let it select files or URLs without the same checks as user input.
Prompt-injection guidance for Claude itself: `agent-safety.md`.

## Sources

- OWASP Input Validation Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- OWASP Injection Prevention / SQL Injection Prevention Cheat Sheets — https://cheatsheetseries.owasp.org/
- OWASP SSRF Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP File Upload Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- OWASP Deserialization Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html
- OWASP Top 10 for LLM Applications — https://genai.owasp.org/llm-top-10/
