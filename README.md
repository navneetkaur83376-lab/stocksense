# StockSense

A working inventory management system: products, warehouses, receiving,
delivery orders, inter-warehouse transfers, stock adjustments, and a full
audit ledger — with a login screen and a single-page dashboard UI.

## Stack

- **Backend:** Node.js + Express + MySQL (`mysql2`), JWT auth (`jsonwebtoken`, `bcrypt`)
- **Frontend:** Plain HTML/CSS/JS, served by the same Express server (no build step)

## Project layout

```
backend/
  index.js            # server entry point, wires routes + serves the frontend
  schema.sql           # full database schema — run this once
  middleware/auth.js    # JWT verification middleware
  routes/
    auth.js             # signup / login / me
    products.js          # product CRUD + per-warehouse stock breakdown
    warehouses.js         # warehouse CRUD + utilization
    receipts.js            # inbound stock (supplier -> warehouse)
    deliveries.js            # outbound stock (warehouse -> customer)
    transfers.js              # warehouse -> warehouse moves
    adjustments.js             # physical count reconciliation
    ledger.js                   # unified audit trail
    dashboard.js                 # KPI summary for the dashboard
static/
  style.css, script.js   # frontend styling + API client / rendering logic
templates/
  index.html            # the single page app (login screen + dashboard)
```

## Setup

### 1. Install MySQL (or MariaDB) and Node.js

You need a running MySQL/MariaDB server and Node 18+.

### 2. Create the database

```bash
mysql -u root -p < backend/schema.sql
```

This creates the `stocksense` database and all tables.

### 3. Configure environment variables

Edit `backend/.env` (already present, adjust as needed):

```
PORT=5000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=stocksense
JWT_SECRET=change_this_to_something_random_and_long
```

**Change `JWT_SECRET` before deploying anywhere real** — the shipped value
is a placeholder.

### 4. Install dependencies and run

```bash
cd backend
npm install
npm start        # runs `nodemon index.js`
```

Or for a plain run without nodemon:

```bash
node index.js
```

### 5. Open the app

Visit **http://localhost:5000** — you'll land on the login screen. Click
"Sign up" to create the first account, then log in.

## How the data model works

- `products.current_stock` is always the sum of a product's stock across every
  warehouse. It's kept in sync automatically by every operation below.
- `product_stock` holds the actual per-warehouse breakdown (product × warehouse → quantity).
- **Receiving** a receipt credits stock to the receipt's warehouse.
- **Delivering** an order checks the source warehouse has enough stock, then debits it.
- **Transferring** moves stock from one warehouse's row to another's — the total is unchanged.
- **Adjusting** compares a physical count to the recorded quantity at a warehouse and applies the difference.
- Every one of the above writes a row to `stock_ledger`, which is what powers the Stock Ledger view and the dashboard's recent-activity feed.

## API summary

All endpoints are under `/api`. GET endpoints are public; every write
(`POST`/`PUT`/`DELETE`, except `/auth/signup` and `/auth/login`) requires
`Authorization: Bearer <token>` from `/api/auth/login`.

| Method              | Path                                                                      | Purpose                            |
| ------------------- | ------------------------------------------------------------------------- | ---------------------------------- |
| POST                | `/auth/signup`, `/auth/login`                                             | account creation / login           |
| GET                 | `/auth/me`                                                                | verify a stored token              |
| GET/POST/PUT/DELETE | `/products`                                                               | product CRUD                       |
| GET                 | `/products/stock/breakdown`                                               | every product × warehouse quantity |
| GET                 | `/products/:id/stock`                                                     | one product's stock by warehouse   |
| GET/POST/PUT/DELETE | `/warehouses`                                                             | warehouse CRUD                     |
| POST                | `/receipts`, `PUT /receipts/:id/validate`                                 | receive stock                      |
| POST                | `/deliveries`, `PUT /deliveries/:id/pack`, `PUT /deliveries/:id/validate` | deliver stock                      |
| POST                | `/transfers`, `PUT /transfers/:id/validate`                               | move stock between warehouses      |
| POST                | `/adjustments`                                                            | reconcile a physical count         |
| GET                 | `/ledger`                                                                 | audit trail                        |
| GET                 | `/dashboard/summary`                                                      | KPI numbers for the dashboard      |

## Notes

- This was tested end-to-end (signup → login → create warehouses/products →
  receive → transfer → deliver → adjust → verify ledger and dashboard totals)
  against a live MySQL instance before delivery.
- `backend/.env` is in `.gitignore` — don't commit real credentials.
