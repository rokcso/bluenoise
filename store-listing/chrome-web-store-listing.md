# Chrome Web Store Listing

## Name

BlueNoise - Make X readable again

## Short description

Blur or hide noisy X replies with local, reversible keyword rules - no APIs,
cookies, or account changes.

## Detailed description

BlueNoise makes X reply threads easier to read without taking actions on your
account. It visually blurs or hides replies that match your keyword rules while
leaving the original page, your X settings, and your account untouched.

### What it does

- Filters replies on X post-detail pages using built-in, community, and personal
  keyword lists.
- Supports plain keywords and custom `/regular-expression/flags` rules.
- Handles common spacing and zero-width-character evasion.
- Lets you blur or hide matched replies, with a whitelist for correcting false
  positives.
- Updates newly loaded replies without reloading the page.

### What it does not do

- It does not read cookies or call X APIs.
- It does not block, mute, follow, unfollow, post, or otherwise alter your X
  account.
- It does not filter the post you opened; it only filters replies.
- It does not collect analytics or send your rules to a server.

### Permissions

- `storage`: saves your settings, rules, and whitelist locally in your browser.
- `raw.githubusercontent.com`: downloads public keyword lists only when first
  needed or when you choose to sync them.

### Privacy

Privacy policy: https://github.com/rokcso/bluenoise/blob/main/docs/privacy-policy.md

Source code and support: https://github.com/rokcso/bluenoise
