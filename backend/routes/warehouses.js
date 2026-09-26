const express = require('express');
const router = express.Router();

module.exports = (db) => {

    // CREATE a warehouse
    router.post('/', (req, res) => {
        const { name, address } = req.body;

        if (!name) {
            return res.status(400).json({ message: 'Name is required' });
        }

        db.query('INSERT INTO warehouses (name, address) VALUES (?, ?)', [name, address || null], (err, result) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            res.status(201).json({ message: 'Warehouse created', warehouseId: result.insertId });
        });
    });

    // GET all warehouses
    router.get('/', (req, res) => {
        db.query('SELECT * FROM warehouses', (err, results) => {
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
    router.put('/:id', (req, res) => {
        const { name, address } = req.body;

        db.query('UPDATE warehouses SET name = ?, address = ? WHERE id = ?', [name, address, req.params.id], (err, result) => {
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
    router.delete('/:id', (req, res) => {
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