# BlueNoise Privacy Policy

Last updated: 2026-08-20

BlueNoise is an open-source browser extension that visually filters noisy replies on X (Twitter). This policy explains the limited data the extension handles.

## Data collection

BlueNoise does not collect, sell, share, transmit, or use personal data for advertising, analytics, profiling, or tracking. It does not use telemetry or remote code.

## Local extension data

Your settings, custom keywords, whitelist, selected display mode, and optional debug preference are stored only in your browser through `chrome.storage.local`. They are not sent to the developer or any third party.

## X account and page access

BlueNoise runs only on X pages to inspect reply text already rendered in your browser and apply reversible visual styling. It does not read cookies, access your X account credentials, call X APIs, block or mute accounts, post content, or change account settings.

## Network requests

BlueNoise contacts `raw.githubusercontent.com` only to download public keyword lists from the sources shown in its settings page. This happens when a list is first obtained or when you explicitly choose to sync it. These requests do not include your X account data, custom keywords, whitelist, or browsing history.

## Data retention and control

You can edit or remove locally stored rules at any time in the extension's settings. Removing the extension removes its local extension storage according to your browser's normal extension-data behavior.

## Changes to this policy

If BlueNoise adds data collection, telemetry, or a new network capability, this policy and the extension permissions will be updated before that capability is released.

## Contact and source code

The source code and issue tracker are available at https://github.com/rokcso/bluenoise.
