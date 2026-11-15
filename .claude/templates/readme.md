# Project name

One sentence: what this is and who it's for.

[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions)

## Why

The problem it solves, in two or three sentences. Link to the longer design doc if there is one.

## Quick start

Prerequisites: runtime and tool versions (for example Node 22, Python 3.12, Docker).

```bash
git clone https://github.com/OWNER/REPO.git
cd REPO
cp .env.example .env     # then fill in the values; never commit .env
<install command>
<run command>
```

Expected result: what the reader should see (a URL, a log line, a test summary).

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | yes | | Connection string for the primary database |

Secrets come from the environment or a secret manager, never from the repository.

## Usage

The two or three most common tasks, each with a copy-pasteable example and its output.

## Development

```bash
<test command>      # run the tests
<lint command>      # lint and format check
<build command>     # production build
```

How the code is organized (one short paragraph or a directory map), and where to start reading.
Contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md): branch naming, Conventional
Commits, and PR expectations.

## Architecture

One diagram (Mermaid) showing the main components and data flow, plus links to ADRs in
`docs/adr/`.

## Deployment and operations

How it is released, how to roll back, where the dashboards, alerts and runbooks live.

## Support

Where to ask questions and report bugs. For security issues, see [SECURITY.md](SECURITY.md).

## License

Name of the license, linked to the LICENSE file.
