# BlueNoise

**English** · [简体中文](./README.zh-CN.md)

> Make X readable again.

BlueNoise is an open-source browser extension that blurs or hides noisy replies on X (formerly Twitter) post-detail pages and posts on the home timeline with local, reversible keyword rules. It improves reading without calling X APIs, reading cookies, or changing your
account state.

Created by rokcso · Source and feedback: <https://github.com/rokcso/bluenoise>

## Installation

<a href="https://chromewebstore.google.com/detail/ponbeiihcconklnlphjcnbfkghnimpid"><img src="https://storage.googleapis.com/web-dev-uploads/image/WlD8wC6g8khjGJcVzh1J3I8B5oE1/aU1sJbxmQ1yCXS5MYRDu.svg" alt="Available in the Chrome Web Store" width="220"></a>

Install BlueNoise from the [Chrome Web Store](https://chromewebstore.google.com/detail/ponbeiihcconklnlphjcnbfkghnimpid).

Prefer to install manually? Download `bluenoise-<version>-chrome.zip` from the [releases page](https://github.com/rokcso/bluenoise/releases):

1. Unzip it to a folder you won't delete (the browser needs the source files to stay put).
2. Open `chrome://extensions` (or your Chromium browser's extension page), enable **Developer mode**, click **Load unpacked**, and select the unzipped folder.

## Features

- Blur or hide noisy replies on post-detail pages and posts on the home timeline
  (it never filters the post you opened). Turning the extension off restores everything instantly.
- Match by keyword and by account: plain keywords, `/regex/` patterns, and account IDs or @handles.
- Ships with built-in community keyword lists (X Spam Filter, X Comment Blocker) and community
  account lists (Make X Great Again) that stay up to date automatically, plus your own personal
  keyword lists and a local account blacklist/whitelist.
- Right-click any selected text to add it as a keyword or an account ban.
- A toolbar badge shows how many posts were filtered; hovering a blurred reply reveals it around your cursor.
- Handles evasive forms (spaces and zero-width characters) and includes a whitelist to correct false positives.
- New replies and posts are filtered automatically as they load, with no page refresh.

## Privacy and permissions

BlueNoise collects no telemetry or analytics. It does not read cookies, access account credentials, call X APIs, or take account actions such as blocking, muting, following, or posting.

The extension requests these permissions:

- `storage` and `unlimitedStorage`: save your settings, rules, and whitelist, and cache keyword lists locally.
- `alarms`: periodically refresh subscribed keyword and account lists in the background.
- `contextMenus`: add **Add keyword** / **Add account** to the right-click menu for selected text.
- `https://raw.githubusercontent.com/*`: download public keyword lists.
- `https://x.zuoluo.tv/*`: download the public community account blacklist/whitelist.

Read the full [Privacy Policy](./docs/privacy-policy.md).

## Development

See [DESIGN.md](./docs/DESIGN.md) for the architecture and design notes.

### Requirements

- Node.js 22 or later
- pnpm 10

### Run locally

```bash
pnpm install
pnpm dev
```

When the development build is ready, open the Chrome/Chromium extensions page, enable Developer mode, choose **Load unpacked**, and select WXT's generated development output directory.

### Common commands

```bash
pnpm typecheck  # Run TypeScript type checking
pnpm test       # Run unit tests
pnpm check      # Run Biome checks
pnpm build      # Create a production build
pnpm zip        # Package the extension as a zip archive
```

## Contributing

Contributions are welcome. Please use [Issues](https://github.com/rokcso/bluenoise/issues) to report bugs or discuss features, or open a pull request. Before submitting, please run:

```bash
pnpm typecheck && pnpm test && pnpm check
```

## Acknowledgements

BlueNoise is inspired by and pays tribute to these projects:

- [x-spam-filter](https://github.com/ZPVIP/x-spam-filter)
- [x-comment-blocker](https://github.com/amahteru/x-comment-blocker)
- [make-x-great-again](https://github.com/foru17/make-x-great-again)

## Releases

The latest version is published on the [Chrome Web Store](https://chromewebstore.google.com/detail/ponbeiihcconklnlphjcnbfkghnimpid); source builds are attached to [GitHub Releases](https://github.com/rokcso/bluenoise/releases).

## License

This project is licensed under the [MIT License](./LICENSE).

Copyright (c) 2026 rokcso
