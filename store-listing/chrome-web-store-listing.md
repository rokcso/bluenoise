# Chrome Web Store Listing

## Name

BlueNoise - Make X readable again

## Short description

Blur or hide noisy X replies and timeline posts with local, reversible keyword rules - no APIs, cookies, or account changes.

## Detailed description

BlueNoise makes X reply threads and your home timeline easier to read without taking actions on your account. It visually blurs or hides replies and posts that match your keyword rules while leaving the original page, your X settings, and your account untouched.

### What it does

- Filters replies on X post-detail pages and posts on the home timeline using built-in, community, and personal keyword lists.
- Bans specific accounts by numeric ID or @handle with built-in community account lists plus your own local blacklist and whitelist.
- Supports plain keywords and custom `/regular-expression/flags` rules.
- Handles common spacing and zero-width-character evasion.
- Lets you blur or hide matched content, with a whitelist for correcting false positives.
- Updates newly loaded replies and posts without reloading the page.

### What it does not do

- It does not read cookies or call X APIs.
- It does not block, mute, follow, unfollow, post, or otherwise alter your X account - banned accounts are only blurred or hidden locally, never actioned on X.
- On a post-detail page it never filters the post you opened; it only filters its replies. Home-timeline posts are filterable like replies.
- It does not collect analytics or send your rules to a server.

### Permissions

The extension requests the minimum permissions needed for its single purpose:

- `storage`: saves your settings, rules, whitelist, and cached filter lists locally in your browser. Nothing is synced to a server.
- `unlimitedStorage`: lets the locally cached community filter lists (a few MB of keyword and account lists) exceed the default 10 MB `storage.local` quota.
- `alarms`: schedules low-frequency background refreshes of the public filter lists (every 12 h for keywords, every 6 h for account lists).
- `contextMenus`: adds "Add keyword" / "Add account" right-click items for selected text, only on X pages.
- `raw.githubusercontent.com`: downloads public keyword lists only when first needed or when you choose to sync them.
- `x.zuoluo.tv`: downloads the public community account blacklist/whitelist (Make X Great Again) only when you enable external account lists.

### Privacy

Privacy policy: https://github.com/rokcso/bluenoise/blob/main/docs/privacy-policy.md

Source code and support: https://github.com/rokcso/bluenoise

---

## Permission review (Chrome Web Store submission form)

Copy-paste answers for the Chrome Web Store permission-review questions.

### Single purpose description

BlueNoise's single purpose is to make X (formerly Twitter) easier to read by visually blurring or hiding noisy replies on post-detail pages and noisy posts on the home timeline, based on keyword and account rules the user controls. It is a local, client-side content-filtering and readability tool for X. Every filter action is purely visual and reversible: turning the extension off instantly restores all content, and BlueNoise never reads cookies, calls X APIs, or changes the user's X account in any way. One purpose, one feature set: filter noisy X content locally.

### storage justification

The `storage` permission is used exclusively with `chrome.storage.local` to persist, entirely in the user's browser:

- The user's configuration: master on/off switch, dim vs. hide mode, language, theme, keyword rules, whitelist, account blacklist/whitelist, and the list of enabled keyword subscriptions (one `config` key).
- Cached snapshots of downloaded public community filter lists (keywords and account lists), so content scripts can match instantly without re-downloading on every page load.

`chrome.storage.sync` is not used: no settings are sent to Google's servers. No cookies, X account credentials, browsing history, or data from other sites are ever read or stored. Users can edit or delete their locally stored rules at any time; uninstalling the extension removes the data.

### unlimitedStorage justification

BlueNoise caches public community filter lists in `chrome.storage.local` so the filters work offline and instantly:

- Downloaded keyword lists, up to 2 MB each (enforced in code before import).
- The community account blacklist (the "lite" artifact, schema v2) is roughly 9 MB raw / ~4 MB over the wire, with a 25 MB validation cap in code, plus a whitelist capped at 2 MB.

Chrome's default `storage.local` quota (~10 MB total, ~5 MB per item) would be exceeded by these cached lists, breaking sync and leaving users with stale or missing filters. `unlimitedStorage` removes that quota so the lists can be cached locally. Download sizes are still bounded and validated in code (2 MB for keyword lists, 25 MB for account artifacts), and only the compact list artifacts are stored - never expanded per-entry objects.

### alarms justification

The `alarms` permission is used only to refresh the public filter lists on a low-frequency schedule from the extension's background service worker:

- `keyword-sync`: every 12 hours (720 minutes), refreshes subscribed keyword lists so users get updates without opening the extension.
- `account-list-sync`: every 6 hours (360 minutes), refreshes the community account blacklist/whitelist when the user has enabled external account lists.
- Both are also scheduled 1-2 minutes after install or browser startup, so a fresh copy is fetched without keeping the service worker alive.

Alarms fire only for these scheduled list updates. There is no continuous background processing, no tracking, no analytics, and no wake-ups for anything else.

### contextMenus justification

BlueNoise registers two right-click menu items that appear only when the user selects text on X pages (`documentUrlPatterns` restricted to `https://x.com/*` and `https://twitter.com/*`):

- **Add keyword to BlueNoise**: saves the selected text as a personal keyword rule.
- **Add account to BlueNoise**: saves a selected X numeric user ID or @handle to the local account blacklist.

These items exist purely for convenience: users can add a filter rule from the page they are reading instead of switching to the options page. The menus never appear on other sites, never read other tabs or page content, and only write the user's own selection into local `storage.local`.

### Host permission justification

The extension requests two narrow host permissions. `https://raw.githubusercontent.com/*` is used solely to download the public keyword list files of the two community keyword projects shown on the settings page (x-spam-filter and x-comment-blocker). `https://x.zuoluo.tv/*` is used solely to download the public community account blacklist/whitelist (from the Make X Great Again project) when the user enables external account lists in settings. Downloads happen on first install/use, when the user manually clicks "sync", and on the scheduled refresh described above. These permissions are never used to run scripts on those hosts or to read content from them beyond the plain-text/JSON list files; BlueNoise does not inject into or observe any page outside X. Each downloaded file is validated before use (size caps enforced in code, HTML responses rejected, non-empty content required), and no cookies or credentials are attached to the requests.

### Are you using remote code?

No. All code is bundled and versioned inside the extension package (built with WXT/Vite from this repository). BlueNoise does not load or execute any remote script, code from a CDN, or dynamic code - no `eval`, no `new Function`, no remote configuration that executes code. The only remote resource ever downloaded is plain-text/JSON data (public keyword and account lists), which is validated and parsed strictly as data, never executed.

Source: https://github.com/rokcso/bluenoise
