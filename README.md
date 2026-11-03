# Sticky Fingers

A visual-first, single-page Horde guild site built with plain HTML, CSS, and JavaScript for GitHub Pages. Its art direction borrows the uploaded undead artwork's scarlet-on-black palette, hard-edged silhouettes, and distressed brush texture across the cover, dispatches, and character gallery.

## Run locally

Serve this folder with a static file server (for example, VS Code Live Server) so the browser can fetch `events.json`.

## Publish with GitHub Pages

Push the files to a GitHub repository, then in **Settings → Pages**, choose **Deploy from a branch** and select the branch's `/ (root)` folder.

## Add your guild's art

- The uploaded `orc2.png` is used as the intro and cover background. Replace it with your guild's artwork as needed. Add your intro video as `assets/intro.mp4`; it plays over the artwork and fades away automatically. The image remains visible if video playback is unavailable.
- Replace the character portrait images in `assets/` and update their names and labels in `index.html`.
- Edit `events.json` to add or change dispatches. Each event needs a unique `id`, `title`, short `description`, longer `details`, `category`, ISO date (`YYYY-MM-DD`), and `artwork` (`raid`, `recruit`, or `other`). Optional fields are `time`, `location`, and a relative `image` path. Selecting a dispatch opens its details in a sliding modal.
- The supplied LifeCraft font is loaded locally from `assets/LifeCraft_Font.ttf`. Font Meme lists LifeCraft as donationware and notes commercial use might require a donation; contact designer Eliot Truelove if needed: [Font Meme listing](https://fontmeme.com/fonts/lifecraft-font/).
- Google Fonts are optional; local system font fallbacks are included.
