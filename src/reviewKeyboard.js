/**
 * iPhone app only. The website already moves a focused review box.
 * The app leaves the page still and draws the keyboard on top, so the
 * note and buttons stay covered unless this scrolls them clear.
 */

const BLOCK_SELECTOR = ".season-score__review, .rate-review-panel, .detail-rate-section--slider";

let active = null;
let keyboardHeight = 0;
let frame = 0;

function restore(textarea) {
  if (!textarea) return;
  textarea.style.height = "";
  textarea.style.minHeight = "";
}

/** Bottom edge of what the person can see, in layout-viewport coordinates. */
function visibleLimit(keyboardHeightPx) {
  const vv = window.visualViewport;
  const full = window.innerHeight;
  if (!vv) return full - keyboardHeightPx;
  return Math.min(vv.offsetTop + vv.height, full - keyboardHeightPx);
}

function fit(textarea, keyboardHeightPx) {
  const scroller = textarea.closest(".detail");
  const block = textarea.closest(BLOCK_SELECTOR);
  if (!scroller || !block || keyboardHeightPx <= 0) return;

  restore(textarea);

  const scrollerRect = scroller.getBoundingClientRect();
  const top = Math.max(scrollerRect.top, 0) + 8;
  const bottom = Math.min(scrollerRect.bottom, visibleLimit(keyboardHeightPx)) - 8;
  const room = bottom - top;
  if (room < 80) return;

  let rect = block.getBoundingClientRect();
  if (rect.bottom > bottom + 2) scroller.scrollTop += rect.bottom - bottom;

  rect = block.getBoundingClientRect();
  const extra = rect.height - room;
  if (extra > 2) {
    const next = Math.max(64, Math.floor(textarea.getBoundingClientRect().height - extra));
    textarea.style.minHeight = "0px";
    textarea.style.height = `${next}px`;
  }

  rect = block.getBoundingClientRect();
  if (rect.bottom > bottom + 2) scroller.scrollTop += rect.bottom - bottom;
}

function scheduleFit() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if (active && keyboardHeight > 0 && document.contains(active)) fit(active, keyboardHeight);
    });
  });
}

function isReviewBox(target) {
  return target instanceof HTMLTextAreaElement && target.classList.contains("review-text");
}

export async function initReviewKeyboard() {
  const { Keyboard } = await import("@capacitor/keyboard");

  document.addEventListener("focusin", (event) => {
    if (!isReviewBox(event.target)) return;
    active = event.target;
    scheduleFit();
  });

  document.addEventListener("focusout", (event) => {
    if (event.target !== active) return;
    const leaving = event.target;
    window.setTimeout(() => {
      if (document.activeElement === leaving) return;
      restore(leaving);
      if (active === leaving) active = null;
    }, 50);
  });

  await Keyboard.addListener("keyboardWillShow", (info) => {
    keyboardHeight = Number(info?.keyboardHeight) || 0;
    scheduleFit();
  });
  await Keyboard.addListener("keyboardDidShow", (info) => {
    keyboardHeight = Number(info?.keyboardHeight) || keyboardHeight;
    scheduleFit();
  });
  await Keyboard.addListener("keyboardWillHide", () => {
    keyboardHeight = 0;
    restore(active);
  });

  window.visualViewport?.addEventListener("resize", scheduleFit);
}
