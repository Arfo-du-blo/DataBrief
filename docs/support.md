# Support

DataBrief is free software maintained by one person. This page says where to ask for help and how to report a problem.

## A question, a bug, an idea

Open an issue on GitHub: <https://github.com/Arfo-du-blo/DataBrief/issues>. Say:

- what you did and what you expected;
- which app (Claude in the browser, Claude Desktop, ChatGPT, the command line...) and which DataBrief version (the page, the extension or `databrief --version`);
- the error message, if any.

An issue is **public**: do not paste your data, your file names if they are private, or any secret. A description of the file's structure is enough.

## A security problem

Do not post it as an issue. Use the repository's **Security** tab, then **Report a vulnerability**, which sends it privately to the maintainer. Say what is affected and how to reproduce it, without real data.
Security reports are read first.

## The connector's server

If the DataBrief connector does not answer, the server may be down or restarting. Try again later; if it lasts, open an issue titled "connector down". The state of the server is also visible at its `/healthz` address, which answers `ok` when it runs.

## Before you ask

- [The connector guide](connector.md): add it, use it, and what to do when a button does nothing.
- [The privacy policy](privacy.md): what the server receives and logs.
- [Do not share data](no-share.md): what the prompt contains.
- [Check the page yourself](verify-privacy.md): how to see that the page sends nothing.
