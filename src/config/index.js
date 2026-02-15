require('dotenv').config();

const config = {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',

    // Límites de audio
    maxAudioSizeMB: parseInt(process.env.MAX_AUDIO_SIZE_MB, 10) || 10,
    maxAudioDurationSeconds: parseInt(process.env.MAX_AUDIO_DURATION_SECONDS, 10) || 180,

    // Formatos de audio permitidos
    allowedAudioMimeTypes: [
        'audio/webm',
        'audio/mp3',
        'audio/mpeg',
        'audio/wav',
        'audio/mp4',
        'audio/ogg'
    ],

    // Storage
    storageBucket: 'voice-recordings',

    // Signed URL expiration (1 hour)
    signedUrlExpiration: 3600,

    // Whisper transcription settings
    whisperCostPerMinute: 0.006,
    whisperTimeoutMs: parseInt(process.env.WHISPER_TIMEOUT_MS, 10) || 30000,   // 30s default
    whisperMaxRetries: parseInt(process.env.WHISPER_MAX_RETRIES, 10) || 2,     // 2 retries default

    // CORS origins
    allowedOrigins: [
        'https://voice.geniuslabs.ai',
        'https://voiceapi.survey-genius.ai',
        'http://localhost:3000',
        'http://localhost:5173'
    ],

    wildcardPatterns: [
        /^https:\/\/.*\.lovable\.app$/,
        /^https:\/\/.*\.alchemer\.com$/,
        /^https:\/\/.*\.alchemer\.eu$/,
        /^https:\/\/.*\.surveygizmo\.com$/
    ]
};

module.exports = config;
