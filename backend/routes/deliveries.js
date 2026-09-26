const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');

module.exports = (db) => {

    // CREATE a delivery (Draft) with items
    // body: { customer_name, warehouse_id, reference, items: [{ product_id, quantity }] }
    router.post('/', requireAuth, (req, res) => {
        const { customer_name, warehouse_id, reference, items } = req.body;
        const created_by = req.user.id;

        if (!customer_name || !warehouse_id || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'customer_name, warehouse_id and at least one item are required' });
        }

        const query = 'INSERT INTO deliveries (reference, customer_name, warehouse_id, status, created_by) VALUES (?, ?, ?, ?, ?)';
        db.query(query, [reference || null, customer_name, warehouse_id, 'Draft', created_by], (err, result) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }

            const deliveryId = result.insertId;
            const itemValues = items.map(item => [deliveryId, item.product_id, item.quantity]);

            db.query('INSERT INTO delivery_items (delivery_id, product_id, quantity) VALUES ?', [itemValues], (err2) => {
                if (err2) {
                    return res.status(500).json({ message: 'Database error', error: err2.message });
                }
                res.status(201).json({ message: 'Delivery created', deliveryId });
            });
        });
    });

    // GET all deliveries
    router.get('/', (req, res) => {
        db.query('SELECT * FROM deliveries ORDER BY created_at DESC', (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            res.json(results);
        });
    });

    // GET a single delivery with its items
    router.get('/:id', (req, res) => {
        db.query('SELECT * FROM deliveries WHERE id = ?', [req.params.id], (err, deliveryResults) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (deliveryResults.length === 0) {
                return res.status(404).json({ message: 'Delivery not found' });
            }

            const itemsQuery = `
                SELECT di.id, di.product_id, p.name, p.sku, p.unit, di.quantity
                FROM delivery_items di
                JOIN products p ON p.id = di.product_id
                WHERE di.delivery_id = ?
            `;
            db.query(itemsQuery, [req.params.id], (err2, itemResults) => {
                if (err2) {
                    return res.status(500).json({ message: 'Database error', error: err2.message });
                }
                res.json({ ...deliveryResults[0], items: itemResults });
            });
        });
    });

    // Mark a draft delivery as packed
    router.put('/:id/pack', requireAuth, (req, res) => {
        db.query("UPDATE deliveries SET status = 'Packed' WHERE id = ? AND status = 'Draft'", [req.params.id], (err, result) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (result.affectedRows === 0) {
                return res.status(409).json({ message: 'Delivery must be in Draft status to be packed' });
            }
            res.json({ message: 'Delivery marked as packed' });
        });
    });

    // VALIDATE a delivery -> stock decreases at the delivery's warehouse, checked
    // against availability first, logged in stock_ledger.
    router.put('/:id/validate', requireAuth, (req, res) => {
        const deliveryId = req.params.id;

        db.query('SELECT * FROM deliveries WHERE id = ?', [deliveryId], (err, deliveryResults) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (deliveryResults.length === 0) {
                return res.status(404).json({ message: 'Delivery not found' });
            }
            const delivery = deliveryResults[0];
            if (delivery.status === 'Done') {
                return res.status(409).json({ message: 'Delivery already validated' });
            }

            db.query('SELECT * FROM delivery_items WHERE delivery_id = ?', [deliveryId], (err2, items) => {
                if (err2) {
                    return res.status(500).json({ message: 'Database error', error: err2.message });
                }
                if (items.length === 0) {
                    return res.status(400).json({ message: 'Delivery has no items' });
                }

                const checkStock = (index, done) => {
                    if (index === items.length) return done();
                    const item = items[index];
                    db.query(
                        'SELECT quantity FROM product_stock WHERE product_id = ? AND warehouse_id = ?',
                        [item.product_id, delivery.warehouse_id],
                        (errCheck, rows) => {
                            if (errCheck) {
                                return res.status(500).json({ message: 'Database error', error: errCheck.message });
                            }
                            const available = rows.length ? rows[0].quantity : 0;
                            if (available < item.quantity) {
                                return res.status(409).json({
                                    message: `Insufficient stock for product ${item.product_id} at this warehouse (have ${available}, need ${item.quantity})`
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
                                db.query("UPDATE deliveries SET status = 'Done' WHERE id = ?", [deliveryId], (err3) => {
                                    if (err3) {
                                        return db.rollback(() => res.status(500).json({ message: 'Database error', error: err3.message }));
                                    }
                                    db.commit((commitErr) => {
                                        if (commitErr) {
                                            return db.rollback(() => res.status(500).json({ message: 'Commit error', error: commitErr.message }));
                                        }
                                        res.json({ message: 'Delivery validated, stock updated' });
                                    });
                                });
                                return;
                            }

                            const item = items[index];

                            db.query('UPDATE products SET current_stock = current_stock - ? WHERE id = ?', [item.quantity, item.product_id], (err4) => {
                                if (err4) {
                                    return db.rollback(() => res.status(500).json({ message: 'Database error', error: err4.message }));
                                }

                                db.query(
                                    'UPDATE product_stock SET quantity = quantity - ? WHERE product_id = ? AND warehouse_id = ?',
                                    [item.quantity, item.product_id, delivery.warehouse_id],
                                    (errStock) => {
                                        if (errStock) {
                                            return db.rollback(() => res.status(500).json({ message: 'Database error', error: errStock.message }));
                                        }

                                        const ledgerQuery = `
                                            INSERT INTO stock_ledger (product_id, warehouse_id, change_qty, reason, reference_type, reference_id)
                                            VALUES (?, ?, ?, 'delivery', 'delivery', ?)
                                        `;
                                        db.query(ledgerQuery, [item.product_id, delivery.warehouse_id, -item.quantity, deliveryId], (err5) => {
                                            if (err5) {
                                                return db.rollback(() => res.status(500).json({ message: 'Database error', error: err5.message }));
                                            }
                                            applyItem(index + 1);
                                        });
                                    }
                                );
                            });
                        };

                        applyItem(0);
                    });
                });
            });
        });
    });

    // DELETE a draft delivery (can't delete once validated)
    router.delete('/:id', requireAuth, (req, res) => {
        db.query('SELECT status FROM deliveries WHERE id = ?', [req.params.id], (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (results.length === 0) {
                return res.status(404).json({ message: 'Delivery not found' });
            }
            if (results[0].status === 'Done') {
                return res.status(409).json({ message: 'Cannot delete a validated delivery' });
            }
            db.query('DELETE FROM deliveries WHERE id = ?', [req.params.id], (err2) => {
                if (err2) {
                    return res.status(500).json({ message: 'Database error', error: err2.message });
                }
                res.json({ message: 'Delivery deleted' });
            });
        });
    });

    return router;
};
