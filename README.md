# Sticky Fingers

A visual-first, single-page Horde guild site built with plain HTML, CSS, and JavaScript for GitHub Pages. The art direction uses a hard crimson, black, and dark-earth palette, a bold condensed war-poster title, an animated cinematic intro, illustrated dispatches, and a character gallery. Original SVG art is included as a stand-in for custom artwork.

## Run locally

Open `index.html` in a browser, or serve this folder with any static file server.

## Publish with GitHub Pages

Push the files to a GitHub repository, then in **Settings → Pages**, choose **Deploy from a branch** and select the branch's `/ (root)` folder.

## Add your guild's art

- The uploaded `orc2.png` is used as the intro and cover background. Replace it with your guild's artwork as needed. Add your intro video as `assets/intro.mp4`; it plays over the artwork and fades away automatically. The image remains visible if video playback is unavailable.
- Replace the character portrait images in `assets/` and update their names and labels in `index.html`.
- Update the two dispatch captions in `index.html` with actual guild news.
- The supplied LifeCraft font is loaded locally from `assets/LifeCraft_Font.ttf`. Font Meme lists LifeCraft as donationware and notes commercial use might require a donation; contact designer Eliot Truelove if needed: [Font Meme listing](https://fontmeme.com/fonts/lifecraft-font/).
- Google Fonts are optional; local system font fallbacks are included.
