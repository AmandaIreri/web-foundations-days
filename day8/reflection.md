# Reflection

The most difficult idea in the course for me was **cache invalidation**. I
understood *why* a cache speeds things up (Redis is ~1 ms, a database query
is ~20 ms), but the "what to delete when" question felt like a trap: delete
too eagerly and the cache is useless; delete too late and users see stale
data. I overcame it by building the QuickNotes API client and the caching
section of its architecture by hand — every write deleted `notes:user:{id}`
and the next read re-populated lazily. Once I saw that the delete happens
on the *write* path and the populate happens on the *read* path, the
pattern stopped feeling magical.

Based on feedback on my capstone, the part I would most improve is the
**live demo**. My architecture explanation was clear, but my demo skipped
the Network tab when creating a note, so the audience had to take my word
that the POST really fired. Next time I would open DevTools, show the
request, then the 201 response, then the new card in the list — a ten-second
detour that makes the whole point of the project visible.

Next I want to build a real backend for QuickNotes in **Node.js + Express
with PostgreSQL**. Every design decision in my documents is a claim that
has never been tested against a real database, a real unique constraint,
or a real transaction. I want to feel what happens when two requests race
for the same row — and to have the constraint save me.