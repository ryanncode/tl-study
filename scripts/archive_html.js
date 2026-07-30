const fs = require('fs');
const path = require('path');

const VERSIONS_FILE = path.join(__dirname, '../versions.json');
const SITE_DIR = path.join(__dirname, '../_site');
const ARCHIVE_BASE_DIR = path.join(__dirname, '../archive');

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
        const topic = parts.length > 1 ? parts[0] : '';
        const basename = parts.length > 1 ? parts[1].replace('.qmd', '') : parts[0].replace('.qmd', '');
        const hash = data.document_hash;
        
        const topicDir = path.join(ARCHIVE_BASE_DIR, topic);
        if (!fs.existsSync(topicDir)) {
            fs.mkdirSync(topicDir, { recursive: true });
        }

        const sourceHtml = topic ? path.join(SITE_DIR, topic, `${basename}.html`) : path.join(SITE_DIR, `${basename}.html`);
        const targetHtml = path.join(topicDir, `${basename}_${hash}.html`);
        
        if (fs.existsSync(sourceHtml)) {
            if (!fs.existsSync(targetHtml)) {
                const targetRelative = topic ? `${topic}/${basename}_${hash}.html` : `${basename}_${hash}.html`;
                console.log(`[HTML Archiver] Archiving ${docKey.replace('.qmd', '.html')} to ${targetRelative}`);
                fs.copyFileSync(sourceHtml, targetHtml);
                
                // Copy directly to _site/archive/ to prevent Quarto render lifecycle race condition
                const siteArchiveDir = path.join(SITE_DIR, 'archive', topic);
                if (!fs.existsSync(siteArchiveDir)) {
                    fs.mkdirSync(siteArchiveDir, { recursive: true });
                }
                const siteTargetHtml = path.join(siteArchiveDir, `${basename}_${hash}.html`);
                fs.copyFileSync(sourceHtml, siteTargetHtml);
            }
        } else {
            console.warn(`[HTML Archiver] Warning: Source file ${sourceHtml} not found. Quarto may not have rendered it yet.`);
        }
    }
}

archiveSite();
