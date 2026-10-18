-- =============================================================
-- Day 6 Assignment — School Database
-- File: day6/school.sql
-- Tested in: SQLite (sqliteonline.com / sqlite3 module)
-- =============================================================
-- Three entities:
--   * a student           -> students
--   * a course            -> courses
--   * a student enrolled  -> enrolments  (holds the grade too)
--     on a course
-- =============================================================

-- SQLite only enforces foreign keys after this line is run.
-- (PostgreSQL and MySQL enforce them automatically.)
PRAGMA foreign_keys = ON;

-- =============================================================
-- 1. CREATE TABLE statements
-- =============================================================

CREATE TABLE students (
    id           INTEGER PRIMARY KEY,                       -- PK, auto-increments in SQLite
    name         TEXT    NOT NULL,                          -- every student must have a name
    email        TEXT    NOT NULL UNIQUE,                   -- unique email, no two students share it
    enrolled_at  TEXT    DEFAULT CURRENT_TIMESTAMP          -- filled in automatically
);

CREATE TABLE courses (
    id     INTEGER PRIMARY KEY,
    title  TEXT    NOT NULL,
    code   TEXT    NOT NULL UNIQUE,                          -- e.g. CS101, no duplicates
    credits INTEGER NOT NULL DEFAULT 1                       -- at least 1 credit
);

CREATE TABLE enrolments (
    id          INTEGER PRIMARY KEY,
    student_id  INTEGER NOT NULL,
    course_id   INTEGER NOT NULL,
    grade       TEXT,                                        -- A/B/C/D/F or NULL if not yet graded
    enrolled_at TEXT    DEFAULT CURRENT_TIMESTAMP,

    -- Each enrolment row must point at a real student and a real course.
    -- ON DELETE CASCADE: if a student (or course) is removed, their
    -- enrolments are removed too, so no enrolment is left dangling.
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id)  REFERENCES courses(id)  ON DELETE CASCADE,

    -- The rule that prevents the same student from enrolling on the
    -- same course twice: the pair (student_id, course_id) must be unique.
    UNIQUE (student_id, course_id)
);

-- =============================================================
-- 2. INSERT statements — sample data
-- =============================================================

-- 3 students (a 4th is added below so query 4 has something to return)
INSERT INTO students (name, email) VALUES
    ('Amina Otieno',   'amina@example.com'),
    ('Brian Kamau',    'brian@example.com'),
    ('Cynthia Wanjiru','cynthia@example.com');

-- 3 courses
INSERT INTO courses (title, code, credits) VALUES
    ('Introduction to Databases', 'CS101', 3),
    ('Web Foundations',           'CS102', 2),
    ('Algorithms',                'CS201', 3);

-- 5 enrolments
INSERT INTO enrolments (student_id, course_id, grade) VALUES
    (1, 1, 'A'),     -- Amina on CS101, grade A
    (1, 2, 'B'),     -- Amina on CS102, grade B
    (2, 1, 'C'),     -- Brian on CS101, grade C
    (2, 3, NULL),    -- Brian on CS201, not yet graded
    (3, 2, 'A');     -- Cynthia on CS102, grade A

-- A 4th student with NO enrolments, so "students who have no enrolments"
-- returns a non-empty result.
INSERT INTO students (name, email) VALUES
    ('David Mwangi', 'david@example.com');

-- =============================================================
-- 3. Five required queries
-- =============================================================

-- Query 1: All courses for one student (looked up by name).
-- JOIN enrolments -> courses to read course info; JOIN to students
-- only so we can filter by the student's name.
SELECT courses.title,
       courses.code,
       enrolments.grade
FROM enrolments
JOIN courses  ON enrolments.course_id  = courses.id
JOIN students ON enrolments.student_id = students.id
WHERE students.name = 'Amina Otieno';

-- Query 2: All students on one course (looked up by course code).
SELECT students.name,
       students.email,
       enrolments.grade
FROM enrolments
JOIN students ON enrolments.student_id = students.id
JOIN courses  ON enrolments.course_id  = courses.id
WHERE courses.code = 'CS101';

-- Query 3: Number of students per course.
-- LEFT JOIN so courses with zero enrolments still appear with count 0.
-- GROUP BY courses.id (the PK) so two courses with the same title are
-- not merged together.
SELECT courses.title,
       COUNT(enrolments.student_id) AS student_count
FROM courses
LEFT JOIN enrolments ON courses.id = enrolments.course_id
GROUP BY courses.id, courses.title
ORDER BY student_count DESC, courses.title ASC;

-- Query 4: Students who have no enrolments.
-- LEFT JOIN keeps every student; rows with no matching enrolment have
-- NULL on the enrolments side, which we filter for with IS NULL.
SELECT students.name,
       students.email
FROM students
LEFT JOIN enrolments ON students.id = enrolments.student_id
WHERE enrolments.id IS NULL;

-- Query 5: Update one enrolment's grade.
-- Targets exactly one row: the UNIQUE (student_id, course_id) rule
-- guarantees Brian-on-CS201 is the only match.
UPDATE enrolments
SET grade = 'A'
WHERE student_id = (SELECT id FROM students WHERE name = 'Brian Kamau')
  AND course_id  = (SELECT id FROM courses  WHERE code = 'CS201');

-- Sanity check: show Brian's enrolment after the update.
SELECT students.name,
       courses.code,
       enrolments.grade
FROM enrolments
JOIN students ON enrolments.student_id = students.id
JOIN courses  ON enrolments.course_id  = courses.id
WHERE students.name = 'Brian Kamau';
