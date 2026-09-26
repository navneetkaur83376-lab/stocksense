const express = require('express');
const router = express.Router();

module.exports = (db) => {

    // CREATE a receipt (Draft) with items
    // body: { supplier_name, warehouse_id, created_by (optional), items: [{ product_id, quantity }] }
    router.post('/', (req, res) => {
        const { supplier_name, warehouse_id, created_by, items } = req.body;

        if (!supplier_name || !warehouse_id || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'supplier_name, warehouse_id and at least one item are required' });
        }

        const receiptQuery = 'INSERT INTO receipts (supplier_name, warehouse_id, status, created_by) VALUES (?, ?, ?, ?)';
        db.query(receiptQuery, [supplier_name, warehouse_id, 'Draft', created_by || null], (err, result) => {
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

    // VALIDATE a receipt -> stock increases automatically, logged in stock_ledger
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
            if (receipt.status === 'Done') {
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
                            db.query('UPDATE receipts SET status = ? WHERE id = ?', ['Done', receiptId], (err3) => {
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

                        // Keep products.current_stock as the running total across all warehouses
                        db.query('UPDATE products SET current_stock = current_stock + ? WHERE id = ?', [item.quantity, item.product_id], (err4) => {
                            if (err4) {
                                return db.rollback(() => res.status(500).json({ message: 'Database error', error: err4.message }));
                            }

                            const ledgerQuery = `
                                INSERT INTO stock_ledger (product_id, location_id, qty_change, reason, ref_id)
                                VALUES (?, ?, ?, 'receipt', ?)
                            `;
                            db.query(ledgerQuery, [item.product_id, receipt.warehouse_id, item.quantity, receiptId], (err5) => {
                                if (err5) {
                                    return db.rollback(() => res.status(500).json({ message: 'Database error', error: err5.message }));
                                }
                                applyItem(index + 1);
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
            if (results[0].status === 'Done') {
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