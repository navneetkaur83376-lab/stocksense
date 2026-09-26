const express = require('express');
const router = express.Router();

module.exports = (db) => {

    // CREATE a transfer (draft) with items
    // body: { from_warehouse_id, to_warehouse_id, items: [{ product_id, quantity }] }
    router.post('/', (req, res) => {
        const { from_warehouse_id, to_warehouse_id, items } = req.body;

        if (!from_warehouse_id || !to_warehouse_id || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'from_warehouse_id, to_warehouse_id and at least one item are required' });
        }
        if (from_warehouse_id === to_warehouse_id) {
            return res.status(400).json({ message: 'from_warehouse_id and to_warehouse_id must be different' });
        }

        const transferQuery = 'INSERT INTO transfers (from_warehouse_id, to_warehouse_id, status) VALUES (?, ?, ?)';
        db.query(transferQuery, [from_warehouse_id, to_warehouse_id, 'draft'], (err, result) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }

            const transferId = result.insertId;
            const itemValues = items.map(item => [transferId, item.product_id, item.quantity]);

            db.query('INSERT INTO transfer_items (transfer_id, product_id, quantity) VALUES ?', [itemValues], (err2) => {
                if (err2) {
                    return res.status(500).json({ message: 'Database error', error: err2.message });
                }
                res.status(201).json({ message: 'Transfer created', transferId });
            });
        });
    });

    // GET all transfers
    router.get('/', (req, res) => {
        db.query('SELECT * FROM transfers ORDER BY created_at DESC', (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            res.json(results);
        });
    });

    // GET a single transfer with its items
    router.get('/:id', (req, res) => {
        db.query('SELECT * FROM transfers WHERE id = ?', [req.params.id], (err, transferResults) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (transferResults.length === 0) {
                return res.status(404).json({ message: 'Transfer not found' });
            }

            const itemsQuery = `
                SELECT ti.id, ti.product_id, p.name, p.sku, ti.quantity
                FROM transfer_items ti
                JOIN products p ON p.id = ti.product_id
                WHERE ti.transfer_id = ?
            `;
            db.query(itemsQuery, [req.params.id], (err2, itemResults) => {
                if (err2) {
                    return res.status(500).json({ message: 'Database error', error: err2.message });
                }
                res.json({ ...transferResults[0], items: itemResults });
            });
        });
    });

    // VALIDATE a transfer -> stock moves between warehouses, total unchanged, logged in the ledger
    router.put('/:id/validate', (req, res) => {
        const transferId = req.params.id;

        db.query('SELECT * FROM transfers WHERE id = ?', [transferId], (err, transferResults) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (transferResults.length === 0) {
                return res.status(404).json({ message: 'Transfer not found' });
            }
            const transfer = transferResults[0];
            if (transfer.status === 'done') {
                return res.status(409).json({ message: 'Transfer already validated' });
            }

            db.query('SELECT * FROM transfer_items WHERE transfer_id = ?', [transferId], (err2, items) => {
                if (err2) {
                    return res.status(500).json({ message: 'Database error', error: err2.message });
                }
                if (items.length === 0) {
                    return res.status(400).json({ message: 'Transfer has no items' });
                }

                // Make sure the source warehouse actually has enough of each item first
                const checkStock = (index, done) => {
                    if (index === items.length) return done();
                    const item = items[index];
                    db.query(
                        'SELECT quantity FROM product_stock WHERE product_id = ? AND warehouse_id = ?',
                        [item.product_id, transfer.from_warehouse_id],
                        (errCheck, rows) => {
                            if (errCheck) {
                                return res.status(500).json({ message: 'Database error', error: errCheck.message });
                            }
                            const available = rows.length ? rows[0].quantity : 0;
                            if (available < item.quantity) {
                                return res.status(409).json({
                                    message: `Insufficient stock for product ${item.product_id} at source warehouse (have ${available}, need ${item.quantity})`
                                });
                            }
                            checkStock(index + 1, done);
                        }
                    );
                };

                checkStock(0, () => {
                    db.beginTransaction((txErr) => {
                        if (txErr) {
                            return res.status(500).json({ message: 'Transaction error', error: txErr.message });
                        }

                        const applyItem = (index) => {
                            if (index === items.length) {
                                db.query('UPDATE transfers SET status = ? WHERE id = ?', ['done', transferId], (err3) => {
                                    if (err3) {
                                        return db.rollback(() => res.status(500).json({ message: 'Database error', error: err3.message }));
                                    }
                                    db.commit((commitErr) => {
                                        if (commitErr) {
                                            return db.rollback(() => res.status(500).json({ message: 'Commit error', error: commitErr.message }));
                                        }
                                        res.json({ message: 'Transfer validated, stock moved' });
                                    });
                                });
                                return;
                            }

                            const item = items[index];

                            // Decrease at source warehouse
                            db.query(
                                'UPDATE product_stock SET quantity = quantity - ? WHERE product_id = ? AND warehouse_id = ?',
                                [item.quantity, item.product_id, transfer.from_warehouse_id],
                                (errDec) => {
                                    if (errDec) {
                                        return db.rollback(() => res.status(500).json({ message: 'Database error', error: errDec.message }));
                                    }

                                    // Increase (or create) at destination warehouse
                                    const upsertQuery = `
                                        INSERT INTO product_stock (product_id, warehouse_id, quantity)
                                        VALUES (?, ?, ?)
                                        ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
                                    `;
                                    db.query(upsertQuery, [item.product_id, transfer.to_warehouse_id, item.quantity], (errInc) => {
                                        if (errInc) {
                                            return db.rollback(() => res.status(500).json({ message: 'Database error', error: errInc.message }));
                                        }

                                        // Note: products.current_stock is NOT changed here -
                                        // total stock stays the same, only location changes.
                                        const ledgerOut = `
                                            INSERT INTO stock_ledger (product_id, warehouse_id, change_qty, reason, reference_type, reference_id)
                                            VALUES (?, ?, ?, 'transfer_out', 'transfer', ?)
                                        `;
                                        db.query(ledgerOut, [item.product_id, transfer.from_warehouse_id, -item.quantity, transferId], (errLedgerOut) => {
                                            if (errLedgerOut) {
                                                return db.rollback(() => res.status(500).json({ message: 'Database error', error: errLedgerOut.message }));
                                            }

                                            const ledgerIn = `
                                                INSERT INTO stock_ledger (product_id, warehouse_id, change_qty, reason, reference_type, reference_id)
                                                VALUES (?, ?, ?, 'transfer_in', 'transfer', ?)
                                            `;
                                            db.query(ledgerIn, [item.product_id, transfer.to_warehouse_id, item.quantity, transferId], (errLedgerIn) => {
                                                if (errLedgerIn) {
                                                    return db.rollback(() => res.status(500).json({ message: 'Database error', error: errLedgerIn.message }));
                                                }
                                                applyItem(index + 1);
                                            });
                                        });
                                    });
                                }
                            );
                        };

                        applyItem(0);
                    });
                });
            });
        });
    });

    // DELETE a draft transfer (can't delete once validated)
    router.delete('/:id', (req, res) => {
        db.query('SELECT status FROM transfers WHERE id = ?', [req.params.id], (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (results.length === 0) {
                return res.status(404).json({ message: 'Transfer not found' });
            }
            if (results[0].status === 'done') {
                return res.status(409).json({ message: 'Cannot delete a validated transfer' });
            }
            db.query('DELETE FROM transfers WHERE id = ?', [req.params.id], (err2) => {
                if (err2) {
                    return res.status(500).json({ message: 'Database error', error: err2.message });
                }
                res.json({ message: 'Transfer deleted' });
            });
        });
    });

    return router;
};