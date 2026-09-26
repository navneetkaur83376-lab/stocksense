const express = require('express');
const router = express.Router();

module.exports = (db) => {

    // GET recent stock movements, joined with product/warehouse names
    router.get('/', (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const query = `
            SELECT sl.*, p.name AS product_name, p.sku, w.name AS warehouse_name
            FROM stock_ledger sl
            JOIN products p ON p.id = sl.product_id
            JOIN warehouses w ON w.id = sl.warehouse_id
            ORDER BY sl.created_at DESC
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
