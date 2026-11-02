{
    "version": "@VERSION@",
    "description": "Turn a data file into a prompt for an AI, offline, with a Do-not-share-data mode (29 formats)",
    "homepage": "https://github.com/Arfo-du-blo/DataBrief",
    "license": "GPL-3.0-or-later",
    "depends": "nodejs-lts",
    "url": "https://github.com/Arfo-du-blo/DataBrief/releases/download/v@VERSION@/databrief-cli.cjs",
    "hash": "@CLI_SHA256@",
    "pre_install": [
        "# Scoop makes shims for programs and scripts, not for a .cjs file: a small launcher runs the tool with Node.js",
        "$launcher = \"@echo off`r`nnode `\"%~dp0databrief-cli.cjs`\" %*\"",
        "Set-Content -Path \"$dir\\databrief.cmd\" -Value $launcher -Encoding Ascii"
    ],
    "bin": "databrief.cmd",
    "checkver": "github",
    "autoupdate": {
        "url": "https://github.com/Arfo-du-blo/DataBrief/releases/download/v$version/databrief-cli.cjs",
        "hash": {
            "url": "$baseurl/SHA256SUMS.txt"
        }
    }
}
