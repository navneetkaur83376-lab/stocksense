const express = require('express');
const router = express.Router();

module.exports = (db) => {

    // CREATE a product
    router.post('/', (req, res) => {
        const { name, sku, category, unit, current_stock } = req.body;

        if (!name || !sku) {
            return res.status(400).json({ message: 'Name and SKU are required' });
        }

        const query = 'INSERT INTO products (name, sku, category, unit, current_stock) VALUES (?, ?, ?, ?, ?)';
        db.query(query, [name, sku, category || null, unit || null, current_stock || 0], (err, result) => {
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
        db.query('SELECT * FROM products', (err, results) => {
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

    // UPDATE a product
    router.put('/:id', (req, res) => {
        const { name, sku, category, unit, current_stock } = req.body;

        const query = 'UPDATE products SET name = ?, sku = ?, category = ?, unit = ?, current_stock = ? WHERE id = ?';
        db.query(query, [name, sku, category, unit, current_stock, req.params.id], (err, result) => {
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
    router.delete('/:id', (req, res) => {
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