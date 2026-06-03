# API — 01 Authentication

All authenticated endpoints expect:

```
Authorization: Bearer <JWT>
```

The JWT payload includes `sub` (employee ID), `role`, `vendor_id`, `exp`.

## Endpoints

### `POST /admin-login`

Authenticate an admin / MD / HR / production-head user.

**Request:**
```json
{ "EMAIL": "admin@bvc24.in", "PASSWORD": "..." }
```

**Response 200:**
```json
{
  "access_token": "<JWT>",
  "token_type": "bearer",
  "employee": { "ID": "...", "NAME": "Admin", "ROLE": "ADMIN", ... }
}
```

**Errors:** 401 invalid credentials.

### `POST /login`

Alias for `/admin-login` (backward compatibility).

### `POST /employee-login`

Authenticate a floor employee using `EMPLOYEE_CODE`.

**Request:**
```json
{ "EMPLOYEE_CODE": "EMP001", "PASSWORD": "..." }
```

**Response:** same shape as `/admin-login`.

### `POST /employee-logout`

Server-side housekeeping (the actual logout is removal of `localStorage.token` on the client).

### `GET /me`

Verifies the bearer token. Returns the decoded payload + the employee row.

**Response 200:**
```json
{
  "employee_id": "...",
  "name": "...",
  "role": "ADMIN",
  "vendor_id": 1
}
```

**Errors:** 401 if token missing / expired / invalid.

## Token Lifecycle

- **Issued at:** `/admin-login` or `/employee-login`.
- **Default expiry:** 7 days (configurable in `jwt_handler.py`).
- **Refresh:** none — client redirects to `/login` on 401.
- **Signing alg:** HS256 with `SECRET_KEY`.

See [Security & Authentication](../05-security-and-authentication.md) for the full security model.

---

Next: [02 — Organization](./02-organization.md)
