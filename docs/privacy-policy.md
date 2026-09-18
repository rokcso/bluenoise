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
- `api.typesafe.ai`: the Jev API from TypeSafe AI, only when you turn on the experimental **Jev second pass** in settings and enter your own TypeSafe API key. In that mode the text of replies that no rule matched, and the text of the post they reply to when you are on a post page, are sent to TypeSafe to be classified. No page content is sent while the feature is off.

Your TypeSafe API key is stored only in this browser's local extension storage. It is never synced to your browser account and never included in a rules export.

Downloads happen when a list is first obtained, on a low-frequency scheduled refresh (every 12 hours for keyword lists, every 6 hours for account lists), or when you explicitly choose to sync. These requests do not include your X account data, custom keywords, whitelist, or browsing history.

## Data retention and control

You can edit or remove locally stored rules at any time in the extension's settings. Removing the extension removes its local extension storage according to your browser's normal extension-data behavior.

## Changes to this policy

If BlueNoise adds data collection, telemetry, or a new network capability, this policy and the extension permissions will be updated before that capability is released.

## Contact and source code

The source code and issue tracker are available at https://github.com/rokcso/bluenoise.
