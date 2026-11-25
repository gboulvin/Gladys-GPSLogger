# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, positions and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes,
including:

- the local receiver (the `receiver` sub-container), which publishes an HTTP
  port on the user's network and must only ever queue positions;
- the relay between the receiver and the integration (`/internal/drain`,
  protected by a per-installation secret);
- the access token check and the parsing of the GPSLogger requests;
- the handling of location data, which is personal data: positions must only
  be stored in the user's Gladys and in the integration's `/data` volume, and
  never logged beyond the device name and coordinates at `info` level.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Gladys Plus, the GPSLogger app, and the phones it runs on.
