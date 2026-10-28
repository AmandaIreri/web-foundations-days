# TicketHub — Event Ticketing System Design

A design document for TicketHub, a website that sells tickets for concerts
and events. It follows the six-part framework from Part 1 of the capstone
brief: requirements, estimates, API, data model, architecture, and
trade-offs. The whole design is anchored on one idea: **the database, not
the application code, is the final arbiter of who gets a seat.**

---

## 1. Requirements

### Functional requirements

1. A visitor can browse upcoming events and view a single event's details.
2. A visitor can view an event's seat map and see which seats are available,
   held, or sold.
3. A signed-in user can **hold** one or more available seats for a short
   window while they pay.
4. A signed-in user can **pay** for their held seats, producing an order and
   one ticket per seat.
5. A user can view their orders and their tickets (with a QR code / unique
   code that will be scanned at the door).
6. A user can release a hold they no longer want, returning the seat to the
   pool immediately.
7. Holds that are not paid for expire automatically, and the seat returns to
   the pool.
8. A user can never end up owning two tickets to the same seat, and two
   users can never hold or buy the same seat.

### Non-functional requirements

| Requirement     | Target and why |
|-----------------|----------------|
| **Speed**       | Event list and detail pages: p95 under 300 ms. Seat map: p95 under 800 ms. Hold request: p95 under 200 ms (it is the most latency-sensitive write). |
| **Correctness** | A seat is **never** sold twice. This is enforced by database constraints, not by application logic. A confirmed payment always produces exactly one ticket per seat, even if the client retries. |
| **Fairness**    | Every buyer gets a fair shot. Each user may hold at most 4 seats at a time. Holds expire after 10 minutes. On-sale admission is controlled by a queue so one fast bot cannot sweep all 20,000 seats in 5 seconds. |
| **Availability**| 99.9% ("three nines", about 8.8 hours of downtime per year). The on-sale moment is a peak-of-the-year event: the system must stay up under 200 times normal load. |
| **Consistency** | Strong consistency on the hold-and-buy path (see section 4.6). Eventual consistency is acceptable for browsing and for seat-map display. |
| **Security**    | HTTPS only. Card details never touch our servers — a payment provider (Stripe-style) handles them. Every hold, order and ticket is scoped to the signed-in user. |
| **Durability**  | No confirmed payment is ever lost, and no issued ticket is ever duplicated. Nightly backups plus point-in-time recovery. |
| **Observability** | Logs, metrics and alerts on hold-attempt rate, hold success rate, payment success rate, and error rate. During a big sale, an on-call engineer watches the queue depth live. |

---

## 2. Estimates

All facts come from the brief. Rounding: 1 day is approximately 100,000 seconds;
1 KB = 1,000 B; 1 TB = 1,000 GB.

### 2.1 Normal day

- **50,000 visitors × 10 pages = 500,000 page views / day**
  → 500,000 ÷ 100,000 = **5 page views/s average**, **~25 at peak (5×)**.
- **5,000 tickets sold / day**
  → 5,000 ÷ 100,000 = **0.05 purchases/s average**, **~0.25 at peak**.
- Assume each purchase needs ~1.5 hold attempts on average (some retries):
  ≈ **0.075 hold attempts/s average**, under 1 per second even at peak.
- **Writes (orders + tickets + payments):** ~0.1/s average, ~0.5/s peak.

Storage on a normal day:

- 5,000 tickets × ~1 KB (order + items + payment row) ≈ **5 MB / day** of
  sales data.
- Event and seat rows: assume ~1,000 events/year with ~5,000 seats each
  → **5,000,000 seat rows/year × ~300 B ≈ 1.5 GB / year**.
- Total sales + events + indices: **~4–5 GB / year**. Trivial for any
  database. Storage is not the bottleneck — correctness and the on-sale
  peak are.

### 2.2 The big sale

A popular concert goes on sale: **200,000 people try to buy its 20,000
seats within 10 minutes (600 seconds)**.

The naive path — every user hits "Buy" the instant the sale opens — would
put **200,000 × (view event + view seats + hold + pay) ≈ 1,000,000 requests
in 600 s ≈ 1,700 req/s on average**, with a **5,000–10,000 req/s spike at
the exact open moment** and **200,000 concurrent hold attempts against 20,000
rows**. That is what a naive design has to survive. The design below does
**not** try to serve 10,000 req/s of holds — it deliberately caps them.

| Metric                     | Normal (avg) | Normal (peak 5×) | Big-sale (peak) |
|----------------------------|--------------|------------------|-----------------|
| Page views / s             | 5            | 25               | ~2,000          |
| Hold attempts / s          | < 0.1        | ~0.5             | **~500** (capped by the waiting room) |
| Purchases / s              | 0.05         | 0.25             | ~30 (20,000 seats over 600 s) |
| API requests / s (all)     | ~5           | ~25              | ~5,000          |
| Writes / s to primary DB   | ~0.1         | ~0.5             | **~500** (short INSERTs) |

### 2.3 Comparison — the two regimes

| Dimension                  | Normal day                       | Big sale                                          |
|----------------------------|----------------------------------|---------------------------------------------------|
| Traffic shape              | Flat, read-heavy                 | Sudden burst, write-heavy on holds                 |
| Peak API requests / s      | ~25                              | ~5,000 (**200× normal peak**)                      |
| Primary DB writes / s      | ~0.5                             | ~500 (**1,000× normal peak**)                      |
| Dominant risk              | Nothing breaks                   | Thundering herd, lock contention, double-booking   |
| Component that saves us    | The whole design is idle         | **The virtual waiting room + DB unique constraint** |

The design is not sized for 5,000 req/s of purchases — it is sized for
**5,000 req/s of browsing** and **500 req/s of atomic hold attempts**,
because the waiting room converts the flood of buyers into a controlled
stream. That is the same discipline as the URL-shortener example: let the
numbers decide what to build, and just as importantly what *not* to build.

---

## 3. API

Base URL: https://api.tickethub.example/v1
Auth: `Authorization: Bearer <token>`. Payment details are handled by the
payment provider's SDK on the client, never sent to our API.

| # | Method | Path                              | Description                                                | Success |
|---|--------|-----------------------------------|------------------------------------------------------------|---------|
| 1 | GET    | /events                           | List upcoming events (paginated, filterable by date/city). | 200 OK  |
| 2 | GET    | /events/{id}                      | Return one event's details.                                | 200 OK  |
| 3 | GET    | /events/{id}/seats                | Return the seat map with each seat's status.              | 200 OK  |
| 4 | POST   | /seats/{seatId}/hold              | Create a 10-minute hold on a seat for the signed-in user. | 201 Created / 409 Conflict |
| 5 | DELETE | /holds/{holdId}                   | Release a hold early.                                      | 204 No Content |
| 6 | POST   | /orders                           | Pay for one or more held seats (idempotent).              | 201 Created |
| 7 | GET    | /orders/{id}                      | View an order (status, total, seats).                     | 200 OK  |
| 8 | GET    | /me/tickets                       | List the signed-in user's tickets.                        | 200 OK  |

### 3.1 Example — POST /seats/8842/hold

**Request body:** none. The seat id is in the path, the user is in the token.

**Success — 201 Created:**

    {
      "holdId": "hl_9c1f...",
      "seatId": 8842,
      "eventId": 312,
      "section": "B",
      "row": 14,
      "seatNumber": 3,
      "priceCents": 8500,
      "expiresAt": "2026-02-11T09:24:00Z"
    }

**Conflict — 409 (seat already held or sold):**

    {
      "status": 409,
      "error": "Conflict",
      "message": "This seat is no longer available.",
      "seatId": 8842
    }

### 3.2 Example — POST /orders

Payment is completed on the client via the payment provider's SDK, which
returns a `paymentToken`. The client then posts the hold ids and the token.

**Request:**

    {
      "holdIds": ["hl_9c1f...", "hl_9c1f...b"],
      "paymentToken": "tok_visa_abc123",
      "idempotencyKey": "order-8f3d2c1a-uid-7442"
    }

**Success — 201 Created:**

    {
      "orderId": 5571,
      "status": "paid",
      "totalCents": 17000,
      "tickets": [
        { "ticketId": "tk_...", "seatId": 8842, "qrCode": "TKH-..." },
        { "ticketId": "tk_...", "seatId": 8843, "qrCode": "TKH-..." }
      ]
    }

The `idempotencyKey` is stored on the order. If the client retries the same
POST /orders (network blip, refresh), the server returns the existing
order instead of creating a second one — a **confirmed payment is never
charged twice**.

### 3.3 Example — GET /me/tickets

**Response — 200 OK:**

    {
      "data": [
        {
          "ticketId": "tk_...",
          "eventId": 312,
          "eventName": "Adele — Live in Nairobi",
          "eventStartsAt": "2026-06-20T19:00:00Z",
          "seat": { "section": "B", "row": 14, "seatNumber": 3 },
          "qrCode": "TKH-...",
          "purchasedAt": "2026-02-11T09:15:42Z"
        }
      ]
    }

### 3.4 Error format and status codes

Every error uses the same body shape:

    { "status": 409, "error": "Conflict", "message": "...", "field": "..." }

| Code | Name | When |
|------|------|------|
| 400  | Bad Request | Malformed JSON; missing `holdIds`; a hold id that is not a string. |
| 401  | Unauthorized | Missing or expired token. |
| 403  | Forbidden | Trying to pay for a hold that belongs to another user. |
| 404  | Not Found | Event, seat, hold or order does not exist. |
| 409  | Conflict | Seat already held or sold; hold expired; too many seats held by the user. |
| 429  | Too Many Requests | Rate limit exceeded (per user, per IP, and per on-sale window). |
| 500  | Internal Server Error | Unexpected failure on our side. |

---

## 4. Data model

PostgreSQL. Relational because seats, orders, tickets and holds are tightly
coupled and the **correctness** of a seat's state is exactly the kind of
invariant a relational database with unique constraints and transactions
enforces for free. (See section 4.7 for the SQL vs NoSQL note.)

### 4.1 Tables

**users**

| Column          | Type          | Key | Notes |
|-----------------|---------------|-----|-------|
| `id`            | BIGSERIAL     | PK  |       |
| `email`         | VARCHAR(255)  |     | UNIQUE |
| `password_hash` | VARCHAR(255)  |     |       |
| `display_name`  | VARCHAR(80)   |     |       |
| `created_at`    | TIMESTAMPTZ   |     | default now() |

**events**

| Column        | Type          | Key | Notes |
|---------------|---------------|-----|-------|
| `id`          | BIGSERIAL     | PK  |       |
| `name`        | VARCHAR(200)  |     |       |
| `venue`       | VARCHAR(200)  |     |       |
| `city`        | VARCHAR(100)  |     |       |
| `starts_at`   | TIMESTAMPTZ   |     |       |
| `on_sale_at`  | TIMESTAMPTZ   |     | when the sale opens |
| `total_seats` | INTEGER       |     | denormalised, for the event page |

**seats** (one row per physical seat per event)

| Column        | Type         | Key | Notes |
|---------------|--------------|-----|-------|
| `id`          | BIGSERIAL    | PK  |       |
| `event_id`    | BIGINT       | FK → `events.id` (ON DELETE CASCADE) | |
| `section`     | VARCHAR(20)  |     | e.g. "B" |
| `row_label`   | VARCHAR(10)  |     | e.g. "14" |
| `seat_number` | INTEGER      |     | e.g. 3 |
| `status`      | VARCHAR(10)  |     | available / held / sold |
| `price_cents` | INTEGER      |     |       |

Constraint: **UNIQUE (event_id, section, row_label, seat_number)** —
guarantees each physical seat exists exactly once per event.

**seat_holds**

| Column       | Type         | Key | Notes |
|--------------|--------------|-----|-------|
| `id`         | VARCHAR(30)  | PK  | e.g. `hl_9c1f...` |
| `seat_id`    | BIGINT       | FK → `seats.id` (ON DELETE CASCADE), **UNIQUE** | **This UNIQUE is the anti-double-booking constraint.** |
| `user_id`    | BIGINT       | FK → `users.id` | |
| `created_at` | TIMESTAMPTZ  |     | default now() |
| `expires_at` | TIMESTAMPTZ  |     | created_at + 10 min |

UNIQUE (seat_id) means the database can only ever hold **one active hold
per seat**. A second insert fails at the constraint — not in the app.

**orders**

| Column             | Type         | Key | Notes |
|--------------------|--------------|-----|-------|
| `id`               | BIGSERIAL    | PK  | |
| `user_id`          | BIGINT       | FK → `users.id` | |
| `event_id`         | BIGINT       | FK → `events.id` | |
| `status`           | VARCHAR(20)  |     | pending / paid / refunded |
| `total_cents`      | INTEGER      |     | |
| `payment_provider_id` | VARCHAR(100) |   | id from Stripe |
| `idempotency_key`  | VARCHAR(100) |     | **UNIQUE** |
| `created_at`       | TIMESTAMPTZ  |     | default now() |

UNIQUE (idempotency_key) makes retries safe.

**order_items**

| Column        | Type    | Key | Notes |
|---------------|---------|-----|-------|
| `order_id`    | BIGINT  | PK, FK → `orders.id` (ON DELETE CASCADE) | |
| `seat_id`     | BIGINT  | PK, FK → `seats.id`, **UNIQUE** | **A seat can appear in at most one order.** |
| `price_cents` | INTEGER |     | copied at purchase time |

**tickets**

| Column          | Type         | Key | Notes |
|-----------------|--------------|-----|-------|
| `id`            | VARCHAR(30)  | PK  | e.g. `tk_...` |
| `order_id`      | BIGINT       | FK → `order_items.order_id` | |
| `seat_id`       | BIGINT       | FK → `order_items.seat_id`  | |
| `qr_code`       | VARCHAR(64)  | UNIQUE | the string the door scanner reads |
| `issued_at`     | TIMESTAMPTZ  |     | default now() |

### 4.2 Relationships

- **users → orders (one-to-many).** One user makes many orders; each
  order belongs to exactly one user.
- **events → seats (one-to-many).** One event has many seats; each seat
  belongs to exactly one event.
- **events → orders (one-to-many).** An order is for one event.
- **orders → order_items (one-to-many).** An order contains one or more
  seats.
- **seats → order_items (one-to-one at a point in time).** A seat can be
  in at most one active order — enforced by UNIQUE (seat_id).
- **seats → seat_holds (one-to-one active).** At most one active hold
  per seat — enforced by UNIQUE (seat_id) on seat_holds.

### 4.3 CREATE TABLE statements

    CREATE TABLE users (
      id            BIGSERIAL    PRIMARY KEY,
      email         VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      display_name  VARCHAR(80)  NOT NULL,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
    );

    CREATE TABLE events (
      id          BIGSERIAL    PRIMARY KEY,
      name        VARCHAR(200) NOT NULL,
      venue       VARCHAR(200) NOT NULL,
      city        VARCHAR(100) NOT NULL,
      starts_at   TIMESTAMPTZ  NOT NULL,
      on_sale_at  TIMESTAMPTZ  NOT NULL,
      total_seats INTEGER      NOT NULL
    );

    CREATE TABLE seats (
      id          BIGSERIAL    PRIMARY KEY,
      event_id    BIGINT       NOT NULL REFERENCES events (id) ON DELETE CASCADE,
      section     VARCHAR(20)  NOT NULL,
      row_label   VARCHAR(10)  NOT NULL,
      seat_number INTEGER      NOT NULL,
      status      VARCHAR(10)  NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available','held','sold')),
      price_cents INTEGER      NOT NULL CHECK (price_cents >= 0),
      UNIQUE (event_id, section, row_label, seat_number)
    );

    CREATE TABLE seat_holds (
      id         VARCHAR(30) PRIMARY KEY,
      seat_id    BIGINT      NOT NULL UNIQUE REFERENCES seats (id) ON DELETE CASCADE,
      user_id    BIGINT      NOT NULL REFERENCES users (id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE orders (
      id                  BIGSERIAL    PRIMARY KEY,
      user_id             BIGINT       NOT NULL REFERENCES users (id),
      event_id            BIGINT       NOT NULL REFERENCES events (id),
      status              VARCHAR(20)  NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','paid','refunded')),
      total_cents         INTEGER      NOT NULL CHECK (total_cents >= 0),
      payment_provider_id VARCHAR(100),
      idempotency_key     VARCHAR(100) NOT NULL UNIQUE,
      created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
    );

    CREATE TABLE order_items (
      order_id    BIGINT  NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
      seat_id     BIGINT  NOT NULL UNIQUE REFERENCES seats (id),
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      PRIMARY KEY (order_id, seat_id)
    );

    CREATE TABLE tickets (
      id        VARCHAR(30) PRIMARY KEY,
      order_id  BIGINT      NOT NULL,
      seat_id   BIGINT      NOT NULL,
      qr_code   VARCHAR(64) NOT NULL UNIQUE,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (order_id, seat_id) REFERENCES order_items (order_id, seat_id)
    );

### 4.4 Indexes

    -- Browsing: "events in Nairobi, next month, newest first".
    CREATE INDEX events_city_starts_idx ON events (city, starts_at);

    -- Loading a seat map for one event.
    CREATE INDEX seats_event_status_idx ON seats (event_id, status);

    -- The expiry sweeper: find holds whose time is up.
    CREATE INDEX seat_holds_expires_idx ON seat_holds (expires_at);

    -- A user's own orders.
    CREATE INDEX orders_user_created_idx ON orders (user_id, created_at DESC);

Reasons: `events_city_starts_idx` serves the main browse screen without
a sort step. `seats_event_status_idx` powers the seat-map read and the
"how many are left" badge. `seat_holds_expires_idx` makes the sweeper an
index range scan instead of a table scan. `orders_user_created_idx`
powers "my tickets".

### 4.5 Example queries

**1. The seat map for event 312:**

    SELECT id, section, row_label, seat_number, status, price_cents
    FROM seats
    WHERE event_id = 312
    ORDER BY section, row_label, seat_number;

**2. A user's tickets with their seat and event (multi-table JOIN):**

    SELECT
      t.id AS ticket_id,
      t.qr_code,
      e.name AS event_name,
      e.starts_at,
      s.section, s.row_label, s.seat_number
    FROM tickets AS t
    JOIN order_items AS oi ON oi.seat_id = t.seat_id
                           AND oi.order_id = t.order_id
    JOIN orders AS o       ON o.id = oi.order_id
    JOIN events AS e       ON e.id = o.event_id
    JOIN seats  AS s       ON s.id = oi.seat_id
    WHERE o.user_id = $1 AND o.status = 'paid'
    ORDER BY e.starts_at;

**3. How many of an event's seats have sold:**

    SELECT status, COUNT(*) FROM seats
    WHERE event_id = 312
    GROUP BY status;

**4. Sweep expired holds and release those seats:**

    BEGIN;

    UPDATE seats
    SET status = 'available'
    WHERE id IN (SELECT seat_id FROM seat_holds WHERE expires_at < now());

    DELETE FROM seat_holds WHERE expires_at < now();

    COMMIT;

### 4.6 Preventing double-booking

This is the point of the whole data model. Three layers, each backing up
the one above it.

**Layer 1 — the unique constraint is the referee.**
`seat_holds` has UNIQUE (seat_id). When two users race for seat 8842, the
hold endpoint runs **one** atomic INSERT:

    INSERT INTO seat_holds (id, seat_id, user_id, expires_at)
    VALUES ($1, $2, $3, now() + interval '10 minutes')
    ON CONFLICT (seat_id) DO NOTHING
    RETURNING id;

Whichever INSERT runs first wins. The second INSERT matches the unique
constraint and is rejected by Postgres in microseconds. **No
SELECT-then-INSERT race, no application-level lock to get wrong.** If the
RETURNING clause comes back empty, the app answers 409 — the seat is taken.

**Layer 2 — payment is a single transaction with its own unique guard.**
When the user pays, one transaction does all of this:

    BEGIN;

    -- 1. Claim the seats for this order. If any hold has already been
    --    used by a concurrent request, the UNIQUE (seat_id) on order_items
    --    rejects the duplicate and the whole transaction rolls back.
    INSERT INTO order_items (order_id, seat_id, price_cents)
    SELECT $order_id, sh.seat_id, s.price_cents
    FROM seat_holds AS sh
    JOIN seats AS s ON s.id = sh.seat_id
    WHERE sh.id = ANY($hold_ids) AND sh.user_id = $user_id;

    -- 2. Only if every insert succeeded, flip the seats to sold and remove
    --    their holds (which are now redundant).
    UPDATE seats SET status = 'sold'
    WHERE id IN (SELECT seat_id FROM order_items WHERE order_id = $order_id);

    DELETE FROM seat_holds WHERE id = ANY($hold_ids);

    COMMIT;

If two orders tried to claim the same seat (which can only happen if the
hold was already consumed), UNIQUE (seat_id) on `order_items` fires and
the whole transaction aborts. **No ticket is issued, no charge is made,
and the other user's order is unaffected.**

**Layer 3 — idempotency protects the payment call.**
`orders.idempotency_key` is UNIQUE. A retried POST /orders with the same
key returns the existing order and tickets rather than charging again.
Combined with the transaction above, a customer who refreshes the payment
page — or whose browser retries after a timeout — sees **the same order**
with **the same seats**, never a second one.

**Holds expire and are swept back to available** by a background job
running every 30 seconds (query 4 above). The seat lock is therefore
finite: a malicious or crashed client cannot hold a seat forever.

**The rule of thumb:** application code decides *whether* to try; the
database constraint decides *who wins*. That is why "two people bought the
same seat" is not a bug this design can have.

### 4.7 SQL vs NoSQL

Relational is the right choice here. The data is highly relational
(users↔orders↔seats↔tickets with hard foreign keys), and the core
invariant — **a seat can be in at most one active hold and at most one
order** — is exactly what a unique constraint and a multi-row transaction
enforce cheaply and reliably. A document database would push that
enforcement into application code, which is where double-booking bugs are
born. The load is also modest: ~5 GB/year of data and ~500 writes/s at
the biggest on-sale moment, which a single well-tuned Postgres instance
plus a read replica easily handles. There is no reason to give up ACID
guarantees here.

---

## 5. Architecture

### 5.1 Diagram

                            ┌──────────┐
                  ┌────────>│   DNS    │  tickethub.com
                  │         └──────────┘
                  │
       ┌──────────┴────────┐   HTML / CSS / JS / images   ┌──────────────────────┐
       │ Browser / mobile  │─────────────────────────────>│  CDN (Cloudflare)    │
       │ client            │<─────────────────────────────│  static + event art  │
       └──────────┬────────┘                              └──────────────────────┘
                  │ API requests (HTTPS, JSON)
                  v
          ┌──────────────────┐
          │ Load balancer    │  health checks + round robin
          └────────┬─────────┘
                   │
         ┌─────────┼───────────────┐
         v         v               v
     ┌───────┐ ┌───────┐       ┌───────┐
     │ App 1 │ │ App 2 │  ...  │ App N │   (stateless, autoscale 3–20)
     └──┬────┘ └──┬────┘       └──┬────┘
        │         │               │
        │  ┌──────┴──────┐        │
        │  │ Redis       │<───────┘   cache: event pages, seat-map snapshots,
        │  │             │            waiting-room counters, rate limits
        │  └─────────────┘
        │
        │  ┌──────────────────────────┐
        ├─>│ Virtual waiting room     │  (Redis-backed token queue)
        │  └──────────────────────────┘
        │
        │  ┌──────────────────────────┐
        ├─>│ Message queue (SQS)      │──>┌────────────────────────────┐
        │  └──────────────────────────┘   │ Worker: send ticket emails,│
        │                                 │ expire holds, refunds       │
        │                                 └────────────────────────────┘
        │
        v writes                          ┌──────────────────┐
     ┌──────────────────┐  replication   │ Read replicas    │
     │ Primary Postgres │───────────────>│ (×2)             │<── reads (browse,
     │ (all writes,     │                └──────────────────┘     seat map)
     │  holds, orders)  │
     └────────┬─────────┘
              │
              │ HTTPS (via SDK)
              v
     ┌────────────────────┐
     │ Payment provider   │  Stripe-style: charges card, sends webhook
     │ (external)         │  back to /webhooks/payment on our app tier
     └────────────────────┘

### 5.2 What each component solves

- **DNS** — turns tickethub.com into the IPs of the load balancer and the
  CDN so the browser knows where to connect.
- **CDN** — serves HTML/CSS/JS and the large event images from an edge
  server near each user; during a big sale the event page loads for
  200,000 people without ever touching our origin.
- **Load balancer** — spreads API traffic across app servers and drops
  any that fail a health check, so the app tier can grow and shrink with
  load (3 servers normally, up to ~20 during a big sale) and never has a
  single point of failure.
- **App servers (stateless, ×N)** — run the API code: auth, seat-map
  reads, the hold endpoint, the order transaction, and the
  payment-provider webhook handler. Statelessness is what lets the load
  balancer scale them freely.
- **Redis cache** — holds three kinds of thing: (1) event list and event
  detail responses, so the browse path is served from memory; (2) a
  short-lived (1–2 s) snapshot of the seat map for popular events, so
  thousands of users refreshing the seat map hit Redis instead of the
  database; (3) the **waiting-room state** (see below) and per-user rate
  limits.
- **Virtual waiting room (Redis-backed)** — the key new component.
  During the first ten minutes of a big sale, users who click "Buy"
  receive a waiting-room token and poll a lightweight endpoint every few
  seconds. The waiting room **admits users into the purchase flow at a
  controlled rate (target ~500/s)**. Everyone sees "you are number 4,381
  in line" and a fair ETA. 200,000 people still all *browse*, but only
  ~500 at a time attempt a hold, which is exactly the load the primary
  database is sized for. Without this component, 200,000 concurrent hold
  attempts would lock the database; with it, the primary sees a steady
  500 INSERTs/s until the 20,000 seats are sold (about 40 seconds of
  real holding traffic, comfortably inside the 10-minute window).
- **Primary Postgres** — the single source of truth. All writes (holds,
  orders, seat status changes) go here, so the unique constraints in
  section 4.6 are the final arbiter. Strong consistency on the money
  path lives here.
- **Read replicas (×2)** — serve the seat-map read and the browse read.
  During the sale, ~2,000 page views/s of the event page and ~500
  seat-map refreshes/s go to the replicas, not the primary. Replication
  lag is a few milliseconds; the seat map is allowed to be a second stale
  (see trade-off 2).
- **Message queue (SQS)** — decouples slow follow-up work from the
  request path: sending ticket emails with QR codes, cleaning up expired
  holds on a timer, processing refunds. The order endpoint returns as
  soon as the transaction commits; the worker sends the email a moment
  later.
- **Worker** — consumes the queue. Among other jobs it runs the
  **expiry sweep** (section 4.5 query 4) every 30 seconds, releasing
  expired holds back to available so a crashed client cannot hold a seat
  forever.
- **Payment provider (external, Stripe-style)** — charges the card. **We
  never see card numbers**, which removes us from most of PCI-DSS. The
  provider calls our webhook after a successful charge; the app tier
  consumes that webhook to run the order transaction from section 4.6.

### 5.3 Flow — normal day, GET /events/{id}/seats

1. Browser requests the page. DNS resolves to the load balancer, then the
   HTML comes from the CDN (already cached).
2. The seat-map API call goes to the load balancer, which forwards it to
   a healthy app server.
3. The app server checks Redis for `seats:event:312`.
   - Hit: return it (~2 ms). Done.
   - Miss: continue.
4. On a miss, it queries a read replica using `seats_event_status_idx`
   (~5–20 ms) and stores the result in Redis with a 1-second TTL.
5. The response is returned; the client renders the seat map.

On a normal day, almost every request after the first one in any given
second is a cache hit. The database is nearly idle.

### 5.4 Flow — the big sale, POST /seats/{id}/hold and POST /orders

This is the flow the design is really built for.

**T-0: sale opens.** 200,000 users all click "Buy". All of them get a
waiting-room token from the app server (backed by Redis INCR + EXPIRE).
Their browser polls GET /queue/status every 3 seconds. Requests to
POST /seats/{id}/hold from a user still in the queue are rejected with
429 Too Many Requests and a Retry-After header.

**Admission (T+0 to T+40s).** The waiting room admits ~500 users/s into
the purchase flow, in the order they joined (or randomised if we want to
make bot-farming harder — see trade-off 3). Each admitted user:

1. Views the seat map. GET /events/312/seats — served from
   Redis/read replica, refreshed every 1 s.
2. Picks a seat and calls POST /seats/8842/hold. The app server runs the
   atomic INSERT from section 4.6. **500 of these run per second against
   the primary**, all short (sub-5 ms). The first 20,000 to succeed get a
   hold; the rest get 409 and go back to step 1 to try another seat.
3. Pays via the payment provider's SDK on the client, then calls
   POST /orders with the hold ids + payment token + idempotency key. The
   app server runs the transaction from section 4.6, issues tickets, and
   pushes the "email tickets" job onto the queue.

**Drain (T+40s to T+10min).** The remaining ~180,000 users see the seat
map without any available seats and are shown "sold out" (cached in
Redis, so it is a single DB read for everyone). All hold attempts from
here answer 409 quickly.

**Failure handling.** If an app server dies at T+20s, the load balancer
drops it and auto-scaling replaces it; other servers absorb its share of
the queue. If a user's hold expires (10 min TTL) before they pay, the
worker sweeps the seat back to available on its next 30-second tick —
new buyers can grab it and the fair-use guarantee holds. If the payment
provider times out after a successful charge, the client retries
POST /orders with the same idempotency key and gets the same order back
— **no double charge**.

**What makes this survive the big sale, in one sentence:** the primary
database never sees more than 500 short INSERTs/s because the waiting
room is the throttle, and every hold attempt is a single atomic INSERT
that the unique constraint either accepts or rejects — never a lock the
app has to manage.

### 5.5 Single points of failure

| Potential SPOF | How it is removed |
|----------------|-------------------|
| One app server | Multiple stateless servers behind the load balancer; auto-scaling replaces a failed one within a minute. |
| The load balancer | A managed, replicated LB (ELB / Cloudflare) that is itself health-checked. |
| The Redis cache | Cache-down means slower reads (fall through to the read replica), not a broken site — **graceful degradation**. The waiting-room state is also backed by Postgres so a Redis restart does not lose tickets already sold. |
| The primary database | A hot standby that is promoted on failure (failover). All writes were committed to WAL on the standby before acknowledgement. |
| The queue | A managed, replicated queue (SQS) that stores jobs durably until confirmed. |
| The payment provider | We retry idempotently; if the provider is down, orders stay pending and we alert. Users see "payment is being confirmed" rather than a lost order. |
| DNS / CDN | Multiple authoritative name servers / anycast CDN. |
| The whole region | Nightly backups plus point-in-time recovery into a second region. |

---

## 6. Trade-offs

### Trade-off 1 — Correctness over availability on the hold path

On the hold and pay path we choose **strong consistency over
availability**. When a seat is contested, exactly one user wins and the
other gets a 409 — the system refuses the request rather than handing out
a possibly-duplicate seat. That is the right choice for a ticketing
system because a double-booked seat is not just a bug, it is a refund, a
support ticket, and lost trust. The cost is that during the big sale,
~90% of hold attempts return a 409 (because the seats are simply gone) —
users see "that seat is taken, try another" and must retry. We accept
that friction because the alternative (best-effort booking) is
unacceptable. Contrast with a banking app: correctness is *even more*
important there, but for a completely different reason (money moves). For
a photo feed, this would be over-engineering — eventual consistency is
fine there. The design matches the cost of getting it wrong.

### Trade-off 2 — Freshness of the seat map vs database load

The seat map shown to a browsing user is allowed to be **up to 1 second
out of date**. It is served from a Redis snapshot refreshed from a read
replica every second. During the big sale this is what lets 500 seat-map
refreshes/s hit Redis instead of 500 SELECTs/s against the primary — the
primary's write capacity is precious in those ten minutes, and spending
it on reads would starve the holds and orders that actually matter. The
cost is that two users can briefly see the same seat as "available",
click hold at the same moment, and one of them gets a 409. **This is a
cosmetic problem, not a correctness one**, because the hold endpoint and
the order transaction are the true arbiters. If we wanted zero stale
reads, we would read the seat map from the primary too, and the primary
would fall over.

### Trade-off 3 — Waiting room queueing policy: FIFO vs randomised

The virtual waiting room can admit users in **first-come-first-served**
order (FIFO) or in **random batches** drawn from everyone who arrived
before the sale started. FIFO is the honest, predictable choice — users
who arrived early are rewarded and the "you are #4,381 in line" message
is meaningful. The cost is that **automated bots that click at T-0 will
still beat humans** to the front. Randomised admission removes the bot
advantage, at the cost of feeling less fair to a user who joined the
queue at T-10 minutes. We choose **FIFO with aggressive bot detection**
(device fingerprinting, per-IP rate limits, CAPTCHA on the queue-join
endpoint) as the best balance. The trade is a small fair-play advantage
for scripted buyers versus an intuitive, honest-feeling queue for humans.

### Trade-off 4 (bonus) — Payment provider as an external dependency

Delegating card processing to Stripe-style providers means we take on a
network dependency at the worst possible moment (the payment call).
Retries with idempotency keys and a queue-backed webhook cover the common
failure modes; the residual risk is that during a rare provider outage,
customers cannot complete a purchase. The alternative — implementing card
processing ourselves — is enormously more expensive, requires PCI-DSS
compliance, and would be less secure. **Buying this capability is clearly
correct.**

---

## 7. What this design does *not* try to do (non-goals)

To keep scope honest:

- **No microservices.** One well-organised monolith serves the API.
  Splitting auth, events, holds and payments into separate services would
  multiply the number of places the double-booking guard has to be
  correct. Split later, if a specific pain point appears.
- **No sharding.** ~5 GB/year and 500 writes/s at peak do not need it. A
  single primary plus replicas is enough at 2 million users.
- **No seat resale / transfer** in v1. Tickets are bound to the buying
  account.
- **No dynamic pricing.** All seat prices are fixed at event-creation
  time. (A legitimate future feature, but not part of this design.)