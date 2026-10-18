# School Database — Design Notes (Day 6)

A small relational schema for a school registry: students, the courses
the school offers, and the fact that a particular student is enrolled on
a particular course (with the grade they earned).

## Tables

### `students`
One row per student. `id` is the **primary key** (auto-incrementing in
SQLite). `name` is `NOT NULL` because every student must have one.
`email` is `NOT NULL` **and** `UNIQUE`, because we use it as a login
identifier and no two students may share an address. `enrolled_at`
defaults to the current timestamp, so it is filled in automatically when
a row is inserted.

### `courses`
One row per course offered by the school. `id` is the primary key.
`title` is `NOT NULL`. `code` (such as `CS101`) is `NOT NULL` and
`UNIQUE`, so two courses can never share a code — the code is what
students and staff actually quote. `credits` is `NOT NULL` with a
default of `1`, so a course with no credit value supplied still gets a
sensible number.

### `enrolments`
The "fact" table that connects the other two: it records that a
particular student is enrolled on a particular course, plus the `grade`
they earned (or `NULL` while the course is still in progress). It has
its own `id` primary key, two `NOT NULL` foreign keys (`student_id`,
`course_id`), and a `UNIQUE (student_id, course_id)` constraint that
**prevents the same student from enrolling on the same course twice**.
Both foreign keys use `ON DELETE CASCADE`, so deleting a student or a
course also removes the now-meaningless enrolment rows rather than
leaving dangling references.

## Relationships

- **One-to-many.** `students → enrolments` (one student can have many
  enrolments) and `courses → enrolments` (one course can have many
  enrolments). In both cases the foreign key lives on the *many* side,
  which is the `enrolments` table — the standard pattern for
  one-to-many in a relational schema.

- **Many-to-many.** `students ↔ courses`. A student can be on many
  courses, and a course has many students. A many-to-many relationship
  **cannot be stored by putting a foreign key on either side**, because
  that would force each row to hold a *list* of ids — a comma-separated
  list in a single column breaks the rule that each column holds one
  value, and makes queries like "is student X on course Y?" slow and
  fragile. The fix is a **join table** (`enrolments`) that stores one
  row per (student, course) pair, with foreign keys pointing back to
  both. As a bonus, the join table is the natural home for the `grade`,
  because the grade belongs to neither the student alone nor the course
  alone — it belongs to the *pair*.

## Index I would add

```sql
CREATE INDEX idx_enrolments_course_id ON enrolments(course_id);
```

The school's most common query is "list every student on this course"
(essentially a class roster). The lookup goes through
`enrolments.course_id`, so an index on that column lets the database
jump straight to the matching enrolments instead of scanning every row
in the table. (The primary keys `students.id`, `courses.id` and the
`UNIQUE (student_id, course_id)` constraint are already indexed
automatically by SQLite, so this is the one *extra* index that pays for
itself.)

## SQL or NoSQL?

For this system I would choose **SQL**. The data is highly structured
(students, courses, grades) and the relationships between those entities
are the *whole point* of the system — exactly what relational databases
and `JOIN`s were designed for. The rules we need to enforce (unique
emails, unique student-per-course pairs, valid foreign keys, `NOT NULL`
on names and codes) are easy to express as SQL constraints, and the
database will check them on every change, no matter whether the change
comes from the app, a migration, or an administrator typing at the
console. A document database would force the application code to
enforce those rules and would make queries like "how many students are
on each course?" awkward — typically requiring either an aggregation
pipeline or duplicated data. NoSQL would only become more attractive if
the school later needed very flexible per-student records (free-form
profile fields, file attachments, activity logs) or write throughput far
beyond what a single PostgreSQL or SQLite instance can deliver. For a
typical school registry the correctness and clarity of a relational
schema wins.
