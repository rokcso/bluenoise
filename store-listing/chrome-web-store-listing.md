# Chrome Web Store Listing

## Name

BlueNoise - Make X readable again

## Short description

Filter noisy replies, timeline posts, and ads locally, with reversible rules and optional X interface cleanup.

## Detailed description

BlueNoise makes X reply threads and your home timeline easier to read. It filters matching content locally and never takes actions on your account.

What it does

- Filters replies and home-timeline posts by keyword or account, while leaving the post you opened untouched.
- Displays matches blurred, collapsed, or hidden; turning filtering off restores the page.
- Supports plain keywords, safe `/regex/flags` rules, account IDs, @handles, personal allowlists, and optional community lists.
- Optionally filters promoted posts, media or card ads, and accounts labeled by X as parody, fan, commentary, or automated.
- Imports and exports personal rules and adds allow or block rules from the right-click menu.
- Independently hides selected X recommendations, promotions, counters, and navigation elements.

What it does not do

- It does not read cookies or call X APIs.
- It does not block, mute, follow, unfollow, post, or otherwise alter your X account - banned accounts are only blurred or hidden locally, never actioned on X.
- It does not collect analytics or send your rules to a server.

### Permissions

The extension requests the minimum permissions needed for its single purpose:

- `storage`: syncs behavioral settings through Chrome Sync and stores personal rules and cached public lists locally.
- `unlimitedStorage`: lets the locally cached community filter lists (a few MB of keyword and account lists) exceed the default 10 MB `storage.local` quota.
- `alarms`: schedules low-frequency background refreshes of the public filter lists (every 12 h for keywords, every 6 h for account lists).
- `contextMenus`: adds allow/block keyword and account actions for selected text, only on X pages.
- `raw.githubusercontent.com`: downloads the public keyword lists available in the extension.
- `x.zuoluo.tv`: downloads the public community account blacklist/whitelist (Make X Great Again) only when you enable external account lists.

### Privacy

Privacy policy: https://github.com/rokcso/bluenoise/blob/main/docs/privacy-policy.md

Source code and support: https://github.com/rokcso/bluenoise

---

## Permission review (Chrome Web Store submission form)

Copy-paste answers for the Chrome Web Store permission-review questions.

### Single purpose description

BlueNoise's single purpose is to make X (formerly Twitter) easier to read by locally filtering replies and home-timeline posts using keyword and account rules the user controls. Matches can be blurred, collapsed, or hidden. Every filter action is visual and reversible: turning filtering off restores the content, and BlueNoise never reads cookies, calls X APIs, or changes the user's X account.

### storage justification

The `storage` permission is used with both Chrome storage areas:

- `chrome.storage.sync` stores behavioral settings such as the on/off switches, display mode, language, theme, and enabled rule sources, allowing them to follow the user's Chrome profile.
- `chrome.storage.local` stores personal keyword/account rules, downloaded public-list snapshots, and optional diagnostic logs so large or private rule data is not placed in sync storage.

No cookies, X credentials, browsing history, or data from other sites are read or stored. Personal rules are not sent to BlueNoise or any third-party application server.

### unlimitedStorage justification

BlueNoise caches public community filter lists in `chrome.storage.local` so the filters work offline and instantly:

- Downloaded keyword lists, up to 2 MB each (enforced in code before import).
- The community account blacklist (the "lite" artifact, schema v2) is roughly 9 MB raw / ~4 MB over the wire, with a 25 MB validation cap in code, plus a whitelist capped at 2 MB.

Chrome's default `storage.local` quota can be exceeded by these cached lists. `unlimitedStorage` allows them to remain available locally without repeated downloads. Download sizes are still bounded and validated in code (2 MB for keyword lists and 25 MB for account artifacts), and only compact list data is stored.

### alarms justification

The `alarms` permission is used only to refresh the public filter lists on a low-frequency schedule from the extension's background service worker:

- `keyword-sync`: every 12 hours (720 minutes), refreshes subscribed keyword lists so users get updates without opening the extension.
- `account-list-sync`: every 6 hours (360 minutes), refreshes the community account blacklist/whitelist when the user has enabled external account lists.
- Both are also scheduled 1-2 minutes after install or browser startup, so a fresh copy is fetched without keeping the service worker alive.

Alarms fire only for these scheduled list updates. There is no continuous background processing, no tracking, no analytics, and no wake-ups for anything else.

### contextMenus justification

BlueNoise registers four right-click menu items that appear only when the user selects text on X pages (`documentUrlPatterns` restricted to `https://x.com/*` and `https://twitter.com/*`):

- Add the selection to the keyword allowlist or blocklist.
- Add a selected numeric X user ID or @handle to the account allowlist or blocklist.

These items exist purely for convenience: users can add a filter rule from the page they are reading instead of switching to the options page. The menus never appear on other sites, never read other tabs or page content, and only write the user's own selection into local `storage.local`.

### Host permission justification

The extension requests two narrow host permissions. `https://raw.githubusercontent.com/*` downloads the public keyword lists shown in settings (BlueNoise, x-spam-filter, and x-comment-blocker). `https://x.zuoluo.tv/*` downloads the public Make X Great Again account blacklist/whitelist when that external list is enabled. Downloads occur during initial setup, manual sync, or scheduled refresh. These permissions are never used to execute scripts or read other content from those hosts; BlueNoise does not inject into or observe any page outside X. Files are validated before use, and requests include no cookies or credentials.

### Are you using remote code?

No. All code is bundled and versioned inside the extension package (built with WXT/Vite from this repository). BlueNoise does not load or execute any remote script, code from a CDN, or dynamic code - no `eval`, no `new Function`, no remote configuration that executes code. The only remote resource ever downloaded is plain-text/JSON data (public keyword and account lists), which is validated and parsed strictly as data, never executed.

Source: https://github.com/rokcso/bluenoise
