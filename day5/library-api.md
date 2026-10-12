# Library API Design

A REST API for a library's **books** resource. All requests and responses use JSON, and every endpoint is under `/books`.

## The book resource

- `id`: number, assigned by the server
- `title`: string, required
- `author`: string, required
- `isbn`: string
- `publishedYear`: number
- `available`: boolean, true when the book is on the shelf

Example:

```json
{
  "id": 12,
  "title": "Things Fall Apart",
  "author": "Chinua Achebe",
  "isbn": "9780385474542",
  "publishedYear": 1958,
  "available": true
}
```

## Endpoints

### 1. List all books

- **Method:** GET
- **Path:** `/books`
- **Description:** Returns every book in the library.
- **Request body:** none
- **Success status:** 200 OK

### 2. Get one book

- **Method:** GET
- **Path:** `/books/{id}`, for example `/books/12`
- **Description:** Returns the single book with that id.
- **Request body:** none
- **Success status:** 200 OK

### 3. Create a book

- **Method:** POST
- **Path:** `/books`
- **Description:** Adds a new book to the library. The server assigns the id and returns the created book.
- **Request body:**

```json
{
  "title": "Weep Not, Child",
  "author": "Ngugi wa Thiong'o",
  "isbn": "9780435908300",
  "publishedYear": 1964
}
```

- **Success status:** 201 Created

### 4. Replace a book

- **Method:** PUT
- **Path:** `/books/{id}`
- **Description:** Replaces the whole book with the new version. Every field must be sent.
- **Request body:**

```json
{
  "title": "Weep Not, Child",
  "author": "Ngugi wa Thiong'o",
  "isbn": "9780435908300",
  "publishedYear": 1964,
  "available": true
}
```

- **Success status:** 200 OK

### 5. Update part of a book

- **Method:** PATCH
- **Path:** `/books/{id}`
- **Description:** Changes only the fields that are sent, for example marking a book as borrowed.
- **Request body:**

```json
{
  "available": false
}
```

- **Success status:** 200 OK

### 6. Delete a book

- **Method:** DELETE
- **Path:** `/books/{id}`
- **Description:** Removes the book from the library.
- **Request body:** none
- **Success status:** 204 No Content

### 7. List books by an author

- **Method:** GET
- **Path:** `/books?author=Chinua%20Achebe`
- **Description:** Returns only the books written by that author. The author name is sent as a query parameter after the `?`.
- **Request body:** none
- **Success status:** 200 OK (an empty list `[]` if the author has no books)

## Error codes

### 400 Bad Request

The request itself is invalid.

- `POST /books` with a body that has no `title`, or with an empty `title`.
- `PATCH /books/12` with `"publishedYear": "last year"` instead of a number.
- `PUT /books/12` with a body that is not valid JSON.

### 404 Not Found

The book or the URL does not exist.

- `GET /books/9999` when no book has the id 9999.
- `DELETE /books/9999` for a book that was already deleted.
- `PATCH /books/9999` for a book that does not exist.
