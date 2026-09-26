const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const requireAuth = require('../middleware/auth');
const router = express.Router();

module.exports = (db) => {

    // SIGNUP
    router.post('/signup', async (req, res) => {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ message: 'Name, email, and password are required' });
        }

        try {
            const hashedPassword = await bcrypt.hash(password, 10);

            const query = 'INSERT INTO users (name, email, password) VALUES (?, ?, ?)';
            db.query(query, [name, email, hashedPassword], (err, result) => {
                if (err) {
                    if (err.code === 'ER_DUP_ENTRY') {
                        return res.status(409).json({ message: 'Email already registered' });
                    }
                    return res.status(500).json({ message: 'Database error', error: err.message });
                }
                res.status(201).json({ message: 'User created successfully', userId: result.insertId });
            });
        } catch (error) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    // LOGIN
    router.post('/login', (req, res) => {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        const query = 'SELECT * FROM users WHERE email = ?';
        db.query(query, [email], async (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (results.length === 0) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }

            const user = results[0];
            const isMatch = await bcrypt.compare(password, user.password);

            if (!isMatch) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }

            const token = jwt.sign(
                { id: user.id, email: user.email },
                process.env.JWT_SECRET,
                { expiresIn: '1d' }
            );

            res.json({ message: 'Login successful', token, user: { id: user.id, name: user.name, email: user.email } });
        });
    });

    // CURRENT USER - lets the frontend verify a stored token on page load
    router.get('/me', requireAuth, (req, res) => {
        db.query('SELECT id, name, email FROM users WHERE id = ?', [req.user.id], (err, results) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (results.length === 0) {
                return res.status(404).json({ message: 'User not found' });
            }
            res.json({ user: results[0] });
        });
    });

    return router;
};