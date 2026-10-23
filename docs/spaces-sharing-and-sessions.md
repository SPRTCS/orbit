# Sharing spaces, sessions and the timeline

Orbit can hand a space to someone else without an account, keep named snapshots of a space, and take you back to
how your sidebar looked an hour, a day or a month ago.

## What a shared space contains

A `.orbitspace` file is a small, readable JSON file with:

- the space's name, icon, colour and theme;
- its Top Apps;
- its pinned tabs, pinned groups and pinned folders (nested, in sidebar order), with custom titles and icons;
- optionally its today tabs.

Only web links travel. Cookies, logins, passwords, history, form data and what a tab had loaded never do, and links
to files on your Mac are left out.

## Share a space

- Right-click a space's icon at the bottom of the sidebar › **Share Space** › **Export as File…**, **Export with
  Today Tabs…** or **Copy as Text**.
- Or **Spaces › Share Space…**, or the command bar: "Share Space as File…", "Copy Space as Text".

**Copy as Text** puts a readable list of the space on the clipboard, followed by the space itself, so you can paste
it in any chat. The person receiving it copies the whole message and chooses **Spaces › Import Space from
Clipboard**.

## Share one folder

Right-click a pinned folder › **Share Folder…** exports just that folder with everything inside it.

## Open a shared space or folder

Any of these shows a preview with the space's name, icon, how many pins, groups, folders and today tabs it has, and
every site in it:

- double-click a `.orbitspace` file in Finder;
- drag it onto an Orbit window;
- **File › Import Space…**, **Spaces › Import Space…** or **File › Open File…**;
- **Spaces › Import Space from Clipboard** for a copied message.

Then choose how to import it:

- **As a new space**, with its own logins and data or sharing them with one of your spaces;
- **Add to** the current space: missing pins and folders are added, pins you already have aren't duplicated, and a
  group with the same name gets the missing tabs;
- **Replace the pins of** the current space (asks first). Pinned tabs you have open stay open as today tabs.

Tick **Open the today tabs too** to bring the file's today tabs along. Imported tabs don't load until you open them.

## Subscribe to a shared space (read-only)

Put a `.orbitspace` file in a folder you share, for example a shared iCloud Drive folder. Whoever subscribes uses
**Spaces › Subscribe to Shared Space…** (or ticks **Keep in sync with this file** when importing it as a new space).
Orbit checks the file every minute and updates that space's pins, folders, icon and theme when it changes. The owner
publishes by exporting the space again over the same file.

The subscriber's own changes to those pins are replaced at the next update. Right-click the space's icon to **Check
for Updates Now** or **Unsubscribe**.

## Sessions

A session is a named snapshot of a space: Top Apps, pinned tabs and folders, and today tabs.

- **Save Session…**: right-click a space's icon, **Spaces › Save Session…**, or the command bar.
- **Sessions & Timeline…** opens the Sessions window. Pick a space at the top; **Saved** lists its sessions with a
  preview. **Restore…** offers:
  - **As a New Space…** (asks whether it shares data with an existing space);
  - **Replace Today Tabs** in the session's space (the replaced tabs go to Recently Closed and the Archive);
  - **Open Tabs** in the current space;
  - **Restore Pins and Folders**.
- Right-click a session to **Rename…**, **Delete** or **Export…** it as a `.orbitspace` file.

Sessions of a space you deleted stay under **Deleted Spaces**, where you can restore them as a new space.

## Timeline

Orbit snapshots each space's sidebar by itself, at most once an hour and only when something changed. It keeps the
last 48 hourly snapshots and one per day for 30 days. In the Sessions window, **Timeline** shows them on a slider
and in a list; select one to preview the sidebar as it was, then:

- **Restore Pins and Folders as of Then…** (the current pins are snapshotted first, so you can go back);
- **Reopen Today Tabs from Then** adds that moment's today tabs to the space.

**Snapshot Now** records the current state immediately.

Sessions and the timeline stay on this Mac, in Orbit's data folder; they aren't synced.
