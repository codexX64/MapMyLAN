# Contributing

## Before opening a pull request

Describe your intent in an issue first. A feature that is designed and then
rejected wastes everyone's time.

## Style

The code is commented **in French**, like the rest of the project. Comments
explain *why* a decision was made, not what the code does line by line — that is
already legible in the code itself.

Dependencies are added sparingly. A fifty-kilobyte library for a twenty-line
function will not be accepted.

## What is checked

- Type checking passes without errors, both backend and frontend.
- No personal data, no real network addresses. Examples use the ranges reserved
  for documentation: `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`.
- Secrets stay out of the repository.

## Security

A vulnerability is reported privately, never through a public pull request that
would reveal it before a fix exists. See [SECURITY.md](SECURITY.md).
