# BlueNoise Privacy Policy

Last updated: 2026-08-20

BlueNoise is an open-source browser extension that visually filters noisy replies on X (Twitter). This policy explains the limited data the extension handles.

## Data collection

BlueNoise does not collect, sell, share, transmit, or use personal data for advertising, analytics, profiling, or tracking. It does not use telemetry or remote code.

The one exception is the optional, off-by-default Jev second pass described under "Network requests". It sends data only after you turn it on and provide your own API key.

## Local extension data

Your settings, custom keywords, whitelist, selected display mode, and optional debug preference are stored only in your browser through `chrome.storage.local`. They are not sent to the developer or any third party.

## X account and page access

BlueNoise runs only on X pages to inspect reply text already rendered in your browser and apply reversible visual styling. It does not read cookies, access your X account credentials, call X APIs, block or mute accounts, post content, or change account settings.

## Network requests

BlueNoise makes limited outbound requests only to download public filter lists:

- `raw.githubusercontent.com`: public keyword lists from the community projects shown in its settings page.
- `x.zuoluo.tv`: the public community account blacklist/whitelist from the Make X Great Again project, only when you enable external account lists in settings.
- **An AI endpoint you configure yourself**, only when you turn on one of the experimental AI passes in settings and add a model provider with your own API key. The two passes are independent switches:
  - the **Jev second pass** sends replies that no rule matched, plus the post they reply to, to the endpoint you entered (by default `api.typesafe.ai`);
  - the **LLM second pass** sends the same content to the chat-completion endpoint you entered, together with the filtering preference you wrote as the criterion.

  No page content is sent while both features are off. The endpoint is whatever you typed on the AI models page: BlueNoise ships with the TypeSafe default and does not otherwise choose a third party for you.

Your API keys are stored only in this browser's local extension storage. They are never synced to your browser account and never included in a rules export.

The reply-farm detector is not a network feature: it compares post times already present in the page and keeps a bounded per-account history in local storage for up to 24 hours. Nothing is uploaded, and no model is called.

Downloads happen when a list is first obtained, on a low-frequency scheduled refresh (every 12 hours for keyword lists, every 6 hours for account lists), or when you explicitly choose to sync. These requests do not include your X account data, custom keywords, whitelist, or browsing history.

## Data retention and control

You can edit or remove locally stored rules at any time in the extension's settings. Removing the extension removes its local extension storage according to your browser's normal extension-data behavior.

## Changes to this policy

If BlueNoise adds data collection, telemetry, or a new network capability, this policy and the extension permissions will be updated before that capability is released.

## Contact and source code

The source code and issue tracker are available at https://github.com/rokcso/bluenoise.
