const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');

module.exports = (db) => {

    // CREATE and immediately apply an adjustment.
    // body: { product_id, warehouse_id, physical_qty, reason }
    router.post('/', requireAuth, (req, res) => {
        const { product_id, warehouse_id, physical_qty, reason } = req.body;
        const created_by = req.user.id;

        if (!product_id || !warehouse_id || physical_qty === undefined || physical_qty === null) {
            return res.status(400).json({ message: 'product_id, warehouse_id and physical_qty are required' });
        }
        if (physical_qty < 0) {
            return res.status(400).json({ message: 'physical_qty cannot be negative' });
        }

        db.query(
            'SELECT quantity FROM product_stock WHERE product_id = ? AND warehouse_id = ?',
            [product_id, warehouse_id],
            (err, rows) => {
                if (err) {
                    return res.status(500).json({ message: 'Database error', error: err.message });
                }
                const recorded_qty = rows.length ? rows[0].quantity : 0;
                const diff_qty = physical_qty - recorded_qty;

                if (diff_qty === 0) {
                    // Still log it for the audit trail, but nothing to change in stock.
                    const logQuery = 'INSERT INTO adjustments (product_id, warehouse_id, recorded_qty, physical_qty, diff_qty, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)';
                    return db.query(logQuery, [product_id, warehouse_id, recorded_qty, physical_qty, diff_qty, reason || null, created_by], (errLog, result) => {
                        if (errLog) {
                            return res.status(500).json({ message: 'Database error', error: errLog.message });
                        }
                        res.status(201).json({ message: 'No variance found; adjustment logged', adjustmentId: result.insertId, diff_qty });
                    });
                }

                db.beginTransaction((txErr) => {
                    if (txErr) {
                        return res.status(500).json({ message: 'Transaction error', error: txErr.message });
                    }

                    const upsertQuery = `
                        INSERT INTO product_stock (product_id, warehouse_id, quantity)
                        VALUES (?, ?, ?)
                        ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)
                    `;
                    db.query(upsertQuery, [product_id, warehouse_id, physical_qty], (errStock) => {
                        if (errStock) {
                            return db.rollback(() => res.status(500).json({ message: 'Database error', error: errStock.message }));
                        }

                        db.query('UPDATE products SET current_stock = current_stock + ? WHERE id = ?', [diff_qty, product_id], (errProduct) => {
                            if (errProduct) {
                                return db.rollback(() => res.status(500).json({ message: 'Database error', error: errProduct.message }));
                            }

                            const adjQuery = 'INSERT INTO adjustments (product_id, warehouse_id, recorded_qty, physical_qty, diff_qty, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)';
                            db.query(adjQuery, [product_id, warehouse_id, recorded_qty, physical_qty, diff_qty, reason || null, created_by], (errAdj, adjResult) => {
                                if (errAdj) {
                                    return db.rollback(() => res.status(500).json({ message: 'Database error', error: errAdj.message }));
                                }

                                const ledgerQuery = `
                                    INSERT INTO stock_ledger (product_id, warehouse_id, change_qty, reason, reference_type, reference_id)
                                    VALUES (?, ?, ?, 'adjustment', 'adjustment', ?)
                                `;
                                db.query(ledgerQuery, [product_id, warehouse_id, diff_qty, adjResult.insertId], (errLedger) => {
                                    if (errLedger) {
                                        return db.rollback(() => res.status(500).json({ message: 'Database error', error: errLedger.message }));
                                    }
                                    db.commit((commitErr) => {
                                        if (commitErr) {
                                            return db.rollback(() => res.status(500).json({ message: 'Commit error', error: commitErr.message }));
                                        }
                                        res.status(201).json({ message: 'Adjustment applied, stock updated', adjustmentId: adjResult.insertId, diff_qty });
                                    });
                                });
                            });
                        });
                    });
                });
            }
        );
    });

    // GET recent adjustments (audit log)
    router.get('/', (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const query = `
            SELECT a.*, p.name AS product_name, p.sku, p.unit, w.name AS warehouse_name
            FROM adjustments a
            JOIN products p ON p.id = a.product_id
            JOIN warehouses w ON w.id = a.warehouse_id
            ORDER BY a.created_at DESC
            LIMIT ?
        `;
        db.query(query, [limit], (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            res.json(results);
        });
    });

    return router;
};
