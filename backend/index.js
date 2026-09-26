const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// NEW: connect the auth routes
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes(db));

const productRoutes = require('./routes/products');
app.use('/api/products', productRoutes(db));

const warehouseRoutes = require('./routes/warehouses');
app.use('/api/warehouses', warehouseRoutes(db));

const receiptRoutes = require('./routes/receipts');
app.use('/api/receipts', receiptRoutes(db));

const transferRoutes = require('./routes/transfers');
app.use('/api/transfers', transferRoutes(db));

app.get('/', (req, res) => {
    res.send('StockSense API is running');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});