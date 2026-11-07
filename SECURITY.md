# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/Pelotto-Technologies/bellwether/security/advisories/new)
rather than a public issue. Expect an acknowledgement within a few days.

## Scope

Bellwether is a local overlay. It reads Herdr's local socket and renders agent state;
it does not run a hosted service. Reports about the npm package
`@pelotto-tech/bellwether`, the installer in `packages/cli`, the Electron shell, or the
release workflow are all in scope.

## Supported versions

Only the latest published release receives fixes.
