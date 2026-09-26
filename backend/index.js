const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect((err) => {
    if (err) {
        console.error('Database connection failed:', err.message);
        return;
    }
    console.log('Connected to MySQL database');
});

// ----- API routes -----
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes(db));

const productRoutes = require('./routes/products');
app.use('/api/products', productRoutes(db));

const warehouseRoutes = require('./routes/warehouses');
app.use('/api/warehouses', warehouseRoutes(db));

const receiptRoutes = require('./routes/receipts');
app.use('/api/receipts', receiptRoutes(db));

const deliveryRoutes = require('./routes/deliveries');
app.use('/api/deliveries', deliveryRoutes(db));

const transferRoutes = require('./routes/transfers');
app.use('/api/transfers', transferRoutes(db));

const adjustmentRoutes = require('./routes/adjustments');
app.use('/api/adjustments', adjustmentRoutes(db));

const ledgerRoutes = require('./routes/ledger');
app.use('/api/ledger', ledgerRoutes(db));

const dashboardRoutes = require('./routes/dashboard');
app.use('/api/dashboard', dashboardRoutes(db));

// ----- Frontend -----
// Serves the static assets and the single page app from the project root,
// so the whole thing runs from one server on one port.
app.use('/static', express.static(path.join(__dirname, '..', 'static')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'templates', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
