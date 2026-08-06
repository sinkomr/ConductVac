/**
 * Engine-worker constructor, isolated so the PORTABLE build can swap it for
 * the inline (Blob-URL) variant via a Vite alias — see workerCtor.portable.ts
 * and vite.portable.config.ts. The normal build keeps the separate worker
 * file (cacheable, smaller main bundle).
 */
import EngineWorker from './worker?worker';

export default EngineWorker;
