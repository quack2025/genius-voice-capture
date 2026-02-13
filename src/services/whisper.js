const { openai } = require('../config/openai');
const { supabaseAdmin } = require('../config/supabase');
const config = require('../config');

const VALID_LANGUAGES = ['es', 'en', 'pt', 'fr', 'de', 'it', 'ja', 'ko', 'zh'];

/**
 * Sleep helper for retry backoff
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
 * Get file extension from MIME type
 * @param {string} mimeType
 * @returns {string}
 */
function getExtensionFromMimeType(mimeType) {
    const extensions = {
        'audio/webm': 'webm',
        'audio/mp3': 'mp3',
        'audio/mpeg': 'mp3',
        'audio/wav': 'wav',
        'audio/mp4': 'mp4',
        'audio/ogg': 'ogg'
    };
    return extensions[mimeType] || 'webm';
}

/**
 * Transcribe audio directly from a Buffer (no storage download needed).
 * Uses OpenAI Whisper with timeout and retry.
 * @param {Buffer} audioBuffer - Raw audio data
 * @param {string} extension - File extension (webm, mp3, wav, etc.)
 * @param {string} language - Expected language (es, en, pt, etc.)
 * @returns {Promise<{text: string, language: string, duration: number}>}
 */
async function transcribeFromBuffer(audioBuffer, extension = 'webm', language = 'es') {
    const lang = VALID_LANGUAGES.includes(language) ? language : 'es';
    const mimeType = getMimeType(extension);
    const audioFile = new File([audioBuffer], `audio.${extension}`, { type: mimeType });

    const timeoutMs = config.whisperTimeoutMs || 30000;
    const maxRetries = config.whisperMaxRetries || 2;

    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const transcription = await Promise.race([
                openai.audio.transcriptions.create({
                    file: audioFile,
                    model: 'whisper-1',
                    language: lang,
                    response_format: 'verbose_json'
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Whisper API timeout')), timeoutMs)
                )
            ]);

            return {
                text: transcription.text,
                language: transcription.language,
                duration: transcription.duration
            };
        } catch (err) {
            lastError = err;
            console.warn(`Whisper attempt ${attempt}/${maxRetries} failed: ${err.message}`);

            // Don't retry on non-transient errors
            if (err.status === 400 || err.status === 401) {
                throw err;
            }

            if (attempt < maxRetries) {
                const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 1000; // jitter
                await sleep(backoff);
            }
        }
    }

    throw lastError;
}

/**
 * Transcribe audio file from Supabase Storage using OpenAI Whisper.
 * Downloads from storage, then delegates to transcribeFromBuffer.
 * @param {string} audioPath - Path in Supabase Storage
 * @param {string} language - Expected language (es, en, pt, etc.)
 * @returns {Promise<{text: string, language: string, duration: number}>}
 */
async function transcribeAudio(audioPath, language = 'es') {
    // 1. Download audio from Supabase Storage
    const { data, error } = await supabaseAdmin.storage
        .from(config.storageBucket)
        .download(audioPath);

    if (error) {
        throw new Error(`Failed to download audio: ${error.message}`);
    }

    // 2. Convert Blob to Buffer
    const audioBuffer = Buffer.from(await data.arrayBuffer());

    // 3. Determine extension from path
    const extension = audioPath.split('.').pop() || 'webm';

    // 4. Delegate to transcribeFromBuffer
    return transcribeFromBuffer(audioBuffer, extension, language);
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
    transcribeFromBuffer,
    calculateTranscriptionCost,
    getExtensionFromMimeType
};
