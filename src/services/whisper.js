const { openai } = require('../config/openai');
const { supabaseAdmin } = require('../config/supabase');
const config = require('../config');

const WHISPER_TIMEOUT_MS = 60000; // 60 seconds
const MAX_RETRIES = 3;
const VALID_LANGUAGES = ['es', 'en', 'pt', 'fr', 'de', 'it', 'ja', 'ko', 'zh'];

/**
 * Sleep helper for retry backoff
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Transcribe audio file using OpenAI Whisper with timeout and retry
 * @param {string} audioPath - Path in Supabase Storage
 * @param {string} language - Expected language (es, en, pt, etc.)
 * @returns {Promise<{text: string, language: string, duration: number}>}
 */
async function transcribeAudio(audioPath, language = 'es') {
    // Validate language
    const lang = VALID_LANGUAGES.includes(language) ? language : 'es';

    // 1. Download audio from Supabase Storage
    const { data, error } = await supabaseAdmin.storage
        .from(config.storageBucket)
        .download(audioPath);

    if (error) {
        throw new Error(`Failed to download audio: ${error.message}`);
    }

    // 2. Convert Blob to Buffer
    const audioBuffer = Buffer.from(await data.arrayBuffer());

    // Determine file extension from path
    const extension = audioPath.split('.').pop() || 'webm';
    const mimeType = getMimeType(extension);

    const audioFile = new File([audioBuffer], `audio.${extension}`, { type: mimeType });

    // 3. Call Whisper API with retry and timeout
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const transcription = await Promise.race([
                openai.audio.transcriptions.create({
                    file: audioFile,
                    model: 'whisper-1',
                    language: lang,
                    response_format: 'verbose_json'
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Whisper API timeout')), WHISPER_TIMEOUT_MS)
                )
            ]);

            return {
                text: transcription.text,
                language: transcription.language,
                duration: transcription.duration
            };
        } catch (err) {
            lastError = err;
            console.warn(`Whisper attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);

            // Don't retry on non-transient errors
            if (err.status === 400 || err.status === 401) {
                throw err;
            }

            if (attempt < MAX_RETRIES) {
                const backoff = Math.pow(2, attempt) * 1000; // 2s, 4s
                await sleep(backoff);
            }
        }
    }

    throw lastError;
}

/**
 * Get MIME type from file extension
 * @param {string} extension
 * @returns {string}
 */
function getMimeType(extension) {
    const mimeTypes = {
        'webm': 'audio/webm',
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'mp4': 'audio/mp4',
        'ogg': 'audio/ogg',
        'mpeg': 'audio/mpeg'
    };
    return mimeTypes[extension.toLowerCase()] || 'audio/webm';
}

/**
 * Calculate estimated cost for transcription
 * @param {number} durationSeconds - Total duration in seconds
 * @returns {number} - Estimated cost in USD
 */
function calculateTranscriptionCost(durationSeconds) {
    const minutes = durationSeconds / 60;
    return Math.ceil(minutes * config.whisperCostPerMinute * 10000) / 10000;
}

module.exports = {
    transcribeAudio,
    calculateTranscriptionCost
};
