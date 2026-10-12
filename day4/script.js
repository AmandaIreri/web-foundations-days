// ==========================================
// Note Pad — Day 4
// Live character counter, draft saving, dark mode
// ==========================================

const MAX_CHARS = 200;
const WARN_AT = 180;
const DRAFT_KEY = "notepad-draft";
const THEME_KEY = "notepad-theme";

// Select every element once, at the top
const noteText = document.querySelector("#note-text");
const charCount = document.querySelector("#char-count");
const wordCount = document.querySelector("#word-count");
const clearBtn = document.querySelector("#clear-btn");
const themeToggle = document.querySelector("#theme-toggle");
const meter = document.querySelector(".meter");
const meterFill = document.querySelector("#meter-fill");

// Updates both counters and the warning / over classes
function updateCounts() {
  const text = noteText.value;
  const chars = text.length;
  const trimmed = text.trim();
  const words = trimmed === "" ? 0 : trimmed.split(/\s+/).length;

  charCount.textContent = `${chars} / ${MAX_CHARS} characters`;
  wordCount.textContent = `${words} words`;

  // Over 200 = red, over 180 = orange, otherwise neither
  const isOver = chars > MAX_CHARS;
  const isWarning = chars > WARN_AT && !isOver;
  charCount.classList.toggle("over", isOver);
  charCount.classList.toggle("warning", isWarning);
  meter.classList.toggle("over", isOver);
  meter.classList.toggle("warning", isWarning);
  meterFill.style.width = `${Math.min(chars / MAX_CHARS, 1) * 100}%`;
}

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, noteText.value);
}

function clearAll() {
  noteText.value = "";
  localStorage.removeItem(DRAFT_KEY);
  updateCounts();
  noteText.focus();
}

// Dark mode: set the class, the button label, and optionally remember it
function applyTheme(isDark) {
  document.body.classList.toggle("dark", isDark);
  themeToggle.textContent = isDark ? "Light mode" : "Dark mode";
}

// --- Events ---
noteText.addEventListener("input", () => {
  updateCounts();
  saveDraft();
});

noteText.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    clearAll();
  }
});

clearBtn.addEventListener("click", clearAll);

themeToggle.addEventListener("click", () => {
  const isDark = !document.body.classList.contains("dark");
  applyTheme(isDark);
  localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
});

// --- On page load: restore draft and theme, then count ---
noteText.value = localStorage.getItem(DRAFT_KEY) || "";
applyTheme(localStorage.getItem(THEME_KEY) === "dark");
updateCounts();