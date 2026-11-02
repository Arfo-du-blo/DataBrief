# scoop-databrief

The [Scoop](https://scoop.sh) bucket of [DataBrief](https://github.com/Arfo-du-blo/DataBrief): the command-line tool that turns a
data file into a prompt for an AI, offline, with a "Do not share data" mode. It reads 29 formats.

```powershell
scoop bucket add databrief https://github.com/Arfo-du-blo/scoop-databrief
scoop install databrief
databrief --help
```

Scoop installs Node.js (`nodejs-lts`) for it if you do not have it.

This repository holds one file, `bucket/databrief.json`. **It is written by the release of DataBrief** (a GitHub Action in the
DataBrief repository fills in the version and the SHA-256 of the released file): do not edit it by hand. Scoop downloads the
release file `databrief-cli.cjs` and checks its fingerprint, the same one that is in the release's `SHA256SUMS.txt`.
Everything else (the guide, the options, the source) is in the
[DataBrief repository](https://github.com/Arfo-du-blo/DataBrief).

The tool makes no network connection and runs no shell. GPL-3.0-or-later.
