const fs = require('fs');
const path = require('path');

const VERSIONS_FILE = path.join(__dirname, '../versions.json');
const CONTENT_DIR = path.join(__dirname, '../_site/nf-set-theory');
const ARCHIVE_BASE_DIR = path.join(__dirname, '../_site/archive');

function archiveSite() {
    if (!fs.existsSync(VERSIONS_FILE)) {
        console.error("[HTML Archiver] versions.json not found. Run generate_hashes.js first.");
        return;
    }

    const versions = JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf8'));

    if (!fs.existsSync(ARCHIVE_BASE_DIR)) {
        fs.mkdirSync(ARCHIVE_BASE_DIR, { recursive: true });
    }

    for (const [filename, data] of Object.entries(versions.documents)) {
        const basename = filename.replace('.qmd', '');
        const hash = data.document_hash;
        
        const sourceHtml = path.join(CONTENT_DIR, `${basename}.html`);
        const targetHtml = path.join(ARCHIVE_BASE_DIR, `${basename}_${hash}.html`);
        
        if (fs.existsSync(sourceHtml)) {
            if (!fs.existsSync(targetHtml)) {
                console.log(`[HTML Archiver] Archiving ${basename}.html to ${basename}_${hash}.html`);
                fs.copyFileSync(sourceHtml, targetHtml);
            }
        } else {
            console.warn(`[HTML Archiver] Warning: Source file ${sourceHtml} not found. Quarto may not have rendered it yet.`);
        }
    }
}

archiveSite();
