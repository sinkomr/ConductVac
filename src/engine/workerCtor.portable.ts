/**
 * Portable-build worker constructor: the worker bundle is inlined into the
 * main chunk (base64) and instantiated through a Blob URL. Browsers refuse
 * to load worker FILES from file:// pages (opaque-origin CORS), but Blob
 * workers are allowed — this is what lets the single-file conductvac.html
 * run from a double-click with no server.
 */
import EngineWorker from './worker?worker&inline';

export default EngineWorker;
