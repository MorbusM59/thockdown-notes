# Google Play store listing

What the Play Console store listing is made of, kept with the app so a
release can be checked against what the listing promises.

- `listing.txt` -- title, short and full description, pasted as they are.
  Plain text on purpose: Play shows Markdown literally, so headings are
  capitals and list items start with `•`. Limits: title 30 characters, short
  description 80, full description 4000.
- `feature-graphic.png` -- the 1024×500 feature graphic. Fonts: Dr Sugiyama
  and Jost, both SIL Open Font License, which asks nothing of an image made
  with them.

The listing makes claims the app has to keep true: no internet access (no
INTERNET permission in the manifest), eighteen layers (`ROSTER_COUNTS` in
`src/shared/soundscape.ts`), and the notification and alarm permissions it
names. A change to any of those is a change to `listing.txt` as well.

The privacy policy the listing links to is `../PRIVACY.md`.
