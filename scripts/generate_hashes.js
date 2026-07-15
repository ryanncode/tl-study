const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NF_SET_THEORY_DIR = path.join(__dirname, '../nf-set-theory');
const OUTPUT_FILE = path.join(__dirname, '../versions.json');

// Helper to generate a short 8-character hex hash
function generateHash(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex').substring(0, 8);
}

function processDirectory() {
    const versions = {
        documents: {}
    };

    let existing = null;
    if (fs.existsSync(OUTPUT_FILE)) {
        try {
            existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
        } catch (e) {}
    }

    const files = fs.readdirSync(NF_SET_THEORY_DIR);
    const qmdFiles = files.filter(f => f.endsWith('.qmd'));

    qmdFiles.forEach(file => {
        const filePath = path.join(NF_SET_THEORY_DIR, file);
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Hash for the entire document
        const docHash = generateHash(content);
        
        let historicalHashes = [];
        if (existing && existing.documents && existing.documents[file]) {
            historicalHashes = existing.documents[file].historical_hashes || [];
            const oldHash = existing.documents[file].document_hash;
            if (oldHash && oldHash !== docHash) {
                if (!historicalHashes.includes(oldHash)) {
                    historicalHashes.push(oldHash);
                }
            }
        }

        versions.documents[file] = {
            document_hash: docHash,
            historical_hashes: historicalHashes,
            problems: {}
        };

        // Extract individual problems and their hashes
        const problemRegex = /\*\*(Problem [^*]+)\*\*[\s\S]*?<textarea id="([^"]+)"/g;
        let match;
        
        while ((match = problemRegex.exec(content)) !== null) {
            const problemTitle = match[1].trim();
            const problemId = match[2].trim();
            const problemBlock = match[0].trim();
            versions.documents[file].problems[problemId] = {
                title: problemTitle,
                hash: generateHash(problemBlock)
            };
        }
    });

    versions.generated_at = new Date().toISOString();

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(versions, null, 2));
    console.log(`[Version Sync] Successfully generated file-level versions.json`);
}

processDirectory();
