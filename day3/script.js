// ==========================================
// Notes Toolkit — Day 3
// Open the console (F12) to see the test results.
// ==========================================

// Starting data
let notes = [
  { id: 1, text: "Buy milk and bread", category: "personal" },
  { id: 2, text: "Finish the Day 3 assignment", category: "study" },
  { id: 3, text: "Email the project report to Grace", category: "work" },
  { id: 4, text: "Revise JavaScript arrays", category: "study" },
  { id: 5, text: "Call mum", category: "personal" },
];

// 1. searchNotes(word)
// Returns every note whose text contains `word`, ignoring case.
function searchNotes(word) {
  const lower = word.toLowerCase();
  return notes.filter((note) => note.text.toLowerCase().includes(lower));
}

// 2. longestNote()
// Returns the note with the most characters, or null if there are no notes.
function longestNote() {
  if (notes.length === 0) {
    return null; // handle the empty array first
  }
  let longest = notes[0];
  for (const note of notes) {
    if (note.text.length > longest.text.length) {
      longest = note;
    }
  }
  return longest;
}

// 3. countByCategory()
// Counts how many notes belong to each category.
function countByCategory() {
  const counts = {};
  for (const note of notes) {
    counts[note.category] = (counts[note.category] || 0) + 1;
  }
  return counts;
}

// 4. getSummary()
// Builds a sentence from countByCategory(), e.g.
// "5 notes: 2 personal, 2 study, 1 work."
function getSummary() {
  const counts = countByCategory();
  const parts = [];
  for (const category in counts) {
    parts.push(`${counts[category]} ${category}`);
  }
  const total = notes.length;
  const word = total === 1 ? "note" : "notes";
  return `${total} ${word}: ${parts.join(", ")}.`;
}

// 5. isDuplicate(text)
// True if a note with the same text already exists,
// ignoring case and extra spaces.
function isDuplicate(text) {
  const cleaned = text.trim().toLowerCase();
  return notes.some((note) => note.text.trim().toLowerCase() === cleaned);
}

// 6. addNote(text, category)
// Adds a note only if the text is 1-200 characters, it is not a
// duplicate, and the category is personal, work or study.
// Returns true when added, false otherwise (logs the reason).
function addNote(text, category) {
  if (text.trim().length < 1 || text.trim().length > 200) {
    console.log("Rejected: note text must be 1-200 characters.");
    return false;
  }
  if (isDuplicate(text)) {
    console.log("Rejected: a note with this text already exists.");
    return false;
  }
  if (!["personal", "work", "study"].includes(category)) {
    console.log("Rejected: category must be personal, work or study.");
    return false;
  }
  const newNote = {
    id: notes.length + 1,
    text: text.trim(),
    category: category,
  };
  notes.push(newNote);
  console.log(`Added note #${newNote.id}.`);
  return true;
}

// ==========================================
// Tests — every function gets a normal case and an edge case
// ==========================================

// --- searchNotes ---
console.log(searchNotes("BUY"));
// Expected: [ { id: 1, text: 'Buy milk and bread', category: 'personal' } ]
// (case-insensitive: "BUY" matches "Buy milk and bread")

console.log(searchNotes("zebra"));
// Expected: [] — no note contains "zebra"

// --- longestNote ---
console.log(longestNote());
// Expected: { id: 3, text: 'Email the project report to Grace', category: 'work' }
// (33 characters — longer than any other note)

// --- countByCategory ---
console.log(countByCategory());
// Expected: { personal: 2, study: 2, work: 1 }
// (key order follows the notes; same counts as the example in the task)

// --- getSummary ---
console.log(getSummary());
// Expected: "5 notes: 2 personal, 2 study, 1 work."

// --- isDuplicate ---
console.log(isDuplicate("  CALL MUM  "));
// Expected: true — matches note 5 once case and spaces are ignored

console.log(isDuplicate("Water the plants"));
// Expected: false — no such note yet

// --- addNote ---
console.log(addNote("Water the plants", "personal"));
// Expected: true, plus the log "Added note #6."

console.log(notes.length);
// Expected: 6 — proves the note was really added

console.log(addNote("buy MILK and bread", "personal"));
// Expected: false, plus "Rejected: a note with this text already exists."

console.log(addNote("", "work"));
// Expected: false, plus "Rejected: note text must be 1-200 characters."

console.log(addNote("x".repeat(201), "work"));
// Expected: false, plus "Rejected: note text must be 1-200 characters."

console.log(addNote("Sort the bookshelf", "hobby"));
// Expected: false, plus "Rejected: category must be personal, work or study."

// --- Edge case: exactly one note ---
notes = [{ id: 1, text: "Only one note here", category: "work" }];
console.log(getSummary());
// Expected: "1 note: 1 work." — singular "note" for exactly one

// --- Edge case: empty array ---
notes = [];
console.log(longestNote());
// Expected: null

console.log(countByCategory());
// Expected: {}

console.log(getSummary());
// Expected: "0 notes: ." — zero total and no category parts