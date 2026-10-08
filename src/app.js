const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const configureRoutes = require('./routes/index');
const config = require('./config');
const bcrypt = require('bcryptjs');
const Admin = require('./models/Admin');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req, res) => {
  res.status(200).json({
    message: '🏸 Badminton Payment Server is running!',
    version: 'v1',
    status: 'healthy'
  });
});

// Routes
configureRoutes(app);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

// Start server
const PORT = config.PORT || 5000;

connectDB().then(async () => {
  // Ensure scorer account admin/12345678 exists
  try {
    const existingScorer = await Admin.findOne({ username: 'admin' });
    if (!existingScorer) {
      const hashedPassword = await bcrypt.hash('12345678', 12);
      await Admin.create({
        username: 'admin',
        password: hashedPassword,
        name: 'Trọng Tài Tỉ Số',
        role: 'scorer'
      });
      console.log('✅ Auto-provisioned scorer account: admin / 12345678');
    } else if (existingScorer.role !== 'scorer') {
      existingScorer.role = 'scorer';
      await existingScorer.save();
    }
  } catch (err) {
    console.error('⚠️ Auto-provision scorer error:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`🏸 Server is running on port ${PORT}`);
    console.log(`📡 API: http://localhost:${PORT}/api`);
    console.log(`💳 Webhook: POST http://localhost:${PORT}/api/payments/sepay-webhook`);
  });
});

module.exports = app;
