// DataBrief: encrypted Access databases are not supported; the encryption libraries are replaced by this stub (see tools/build-mdb-reader.sh).
function unsupported() { const e = new Error('encrypted'); e.code = 'ENCRYPTED'; throw e; }
export default { createDecipheriv: unsupported };
