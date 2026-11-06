# Sticky Fingers

A visual-first, single-page Horde guild site built with plain HTML, CSS, and JavaScript for GitHub Pages. Its art direction borrows the uploaded undead artwork's scarlet-on-black palette, hard-edged silhouettes, and distressed brush texture across the cover, dispatches, and character gallery.

## Run locally

Serve this folder with a static file server (for example, VS Code Live Server) so the browser can fetch `events.json` and `roster.json`.

## Publish with GitHub Pages

Push the files to a GitHub repository, then in **Settings → Pages**, choose **Deploy from a branch** and select the branch's `/ (root)` folder.

## Add your guild's art

- `orc2.jpg` is used as the intro and cover background. Replace it with a similarly wide JPG if you add your own guild artwork. Add your intro video as `assets/intro.mp4`; it plays over the artwork and fades away automatically. The image remains visible if video playback is unavailable.
- Edit `roster.json` to add or change characters. Each entry needs a unique `name`, `class` (e.g. `Paladin`), optional `race` (e.g. `Undead`), short `description`, and image filename in `assets/`; the gallery order follows the JSON array. An optional `video` filename plays on hover/focus and in the character panel, with the portrait used if it cannot play. Clicking a character opens the sliding details panel. Replace portrait images or videos in `assets/` as needed.
- Edit `events.json` to add or change dispatches. Each event needs a unique `id`, `title`, short `description`, longer `details`, `category`, ISO date (`YYYY-MM-DD`), and `artwork` (`raid`, `recruit`, or `other`). It also needs an `image` filename in `assets/` (`.jpg`, `.png` or `.webp`; no videos), shown on the card and in the details panel. Optional fields are `time` and `location`. Selecting a dispatch opens its details in a sliding modal.
- **Overheard in Azeroth** (section 03) renders `news.json`, which the **Refresh news** GitHub Action (`.github/workflows/news.yml`) rebuilds hourly with `scripts/fetch-news.mjs`. It pulls the [Wowhead Forever RSS feed](https://www.wowhead.com/news/rss/forever) and, when configured, the Blizzard API (guild profile and guild activity). The browser can't call either source directly: Wowhead sends no CORS headers and Blizzard needs a client secret.
  - In **Settings → Secrets and variables → Actions**, add the secrets `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET` (from [develop.battle.net](https://develop.battle.net/access/clients)).
  - Under the **Variables** tab, add `GUILD_REALM` (realm slug, e.g. `firemaw`) and `GUILD_SLUG` (e.g. `sticky-fingers`). Optional: `BLIZZARD_REGION` (default `eu`) and `BLIZZARD_NAMESPACE` (default `forever`, i.e. `dynamic-forever-eu` / `profile-forever-eu`). With only `GUILD_REALM` set, the panel shows the realm; realm status and population appear once Blizzard serves them, and guild data once the guild exists.
  - Run it manually from **Actions → Refresh news → Run workflow**, or locally with `node scripts/fetch-news.mjs` (Node 20+, same environment variables). Without Blizzard credentials, only Wowhead news is included.
- The supplied LifeCraft font is loaded locally from `assets/LifeCraft_Font.ttf`. Font Meme lists LifeCraft as donationware and notes commercial use might require a donation; contact designer Eliot Truelove if needed: [Font Meme listing](https://fontmeme.com/fonts/lifecraft-font/).
- Google Fonts are optional; local system font fallbacks are included.

## Guild dossier page

`guild.html` shows the live guild: roster cards, professions ("who can craft it"), level/class/role/race stats, records and guild activity.

- Data comes from `guild.json`, built by `scripts/fetch-guild.mjs` in the same hourly **Refresh news** workflow. WoW Forever has no realms, so the guild is looked up by slug alone (`GUILD_SLUG`, default `sticky-fingers-rare-proc`) in the `profile-forever-eu` namespace.
- Characters below level 10 (or that haven't logged out yet) have no public profile; they're listed from the roster with a placeholder and fill in automatically later.
- Portraits: a character whose name matches an entry in `roster.json` uses that art; everyone else gets a generated placeholder based on race, gender and class.
- The API doesn't expose the in-game MOTD or rank names, so edit them in `guild-notes.json`.
- Link straight to a character with `guild.html#char-<slug>`, e.g. `guild.html#char-lil-stormy`.
- Locally: put `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET` in a `.env` file (git-ignored) and run `node --env-file=.env scripts/fetch-guild.mjs`.
