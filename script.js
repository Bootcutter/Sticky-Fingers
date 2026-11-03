const intro = document.querySelector("#intro");
const skipIntro = document.querySelector("#skipIntro");
const introVideo = document.querySelector(".intro__video");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let introTimer;

function dismissIntro() {
  if (!intro || intro.classList.contains("is-gone")) return;
  window.clearTimeout(introTimer);
  intro.classList.add("is-gone");
  introVideo?.pause();
  document.body.classList.remove("intro-active");
  window.setTimeout(() => intro.remove(), 1100);
}

if (intro) {
  if (introVideo && !reducedMotion) {
    introVideo.addEventListener("canplay", () => {
      introVideo.classList.add("is-ready");
      introVideo.play().catch(() => {
        introVideo.classList.remove("is-ready");
      });
    }, { once: true });
    introVideo.load();
  }
  introTimer = window.setTimeout(dismissIntro, reducedMotion ? 250 : 4300);
  skipIntro?.addEventListener("click", dismissIntro);
}

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    if (intro && !intro.classList.contains("is-gone")) {
      event.preventDefault();
      dismissIntro();
      window.setTimeout(() => target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" }), 300);
    }
  });
});
