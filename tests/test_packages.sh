#!/usr/bin/env bash
# The packages of the command-line tool, installed for real (Docker, Linux):
#   - the .deb in clean Ubuntu 26.04, 24.04, 22.04 and Debian systems: installs (Node comes as a Recommends), runs, has its manual,
#     removes cleanly; without Node it says how to get it; with a Node that is too old (Ubuntu 22.04) it says that
#   - lintian (Debian's package checker) finds no error
#   - the npm tarball with the Node versions 18, 22 and 24 (official builds from nodejs.org, in the test environment folder)
#   - the Homebrew formula (Ruby syntax)
# Removes every image it pulled. On demand and on version tags (.github/workflows/tests.yml, job packages).
set -u
E="${DATABRIEF_TESTENV:-$HOME/databrief-testenv}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
PASS=0; FAIL=0
ok()   { echo "PASS $1"; PASS=$((PASS + 1)); }
bad()  { echo "FAIL $1  —  $2"; FAIL=$((FAIL + 1)); }
# the third argument is a command that shows what went wrong: it runs only when the check fails
check(){ if eval "$2"; then ok "$1"; else bad "$1" "$(eval "${3:-true}" 2>&1 | tail -15)"; fi; }

BEFORE="$(docker images -q | sort -u)"
cleanup() {
  for id in $(docker images -q | sort -u); do echo "$BEFORE" | grep -qx "$id" || docker rmi -f "$id" >/dev/null 2>&1; done
  rm -rf "$T"
}
trap cleanup EXIT

cd "$ROOT"
NODE="${NODE:-node}"
V="$("$NODE" -p "require('./package.json').version")"
mkdir -p "$T/deb" "$T/tap" "$T/npm"
check "build the .deb" '"$NODE" tools/build-deb.cjs "$T/deb/" > "$T/b.log" 2>&1 && ls "$T/deb/databrief_${V}_all.deb"' 'cat "$T/b.log"'
DEB="databrief_${V}_all.deb"

# a prompt that must hold no record: "Zelda" is the record ("Ana" would match the word "Analysis" of the prompt)
CSV='name,amount\nZelda,12\nBo,8\n'
install_test() {   # image
  docker run --rm -v "$T/deb:/pkg:ro" "$1" sh -c '
    set -e
    export DEBIAN_FRONTEND=noninteractive
    # the Docker images of Ubuntu leave out man pages and documentation on purpose: a normal system has them
    rm -f /etc/dpkg/dpkg.cfg.d/excludes
    apt-get update -qq >/dev/null
    apt-get install -y -qq /pkg/'"$DEB"' >/dev/null 2>&1 || { apt-get install -y /pkg/'"$DEB"'; exit 11; }
    echo "node: $(node --version)"
    test "$(databrief --version)" = "databrief '"$V"'"
    printf "'"$CSV"'" > /tmp/people.csv
    databrief /tmp/people.csv --print --no-copy --quiet | grep -q Zelda
    P="$(databrief /tmp/people.csv --print --no-copy --quiet --no-share)"
    echo "$P" | grep -q "data not shared"
    ! echo "$P" | grep -q Zelda
    test -f /usr/share/man/man1/databrief.1.gz
    test -f /usr/share/doc/databrief/copyright
    test -f /usr/share/doc/databrief/licenses/LICENSE-pdfjs.txt
    dpkg -s databrief | grep -q "^Status: install ok installed"
    apt-get remove -y -qq databrief >/dev/null 2>&1
    ! test -e /usr/bin/databrief
    ! test -d /usr/lib/databrief
    ! test -e /usr/share/man/man1/databrief.1.gz
    echo OK
  ' > "$T/i.log" 2>&1
}
for image in ubuntu:26.04 ubuntu:24.04 debian:stable; do
  check "$image: install (Node comes as a Recommends), run, Do-not-share-data prompt, manual, clean removal" 'install_test "$image"' 'tail -15 "$T/i.log"'
  grep "^node:" "$T/i.log" | sed "s|^|     $image |"
done

# without Node (--no-install-recommends): the launcher says how to get it, exit code 127
check "ubuntu:26.04 without Node: a clear message and exit code 127" 'docker run --rm -v "$T/deb:/pkg:ro" ubuntu:26.04 sh -c "apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends /pkg/$DEB >/dev/null 2>&1; databrief --version; echo \"exit \$?\"" > "$T/n.log" 2>&1; grep -q "needs Node.js 18 or newer" "$T/n.log" && grep -q "sudo apt install nodejs" "$T/n.log" && grep -q "^exit 127" "$T/n.log"' 'cat "$T/n.log"'

# a Node that is too old (Ubuntu 22.04 has Node 12): the tool says so instead of failing in a strange way
check "ubuntu:22.04 (Node 12 from the system): the tool says it needs Node.js 18 or newer" 'docker run --rm -v "$T/deb:/pkg:ro" ubuntu:22.04 sh -c "apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /pkg/$DEB >/dev/null 2>&1; node --version; databrief --version; echo \"exit \$?\"" > "$T/o.log" 2>&1; grep -q "databrief needs Node.js 18 or newer (this is 12\." "$T/o.log" && grep -q "^exit 2" "$T/o.log"' 'cat "$T/o.log"'

# Debian's package checker
check "lintian finds no error in the .deb" 'docker run --rm -v "$T/deb:/pkg:ro" debian:stable sh -c "apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq lintian >/dev/null 2>&1 && lintian --no-tag-display-limit /pkg/$DEB; true" > "$T/l.log" 2>&1; ! grep -q "^E:" "$T/l.log"' 'grep "^E:" "$T/l.log"'
echo "     lintian: $(grep -c '^W:' "$T/l.log") warning(s), $(grep -c '^I:' "$T/l.log") note(s)"; grep '^W:' "$T/l.log" | sed 's|^|     |' | head -10

# the npm tarball with the Node versions the tool supports: official builds, kept in the test environment folder
for M in 18 22 24; do
  N="$E/node$M/bin"
  [ -x "$N/node" ] || N="$HOME/databrief-spike/node$M/bin"
  if [ ! -x "$N/node" ]; then echo "SKIP npm tarball with Node $M (no Node $M in $E or ~/databrief-spike)"; continue; fi
  check "npm tarball with Node $M ($("$N/node" --version)): install -g, run, Do-not-share-data prompt" 'rm -rf "$T/np$M" && mkdir -p "$T/np$M" && "$N/node" tools/build-npm.cjs "$T/np$M/pkg" > /dev/null && (cd "$T/np$M" && PATH="$N:$PATH" npm pack ./pkg --silent >/dev/null 2>&1 && PATH="$N:$PATH" npm install -g --prefix "$T/np$M/prefix" --no-audit --no-fund ./databrief-*.tgz >/dev/null 2>&1) && printf "'"$CSV"'" > "$T/np$M/p.csv" && PATH="$N:$PATH" "$T/np$M/prefix/bin/databrief" "$T/np$M/p.csv" --print --no-copy --quiet --no-share | grep -q "data not shared"' 'cat "$T/np$M.log"'
done

# the Homebrew formula: Ruby syntax (the tap's own workflow runs brew audit, install and test on macOS and Linux)
check "Homebrew formula: Ruby syntax" '"$NODE" tools/update-packages.cjs --version "$V" --cli-sha $(printf a%.0s $(seq 64)) --man-sha $(printf b%.0s $(seq 64)) --tap "$T/tap" >/dev/null && docker run --rm -v "$T/tap:/t:ro" ruby:3-alpine ruby -c /t/Formula/databrief.rb > "$T/r.log" 2>&1' 'cat "$T/r.log"'

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
