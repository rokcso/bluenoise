# BlueNoise

**English** · [简体中文](./README.zh-CN.md)

> Make X readable again.

BlueNoise is an open-source, privacy-first browser extension that filters noisy content and cleans up the interface of X (formerly Twitter). All matching happens locally with reversible keyword and account rules.

Created by rokcso · Source and feedback: <https://github.com/rokcso/bluenoise>

## Installation

<a href="https://chromewebstore.google.com/detail/ponbeiihcconklnlphjcnbfkghnimpid"><img src="./docs/assets/chrome-web-store-badge.png" alt="Available in the Chrome Web Store" width="220"></a>

Install BlueNoise from the store, or download `bluenoise-<version>-chrome.zip` from [GitHub Releases](https://github.com/rokcso/bluenoise/releases) for manual installation:

1. Unzip it to a folder you won't delete (the browser needs the source files to stay put).
2. Open `chrome://extensions` (or your Chromium browser's extension page), enable **Developer mode**, click **Load unpacked**, and select the unzipped folder.

## Features

- Filter replies and home-timeline posts by keyword or account, while leaving the post you opened untouched.
- Display matches blurred, collapsed, or hidden; disable filtering at any time to restore the page.
- Use plain keywords, safe `/regex/` patterns, account IDs, @handles, personal allowlists, and optional community lists.
- Optionally filter promoted posts, media or card ads, and accounts labeled by X as parody, fan, commentary, or automated.
- Import and export personal rules, or add allow/block rules from the right-click menu.
- Independently clean up X's interface by hiding selected recommendations, promotions, counters, and navigation elements.

## Privacy and permissions

BlueNoise collects no telemetry or analytics. It does not read cookies, access account credentials, call X APIs, or take account actions such as blocking, muting, following, or posting. Settings and rules are stored through the browser; network access is used only to update enabled public rule lists.

Read the full [Privacy Policy](./docs/privacy-policy.md).

## Development

Requires Node.js 22 or later and pnpm 10.

```bash
pnpm install
pnpm dev
```

Then load WXT's generated development directory as an unpacked extension. Other commands:

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

## License

This project is licensed under the [MIT License](./LICENSE).

Copyright (c) 2026 rokcso
