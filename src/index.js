require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { errorHandler } = require('./middleware/errorHandler');

// Import routes
const uploadRoutes = require('./routes/upload');
const projectsRoutes = require('./routes/projects');
const recordingsRoutes = require('./routes/recordings');
const transcribeRoutes = require('./routes/transcribe');
const exportRoutes = require('./routes/export');
const transcribeImmediateRoutes = require('./routes/transcribeImmediate');
const path = require('path');

const app = express();

// Security middleware
// Allow cross-origin loading of voice.js widget from external survey pages
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false
}));

// Serve static files BEFORE CORS so voice.js is always accessible
// (CORS middleware rejects requests without Origin header in production,
//  which would block the widget script from being loaded)
app.use(express.static(path.join(__dirname, '..', 'public')));

// CORS configuration
function isOriginAllowed(origin) {
    // In production, require an origin header to prevent CSRF
    if (!origin) {
        return config.nodeEnv === 'development';
    }
    if (config.allowedOrigins.includes(origin)) return true;
    return config.wildcardPatterns.some(pattern => pattern.test(origin));
}

app.use(cors({
    origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-project-key']
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // max 100 requests per IP
    message: {
        success: false,
        error: 'Too many upload requests, please try again later'
    },
    standardHeaders: true,
    legacyHeaders: false
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: {
        success: false,
        error: 'Too many requests, please try again later'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
    });
});

// Explicit route for voice.js widget (safety net in case express.static fails)
app.get('/voice.js', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'voice.js'));
});

// API routes
app.use('/api/transcribe', uploadLimiter, transcribeImmediateRoutes);
app.use('/api/upload', uploadLimiter, uploadRoutes);
app.use('/api/projects', apiLimiter, projectsRoutes);
app.use('/api/projects/:projectId/recordings', apiLimiter, recordingsRoutes);
app.use('/api/projects/:projectId/transcribe-batch', apiLimiter, transcribeRoutes);
app.use('/api/projects/:projectId/export', apiLimiter, exportRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Global error handler
app.use(errorHandler);

// Start server
const PORT = config.port;

app.listen(PORT, () => {
    console.log(`Voice Capture API running on port ${PORT}`);
    console.log(`Environment: ${config.nodeEnv}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
