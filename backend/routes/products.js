const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');

module.exports = (db) => {

    // CREATE a product
    router.post('/', requireAuth, (req, res) => {
        const { name, sku, category, unit, current_stock, min_stock } = req.body;

        if (!name || !sku) {
            return res.status(400).json({ message: 'Name and SKU are required' });
        }

        const query = 'INSERT INTO products (name, sku, category, unit, current_stock, min_stock) VALUES (?, ?, ?, ?, ?, ?)';
        db.query(query, [name, sku, category || null, unit || 'units', current_stock || 0, min_stock ?? 10], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({ message: 'SKU already exists' });
                }
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            res.status(201).json({ message: 'Product created', productId: result.insertId });
        });
    });

    // GET all products
    router.get('/', (req, res) => {
        db.query('SELECT * FROM products ORDER BY name', (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            res.json(results);
        });
    });

    // GET stock for every product broken down by warehouse (used to render the
    // inventory table with a location column, and to know per-warehouse availability)
    router.get('/stock/breakdown', (req, res) => {
        const query = `
            SELECT p.id AS product_id, p.name, p.sku, p.category, p.unit, p.min_stock,
                   w.id AS warehouse_id, w.name AS warehouse_name,
                   COALESCE(ps.quantity, 0) AS quantity
            FROM products p
            CROSS JOIN warehouses w
            LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.warehouse_id = w.id
            ORDER BY p.name, w.name
        `;
        db.query(query, (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            res.json(results);
        });
    });

    // GET a single product by id
    router.get('/:id', (req, res) => {
        db.query('SELECT * FROM products WHERE id = ?', [req.params.id], (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (results.length === 0) {
                return res.status(404).json({ message: 'Product not found' });
            }
            res.json(results[0]);
        });
    });

    // GET a single product's stock by warehouse
    router.get('/:id/stock', (req, res) => {
        const query = `
            SELECT w.id AS warehouse_id, w.name AS warehouse_name, COALESCE(ps.quantity, 0) AS quantity
            FROM warehouses w
            LEFT JOIN product_stock ps ON ps.warehouse_id = w.id AND ps.product_id = ?
            ORDER BY w.name
        `;
        db.query(query, [req.params.id], (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            res.json(results);
        });
    });

    // UPDATE a product
    router.put('/:id', requireAuth, (req, res) => {
        const { name, sku, category, unit, current_stock, min_stock } = req.body;

        const query = 'UPDATE products SET name = ?, sku = ?, category = ?, unit = ?, current_stock = ?, min_stock = ? WHERE id = ?';
        db.query(query, [name, sku, category, unit, current_stock, min_stock, req.params.id], (err, result) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Product not found' });
            }
            res.json({ message: 'Product updated' });
        });
    });

    // DELETE a product
    router.delete('/:id', requireAuth, (req, res) => {
        db.query('DELETE FROM products WHERE id = ?', [req.params.id], (err, result) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Product not found' });
            }
            res.json({ message: 'Product deleted' });
        });
    });

    return router;
};
