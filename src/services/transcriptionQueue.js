const { supabaseAdmin } = require('../config/supabase');
const { transcribeAudio, calculateTranscriptionCost } = require('./whisper');

// Simple in-memory concurrency limiter
const MAX_CONCURRENT = 3;
let activeJobs = 0;
const pendingQueue = [];

function runWithConcurrencyLimit(fn) {
    return new Promise((resolve, reject) => {
        const execute = async () => {
            activeJobs++;
            try {
                const result = await fn();
                resolve(result);
            } catch (err) {
                reject(err);
            } finally {
                activeJobs--;
                // Process next in queue
                if (pendingQueue.length > 0) {
                    const next = pendingQueue.shift();
                    next();
                }
            }
        };

        if (activeJobs < MAX_CONCURRENT) {
            execute();
        } else {
            pendingQueue.push(execute);
        }
    });
}

/**
 * Process a single recording transcription
 * @param {string} recordingId - Recording UUID
 * @returns {Promise<{success: boolean, transcription?: string, error?: string}>}
 */
async function processRecording(recordingId) {
    try {
        // Get recording details
        const { data: recording, error: fetchError } = await supabaseAdmin
            .from('recordings')
            .select('id, audio_path, status, project_id, projects(language)')
            .eq('id', recordingId)
            .single();

        if (fetchError || !recording) {
            throw new Error(`Recording not found: ${recordingId}`);
        }

        // Guard: don't re-process completed recordings
        if (recording.status === 'completed') {
            return { success: true, transcription: 'Already transcribed' };
        }

        // Update status to processing
        await supabaseAdmin
            .from('recordings')
            .update({ status: 'processing' })
            .eq('id', recordingId);

        // Transcribe
        const language = recording.projects?.language || 'es';
        const result = await transcribeAudio(recording.audio_path, language);

        // Update with transcription
        await supabaseAdmin
            .from('recordings')
            .update({
                status: 'completed',
                transcription: result.text,
                language_detected: result.language,
                duration_seconds: Math.round(result.duration),
                transcribed_at: new Date().toISOString()
            })
            .eq('id', recordingId);

        return { success: true, transcription: result.text };
    } catch (error) {
        // Update with error
        await supabaseAdmin
            .from('recordings')
            .update({
                status: 'failed',
                error_message: error.message
            })
            .eq('id', recordingId)
            .catch(dbErr => console.error('Failed to update recording status:', dbErr));

        return { success: false, error: error.message };
    }
}

/**
 * Process batch transcription with concurrency control
 * @param {string} batchId - Batch UUID
 * @returns {Promise<void>}
 */
async function processBatch(batchId) {
    try {
        // Get all recordings for this batch
        const { data: recordings, error: fetchError } = await supabaseAdmin
            .from('recordings')
            .select('id')
            .eq('batch_id', batchId)
            .eq('status', 'processing');

        if (fetchError) {
            throw new Error(`Failed to fetch batch recordings: ${fetchError.message}`);
        }

        if (!recordings || recordings.length === 0) {
            await supabaseAdmin
                .from('transcription_batches')
                .update({ status: 'completed', completed_at: new Date().toISOString() })
                .eq('id', batchId);
            return;
        }

        let completedCount = 0;
        let failedCount = 0;

        // Process each recording sequentially (Whisper calls are rate-limited by the concurrency limiter)
        for (const recording of recordings) {
            const result = await runWithConcurrencyLimit(
                () => processRecording(recording.id)
            );

            if (result.success) {
                completedCount++;
            } else {
                failedCount++;
            }

            // Update batch progress
            await supabaseAdmin
                .from('transcription_batches')
                .update({
                    completed_count: completedCount,
                    failed_count: failedCount
                })
                .eq('id', batchId);
        }

        // Calculate actual cost from completed recordings
        const { data: completedRecordings } = await supabaseAdmin
            .from('recordings')
            .select('duration_seconds')
            .eq('batch_id', batchId)
            .eq('status', 'completed');

        let actualCost = 0;
        if (completedRecordings) {
            const totalDuration = completedRecordings.reduce(
                (sum, r) => sum + (r.duration_seconds || 0),
                0
            );
            actualCost = calculateTranscriptionCost(totalDuration);
        }

        // Mark batch as completed
        const finalStatus = failedCount > 0 && completedCount > 0 ? 'partial' :
                           failedCount === recordings.length ? 'failed' : 'completed';

        await supabaseAdmin
            .from('transcription_batches')
            .update({
                status: finalStatus,
                actual_cost_usd: actualCost,
                completed_at: new Date().toISOString()
            })
            .eq('id', batchId);

        console.log(`Batch ${batchId} completed: ${completedCount} ok, ${failedCount} failed`);
    } catch (error) {
        console.error('Batch processing error:', error);

        await supabaseAdmin
            .from('transcription_batches')
            .update({ status: 'failed' })
            .eq('id', batchId)
            .catch(dbErr => console.error('Failed to update batch status:', dbErr));
    }
}

/**
 * Enqueue recording for transcription with concurrency control
 * @param {string} recordingId - Recording UUID
 * @returns {Promise<void>}
 */
async function enqueueTranscription(recordingId) {
    // Process with concurrency limit (max 3 simultaneous Whisper calls)
    // NOTE: For production scale, replace with BullMQ + Redis
    runWithConcurrencyLimit(() => processRecording(recordingId)).catch(err => {
        console.error(`Failed to process recording ${recordingId}:`, err);
    });
}

/**
 * Start batch processing (async with concurrency control)
 * @param {string} batchId - Batch UUID
 * @returns {Promise<void>}
 */
async function startBatchProcessing(batchId) {
    // Process in background with concurrency control
    // NOTE: For production scale, replace with BullMQ + Redis
    processBatch(batchId).catch(err => {
        console.error(`Failed to process batch ${batchId}:`, err);
    });
}

module.exports = {
    processRecording,
    processBatch,
    enqueueTranscription,
    startBatchProcessing
};
