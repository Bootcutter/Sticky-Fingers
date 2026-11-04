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
- The supplied LifeCraft font is loaded locally from `assets/LifeCraft_Font.ttf`. Font Meme lists LifeCraft as donationware and notes commercial use might require a donation; contact designer Eliot Truelove if needed: [Font Meme listing](https://fontmeme.com/fonts/lifecraft-font/).
- Google Fonts are optional; local system font fallbacks are included.
