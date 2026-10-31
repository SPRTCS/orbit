---
name: orbit
description: Drive the user's running Orbit browser from the terminal with `orbit exec` (Python and pydoll over the Chrome DevTools Protocol). Use when a task needs a real browser with the user's logins, to read the page the user is looking at, open pages, click, type, take screenshots or run JavaScript; to write, test and install userscripts that change how sites look or behave; or to set up and run a daily report built from the sites the user pins and visits.
---

# Driving Orbit with `orbit exec`

`orbit exec` runs Python against the Orbit the user has open, with top-level `await`. The value of the last
expression is printed: strings as they are, anything else as its repr, or JSON with `--json`. Every run is a new
process, so carry state between runs in a URL or a file, not a variable.

```sh
orbit exec 'await tab.title()'
orbit exec --json '[await t.current_url() for t in tabs]'
orbit exec -f script.py
```

In scope:

- `tab`: the web page the user is looking at when the run starts, even with Orbit's window covered. When they're on
  New Tab or another Orbit view, any use of `tab` raises `NoPageTab` (and `bool(tab)` is False): open a page with
  `new_tab` instead.
- `tabs`: every web page tab when the run starts, the user's own included, plus the ones `new_tab` opens.
- `new_tab(url, background=True)`: opens a tab in the sidebar, waits for the page to load and returns it.
  `background=False` switches the user to it.
- `js(expression, tab=None)`: evaluates JavaScript and returns its value. Pass `tab=t` for your own tab; without
  it, `js` uses the user's tab, else the last tab you opened, else raises `NoPageTab`.
- `browser` (pydoll `Chrome`), `By`, `Key`, `asyncio` and the rest of `pydoll`'s exports.

Exit status: 0 done, 1 your code raised or timed out (`--timeout`, default 300 s), 2 Orbit can't be reached or
stopped the connection.
On exit 2, tell the user to open Orbit and turn on Settings › "Let the orbit command control Orbit".

## Etiquette

This is the user's own browser, signed in to their accounts.

- Do your work in a tab you open with `new_tab`. Read the user's `tab`, but don't navigate it unless they ask.
- Close only the tabs you opened (`await t.close()`), and only when you're done with them.
- Delete the scratch scripts you wrote; keep the files the user asked for (screenshots, exports).
- Ask before anything with consequences: submitting forms, sending messages, posting, buying, deleting,
  changing settings or accepting dialogs.
- Don't read or export cookies, passwords or storage unless the user asks for exactly that.

## Recipes

Read the page the user is on (raises `NoPageTab` on New Tab):

```sh
orbit exec 'await tab.current_url(), await tab.title()'
orbit exec 'await js("document.body.innerText.slice(0, 5000)")'
```

Open a page and work there. Every run starts over, so find your tab again by URL:

```sh
orbit exec 't = await new_tab("https://example.com"); await js("document.links[0].href", tab=t)'
orbit exec 't = [t for t in tabs if "example.com" in await t.current_url()][0]; await t.page_source()'
```

Longer work goes in a file. Close your tab, then put the data on the last line so it's printed:

```python
t = await new_tab("https://news.ycombinator.com")
rows = await js("[...document.querySelectorAll('.titleline > a')].slice(0, 3).map(a => [a.innerText, a.href])", tab=t)
await t.take_screenshot("/tmp/hn.png")
await t.close()
rows
```

```sh
orbit exec --json -f /tmp/hn.py && rm /tmp/hn.py
```

Find, click and type:

```python
t = await new_tab("https://example.com/search")
box = await t.query('input[name="q"]', timeout=10)
await box.type_text("orbit browser\r")
await t.wait_for_url("**?q=*", timeout=15)
results = await t.query("h3", find_all=True)
[await r.text() for r in results[:5]]
```

`query` takes CSS or XPath; `find(tag_name=..., id=..., class_name=..., name=..., text=..., **attributes)` builds
the selector for you. Both wait up to `timeout` seconds for the element. When it isn't there they raise
`ElementNotFound` (with `timeout=0`, the default) or `WaitElementTimeout` (with a timeout), or return `None` with
`raise_exc=False`. For a click that loads a new page:

```python
async with t.expect_navigation():
    await (await t.find(tag_name="a", text="Next")).click()
```

Wait for things:

```python
await (await t.query("#results", timeout=10)).wait_until(is_visible=True, timeout=10)
await t.wait_for_script("document.readyState === 'complete'", timeout=10)
await t.wait_for_network_idle(timeout=15)
```

Screenshots and PDFs go to a file:

```sh
orbit exec 'await tab.take_screenshot("/tmp/page.png"); "/tmp/page.png"'
orbit exec 'await tab.take_screenshot("/tmp/full.png", beyond_viewport=True)'
orbit exec 'el = await tab.query("main"); await el.take_screenshot("/tmp/main.png")'
orbit exec 'await tab.print_to_pdf("/tmp/page.pdf")'
```

Run JavaScript: `js()` returns plain values (awaiting promises) and raises on a JavaScript error.

```sh
orbit exec --json 'await js("[...document.links].slice(0, 20).map(a => ({text: a.innerText, href: a.href}))")'
```

The full pydoll 3.0 API is in `references/pydoll.md`.

## Userscripts

When the user wants a site to look or behave differently every time they visit it, write a userscript instead of
driving the page by hand. `orbit scripts` takes TypeScript or JavaScript with a Violentmonkey `==UserScript==` header,
so existing `.user.js` files work too. `orbit scripts --help` and each command's `--help` explain the details.

- Start from `orbit scripts new`, or from a script the user already has.
- Read the real page before writing selectors, and keep the script small and robust to the site changing.
- Iterate with `orbit scripts test` until it passes cleanly on the pages it targets. It runs in a tab of its own and
  reports what ran, what logged and what threw.
- Install only once the user is happy with it. `orbit scripts list` and `uninstall` manage what's installed.

## Daily reports

Once you know Orbit works, ask the user whether they'd like a daily report. If they say no, drop it. If they say
yes, ask what they care about most and when they want it, then set it up so it runs on its own each day (your
harness's scheduler if it has one, otherwise the system's). Save what you agreed on where the scheduled run can read
it.

Each report starts from what the user actually uses. `await pinned()` returns their pinned tabs and favorites, and
`await history()` returns what they visited recently. Visit the sites that matter in tabs of your own, using their
logins, and only read: never reply, mark as read, accept or send anything. By default the report covers what's
pending for them and what changed on things they finished or are waiting on since the last report. Shape it around
their priorities, keep it short, and deliver it the way they asked. Keep enough state between runs to tell new from
old.

## Gotchas

- Tab and element methods are coroutines: `await tab.title()`, `await tab.current_url()`, `await el.text()`.
  `el.get_attribute("href")` is a plain call and `el.tag_name` a plain property, both read when the element was found.
- `orbit exec` refuses `browser.stop()` and `Browser.close`. It never quits Orbit.
- It reaches web pages only (http, https, `about:blank`, `data:`, `blob:`), not `file://`, `chrome://`, extension
  pages or Orbit's own views. Orbit also refuses DevTools calls that read cookies, storage or saved data, change
  browser settings or permissions, intercept requests or touch local files; those fail with
  `orbit: <Method> isn't allowed for the orbit command`. Network events come without cookie and authorization headers.
- Background tabs are hidden, so pages there may throttle timers and animations. Screenshots still work.
- An `await` inside a generator expression makes it async, so `next(... await ...)` fails. Use a list comprehension.
- Type with `type_text` (real key events) when a page listens for keys; `insert_text` is faster for plain fields.
- To press Enter in a field, end the typed text with `"\r"`. `keyboard.press(Key.ENTER)` sends no character, so it
  doesn't submit forms; use it for key handlers only.
