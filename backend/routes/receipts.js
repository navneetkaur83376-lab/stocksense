const express = require('express');
const router = express.Router();

module.exports = (db) => {

    // CREATE a receipt (draft) with items
    // body: { supplier_name, warehouse_id, items: [{ product_id, quantity }] }
    router.post('/', (req, res) => {
        const { supplier_name, warehouse_id, items } = req.body;

        if (!supplier_name || !warehouse_id || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'supplier_name, warehouse_id and at least one item are required' });
        }

        const receiptQuery = 'INSERT INTO receipts (supplier_name, warehouse_id, status) VALUES (?, ?, ?)';
        db.query(receiptQuery, [supplier_name, warehouse_id, 'draft'], (err, result) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }

            const receiptId = result.insertId;
            const itemValues = items.map(item => [receiptId, item.product_id, item.quantity]);

            db.query('INSERT INTO receipt_items (receipt_id, product_id, quantity) VALUES ?', [itemValues], (err2) => {
                if (err2) {
                    return res.status(500).json({ message: 'Database error', error: err2.message });
                }
                res.status(201).json({ message: 'Receipt created', receiptId });
            });
        });
    });

    // GET all receipts
    router.get('/', (req, res) => {
        db.query('SELECT * FROM receipts ORDER BY created_at DESC', (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            res.json(results);
        });
    });

    // GET a single receipt with its items
    router.get('/:id', (req, res) => {
        db.query('SELECT * FROM receipts WHERE id = ?', [req.params.id], (err, receiptResults) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (receiptResults.length === 0) {
                return res.status(404).json({ message: 'Receipt not found' });
            }

            const itemsQuery = `
                SELECT ri.id, ri.product_id, p.name, p.sku, ri.quantity
                FROM receipt_items ri
                JOIN products p ON p.id = ri.product_id
                WHERE ri.receipt_id = ?
            `;
            db.query(itemsQuery, [req.params.id], (err2, itemResults) => {
                if (err2) {
                    return res.status(500).json({ message: 'Database error', error: err2.message });
                }
                res.json({ ...receiptResults[0], items: itemResults });
            });
        });
    });

    // VALIDATE a receipt -> stock increases automatically, logged in the ledger
    router.put('/:id/validate', (req, res) => {
        const receiptId = req.params.id;

        db.query('SELECT * FROM receipts WHERE id = ?', [receiptId], (err, receiptResults) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (receiptResults.length === 0) {
                return res.status(404).json({ message: 'Receipt not found' });
            }
            const receipt = receiptResults[0];
            if (receipt.status === 'done') {
                return res.status(409).json({ message: 'Receipt already validated' });
            }

            db.query('SELECT * FROM receipt_items WHERE receipt_id = ?', [receiptId], (err2, items) => {
                if (err2) {
                    return res.status(500).json({ message: 'Database error', error: err2.message });
                }
                if (items.length === 0) {
                    return res.status(400).json({ message: 'Receipt has no items' });
                }

                db.beginTransaction((txErr) => {
                    if (txErr) {
                        return res.status(500).json({ message: 'Transaction error', error: txErr.message });
                    }

                    const applyItem = (index) => {
                        if (index === items.length) {
                            db.query('UPDATE receipts SET status = ? WHERE id = ?', ['done', receiptId], (err3) => {
                                if (err3) {
                                    return db.rollback(() => res.status(500).json({ message: 'Database error', error: err3.message }));
                                }
                                db.commit((commitErr) => {
                                    if (commitErr) {
                                        return db.rollback(() => res.status(500).json({ message: 'Commit error', error: commitErr.message }));
                                    }
                                    res.json({ message: 'Receipt validated, stock updated' });
                                });
                            });
                            return;
                        }

                        const item = items[index];

                        // Add to (or create) this product's stock at this warehouse
                        const upsertQuery = `
                            INSERT INTO product_stock (product_id, warehouse_id, quantity)
                            VALUES (?, ?, ?)
                            ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
                        `;
                        db.query(upsertQuery, [item.product_id, receipt.warehouse_id, item.quantity], (err4) => {
                            if (err4) {
                                return db.rollback(() => res.status(500).json({ message: 'Database error', error: err4.message }));
                            }

                            // Keep products.current_stock as the running total across all warehouses
                            db.query('UPDATE products SET current_stock = current_stock + ? WHERE id = ?', [item.quantity, item.product_id], (err5) => {
                                if (err5) {
                                    return db.rollback(() => res.status(500).json({ message: 'Database error', error: err5.message }));
                                }

                                const ledgerQuery = `
                                    INSERT INTO stock_ledger (product_id, warehouse_id, change_qty, reason, reference_type, reference_id)
                                    VALUES (?, ?, ?, 'receipt', 'receipt', ?)
                                `;
                                db.query(ledgerQuery, [item.product_id, receipt.warehouse_id, item.quantity, receiptId], (err6) => {
                                    if (err6) {
                                        return db.rollback(() => res.status(500).json({ message: 'Database error', error: err6.message }));
                                    }
                                    applyItem(index + 1);
                                });
                            });
                        });
                    };

                    applyItem(0);
                });
            });
        });
    });

    // DELETE a draft receipt (can't delete once validated)
    router.delete('/:id', (req, res) => {
        db.query('SELECT status FROM receipts WHERE id = ?', [req.params.id], (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (results.length === 0) {
                return res.status(404).json({ message: 'Receipt not found' });
            }
            if (results[0].status === 'done') {
                return res.status(409).json({ message: 'Cannot delete a validated receipt' });
            }
            db.query('DELETE FROM receipts WHERE id = ?', [req.params.id], (err2) => {
                if (err2) {
                    return res.status(500).json({ message: 'Database error', error: err2.message });
                }
                res.json({ message: 'Receipt deleted' });
            });
        });
    });

    return router;
};