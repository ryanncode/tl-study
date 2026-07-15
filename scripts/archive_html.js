const fs = require('fs');
const path = require('path');

const VERSIONS_FILE = path.join(__dirname, '../versions.json');
const SITE_DIR = path.join(__dirname, '../_site');
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

    // docKey is "topic/file.qmd"
    for (const [docKey, data] of Object.entries(versions.documents)) {
        const parts = docKey.split('/');
        const topic = parts[0];
        const basename = parts[1].replace('.qmd', '');
        const hash = data.document_hash;
        
        const sourceHtml = path.join(SITE_DIR, topic, `${basename}.html`);
        const targetHtml = path.join(ARCHIVE_BASE_DIR, `${topic}_${basename}_${hash}.html`);
        
        if (fs.existsSync(sourceHtml)) {
            if (!fs.existsSync(targetHtml)) {
                console.log(`[HTML Archiver] Archiving ${topic}/${basename}.html to ${topic}_${basename}_${hash}.html`);
                fs.copyFileSync(sourceHtml, targetHtml);
            }
        } else {
            console.warn(`[HTML Archiver] Warning: Source file ${sourceHtml} not found. Quarto may not have rendered it yet.`);
        }
    }
}

archiveSite();
