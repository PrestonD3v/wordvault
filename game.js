const SECRET_KEY = "top-level-secret-WordVault-custom-key";
const DEFAULT_SOLUTION = "INDEX";

const DEFAULT_MAX_GUESSES = 6;
const MIN_WORD_LENGTH = 2;
const MAX_WORD_LENGTH = 10;
const MIN_GUESSES = 1;
const MAX_GUESSES_LIMIT = 9;

const TILE_FLIP_DURATION = 500; // Change this to adjust the tile flip animation speed.
const delay = 400; // ms between tile flips

const ENGLISH_KEYBOARD = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Enter", "Z", "X", "C", "V", "B", "N", "M", "Backspace"]
];

// Modern Greek keyboard layout. Final sigma (ς) normalizes to Σ, so one sigma key is enough.
const GREEK_KEYBOARD = [
  ["Ε", "Ρ", "Τ", "Υ", "Θ", "Ι", "Ο", "Π"],
  ["Α", "Σ", "Δ", "Φ", "Γ", "Η", "Ξ", "Κ", "Λ"],
  ["Enter", "Ζ", "Χ", "Ψ", "Ω", "Β", "Ν", "Μ", "Backspace"]
];

let SOLUTION = "";
let WORD_LENGTH = 5;
let MAX_GUESSES = DEFAULT_MAX_GUESSES;
let WORD_SCRIPT = "latin";

let currentRow = 0;
let currentCol = 0;
let currentGuess = [];
let gameOver = false;
let inputLocked = false;
let board = [];

function xorBytes(bytes, key) {
  const keyBytes = new TextEncoder().encode(key);
  return bytes.map((byte, i) => byte ^ keyBytes[i % keyBytes.length]);
}

function encodeGameConfig(config) {
  const word = normalizeWordInput(config.word || DEFAULT_SOLUTION);
  const maxGuesses = Number(config.maxGuesses) || DEFAULT_MAX_GUESSES;

  // Compact v5 payload. Supports Unicode words like Greek.
  // Format: 5|WORD|MAX_GUESSES
  const payload = `5|${word}|${maxGuesses}`;
  const payloadBytes = new TextEncoder().encode(payload);
  const encryptedBytes = xorBytes(payloadBytes, SECRET_KEY);

  return toBase64UrlFromBytes(encryptedBytes);
}

function decodeGameConfig(hash) {
  const cleanHash = decodeURIComponent(hash);

  try {
    const encryptedBytes = fromBase64UrlToBytes(cleanHash);
    const decryptedBytes = xorBytes(encryptedBytes, SECRET_KEY);
    const decrypted = new TextDecoder().decode(decryptedBytes);

    const compactPayload = parseCompactPayload(decrypted);
    if (compactPayload) return normalizeGameConfig(compactPayload);

    // Backward compatibility: v2 URLs used encrypted JSON.
    const jsonPayload = JSON.parse(decrypted);
    return normalizeGameConfig(jsonPayload);
  } catch (e) {
    // Backward compatibility: the oldest URLs were just the encrypted English word.
    const oldWord = decodeLegacyWord(cleanHash);
    if (oldWord) {
      return normalizeGameConfig({
        word: oldWord,
        wordLength: oldWord.length,
        maxGuesses: DEFAULT_MAX_GUESSES
      });
    }

    return null;
  }
}

function parseCompactPayload(payload) {
  const parts = String(payload || "").split("|");

  // v5 is the current short format: 5|WORD|MAX_GUESSES
  if (parts[0] === "5") {
    return {
      word: parts[1],
      maxGuesses: parts[2]
    };
  }

  // v4 was the previous short English-only format: 4|WORD|MAX_GUESSES
  if (parts[0] === "4") {
    return {
      word: parts[1],
      maxGuesses: parts[2]
    };
  }

  // v3 links also work, but the flip duration from the URL is now ignored.
  if (parts[0] === "3") {
    return {
      word: parts[1],
      maxGuesses: parts[2]
    };
  }

  return null;
}

function toBase64UrlFromBytes(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64UrlToBytes(value) {
  let base64 = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  while (base64.length % 4) base64 += "=";

  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeLegacyWord(hash) {
  try {
    const encryptedBytes = fromBase64UrlToBytes(hash);
    const decryptedBytes = xorBytes(encryptedBytes, SECRET_KEY);
    const decoded = new TextDecoder().decode(decryptedBytes);
    const word = normalizeWordInput(decoded);
    return isLatinWord(word) ? word : null;
  } catch (e) {
    return null;
  }
}

function normalizeGameConfig(config) {
  if (!config || typeof config !== "object") return null;

  const word = normalizeWordInput(config.word || "");
  if (!isValidWord(word)) return null;
  if (word.length < MIN_WORD_LENGTH || word.length > MAX_WORD_LENGTH) return null;

  const maxGuesses = clampInt(config.maxGuesses, MIN_GUESSES, MAX_GUESSES_LIMIT, DEFAULT_MAX_GUESSES);
  return {
    word,
    wordLength: word.length,
    maxGuesses,
    script: isGreekWord(word) ? "greek" : "latin"
  };
}

function getCurrentGameConfig() {
  return {
    word: SOLUTION,
    wordLength: WORD_LENGTH,
    maxGuesses: MAX_GUESSES
  };
}

function buildShareUrl() {
  const url = new URL(window.location.href);
  url.hash = encodeGameConfig(getCurrentGameConfig());
  return url.href;
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve, reject) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      copied ? resolve() : reject(new Error("Copy command failed"));
    } catch (err) {
      document.body.removeChild(textarea);
      reject(err);
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  const hash = window.location.hash.slice(1);
  const config = hash ? decodeGameConfig(hash) : normalizeGameConfig({
    word: DEFAULT_SOLUTION,
    maxGuesses: DEFAULT_MAX_GUESSES
  });

  if (config) {
    SOLUTION = config.word;
    WORD_LENGTH = config.wordLength;
    MAX_GUESSES = config.maxGuesses;
    WORD_SCRIPT = config.script;
  } else {
    showToast("Invalid link! Using default word.", 3000);
    SOLUTION = DEFAULT_SOLUTION;
    WORD_LENGTH = DEFAULT_SOLUTION.length;
    MAX_GUESSES = DEFAULT_MAX_GUESSES;
    WORD_SCRIPT = "latin";
  }

  applySettingsToCss();
  updateStaticText();
  buildBoard();
  buildKeyboard();
  attachKeyboardListeners();
  attachModalListeners();
});

/* =====================
   BUILD BOARD
   ===================== */
function buildBoard() {
  const boardEl = document.getElementById("board");
  boardEl.innerHTML = "";
  board = [];

  boardEl.style.setProperty("--cols", WORD_LENGTH);
  boardEl.style.gridTemplateRows = `repeat(${MAX_GUESSES}, 1fr)`;

  for (let r = 0; r < MAX_GUESSES; r++) {
    const row = document.createElement("div");
    row.classList.add("row");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", `Row ${r + 1}`);
    row.style.gridTemplateColumns = `repeat(${WORD_LENGTH}, 1fr)`;

    const rowTiles = [];
    for (let c = 0; c < WORD_LENGTH; c++) {
      const tile = document.createElement("div");
      tile.classList.add("tile");
      tile.setAttribute("data-state", "empty");
      tile.setAttribute("aria-label", `${ordinal(c + 1)} letter, empty`);
      row.appendChild(tile);
      rowTiles.push(tile);
    }

    boardEl.appendChild(row);
    board.push(rowTiles);
  }

  const tileSize = Number(getComputedStyle(document.documentElement).getPropertyValue("--tile-size").replace("px", "")) || 62;
  const gap = Number(getComputedStyle(document.documentElement).getPropertyValue("--tile-gap").replace("px", "")) || 5;
  const availableWidth = Math.min(window.innerWidth - 24, 500);
  const idealWidth = WORD_LENGTH * tileSize + (WORD_LENGTH - 1) * gap;
  const boardWidth = Math.min(idealWidth, availableWidth);
  const actualTileSize = (boardWidth - (WORD_LENGTH - 1) * gap) / WORD_LENGTH;
  const boardHeight = MAX_GUESSES * actualTileSize + (MAX_GUESSES - 1) * gap;

  boardEl.style.width = `${boardWidth}px`;
  boardEl.style.height = `${boardHeight}px`;
}

/* =====================
   BUILD KEYBOARD
   ===================== */
function buildKeyboard() {
  const keyboard = document.getElementById("keyboard");
  keyboard.innerHTML = "";

  const layout = WORD_SCRIPT === "greek" ? GREEK_KEYBOARD : ENGLISH_KEYBOARD;
  keyboard.setAttribute("aria-label", WORD_SCRIPT === "greek" ? "Greek keyboard" : "English keyboard");

  layout.forEach((rowKeys, rowIndex) => {
    const row = document.createElement("div");
    row.classList.add("keyboard-row");

    if (WORD_SCRIPT === "latin" && rowIndex === 1) {
      row.appendChild(createKeySpacer());
    }

    rowKeys.forEach((keyValue) => {
      row.appendChild(createKeyboardButton(keyValue));
    });

    if (WORD_SCRIPT === "latin" && rowIndex === 1) {
      row.appendChild(createKeySpacer());
    }

    keyboard.appendChild(row);
  });
}

function createKeyboardButton(keyValue) {
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("key");
  button.dataset.key = keyValue;

  if (keyValue === "Enter") {
    button.classList.add("key-wide");
    button.textContent = "enter";
    button.setAttribute("aria-label", "Enter");
  } else if (keyValue === "Backspace") {
    button.classList.add("key-wide");
    button.textContent = "⌫";
    button.setAttribute("aria-label", "Backspace");
  } else {
    button.textContent = keyValue;
    button.setAttribute("aria-label", keyValue);
  }

  return button;
}

function createKeySpacer() {
  const spacer = document.createElement("div");
  spacer.classList.add("key-spacer");
  return spacer;
}

/* =====================
   KEYBOARD LISTENERS
   ===================== */
function attachKeyboardListeners() {
  document.addEventListener("keydown", (e) => {
    if (gameOver || inputLocked) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === "Enter") {
      e.preventDefault();
      submitGuess();
    } else if (e.key === "Backspace") {
      e.preventDefault();
      deleteLetter();
    } else {
      const letter = normalizeLetterKey(e.key);
      if (letter && isAllowedLetterForPuzzle(letter)) {
        addLetter(letter);
      }
    }
  });

  document.getElementById("keyboard").addEventListener("click", (e) => {
    if (gameOver || inputLocked) return;
    const key = e.target.closest("[data-key]");
    if (!key) return;

    const k = key.dataset.key;
    if (k === "Enter") {
      submitGuess();
    } else if (k === "Backspace") {
      deleteLetter();
    } else {
      addLetter(normalizeLetterKey(k));
    }
  });
}

/* =====================
   GAME ACTIONS
   ===================== */
function addLetter(letter) {
  if (inputLocked || gameOver) return;
  if (currentRow >= MAX_GUESSES || currentCol >= WORD_LENGTH) return;
  if (!isAllowedLetterForPuzzle(letter)) return;

  const tile = board[currentRow][currentCol];
  tile.textContent = letter;
  tile.setAttribute("data-state", "tbd");
  tile.setAttribute("aria-label", `${ordinal(currentCol + 1)} letter, ${letter}`);

  currentGuess.push(letter);
  currentCol++;
}

function deleteLetter() {
  if (inputLocked || gameOver) return;
  if (currentRow >= MAX_GUESSES || currentCol <= 0) return;

  currentCol--;
  currentGuess.pop();

  const tile = board[currentRow][currentCol];
  tile.textContent = "";
  tile.setAttribute("data-state", "empty");
  tile.setAttribute("aria-label", `${ordinal(currentCol + 1)} letter, empty`);
}

function submitGuess() {
  if (inputLocked || gameOver) return;

  if (currentCol < WORD_LENGTH) {
    shakeRow(currentRow);
    showToast("Not enough letters");
    return;
  }

  inputLocked = true;

  const guess = currentGuess.join("");
  const result = evaluateGuess(guess);
  // Capture the row index before any later state changes.
  const submittedRow = currentRow;

  revealRow(submittedRow, result, () => {
    updateKeyboard(guess, result);

    if (guess === SOLUTION) {
      gameOver = true;
      setTimeout(() => {
        bounceRow(submittedRow);
        setTimeout(() => showEndModal(true, submittedRow + 1), 600);
      }, 300);
      return;
    }

    if (submittedRow === MAX_GUESSES - 1) {
      gameOver = true;
      setTimeout(() => showEndModal(false, submittedRow + 1), 600);
      return;
    }

    currentRow++;
    currentCol = 0;
    currentGuess = [];
    inputLocked = false;
  });
}

/* =====================
   EVALUATE GUESS
   ===================== */
function evaluateGuess(guess) {
  const result = Array(WORD_LENGTH).fill("absent");
  const solutionArr = SOLUTION.split("");
  const guessArr = guess.split("");

  const solutionRemaining = [];
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guessArr[i] === solutionArr[i]) {
      result[i] = "correct";
      solutionRemaining.push(null);
    } else {
      solutionRemaining.push(solutionArr[i]);
    }
  }

  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] === "correct") continue;
    const idx = solutionRemaining.indexOf(guessArr[i]);
    if (idx !== -1) {
      result[i] = "present";
      solutionRemaining[idx] = null;
    }
  }

  return result;
}

/* =====================
   REVEAL ROW (flip animation)
   ===================== */
function revealRow(rowIndex, result, callback) {
  const tiles = board[rowIndex];
  if (!tiles) return;

  tiles.forEach((tile, i) => {
    setTimeout(() => {
      tile.style.animationDelay = "0ms";
      tile.setAttribute("data-state", result[i]);
      tile.setAttribute("aria-label",
        `${ordinal(i + 1)} letter, ${tile.textContent}, ${result[i]}`
      );

      if (i === tiles.length - 1) {
        setTimeout(callback, TILE_FLIP_DURATION);
      }
    }, i * delay);
  });
}

const keyStates = {};

function updateKeyboard(guess, result) {
  const priority = { correct: 3, present: 2, absent: 1 };

  for (let i = 0; i < guess.length; i++) {
    const letter = normalizeLetterKey(guess[i]);
    const state = result[i];
    const current = keyStates[letter];

    if (!current || priority[state] > priority[current]) {
      keyStates[letter] = state;
    }
  }
  
  document.querySelectorAll("[data-key]").forEach((key) => {
    const k = normalizeLetterKey(key.dataset.key);
    if (keyStates[k]) {
      key.setAttribute("data-state", keyStates[k]);
    }
  });
}

function shakeRow(rowIndex) {
  if (!board[rowIndex] || !board[rowIndex][0]) return;
  const rowEl = board[rowIndex][0].parentElement;
  rowEl.classList.add("shake");
  rowEl.addEventListener("animationend", () => {
    rowEl.classList.remove("shake");
  }, { once: true });
}

function bounceRow(rowIndex) {
  if (!board[rowIndex]) return;
  board[rowIndex].forEach((tile, i) => {
    setTimeout(() => {
      tile.classList.add("bounce");
      tile.addEventListener("animationend", () => {
        tile.classList.remove("bounce");
      }, { once: true });
    }, i * 100);
  });
}

function showToast(message, duration = 1500) {
  const toaster = document.getElementById("game-toaster");
  const toast = document.createElement("div");
  toast.classList.add("toast");
  toast.textContent = message;
  toaster.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

function attachModalListeners() {
  const helpModal = document.getElementById("help-modal");
  const endModal = document.getElementById("end-modal");
  const helpClose = document.getElementById("help-close");
  const endClose = document.getElementById("end-close");

  // Help modal
  document.getElementById("help-button").addEventListener("click", () => {
    helpModal.classList.remove("hidden");
  });

  helpClose.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    helpModal.classList.add("hidden");
  });

  helpModal.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
  });

  // Stats button
  document.getElementById("stats-button").addEventListener("click", () => {
    if (gameOver) {
      endModal.classList.remove("hidden");
    } else {
      showToast("Finish the game to see stats!");
    }
  });

  // Settings button
  document.getElementById("settings-button").addEventListener("click", () => {
    showToast("Settings are saved in generated links.");
  });

  // Copy link button — copies the canonical encrypted game URL, including settings.
  document.getElementById("copy-link-button").addEventListener("click", () => {
    copyText(buildShareUrl()).then(() => {
      showToast("Link copied!");
    }).catch(() => {
      showToast("Could not copy link.");
    });
  });

  // End modal close. Keep this separate from gameplay input locks.
  endClose.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeEndModal();
  });

  endModal.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeEndModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    helpModal.classList.add("hidden");
    closeEndModal();
  });
}

function closeEndModal() {
  document.getElementById("end-modal").classList.add("hidden");
}

function showEndModal(won, triesCount) {
  const modal = document.getElementById("end-modal");
  const winContent = document.getElementById("end-win-content");
  const loseContent = document.getElementById("end-lose-content");

  if (won) {
    winContent.classList.remove("hidden");
    loseContent.classList.add("hidden");
    document.getElementById("end-message").textContent =
      `You guessed it in ${triesCount} ${triesCount === 1 ? "try" : "tries"}!`;
    document.getElementById("end-word").textContent = `The word was: ${SOLUTION}`;
  } else {
    loseContent.classList.remove("hidden");
    winContent.classList.add("hidden");
    document.getElementById("end-lose-message").textContent = "Better luck next time!";
    document.getElementById("end-lose-word").textContent = `The word was: ${SOLUTION}`;
  }

  modal.classList.remove("hidden");
}

function applySettingsToCss() {
  document.documentElement.style.setProperty("--flip-duration", `${TILE_FLIP_DURATION}ms`);
}

function updateStaticText() {
  const guessesText = document.getElementById("max-guesses-text");
  if (guessesText) guessesText.textContent = MAX_GUESSES;
}

/* =====================
   HELPERS
   ===================== */
function normalizeWordInput(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ς/g, "σ")
    .toUpperCase();
}

function normalizeLetterKey(value) {
  const normalized = normalizeWordInput(value);
  return normalized.length === 1 ? normalized : "";
}

function isLatinWord(word) {
  return /^[A-Z]+$/.test(word);
}

function isGreekWord(word) {
  return /^[\u0391-\u03A1\u03A3-\u03A9]+$/.test(word);
}

function isValidWord(word) {
  return isLatinWord(word) || isGreekWord(word);
}

function isAllowedLetterForPuzzle(letter) {
  return WORD_SCRIPT === "greek" ? isGreekWord(letter) : isLatinWord(letter);
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
