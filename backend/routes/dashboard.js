const express = require('express');
const router = express.Router();

module.exports = (db) => {

    // GET summary KPIs for the dashboard
    router.get('/summary', (req, res) => {
        const queries = {
            totalUnits: 'SELECT COALESCE(SUM(current_stock), 0) AS value FROM products',
            lowCount: 'SELECT COUNT(*) AS value FROM products WHERE current_stock > 0 AND current_stock <= min_stock',
            outCount: 'SELECT COUNT(*) AS value FROM products WHERE current_stock = 0',
            pendingDeliveries: "SELECT COUNT(*) AS value FROM deliveries WHERE status != 'Done'"
        };

        const keys = Object.keys(queries);
        const results = {};
        let remaining = keys.length;
        let failed = false;

        keys.forEach((key) => {
            db.query(queries[key], (err, rows) => {
                if (failed) return;
                if (err) {
                    failed = true;
                    return res.status(500).json({ message: 'Database error', error: err.message });
                }
                results[key] = rows[0].value;
                remaining -= 1;
                if (remaining === 0) {
                    res.json(results);
                }
            });
        });
    });

    return router;
};
