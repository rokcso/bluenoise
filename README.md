# BlueNoise

> Make X readable again.

BlueNoise is an open-source browser extension that blurs or hides noisy replies on X (formerly Twitter) post-detail pages and posts on the home timeline with local, reversible keyword rules. It improves reading without calling X APIs, reading cookies, or changing your
account state.

Created by rokcso · Source and feedback: <https://github.com/rokcso/bluenoise>

## Installation

> BlueNoise is a [Chrome Web Store](https://chromewebstore.google.com) listing in progress. Until it is approved, install the extension manually from the [latest release](https://github.com/rokcso/bluenoise/releases/latest).

1. Download `bluenoise-<version>-chrome.zip` from the [releases page](https://github.com/rokcso/bluenoise/releases).
2. Unzip it to a folder you won't delete (the browser needs the source files to stay put).
3. Open `chrome://extensions` (or your Chromium browser's extension page), enable **Developer mode**, click **Load unpacked**, and select the unzipped folder.

## Features

- Filters replies on X post-detail pages and posts on the home timeline; on a
  post page it never filters the post you opened.
- Blur or hide matched content, and restore it instantly by disabling the extension.
- Supports built-in, community, and personal keyword lists.
- Bans specific accounts by numeric ID or @handle with built-in community
  account lists plus your own local blacklist and whitelist.
- Supports plain keywords and JavaScript regular expressions, such as `/error/i`.
- Detects common evasion using spaces and zero-width characters.
- Includes a whitelist for correcting false positives.
- Processes newly loaded replies and posts automatically, with no page refresh required.
- Stores settings, rules, and the whitelist only in local browser storage.

## Privacy and permissions

BlueNoise collects no telemetry or analytics. It does not read cookies, access account credentials, call X APIs, or take account actions such as blocking, muting, following, or posting.

The extension uses these permissions:

- `storage`: saves settings, rules, and the whitelist locally in your browser.
- `https://raw.githubusercontent.com/*`: downloads public keyword lists when first needed or when you manually sync them.
- `https://x.zuoluo.tv/*`: downloads the public community account blacklist/whitelist when you enable external account lists.

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

Published builds are attached to [GitHub Releases](https://github.com/rokcso/bluenoise/releases).

## License

This project is licensed under the [MIT License](./LICENSE).

Copyright (c) 2026 rokcso
