# homebrew-databrief

The [Homebrew](https://brew.sh) tap of [DataBrief](https://github.com/Arfo-du-blo/DataBrief): the command-line tool that turns a
data file into a prompt for an AI, offline, with a "Do not share data" mode. It reads 29 formats.

```bash
brew install Arfo-du-blo/databrief/databrief
databrief --help
man databrief
```

(or `brew tap Arfo-du-blo/databrief`, then `brew install databrief`). Homebrew installs Node.js for it.

This repository holds one file, `Formula/databrief.rb`. **It is written by the release of DataBrief** (a GitHub Action in
the DataBrief repository fills in the version and the SHA-256 of the released files): do not edit it by hand. The formula
downloads the release file `databrief-cli.cjs` and checks its fingerprint, the same one that is in the release's
`SHA256SUMS.txt`. Everything else (the guide, the options, the source) is in the
[DataBrief repository](https://github.com/Arfo-du-blo/DataBrief).

The tool makes no network connection and runs no shell. GPL-3.0-or-later.
