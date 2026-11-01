// mdb-reader uses Node's Buffer: the "buffer" package (MIT) provides it in the page.
import { Buffer } from 'buffer';
globalThis.Buffer = globalThis.Buffer || Buffer;
