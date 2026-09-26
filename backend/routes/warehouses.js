const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');

module.exports = (db) => {

    // CREATE a warehouse
    router.post('/', requireAuth, (req, res) => {
        const { name, address, capacity } = req.body;

        if (!name) {
            return res.status(400).json({ message: 'Name is required' });
        }

        db.query('INSERT INTO warehouses (name, address, capacity) VALUES (?, ?, ?)', [name, address || null, capacity || 5000], (err, result) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            res.status(201).json({ message: 'Warehouse created', warehouseId: result.insertId });
        });
    });

    // GET all warehouses, with how many units are currently stored in each
    router.get('/', (req, res) => {
        const query = `
            SELECT w.*, COALESCE(SUM(ps.quantity), 0) AS stored_units
            FROM warehouses w
            LEFT JOIN product_stock ps ON ps.warehouse_id = w.id
            GROUP BY w.id
            ORDER BY w.name
        `;
        db.query(query, (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            res.json(results);
        });
    });

    // GET a single warehouse
    router.get('/:id', (req, res) => {
        db.query('SELECT * FROM warehouses WHERE id = ?', [req.params.id], (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (results.length === 0) {
                return res.status(404).json({ message: 'Warehouse not found' });
            }
            res.json(results[0]);
        });
    });

    // UPDATE a warehouse
    router.put('/:id', requireAuth, (req, res) => {
        const { name, address, capacity } = req.body;

        db.query('UPDATE warehouses SET name = ?, address = ?, capacity = ? WHERE id = ?', [name, address, capacity, req.params.id], (err, result) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Warehouse not found' });
            }
            res.json({ message: 'Warehouse updated' });
        });
    });

    // DELETE a warehouse
    router.delete('/:id', requireAuth, (req, res) => {
        db.query('DELETE FROM warehouses WHERE id = ?', [req.params.id], (err, result) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Warehouse not found' });
            }
            res.json({ message: 'Warehouse deleted' });
        });
    });

    return router;
};
